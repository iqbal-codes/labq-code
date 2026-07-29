import type {
  Command,
  DomainEvent,
  CommandReceipt,
  CommandResult,
  Snapshot,
  Project,
  Thread,
  Turn,
  SyncResult,
} from "../domain/types.js";
import { boundChangeSummary, DEFAULT_ENVIRONMENT_ID } from "../domain/types.js";
import { sanitizeErrorMetadata, type CanonicalProviderEvent, type StartTurnParams } from "./provider-adapter.js";
import { SourceManager } from "../source/source-manager.js";
import { decideCommand } from "./decider.js";
import { applyEvent, createInitialSnapshot, rebuildSnapshot } from "./projector.js";
import { DEFAULT_PI_CATALOG } from "../catalog/pi-catalog.js";
import { ProviderService, resolveWorkspacePath } from "./provider-service.js";
import { PiAdapter } from "./pi-adapter.js";
import type { StorageAdapter } from "./storage-adapter.js";
import { InMemoryStorageAdapter } from "./storage-adapter.js";

interface ListenerEntry {
  listener: (event: DomainEvent) => void;
  filter?: { project_id?: string; thread_id?: string };
}

/**
 * Maps from turn_id to provider name for active streaming turns.
 */
interface ActiveTurnStream {
  turn_id: string;
  thread_id: string;
  providerName: string;
  abortController: AbortController;
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
  private providerService: ProviderService;
  private activeTurns: Map<string, ActiveTurnStream> = new Map();
  private storageAdapter: StorageAdapter;

  /**
   * Derive the provider name for a thread.
   * In v1, all Pi models map to the "pi" provider.
   */
  private resolveProviderName(threadId: string): string {
    const thread = this.snapshot.threads[threadId];
    if (!thread) return "pi";
    // v1: always "pi" — future: map from thread.model prefix
    return "pi";
  }

  constructor(sourceManager?: SourceManager, providerService?: ProviderService, storageAdapter?: StorageAdapter) {
    this.sourceManager = sourceManager || new SourceManager();
    const ps = providerService || new ProviderService();
    // Register the default Pi adapter only when no provider service was injected
    if (!providerService) {
      ps.registerAdapter("pi", new PiAdapter());
    }
    this.providerService = ps;
    this.storageAdapter = storageAdapter || new InMemoryStorageAdapter();
    this.snapshot = createInitialSnapshot(DEFAULT_PI_CATALOG);
    // Synchronously recover persisted state from storage (SQLite ops are sync)
    this.recoverFromStorage();
  }

  private recoverFromStorage(): void {
    try {
      const state = this.storageAdapter.loadAll();
      if (state.events.length > 0 || state.receipts.size > 0) {
        this.events = state.events;
        this.receipts = new Map(state.receipts);
        this.nextSequence = state.nextSequence;
        if (this.events.length > 0) {
          this.snapshot = rebuildSnapshot(this.events, this.snapshot.catalog);
        }
      }
    } catch {
      // Recovery failure leaves the default empty state
    }
  }

  async dispatchCommand(command: Command): Promise<CommandResult> {
    const commandValue = command as unknown as { command_id?: unknown };
    if (
      command === null ||
      typeof command !== "object" ||
      typeof commandValue.command_id !== "string" ||
      !commandValue.command_id.trim()
    ) {
      return {
        ok: false,
        code: "invalid_command",
        detail: "Command must include a non-empty command_id.",
      };
    }

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
        await this.storeErrorReceipt(command.command_id, errorResult);
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
      await this.storeErrorReceipt(command.command_id, errorResult);
      return errorResult;
    }

    // 3. Construct globally sequenced domain events
    const sequences: number[] = [];
    const newEvents: DomainEvent[] = [];
    let turnId: string | undefined;

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

