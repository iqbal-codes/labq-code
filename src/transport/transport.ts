import type { Command, DomainEvent, Snapshot, SyncResult, CommandResult } from "../domain/types.js";
import { OrchestratorEngine } from "../engine/engine.js";

export interface WireCommandMessage {
  token?: string;
  command: Command;
}

export interface WireSubscriptionParams {
  environment_id?: string;
  project_id?: string;
  thread_id?: string;
  after_sequence?: number;
}

export interface OrchestratorSubscription {
  onEvent(listener: (event: DomainEvent) => void): () => void;
  unsubscribe(): void;
}

export type WireSubscriptionResult =
  | { ok: true; subscription: OrchestratorSubscription }
  | { ok: false; code: string; detail: string };

export type AuthorizeCallback = (
  token: string | undefined,
  action: "read" | "mutate",
  scope?: { project_id?: string; thread_id?: string }
) => boolean;

export interface OrchestratorTransportOptions {
  engine: OrchestratorEngine;
  authorize?: AuthorizeCallback;
}

const VALID_COMMAND_KINDS = new Set<string>([
  "create_project",
  "archive_project",
  "settle_project",
  "delete_project",
  "create_thread",
  "archive_thread",
  "settle_thread",
  "delete_thread",
  "start_turn",
  "interrupt_turn",
  "stop_turn",
  "respond_approval",
  "respond_input",
]);

export class OrchestratorTransport {
  private engine: OrchestratorEngine;
  private authorize?: AuthorizeCallback;

  constructor(options: OrchestratorTransportOptions) {
    this.engine = options.engine;
    this.authorize = options.authorize;
  }

  /**
   * Validate command wire payload and authorization before dispatching to engine.
   */
  async dispatchCommand(wireMessage: WireCommandMessage): Promise<CommandResult> {
    if (!wireMessage || typeof wireMessage !== "object" || !wireMessage.command) {
      return {
        ok: false,
        code: "invalid_wire_shape",
        detail: "Payload must be a WireCommandMessage with a valid command property.",
      };
    }

    const { command, token } = wireMessage;
    if (!command || typeof command !== "object" || typeof command.kind !== "string" || typeof command.command_id !== "string" || !command.command_id.trim()) {
      return {
        ok: false,
        code: "invalid_wire_shape",
        detail: "Command must include a valid string kind and non-empty command_id.",
      };
    }

    if (!VALID_COMMAND_KINDS.has(command.kind)) {
      return {
        ok: false,
        code: "invalid_wire_shape",
        detail: `Unknown command kind: ${command.kind}`,
      };
    }

    // Extract scoping from command for authorization check
    let scope: { environment_id?: string; project_id?: string; thread_id?: string } | undefined;
    if ("environment_id" in command && typeof command.environment_id === "string") {
      scope = { environment_id: command.environment_id };
    }
    if ("project_id" in command && typeof command.project_id === "string") {
      scope = { ...scope, project_id: command.project_id };
    } else if ("thread_id" in command && typeof command.thread_id === "string") {
      scope = { ...scope, thread_id: command.thread_id };
    }
    if (this.authorize && !this.authorize(token, "mutate", scope)) {
      return {
        ok: false,
        code: "unauthorized",
        detail: "Authorization denied for command mutation.",
      };
    }

    return this.engine.dispatchCommand(command);
  }

