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

interface ListenerEntry {
  listener: (event: DomainEvent) => void;
  filter?: { project_id?: string; thread_id?: string };
}

export class OrchestratorEngine {
  private events: DomainEvent[] = [];
  private receipts: Map<string, CommandReceipt> = new Map();
  private snapshot: Snapshot;
  private nextSequence = 1;
  private sourceManager: SourceManager;
  private listeners: Set<ListenerEntry> = new Set();
  private inFlightCommands: Map<string, Promise<CommandResult>> = new Map();
  private dispatchQueue: Promise<unknown> = Promise.resolve();

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

    // 2. In-flight check: concurrent command execution with same command_id
    const inFlight = this.inFlightCommands.get(command.command_id);
    if (inFlight) {
      const result = await inFlight;
      return {
        ...result,
        duplicate: true,
      };
    }

    // 3. Wrap execution in Promise and store in inFlightCommands
    const executionPromise = (async (): Promise<CommandResult> => {
      try {
        return await this.executeCommand(command);
      } finally {
        this.inFlightCommands.delete(command.command_id);
      }
    })();

    this.inFlightCommands.set(command.command_id, executionPromise);
    return await executionPromise;
  }

  private async executeCommand(command: Command): Promise<CommandResult> {
    const queuePromise = this.dispatchQueue.then(() => this.processCommand(command));
    this.dispatchQueue = queuePromise.catch(() => {});
    return await queuePromise;
  }

  private async processCommand(command: Command): Promise<CommandResult> {
    // Re-check receipt inside queue lock
    const existingReceipt = this.receipts.get(command.command_id);
    if (existingReceipt) {
      return {
        ...existingReceipt.result,
        duplicate: true,
      };
    }

    // 1. Resolve source for project creation if applicable
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

    // 2. Evaluate domain decision
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

    // 3. Construct and append globally sequenced domain events
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

    // 4. Notify live subscribers
    for (const event of newEvents) {
      for (const entry of this.listeners) {
        if (entry.filter) {
          const { project_id, thread_id } = entry.filter;
          let eventProjectId: string | undefined;
          let eventThreadId: string | undefined;

          if (event.kind === "ProjectCreated") {
            eventProjectId = event.data.project.id;
          } else if (
            event.kind === "ProjectArchived" ||
            event.kind === "ProjectSettled" ||
            event.kind === "ProjectDeleted"
          ) {
            eventProjectId = event.data.project_id;
          } else if (event.kind === "ThreadCreated") {
            eventThreadId = event.data.thread.id;
            eventProjectId = event.data.thread.project_id;
          } else if (
            event.kind === "ThreadArchived" ||
            event.kind === "ThreadSettled" ||
            event.kind === "ThreadDeleted"
          ) {
            eventThreadId = event.data.thread_id;
            eventProjectId = this.snapshot.threads[event.data.thread_id]?.project_id;
          }

          if (project_id !== undefined && eventProjectId !== project_id) {
            continue;
          }
          if (thread_id !== undefined && eventThreadId !== thread_id) {
            continue;
          }
        }

        try {
          entry.listener(structuredClone(event));
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

  getReceipt(commandId: string): CommandReceipt | undefined {
    const receipt = this.receipts.get(commandId);
    return receipt ? structuredClone(receipt) : undefined;
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
      events: structuredClone(replayEvents),
    };
  }

  getScopedSnapshot(filter?: { project_id?: string; thread_id?: string }): Snapshot {
    const full = this.getSnapshot();
    if (!filter || (!filter.project_id && !filter.thread_id)) {
      return full;
    }

    const projects: Record<string, Project> = {};
    const threads: Record<string, Thread> = {};

    if (filter.project_id && filter.thread_id) {
      const th = full.threads[filter.thread_id];
      if (th && th.project_id === filter.project_id) {
        threads[th.id] = th;
        if (full.projects[filter.project_id]) {
          projects[filter.project_id] = full.projects[filter.project_id];
        }
      }
    } else if (filter.thread_id && full.threads[filter.thread_id]) {
      const th = full.threads[filter.thread_id];
      threads[th.id] = th;
      if (full.projects[th.project_id]) {
        projects[th.project_id] = full.projects[th.project_id];
      }
    } else if (filter.project_id && full.projects[filter.project_id]) {
      projects[filter.project_id] = full.projects[filter.project_id];
      for (const th of Object.values(full.threads)) {
        if (th.project_id === filter.project_id) {
          threads[th.id] = th;
        }
      }
    }

    return {
      sequence: full.sequence,
      projects,
      threads,
      catalog: full.catalog,
    };
  }
  subscribe(
    listener: (event: DomainEvent) => void,
    filter?: { project_id?: string; thread_id?: string },
    options: { emitInitialSnapshot?: boolean } = { emitInitialSnapshot: true }
  ): () => void {
    const entry: ListenerEntry = { listener, filter };
    this.listeners.add(entry);

    if (options.emitInitialSnapshot !== false) {
      const snapshotEvent: DomainEvent = {
        sequence: this.snapshot.sequence,
        event_id: `snapshot-${this.snapshot.sequence}`,
        timestamp: new Date().toISOString(),
        command_id: "system-subscribe-snapshot",
        kind: "SnapshotEmitted",
        data: { snapshot: this.getScopedSnapshot(filter) },
      };
      try {
        listener(structuredClone(snapshotEvent));
      } catch {
        // Prevent listener error from breaking subscription
      }
    }

    return () => {
      this.listeners.delete(entry);
    };
  }
}
