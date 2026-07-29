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
    this.maxReplayRetries = Math.max(1, options.maxReplayRetries ?? 3);
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
    let attempts = 0;
    try {
      while (attempts < this.maxReplayRetries) {
        attempts++;
        if (this.subscription) {
          this.subscription.unsubscribe();
          this.subscription = null;
        }

        const currentCursor = this.lastSequence;
        const syncRes = this.transport.sync(this.token, currentCursor, {
          environment_id: this.environmentId,
          project_id: this.projectId,
          thread_id: this.threadId,
        });

        if (!syncRes || typeof syncRes !== "object" || !("ok" in syncRes) || !syncRes.ok) {
          continue;
        }

        if (syncRes.mode === "up_to_date") {
          await this.ensureSubscriptionActive({ after_sequence: this.lastSequence, emitInitialSnapshot: false });
          this.reconnecting = false;
          return syncRes;
        }

        if (syncRes.mode === "replay") {
          const events = syncRes.events;
          if (events.length === 0 && currentCursor < syncRes.to) {
            continue;
          }

          let valid = true;
          let expectedSeq = currentCursor + 1;
          for (const ev of events) {
            if (ev.sequence !== expectedSeq) {
              valid = false;
              break;
            }
            expectedSeq++;
          }

          if (!valid) {
            continue;
          }

          const resultingSeq = events.length > 0 ? events[events.length - 1].sequence : currentCursor;
          if (resultingSeq !== syncRes.to) {
            continue;
          }

          let tempSnapshot = structuredClone(this.snapshot);
          for (const ev of events) {
            tempSnapshot = applyEvent(tempSnapshot, ev);
          }
          this.snapshot = tempSnapshot;
          this.lastSequence = resultingSeq;

          await this.ensureSubscriptionActive({ after_sequence: this.lastSequence, emitInitialSnapshot: false });
          this.reconnecting = false;
          return syncRes;
        }

        if (syncRes.mode === "snapshot") {
          const snap = syncRes.snapshot;
          this.snapshot = structuredClone(snap);
          this.lastSequence = snap.sequence;
          await this.ensureSubscriptionActive({ after_sequence: this.lastSequence, emitInitialSnapshot: false });
          this.reconnecting = false;
          return syncRes;
        }
      }

      return await this.fallbackToFreshSnapshot("replay_failed");
    } catch {
      return await this.fallbackToFreshSnapshot("exception");
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Apply live server-authoritative event at most once,
   * protecting newer live state against stale or out-of-order cached state.
   */
  applyLiveEvent(event: DomainEvent): { applied: boolean; gap: boolean } {
    if (event.kind === "SnapshotEmitted") {
      const snap = (event as { snapshot?: Snapshot; data?: { snapshot?: Snapshot } }).snapshot ?? (event as { data?: { snapshot?: Snapshot } }).data?.snapshot;
      if (snap && snap.sequence > this.lastSequence) {
        this.snapshot = structuredClone(snap);
        this.lastSequence = snap.sequence;
        return { applied: true, gap: false };
      }
      return { applied: false, gap: false };
    }

    if (event.sequence <= this.lastSequence) {
      return { applied: false, gap: false };
    }

    if (event.sequence > this.lastSequence + 1) {
      this.reconnecting = true;
      this.triggerRecovery();
      return { applied: false, gap: true };
    }

    this.snapshot = applyEvent(this.snapshot, event);
    this.lastSequence = event.sequence;
    return { applied: true, gap: false };
  }

  private triggerRecovery(): void {
    if (this.recoveryPromise) return;
    this.reconnecting = true;

    this.recoveryPromise = this.reconnect().finally(() => {
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

    if (snapRes.sequence > this.lastSequence) {
      this.snapshot = structuredClone(snapRes);
      this.lastSequence = snapRes.sequence;
    }
    return { ok: true };
  }

  private async fallbackToFreshSnapshot(reason: string): Promise<SyncResult> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    const snapRes = this.transport.getScopedSnapshot(this.token, {
      environment_id: this.environmentId,
      project_id: this.projectId,
      thread_id: this.threadId,
    });

    if (!isSnapshot(snapRes)) {
      throw new Error(`Failed snapshot fallback: unauthorized or unavailable snapshot (${reason})`);
    }

    if (snapRes.sequence < this.lastSequence) {
      throw new Error(`Failed snapshot fallback: returned snapshot sequence (${snapRes.sequence}) is older than current cursor (${this.lastSequence})`);
    } else if (snapRes.sequence > this.lastSequence) {
      this.snapshot = structuredClone(snapRes);
      this.lastSequence = snapRes.sequence;
    }

    await this.ensureSubscriptionActive({ after_sequence: this.lastSequence, emitInitialSnapshot: false });
    this.reconnecting = false;

    return {
      ok: true,
      mode: "snapshot",
      sequence: snapRes.sequence,
      snapshot: snapRes,
      reason,
    };
  }

  private async ensureSubscriptionActive(params?: { after_sequence?: number; emitInitialSnapshot?: boolean }): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    const subRes = this.transport.createSubscription(
      this.token,
      {
        environment_id: this.environmentId,
        project_id: this.projectId,
        thread_id: this.threadId,
        after_sequence: params?.after_sequence,
      },
      { emitInitialSnapshot: params?.emitInitialSnapshot ?? true }
    );
    if (subRes.ok) {
      this.subscription = subRes.subscription;
      this.connected = true;
      this.subscription.onEvent((event) => {
        this.applyLiveEvent(event);
      });
    } else {
      throw new Error(`Failed to activate transport subscription: ${subRes.detail}`);
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