      // Capture turn_id from TurnQueued for streaming kickoff
      if (draft.kind === "TurnQueued") {
        turnId = draft.data.turn.id;
      }
    }

    const successResult: CommandResult = {
      ok: true,
      ...decision.resultData,
    };

    const receipt: CommandReceipt = {
      command_id: command.command_id,
      result: successResult,
      sequences,
    };

    // 4. Atomically persist events + receipt to storage before mutating in-memory state.
    // A managed acquisition is provisional until this write succeeds. If the
    // durable write fails, release only that managed workspace and return the
    // sequence allocator to its pre-command position so an idempotent retry
    // can safely commit the command.
    try {
      await this.storageAdapter.persistCommandResult(newEvents, receipt);
    } catch (error) {
      this.nextSequence -= newEvents.length;
      if (resolvedSource?.status === "acquired" && resolvedSource.workspace_path) {
        this.sourceManager.cleanupPath(resolvedSource.workspace_path);
      }
      throw error;
    }
    // 5. Update in-memory state
    for (const event of newEvents) {
      this.events.push(event);
      this.snapshot = applyEvent(this.snapshot, event);
    }
    this.receipts.set(command.command_id, receipt);

    // 6. Notify live subscribers about the command-originated events
    for (const event of newEvents) {
      this.notifyListeners(event);
    }

    // 7. If this was a start_turn command, kick off async provider streaming
    if (command.kind === "start_turn" && turnId) {
      this.startTurnStream(command, turnId);
    }

    // 8. If this was interrupt_turn or stop_turn, signal the provider
    if (command.kind === "interrupt_turn" || command.kind === "stop_turn") {
      const turnId = command.turn_id;
      const active = turnId
        ? this.activeTurns.get(turnId)
        : Array.from(this.activeTurns.values()).find((a) => a.thread_id === command.thread_id);
      const thread = this.snapshot.threads[command.thread_id];
      const projectId = thread ? thread.project_id : "";
      const envId = command.environment_id || DEFAULT_ENVIRONMENT_ID;

      if (active) {
        if (command.kind === "stop_turn") {
          this.providerService
            .stopTurn(active.providerName, {
              environment_id: envId,
              project_id: projectId,
              turn_id: active.turn_id,
              thread_id: command.thread_id,
            })
            .catch(() => {});
        } else {
          this.providerService
            .interruptTurn(active.providerName, {
              environment_id: envId,
              project_id: projectId,
              turn_id: active.turn_id,
              thread_id: command.thread_id,
            })
            .catch(() => {});
        }
        active.abortController.abort();
        this.activeTurns.delete(active.turn_id);
      } else if (command.kind === "stop_turn") {
        this.providerService
          .stopTurn(this.resolveProviderName(command.thread_id), {
            environment_id: envId,
            project_id: projectId,
            turn_id: command.turn_id || "",
            thread_id: command.thread_id,
          })
          .catch(() => {});
      }
    }

    // 9. If this was respond_approval or respond_input, route the response
    //    back through the provider service to unblock the provider stream
    if (command.kind === "respond_approval" || command.kind === "respond_input") {
      const active = this.activeTurns.get(command.turn_id);
      if (active) {
        const response =
          command.kind === "respond_approval"
            ? { decision: command.decision }
            : { values: command.values };
        const turn = this.snapshot.turns[command.turn_id];
        const thread = turn ? this.snapshot.threads[turn.thread_id] : undefined;
        this.providerService
          .respondToRequest(active.providerName, {
            environment_id: command.environment_id || DEFAULT_ENVIRONMENT_ID,
            project_id: command.project_id || (turn ? turn.project_id : ""),
            thread_id: command.thread_id,
            turn_id: command.turn_id,
            provider_name: command.provider_name || "pi",
            provider_instance_id: command.provider_instance_id || "pi-default",
            session_id: command.session_id || (turn?.session_id || thread?.session_id || ""),
            request_id: command.request_id,
            response,
          })
          .catch(() => {});
      }
    }

    return successResult;
  }

  /**
   * Persist an error receipt for a failed command and update in-memory state.
   * DRY helper used by both source-validation and decider-error paths.
   */
  private async storeErrorReceipt(commandId: string, result: CommandResult): Promise<void> {
    const receipt: CommandReceipt = {
      command_id: commandId,
      result,
      sequences: [],
    };
    await this.storageAdapter.storeReceipt(receipt);
    this.receipts.set(commandId, receipt);
  }

  /**
   * Start the async provider streaming loop for a queued turn.
   * Records TurnStarted, then processes canonical provider events
   * by appending domain events until completion or failure.
   */
  private async startTurnStream(
    command: Command & { kind: "start_turn" },
    turnId: string
  ): Promise<void> {
    const thread = this.snapshot.threads[command.thread_id];
    if (!thread) return;

    const project = this.snapshot.projects[thread.project_id];
    if (!project) return;

    const workspacePath = resolveWorkspacePath(thread, this.snapshot.projects) || "";

    // v1: always "pi" provider
    const providerName = this.resolveProviderName(command.thread_id);

    const abortController = new AbortController();
    const activeStream: ActiveTurnStream = {
      turn_id: turnId,
      thread_id: command.thread_id,
      providerName,
      abortController,
    };
    this.activeTurns.set(turnId, activeStream);

    const startParams: StartTurnParams = {
      environment_id: command.environment_id || DEFAULT_ENVIRONMENT_ID,
      project_id: project.id,
      thread_id: command.thread_id,
      turn_id: turnId,
      provider_name: "pi",
      provider_instance_id: "pi-default",
      session_id: thread.session_id,
      project_workspace_path: workspacePath,
      model: thread.model,
      access_profile: thread.access_profile,
      interaction_mode: thread.interaction_mode,
      prompt: command.content.text,
      images: command.content.images,
      correlation_id: command.correlation_id || command.command_id,
      command_id: command.command_id,
      signal: abortController.signal,
    };

    try {
      const providerEvents = this.providerService.startTurn(providerName, startParams);

      let turnRunning = false;
      const seenProviderEvents = new Set<string>();

      for await (const providerEvent of providerEvents) {
        if (abortController.signal.aborted) {
          break;
        }
        if (providerEvent.provider_event_id) {
          const key = `${turnId}:${providerEvent.provider_event_id}`;
          if (seenProviderEvents.has(key)) continue;
          seenProviderEvents.add(key);
        }

        // If this is the first non-failure event and the provider hasn't
        // signaled turn start yet, emit TurnStarted to guarantee running state
        if (
          !turnRunning &&
          providerEvent.kind !== "provider_turn_failed"
        ) {
          const turn = this.snapshot.turns[turnId];
          if (turn && turn.status === "queued") {
            const currentThread = this.snapshot.threads[command.thread_id];
            const sessionId = currentThread?.session_id || `session-${command.thread_id}`;
            await this.appendStreamEvent(
              this.makeDomainEvent(
                {
                  kind: "SessionStarted",
                  data: {
                    environment_id: command.environment_id || DEFAULT_ENVIRONMENT_ID,
                    project_id: project.id,
                    thread_id: command.thread_id,
                    turn_id: turnId,
                    provider_name: "pi",
                    provider_instance_id: "pi-default",
                    session_id: sessionId,
                  },
                },
                turnId,
                command
              )
            );
            if (providerEvent.kind !== "provider_turn_started") {
              await this.appendStreamEvent(
                this.makeDomainEvent(
                  { kind: "TurnStarted", data: { turn_id: turnId } },
                  turnId,
                  command
                )
              );
            }
          }
          turnRunning = true;
        }

        const events = this.normalizeProviderEvent(providerEvent, turnId, command);
        for (const event of events) {
          await this.appendStreamEvent(event);
        }

        // Mark turn as running on first provider event
        if (!turnRunning) {
          turnRunning = true;
        }

        // If the provider stream ends or we hit a terminal state, stop
        if (
          providerEvent.kind === "provider_turn_completed" ||
          providerEvent.kind === "provider_turn_failed"
        ) {
          break;
        }

        // Check abort again after processing, in case the event handler itself
        // triggered an interrupt
        if (abortController.signal.aborted) {
          break;
        }
      }

      // Handle unexpected stream exhaustion: if the provider iterable closed
      // without a terminal event, fail the turn
      const finalStatus = this.snapshot.turns[turnId]?.status;
      if (
        finalStatus &&
        finalStatus !== "completed" &&
        finalStatus !== "failed" &&
        finalStatus !== "interrupted"
      ) {
        const failEvent = this.makeDomainEvent(
          {
            kind: "TurnFailed",
            data: {
              turn_id: turnId,
              error: {
                code: "provider_stream_exhausted",
                detail: "Provider stream ended without a terminal event.",
              },
            },
          },
          turnId,
          command
        );
        await this.appendStreamEvent(failEvent);
      }
    } catch (err: unknown) {
      // Only record failure if the turn wasn't explicitly interrupted/stopped
      const currentTurn = this.snapshot.turns[turnId];
      if (
        currentTurn &&
        (currentTurn.status === "queued" ||
          currentTurn.status === "running" ||
          currentTurn.status === "paused")
      ) {
        const errorMeta = sanitizeErrorMetadata(err);
        const failEvent = this.makeDomainEvent(
          {
            kind: "TurnFailed",
            data: {
              turn_id: turnId,
              error: errorMeta,
            },
          },
          turnId,
          command
        );
        await this.appendStreamEvent(failEvent);
      }
    } finally {
      this.activeTurns.delete(turnId);
    }
  }

  /**
   * Append a domain event from the streaming provider turn.
   * Persists to storage, sequences it, pushes to event log, projects to snapshot, notifies listeners.
   */
  private async appendStreamEvent(event: DomainEvent): Promise<void> {
    await this.storageAdapter.appendEvents([event]);
    this.events.push(event);
    this.snapshot = applyEvent(this.snapshot, event);
    this.notifyListeners(event);
  }

  /**
   * Normalize a canonical provider event into one or more domain events.
   */
  private normalizeProviderEvent(
    providerEvent: CanonicalProviderEvent,
    turnId: string,
    command: Command
  ): DomainEvent[] {
    const ts = new Date().toISOString();

    switch (providerEvent.kind) {
      case "provider_turn_started": {
        return [
          this.makeDomainEvent(
            { kind: "TurnStarted", data: { turn_id: turnId } },
            turnId,
            command,
            ts
          ),
        ];
      }
      case "assistant_text_delta": {
        return [
          this.makeDomainEvent(
            {
              kind: "AssistantMessageDelta",
              data: { turn_id: turnId, text: providerEvent.text },
            },
            turnId,
            command,
            ts
          ),
        ];
      }
      case "tool_activity_began": {
        const activity = {
          id: providerEvent.activity_id,
          turn_id: turnId,
          tool: providerEvent.tool,
          input: providerEvent.input,
          status: "in_progress" as const,
          started_at: ts,
        };
        return [
          this.makeDomainEvent(
            {
              kind: "ToolActivityBegan",
              data: { turn_id: turnId, activity },
            },
            turnId,
            command,
            ts
          ),
        ];
      }
      case "tool_activity_delta": {
        return [
          this.makeDomainEvent(
            {
              kind: "ToolActivityDelta",
              data: {
                turn_id: turnId,
                activity_id: providerEvent.activity_id,
                content: providerEvent.content,
              },
            },
            turnId,
            command,
            ts
          ),
        ];
      }
      case "tool_activity_completed": {
        return [
          this.makeDomainEvent(
            {
              kind: "ToolActivityCompleted",
              data: {
                turn_id: turnId,
                activity_id: providerEvent.activity_id,
                status: providerEvent.status,
                output: providerEvent.output,
                error: providerEvent.error,
              },
            },
            turnId,
            command,
            ts
          ),
        ];
      }
      case "assistant_message_completed": {
        return [
          this.makeDomainEvent(
            { kind: "AssistantMessageCompleted", data: { turn_id: turnId } },
            turnId,
            command,
            ts
          ),
        ];
      }
      case "provider_turn_completed": {
        return [
          this.makeDomainEvent(
            { kind: "TurnCompleted", data: { turn_id: turnId } },
            turnId,
            command,
            ts
          ),
        ];
      }
      case "provider_turn_failed": {
        return [
          this.makeDomainEvent(
            {
              kind: "TurnFailed",
              data: {
                turn_id: turnId,
                error: { code: providerEvent.code, detail: providerEvent.detail },
              },
            },
            turnId,
            command,
            ts
          ),
        ];
      }
      case "approval_requested": {
        const turn = this.snapshot.turns[turnId];
        const thread = turn ? this.snapshot.threads[turn.thread_id] : undefined;
        const resolvedThreadId = turn ? turn.thread_id : (command as { thread_id?: string }).thread_id || "";
        const request = {
          id: providerEvent.request_id,
          environment_id: turn ? turn.environment_id : command.environment_id,
          project_id: turn ? turn.project_id : (thread ? thread.project_id : ""),
          thread_id: resolvedThreadId,
          turn_id: turnId,
          provider_name: "pi" as const,
          provider_instance_id: "pi-default" as const,
          session_id: turn?.session_id || thread?.session_id || "",
          operation: providerEvent.operation,
          target_scope: providerEvent.target_scope,
          impact: providerEvent.impact,
          kind: "approval" as const,
          description: providerEvent.description,
          fields: [],
          status: "pending" as const,
          created_at: ts,
        };
        return [
          this.makeDomainEvent(
            {
              kind: "ApprovalRequested",
              data: { turn_id: turnId, request },
            },
            turnId,
            command,
            ts,
            providerEvent.provider_event_id
          ),
        ];
      }
      case "input_requested": {
        const turn = this.snapshot.turns[turnId];
        const thread = turn ? this.snapshot.threads[turn.thread_id] : undefined;
        const resolvedThreadId = turn ? turn.thread_id : (command as { thread_id?: string }).thread_id || "";
        const request = {
          id: providerEvent.request_id,
          environment_id: turn ? turn.environment_id : command.environment_id,
          project_id: turn ? turn.project_id : (thread ? thread.project_id : ""),
          thread_id: resolvedThreadId,
          turn_id: turnId,
          provider_name: "pi" as const,
          provider_instance_id: "pi-default" as const,
          session_id: turn?.session_id || thread?.session_id || "",
          operation: providerEvent.operation,
          target_scope: providerEvent.target_scope,
          impact: providerEvent.impact,
          kind: "input" as const,
          description: providerEvent.description,
          fields: providerEvent.fields,
          status: "pending" as const,
          created_at: ts,
        };
        return [
          this.makeDomainEvent(
            {
              kind: "InputRequested",
              data: { turn_id: turnId, request },
            },
            turnId,
            command,
            ts,
            providerEvent.provider_event_id
          ),
        ];
      }
      case "change_summary": {
        const summary = boundChangeSummary({
          ...providerEvent.summary,
          turn_id: turnId,
        });
        return [
          this.makeDomainEvent(
            {
              kind: "ChangeSummaryEmitted",
              data: { turn_id: turnId, summary },
            },
            turnId,
            command,
            ts
          ),
        ];
      }
    }
  }

  /**
   * Construct a DomainEvent with proper metadata from a raw draft.
   */
  private makeDomainEvent(
    draft: { kind: string; data: Record<string, unknown> },
    turnId: string,
    command: Command,
    timestamp?: string,
    providerEventId?: string
  ): DomainEvent {
    const seq = this.nextSequence++;
    const ts = timestamp || new Date().toISOString();
    const turn = this.snapshot.turns[turnId];
    const thread = turn ? this.snapshot.threads[turn.thread_id] : undefined;
    return {
      sequence: seq,
      event_id: `evt-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: ts,
      command_id: command.command_id,
      correlation_id: command.correlation_id || command.command_id,
      causation_id: command.causation_id,
      provider_name: turn?.provider_name || "pi",
      provider_instance_id: turn?.provider_instance_id || "pi-default",
      session_id: turn?.session_id || thread?.session_id,
      request_id: draft.kind === "ApprovalRequested" || draft.kind === "InputRequested"
        ? (draft.data.request as { id: string })?.id
        : (draft.kind === "PendingRequestResolved" ? (draft.data.request_id as string) : undefined),
      provider_event_id: providerEventId,
      kind: draft.kind,
      data: draft.data,
    } as DomainEvent;
  }

  /**
   * Resolve the thread_id for a turn, preferring the snapshot's authoritative
   * data over a command's thread_id to handle non-start_turn normalization paths.
   */
  private resolveTurnThreadId(turnId: string, command: Command): string {
    const turn = this.snapshot.turns[turnId];
    if (turn) return turn.thread_id;
    // Fallback: extract from the start_turn command if available
    if (command.kind === "start_turn") return command.thread_id;
    return "";
  }

  /**
   * Filter and notify subscribers about a domain event.
   */
  private notifyListeners(event: DomainEvent): void {
    for (const entry of this.listeners) {
      if (entry.filter) {
        const { project_id, thread_id } = entry.filter;
        const scoping = this.getEventScoping(event);
        let eventProjectId = scoping.project_id;
        let eventThreadId = scoping.thread_id;

        // For turn events, resolve project_id from the thread
        if (!eventProjectId && eventThreadId) {
          const th = this.snapshot.threads[eventThreadId];
          if (th) {
            eventProjectId = th.project_id;
          }
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

  /**
   * Extract project_id and thread_id from a domain event for subscription filtering.
   */
  private getEventScoping(event: DomainEvent): { project_id?: string; thread_id?: string } {
    switch (event.kind) {
      case "ProjectCreated":
        return { project_id: event.data.project.id };
      case "ProjectArchived":
      case "ProjectSettled":
      case "ProjectDeleted":
        return { project_id: event.data.project_id };
      case "ThreadCreated":
        return { project_id: event.data.thread.project_id, thread_id: event.data.thread.id };
      case "ThreadArchived":
      case "ThreadSettled":
      case "ThreadDeleted":
      case "SessionStopped":
        return { thread_id: event.data.thread_id };
      case "SessionStarted":
        return { project_id: event.data.project_id, thread_id: event.data.thread_id };
      case "TurnQueued":
        return { thread_id: event.data.turn.thread_id };
      case "TurnStarted":
      case "AssistantMessageDelta":
      case "ToolActivityBegan":
      case "ToolActivityDelta":
      case "ToolActivityCompleted":
      case "AssistantMessageCompleted":
      case "TurnPaused":
      case "TurnCompleted":
      case "TurnFailed":
      case "TurnInterrupted":
      case "ApprovalRequested":
      case "InputRequested":
      case "PendingRequestResolved":
      case "ChangeSummaryEmitted":
        return { thread_id: event.data.turn_id ? this.snapshot.turns[event.data.turn_id]?.thread_id : undefined };
      default:
        return {};
    }
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
    const project = this.snapshot.projects[th.project_id];
    if (
      !includeDeleted &&
      (th.status === "deleted" || project?.status === "deleted")
    ) {
      return undefined;
    }
    return structuredClone(th);
  }

  listThreads(projectId: string, includeDeleted = false): Thread[] {
    const project = this.snapshot.projects[projectId];
    const list = Object.values(this.snapshot.threads).filter(
      (t) =>
        t.project_id === projectId &&
        (includeDeleted ||
          (t.status !== "deleted" && project?.status !== "deleted"))
    );
    return structuredClone(list);
  }

  getTurn(turnId: string): Turn | undefined {
    const turn = this.snapshot.turns[turnId];
    return turn ? structuredClone(turn) : undefined;
  }

  listTurns(threadId: string): Turn[] {
    return structuredClone(
      Object.values(this.snapshot.turns).filter((t) => t.thread_id === threadId)
    );
  }

  getEvents(fromSequence = 1): DomainEvent[] {
    const list = this.events.filter((e) => e.sequence >= fromSequence);
    return structuredClone(list);
  }

  sync(cursor: number, filter?: { environment_id?: string; project_id?: string; thread_id?: string }): SyncResult {
    if (cursor === this.snapshot.sequence) {
      return { ok: true, mode: "up_to_date", sequence: cursor };
    }
    if (cursor < 0 || cursor > this.snapshot.sequence) {
      return {
        ok: true,
        mode: "snapshot",
        sequence: this.snapshot.sequence,
        snapshot: this.getScopedSnapshot(filter),
        reason: "invalid_cursor",
      };
    }
    let replayEvents = this.events.filter((e) => e.sequence > cursor);
    if (filter && (filter.project_id || filter.thread_id)) {
      replayEvents = replayEvents.filter((e) => {
        const scoping = this.getEventScoping(e);
        let eventProjectId = scoping.project_id;
        const eventThreadId = scoping.thread_id;

        if (!eventProjectId && eventThreadId) {
          const th = this.snapshot.threads[eventThreadId];
          if (th) {
            eventProjectId = th.project_id;
          }
        }

        if (filter.project_id !== undefined && eventProjectId !== filter.project_id) {
          return false;
        }
        if (filter.thread_id !== undefined && eventThreadId !== filter.thread_id) {
          return false;
        }
        return true;
      });
    }
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
    const turns: Record<string, Turn> = {};

    if (filter.project_id && filter.thread_id) {
      const th = full.threads[filter.thread_id];
      if (th && th.project_id === filter.project_id) {
        threads[th.id] = th;
        if (full.projects[filter.project_id]) {
          projects[filter.project_id] = full.projects[filter.project_id];
        }
        // Include turns for the scoped thread
        for (const t of Object.values(full.turns)) {
          if (t.thread_id === filter.thread_id) {
            turns[t.id] = t;
          }
        }
      }
    } else if (filter.thread_id && full.threads[filter.thread_id]) {
      const th = full.threads[filter.thread_id];
      threads[th.id] = th;
      if (full.projects[th.project_id]) {
        projects[th.project_id] = full.projects[th.project_id];
      }
      for (const t of Object.values(full.turns)) {
        if (t.thread_id === filter.thread_id) {
          turns[t.id] = t;
        }
      }
    } else if (filter.project_id && full.projects[filter.project_id]) {
      projects[filter.project_id] = full.projects[filter.project_id];
      for (const th of Object.values(full.threads)) {
        if (th.project_id === filter.project_id) {
          threads[th.id] = th;
        }
      }
      // Include turns for all threads in the project
      for (const t of Object.values(full.turns)) {
        const th = full.threads[t.thread_id];
        if (th && th.project_id === filter.project_id) {
          turns[t.id] = t;
        }
      }
    }

    return {
      sequence: full.sequence,
      projects,
      threads,
      turns,
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