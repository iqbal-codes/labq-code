import type {
  Command,
  CommandResult,
  DomainEvent,
  Project,
  Snapshot,
  SourceDescriptor,
  Thread,
  Turn,
} from "@labq/domain/types";
import { applyEvent } from "@labq/engine/projector";
import type {
  OrchestratorTransportPort,
  SubscriptionScope,
  TransportError,
  TransportSnapshotResult,
  TransportSyncResult,
} from "./transport-port";

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

interface Listener {
  scope: SubscriptionScope;
  onEvent: (event: DomainEvent) => void;
}

/**
 * In-memory orchestration transport used for development bootstrap and tests.
 * It is browser-safe (no Node/Bun APIs) and reduces a small, real command
 * surface into canonical domain events using the shared projector, so the
 * client store and components exercise the same ordered-event contract as the
 * production transport without a server or provider SDK.
 */
export class FakeTransport implements OrchestratorTransportPort {
  private snapshot: Snapshot;
  private sequence = 0;
  private listeners = new Set<Listener>();
  private seenCommands = new Map<string, CommandResult>();
  private forcedSnapshotError: TransportError | null = null;

  constructor(opts?: { snapshotError?: TransportError }) {
    const empty: Snapshot = {
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
    this.snapshot = empty;
    this.forcedSnapshotError = opts?.snapshotError ?? null;
  }

  /** Dev/test hook: push an authoritative event to all matching subscribers. */
  emit(event: DomainEvent): void {
    this.snapshot = applyEvent(this.snapshot, event);
    if (event.kind !== "SnapshotEmitted") {
      this.snapshot.sequence = event.sequence;
    }
    for (const listener of this.listeners) {
      if (this.matchesScope(listener.scope, event)) {
        listener.onEvent(event);
      }
    }
  }

  /** Dev/test hook: replace the authoritative snapshot. */
  setSnapshot(snapshot: Snapshot): void {
    this.snapshot = structuredClone(snapshot);
    this.sequence = snapshot.sequence;
  }

  setSnapshotError(error: TransportError | null): void {
    this.forcedSnapshotError = error;
  }

  getScopedSnapshot(scope: SubscriptionScope): TransportSnapshotResult {
    if (this.forcedSnapshotError) return this.forcedSnapshotError;
    return this.scopeSnapshot(this.snapshot, scope);
  }

  sync(cursor: number, scope: SubscriptionScope): TransportSyncResult {
    if (cursor >= this.snapshot.sequence) {
      return { ok: true, mode: "up_to_date", sequence: this.snapshot.sequence };
    }
    // The fake keeps the full event log implicitly via the snapshot; for replay
    // we surface the events by re-deriving them is unnecessary — a real replay
    // would return stored events. Here we fall back to the authoritative
    // snapshot when the cursor is behind, which the store treats as fallback.
    return {
      ok: true,
      mode: "snapshot",
      sequence: this.snapshot.sequence,
      snapshot: this.scopeSnapshot(this.snapshot, scope),
      reason: "fake_replay",
    };
  }

  subscribe(scope: SubscriptionScope, onEvent: (event: DomainEvent) => void): () => void {
    const listener: Listener = { scope, onEvent };
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispatchCommand(command: Command): Promise<CommandResult> {
    const existing = this.seenCommands.get(command.command_id);
    if (existing) {
      return { ...existing, duplicate: true };
    }
    const result = this.reduce(command);
    if (result.ok) {
      this.seenCommands.set(command.command_id, result);
    }
    return result;
  }

  // --- internals ---------------------------------------------------------

  private matchesScope(scope: SubscriptionScope, event: DomainEvent): boolean {
    if (scope.project_id || scope.thread_id) {
      const pid = this.projectIdForEvent(event);
      if (scope.project_id && pid && pid !== scope.project_id) return false;
      if (scope.thread_id) {
        const tid = this.threadIdForEvent(event);
        if (tid && tid !== scope.thread_id) return false;
      }
    }
    return true;
  }

  private projectIdForEvent(event: DomainEvent): string | undefined {
    const d = event.data as Record<string, unknown>;
    if (d.project) return (d.project as Project).id;
    if (d.project_id) return d.project_id as string;
    if (d.thread) return (d.thread as Thread).project_id;
    if (d.thread_id) return this.snapshot.threads[d.thread_id as string]?.project_id;
    if (d.turn)
      return (d.turn as Turn).thread_id
        ? this.snapshot.threads[(d.turn as Turn).thread_id]?.project_id
        : undefined;
    return undefined;
  }

  private threadIdForEvent(event: DomainEvent): string | undefined {
    const d = event.data as Record<string, unknown>;
    if (d.thread) return (d.thread as Thread).id;
    if (d.thread_id) return d.thread_id as string;
    if (d.turn) return (d.turn as Turn).thread_id;
    if (d.turn_id) return d.turn_id as string;
    return undefined;
  }

  private nextEvent(
    kind: DomainEvent["kind"],
    data: Record<string, unknown>,
    commandId: string,
  ): DomainEvent {
    this.sequence += 1;
    return {
      kind,
      data,
      sequence: this.sequence,
      event_id: uid(),
      timestamp: nowIso(),
      command_id: commandId,
    } as DomainEvent;
  }

  private reduce(command: Command): CommandResult {
    const id = command.command_id;
    switch (command.kind) {
      case "create_project": {
        const projectId = command.project_id ?? uid();
        const project: Project = {
          id: projectId,
          name: command.name,
          source: normalizeSource(command.source),
          status: "active",
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        this.emit(this.nextEvent("ProjectCreated", { project }, id));
        return { ok: true, project_id: projectId, status: "active" };
      }
      case "archive_project":
        this.emit(this.nextEvent("ProjectArchived", { project_id: command.project_id }, id));
        return { ok: true, project_id: command.project_id, status: "archived" };
      case "settle_project":
        this.emit(this.nextEvent("ProjectSettled", { project_id: command.project_id }, id));
        return { ok: true, project_id: command.project_id, status: "settled" };
      case "delete_project":
        this.emit(this.nextEvent("ProjectDeleted", { project_id: command.project_id }, id));
        return { ok: true, project_id: command.project_id, status: "deleted" };
      case "create_thread": {
        const threadId = command.thread_id ?? uid();
        const thread: Thread = {
          id: threadId,
          project_id: command.project_id,
          title: command.title ?? "New thread",
          status: "active",
          session_status: "none",
          model: command.model,
          access_profile: command.access_profile,
          interaction_mode: command.interaction_mode,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        this.emit(this.nextEvent("ThreadCreated", { thread }, id));
        return { ok: true, thread_id: threadId, status: "active" };
      }
      case "archive_thread":
        this.emit(this.nextEvent("ThreadArchived", { thread_id: command.thread_id }, id));
        return { ok: true, thread_id: command.thread_id, status: "archived" };
      case "settle_thread":
        this.emit(this.nextEvent("ThreadSettled", { thread_id: command.thread_id }, id));
        return { ok: true, thread_id: command.thread_id, status: "settled" };
      case "delete_thread":
        this.emit(this.nextEvent("ThreadDeleted", { thread_id: command.thread_id }, id));
        return { ok: true, thread_id: command.thread_id, status: "deleted" };
      case "start_turn": {
        const turnId = command.turn_id ?? uid();
        const turn: Turn = {
          id: turnId,
          thread_id: command.thread_id,
          status: "queued",
          user_message: command.content,
          activities: {},
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        this.emit(this.nextEvent("TurnQueued", { turn }, id));
        this.emit(this.nextEvent("TurnStarted", { turn_id: turnId }, id));
        return { ok: true, turn_id: turnId, status: "queued" };
      }
      case "interrupt_turn":
        this.emit(this.nextEvent("TurnInterrupted", { turn_id: command.turn_id }, id));
        return { ok: true, turn_id: command.turn_id, status: "interrupted" };
      case "stop_turn":
        this.emit(this.nextEvent("SessionStopped", { thread_id: command.thread_id }, id));
        return { ok: true, status: "stopped" };
      case "respond_approval":
        this.emit(
          this.nextEvent(
            "PendingRequestResolved",
            {
              turn_id: command.turn_id,
              request_id: command.request_id,
              response: { decision: command.decision },
            },
            id,
          ),
        );
        return { ok: true };
      case "respond_input":
        this.emit(
          this.nextEvent(
            "PendingRequestResolved",
            {
              turn_id: command.turn_id,
              request_id: command.request_id,
              response: { values: command.values },
            },
            id,
          ),
        );
        return { ok: true };
      default:
        return {
          ok: false,
          code: "unsupported_command",
          detail: `FakeTransport does not reduce command kind: ${(command as { kind: string }).kind}`,
        };
    }
  }

  private scopeSnapshot(snapshot: Snapshot, scope: SubscriptionScope): Snapshot {
    if (!scope.project_id && !scope.thread_id) return structuredClone(snapshot);
    const threadId = scope.thread_id;
    const projectId = scope.project_id;
    const projects = projectId ? filterKeys(snapshot.projects, [projectId]) : snapshot.projects;
    const threads = filterKeys(
      snapshot.threads,
      Object.keys(snapshot.threads).filter((tid) => {
        const t = snapshot.threads[tid];
        if (threadId) return t.id === threadId;
        return t.project_id === projectId;
      }),
    );
    const turns = filterKeys(
      snapshot.turns,
      Object.keys(snapshot.turns).filter((tuid) => {
        const t = snapshot.turns[tuid];
        if (threadId) return t.thread_id === threadId;
        if (projectId) {
          const th = snapshot.threads[t.thread_id];
          return th?.project_id === projectId;
        }
        return true;
      }),
    );
    return { ...structuredClone(snapshot), projects, threads, turns };
  }
}

function filterKeys<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of keys) {
    if (k in record) out[k] = record[k];
  }
  return out;
}

function normalizeSource(source: SourceDescriptor): Project["source"] {
  switch (source.kind) {
    case "local_folder":
      return {
        kind: "local_folder",
        status: "bound",
        locator: source.path,
        workspace_path: source.path,
      };
    case "git_url":
      return { kind: "git_url", status: "acquired", locator: source.url };
    default:
      return {
        kind: source.kind,
        status: "setup_required",
        locator: (source as { repo: string }).repo,
      };
  }
}
