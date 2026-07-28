import {
  Command,
  DomainEvent,
  CommandReceipt,
  CommandResult,
  Snapshot,
  Project,
  Thread,
  SyncResult,
} from "../domain/types.js";
import { SourceManager } from "../source/source-manager.js";
import { decideCommand } from "./decider.js";
import { applyEvent, createInitialSnapshot, rebuildSnapshot } from "./projector.js";
import { DEFAULT_PI_CATALOG } from "../catalog/pi-catalog.js";

export class OrchestratorEngine {
  private events: DomainEvent[] = [];
  private receipts: Map<string, CommandReceipt> = new Map();
  private snapshot: Snapshot;
  private nextSequence = 1;
  private sourceManager: SourceManager;
  private listeners: Set<(event: DomainEvent) => void> = new Set();

  constructor(sourceManager?: SourceManager) {
    this.sourceManager = sourceManager || new SourceManager();
    this.snapshot = createInitialSnapshot(DEFAULT_PI_CATALOG);
  }

  async dispatchCommand(command: Command): Promise<CommandResult> {
    // 1. Idempotency check: duplicate command returning existing receipt
    const existingReceipt = this.receipts.get(command.command_id);
    if (existingReceipt) {
      return {
        ...existingReceipt.result,
        duplicate: true,
      };
    }

    // 2. Resolve source for project creation if applicable
    let resolvedSource;
    if (command.kind === "create_project") {
      const sourceRes = await this.sourceManager.validateAndAcquire(
        command.source
      );
      if (!sourceRes.ok) {
        const errorResult: CommandResult = {
          ok: false,
          code: sourceRes.code,
          detail: sourceRes.detail,
        };
        this.receipts.set(command.command_id, {
          command_id: command.command_id,
          result: errorResult,
          sequences: [],
        });
        return errorResult;
      }
      resolvedSource = sourceRes.source;
    }

    // 3. Evaluate domain decision
    const nowIso = new Date().toISOString();
    const decision = decideCommand(
      this.snapshot,
      command,
      resolvedSource,
      nowIso
    );

    if (!decision.ok) {
      if (resolvedSource && resolvedSource.status === "acquired" && resolvedSource.workspace_path) {
        this.sourceManager.cleanupPath(resolvedSource.workspace_path);
      }
      const errorResult: CommandResult = {
        ok: false,
        code: decision.code,
        detail: decision.detail,
      };
      this.receipts.set(command.command_id, {
        command_id: command.command_id,
        result: errorResult,
        sequences: [],
      });
      return errorResult;
    }

    // 4. Construct and append globally sequenced domain events
    const sequences: number[] = [];
    const newEvents: DomainEvent[] = [];

    for (const draft of decision.events) {
      const seq = this.nextSequence++;
      const domainEvent = {
        sequence: seq,
        event_id: `evt-${seq}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: nowIso,
        command_id: command.command_id,
        correlation_id: command.correlation_id || command.command_id,
        causation_id: command.causation_id,
        kind: draft.kind,
        data: draft.data,
      } as DomainEvent;
      sequences.push(seq);
      newEvents.push(domainEvent);
      this.events.push(domainEvent);
      this.snapshot = applyEvent(this.snapshot, domainEvent);
    }

    const successResult: CommandResult = {
      ok: true,
      ...decision.resultData,
    };

    this.receipts.set(command.command_id, {
      command_id: command.command_id,
      result: successResult,
      sequences,
    });

    // 5. Notify live subscribers
    for (const event of newEvents) {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // Prevent listener errors from corrupting engine loop
        }
      }
    }

    return successResult;
  }

  // Queries
  getSnapshot(): Snapshot {
    return structuredClone(this.snapshot);
  }

  rebuildSnapshotFromHistory(): Snapshot {
    return rebuildSnapshot(this.events, this.snapshot.catalog);
  }

  getProject(projectId: string, includeDeleted = false): Project | undefined {
    const proj = this.snapshot.projects[projectId];
    if (!proj) return undefined;
    if (!includeDeleted && proj.status === "deleted") return undefined;
    return structuredClone(proj);
  }

  listProjects(includeDeleted = false): Project[] {
    const list = Object.values(this.snapshot.projects).filter(
      (p) => includeDeleted || p.status !== "deleted"
    );
    return structuredClone(list);
  }

  getThread(threadId: string, includeDeleted = false): Thread | undefined {
    const th = this.snapshot.threads[threadId];
    if (!th) return undefined;
    if (!includeDeleted && th.status === "deleted") return undefined;
    return structuredClone(th);
  }

  listThreads(projectId: string, includeDeleted = false): Thread[] {
    const list = Object.values(this.snapshot.threads).filter(
      (t) =>
        t.project_id === projectId &&
        (includeDeleted || t.status !== "deleted")
    );
    return structuredClone(list);
  }

  getEvents(fromSequence = 1): DomainEvent[] {
    const list = this.events.filter((e) => e.sequence >= fromSequence);
    return structuredClone(list);
  }

  sync(cursor: number): SyncResult {
    if (cursor === this.snapshot.sequence) {
      return { ok: true, mode: "up_to_date", sequence: cursor };
    }
    if (cursor < 0 || cursor > this.snapshot.sequence) {
      return {
        ok: true,
        mode: "snapshot",
        sequence: this.snapshot.sequence,
        snapshot: this.getSnapshot(),
        reason: "invalid_cursor",
      };
    }
    const replayEvents = this.events.filter((e) => e.sequence > cursor);
    return {
      ok: true,
      mode: "replay",
      from: cursor,
      to: this.snapshot.sequence,
      events: replayEvents,
    };
  }

  subscribe(listener: (event: DomainEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