  /**
   * Create an authorized, environment- and thread-scoped subscription.
   */
  createSubscription(
    token: string | undefined,
    params: WireSubscriptionParams,
    options: { emitInitialSnapshot?: boolean } = { emitInitialSnapshot: true }
  ): WireSubscriptionResult {
    if (!params || typeof params !== "object") {
      return {
        ok: false,
        code: "invalid_wire_shape",
        detail: "Subscription params must be an object.",
      };
    }

    if (params.environment_id !== undefined && (typeof params.environment_id !== "string" || !params.environment_id.trim())) {
      return {
        ok: false,
        code: "invalid_wire_shape",
        detail: "environment_id must be a non-empty string when provided.",
      };
    }
    if (params.project_id !== undefined && (typeof params.project_id !== "string" || !params.project_id.trim())) {
      return {
        ok: false,
        code: "invalid_wire_shape",
        detail: "project_id must be a non-empty string when provided.",
      };
    }
    if (params.thread_id !== undefined && (typeof params.thread_id !== "string" || !params.thread_id.trim())) {
      return {
        ok: false,
        code: "invalid_wire_shape",
        detail: "thread_id must be a non-empty string when provided.",
      };
    }
    if (params.after_sequence !== undefined && (!Number.isFinite(params.after_sequence) || params.after_sequence < 0 || !Number.isInteger(params.after_sequence))) {
      return {
        ok: false,
        code: "invalid_wire_shape",
        detail: "after_sequence must be a finite non-negative integer when provided.",
      };
    }

    const scope = {
      environment_id: params.environment_id,
      project_id: params.project_id,
      thread_id: params.thread_id,
    };

    if (this.authorize && !this.authorize(token, "read", scope)) {
      return {
        ok: false,
        code: "unauthorized",
        detail: "Authorization denied for subscription.",
      };
    }

    const listeners = new Set<(event: DomainEvent) => void>();
    let synchronizationMarker: DomainEvent | null = null;
    let replayEventsToEmit: DomainEvent[] = [];

    const emitInitial = options.emitInitialSnapshot !== false && params.after_sequence === undefined;

    if (params.after_sequence !== undefined) {
      const syncRes = this.engine.sync(params.after_sequence, scope);
      if (syncRes.ok) {
        if (syncRes.mode === "replay") {
          replayEventsToEmit = syncRes.events.filter((e) => e.sequence > (params.after_sequence ?? 0));
        } else if (syncRes.mode === "up_to_date") {
          const snapshot = this.engine.getScopedSnapshot(scope);
          synchronizationMarker = {
            kind: "SnapshotEmitted",
            event_id: `evt_snap_sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            command_id: `cmd_snap_sync_${Date.now()}`,
            sequence: snapshot.sequence,
            timestamp: new Date().toISOString(),
            data: { snapshot },
          };
        } else if (syncRes.mode === "snapshot") {
          synchronizationMarker = {
            kind: "SnapshotEmitted",
            event_id: `evt_snap_fallback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            command_id: `cmd_snap_fallback_${Date.now()}`,
            sequence: syncRes.snapshot.sequence,
            timestamp: new Date().toISOString(),
            data: { snapshot: syncRes.snapshot },
          };
        }
      }
    }

    const engineUnsub = this.engine.subscribe(
      (event) => {
        if (event.kind === "SnapshotEmitted" && listeners.size === 0) {
          if (emitInitial) {
            synchronizationMarker = event;
          }
          return;
        }
        for (const listener of listeners) {
          listener(event);
        }
      },
      scope,
      { emitInitialSnapshot: emitInitial }
    );

    const subscription: OrchestratorSubscription = {
      onEvent: (listener) => {
        listeners.add(listener);
        if (synchronizationMarker) {
          const marker = synchronizationMarker;
          synchronizationMarker = null;
          listener(marker);
        }
        if (replayEventsToEmit.length > 0) {
          const events = replayEventsToEmit;
          replayEventsToEmit = [];
          for (const replayEvent of events) {
            listener(replayEvent);
          }
        }
        return () => {
          listeners.delete(listener);
        };
      },
      unsubscribe: () => {
        listeners.clear();
        engineUnsub();
      },
    };

    return { ok: true, subscription };
  }

  /**
   * Perform cursor-based synchronization (snapshot or replay).
   */
  sync(
    token: string | undefined,
    cursor: number,
    scope?: { environment_id?: string; project_id?: string; thread_id?: string }
  ): SyncResult | { ok: false; code: string; detail: string } {
    if (this.authorize && !this.authorize(token, "read", scope)) {
      return {
        ok: false,
        code: "unauthorized",
        detail: "Authorization denied for sync query.",
      };
    }

    return this.engine.sync(cursor, scope);
  }

  /**
   * Fetch snapshot scoped by project/thread.
   */
  getScopedSnapshot(token: string | undefined, scope?: { environment_id?: string; project_id?: string; thread_id?: string }): Snapshot | { ok: false; code: string; detail: string } {
    if (this.authorize && !this.authorize(token, "read", scope)) {
      return {
        ok: false,
        code: "unauthorized",
        detail: "Authorization denied for snapshot query.",
      };
    }

    return this.engine.getScopedSnapshot(scope);
  }
}
