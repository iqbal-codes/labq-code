import type { DomainEvent, Snapshot, SyncResult } from "../domain/types.js";
import { applyEvent } from "../engine/projector.js";
import type { OrchestratorTransport, OrchestratorSubscription } from "../transport/transport.js";
function isSnapshot(res: unknown): res is Snapshot {
  return Boolean(res && typeof res === "object" && "sequence" in res && "projects" in res);
}
export interface ReconnectingClientOptions {
  transport: OrchestratorTransport;
  token?: string;
  environment_id?: string;
  project_id?: string;
  thread_id?: string;
  maxReplayRetries?: number;
}

export class ReconnectingClient {
  private transport: OrchestratorTransport;
  private token?: string;
  private environmentId?: string;
  private projectId?: string;
  private threadId?: string;
  private maxReplayRetries: number;

  private snapshot: Snapshot = {
    sequence: 0,
    projects: {},
    threads: {},
    turns: {},
    catalog: {
      models: [],
      access_profiles: [],
      interaction_modes: [],
      capabilities: [],
    },
  };
  private lastSequence = 0;
  private connected = false;
  private reconnecting = false;
  private subscription: OrchestratorSubscription | null = null;
  private recoveryPromise: Promise<SyncResult> | null = null;

  constructor(options: ReconnectingClientOptions) {
    this.transport = options.transport;
    this.token = options.token;
    this.environmentId = options.environment_id;
    this.projectId = options.project_id;
    this.threadId = options.thread_id;
    this.maxReplayRetries = options.maxReplayRetries ?? 3;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const subRes = this.transport.createSubscription(this.token, {
      environment_id: this.environmentId,
      project_id: this.projectId,
      thread_id: this.threadId,
    });

    if (!subRes.ok) {
      throw new Error(`Failed to connect transport: ${subRes.detail}`);
    }

    this.subscription = subRes.subscription;
    this.connected = true;

    this.subscription.onEvent((event) => {
      this.applyLiveEvent(event);
    });

    // Initial snapshot sync if needed
    await this.syncSnapshot();
  }

  disconnect(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.connected = false;
  }

  simulateInvoluntaryDisconnect(): void {
    this.disconnect();
  }

  async reconnect(): Promise<SyncResult> {
    this.reconnecting = true;
    try {
      await this.ensureSubscriptionActive({ emitInitialSnapshot: false });

      const syncRes = this.transport.sync(this.token, this.lastSequence, {
        environment_id: this.environmentId,
        project_id: this.projectId,
        thread_id: this.threadId,
      });

      if (!syncRes.ok) {
        return await this.fallbackToFreshSnapshot("sync_failed");
      }

      if (syncRes.mode === "up_to_date") {
        this.reconnecting = false;
        return syncRes;
      }

      if (syncRes.mode === "replay") {
        for (const event of syncRes.events) {
          if (event.sequence > this.lastSequence) {
            this.snapshot = applyEvent(this.snapshot, event);
            this.lastSequence = event.sequence;
          }
        }
        this.reconnecting = false;
        return syncRes;
      }

      // Mode is "snapshot" or cursor was rejected
      return await this.fallbackToFreshSnapshot("cursor_rejected");
    } catch {
      return await this.fallbackToFreshSnapshot("exception");
    }
  }

  /**
   * Apply live server-authoritative event at most once,
   * protecting newer live state against stale or out-of-order cached state.
   */
  applyLiveEvent(event: DomainEvent): { applied: boolean; gap: boolean } {
    if (event.kind === "SnapshotEmitted") {
      const snap = event.data.snapshot;
      this.snapshot = structuredClone(snap);
      if (snap.sequence > this.lastSequence) {
        this.lastSequence = snap.sequence;
      }
      return { applied: true, gap: false };
    }

    if (event.sequence <= this.lastSequence) {
      // Ignore duplicate or older events (at-most-once delivery & cache protection)
      return { applied: false, gap: false };
    }

    if (event.sequence > this.lastSequence + 1) {
      // Sequence gap detected! Trigger reconnect/replay recovery
      this.reconnecting = true;
      this.triggerRecovery();
      return { applied: false, gap: true };
    }

    // Exact expected sequence (lastSequence + 1)
    this.snapshot = applyEvent(this.snapshot, event);
    this.lastSequence = event.sequence;
    return { applied: true, gap: false };
  }

  private triggerRecovery(): void {
    if (this.recoveryPromise) return;
    this.reconnecting = true;

    let retries = 0;
    const executeRecovery = async (): Promise<SyncResult> => {
      await Promise.resolve();
      while (retries <= this.maxReplayRetries) {
        try {
          const res = await this.reconnect();
          if (res.ok) {
            return res;
          }
        } catch (err) {
          if (retries >= this.maxReplayRetries) {
            break;
          }
        }
        retries++;
      }
      return await this.fallbackToFreshSnapshot("max_retries_exceeded");
    };

    this.recoveryPromise = executeRecovery().finally(() => {
      this.recoveryPromise = null;
      this.reconnecting = false;
    });
  }
  async awaitRecovery(): Promise<void> {
    if (this.recoveryPromise) {
      await this.recoveryPromise;
    }
  }

  async syncSnapshot(): Promise<{ ok: boolean }> {
    const snapRes = this.transport.getScopedSnapshot(this.token, {
      environment_id: this.environmentId,
      project_id: this.projectId,
      thread_id: this.threadId,
    });

    if (!isSnapshot(snapRes)) {
      return { ok: false };
    }

    this.snapshot = structuredClone(snapRes);
    if (snapRes.sequence > this.lastSequence) {
      this.lastSequence = snapRes.sequence;
    }
    return { ok: true };
  }

  private async fallbackToFreshSnapshot(reason: string): Promise<SyncResult> {
    const snapRes = this.transport.getScopedSnapshot(this.token, {
      environment_id: this.environmentId,
      project_id: this.projectId,
      thread_id: this.threadId,
    });

    if (!isSnapshot(snapRes)) {
      this.reconnecting = false;
      return {
        ok: true,
        mode: "snapshot",
        sequence: this.lastSequence,
        snapshot: this.snapshot,
        reason,
      };
    }

    this.snapshot = structuredClone(snapRes);
    this.lastSequence = snapRes.sequence;
    this.reconnecting = false;
    await this.ensureSubscriptionActive();

    return {
      ok: true,
      mode: "snapshot",
      sequence: snapRes.sequence,
      snapshot: snapRes,
      reason,
    };
  }

  private async ensureSubscriptionActive(options?: { emitInitialSnapshot?: boolean }): Promise<void> {
    if (!this.connected || !this.subscription) {
      const subRes = this.transport.createSubscription(
        this.token,
        {
          environment_id: this.environmentId,
          project_id: this.projectId,
          thread_id: this.threadId,
        },
        options
      );
      if (subRes.ok) {
        this.subscription = subRes.subscription;
        this.connected = true;
        this.subscription.onEvent((event) => {
          this.applyLiveEvent(event);
        });
      }
    }
  }

  getLastSequence(): number {
    return this.lastSequence;
  }

  getSnapshot(): Snapshot {
    return structuredClone(this.snapshot);
  }

  isReconnecting(): boolean {
    return this.reconnecting;
  }

  forceSetLastSequence(seq: number): void {
    this.lastSequence = seq;
  }
}
