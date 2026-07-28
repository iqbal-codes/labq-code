import type { Command, DomainEvent, Snapshot, SyncResult, CommandResult, ProjectionFailure, ProtocolDiagnosticEntry } from "../domain/types.js";
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
    let scope: { project_id?: string; thread_id?: string } | undefined;
    if ("project_id" in command && typeof command.project_id === "string") {
      scope = { project_id: command.project_id };
    } else if ("thread_id" in command && typeof command.thread_id === "string") {
      scope = { thread_id: command.thread_id };
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
    let initialSnapshotEvent: DomainEvent | null = null;
    const emitInitial = options.emitInitialSnapshot !== false && params.after_sequence === undefined;

    const engineUnsub = this.engine.subscribe(
      (event) => {
        if (event.kind === "SnapshotEmitted" && listeners.size === 0) {
          if (emitInitial) {
            initialSnapshotEvent = event;
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
        if (initialSnapshotEvent) {
          const snapshotToEmit = initialSnapshotEvent;
          initialSnapshotEvent = null;
          listener(snapshotToEmit);
        }
        if (params.after_sequence !== undefined && params.after_sequence > 0) {
          const syncRes = this.engine.sync(params.after_sequence, scope);
          if (syncRes.ok && syncRes.mode === "replay") {
            for (const replayEvent of syncRes.events) {
              listener(replayEvent);
            }
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

  getProjectionFailures(token?: string): ProjectionFailure[] | { ok: false; code: string; detail: string } {
    if (this.authorize && !this.authorize(token, "read")) {
      return {
        ok: false,
        code: "unauthorized",
        detail: "Authorization denied for projection failures query.",
      };
    }
    return this.engine.getProjectionFailures();
  }

  retryProjectionFailures(token?: string): { ok: true; retried_count: number; resolved_count: number } | { ok: false; code: string; detail: string } {
    if (this.authorize && !this.authorize(token, "mutate")) {
      return {
        ok: false,
        code: "unauthorized",
        detail: "Authorization denied for retrying projection failures.",
      };
    }
    const res = this.engine.retryProjectionFailures();
    return { ok: true, ...res };
  }

  getProtocolDiagnostics(
    token?: string,
    filter?: { project_id?: string; thread_id?: string; turn_id?: string }
  ): ProtocolDiagnosticEntry[] | { ok: false; code: string; detail: string } {
    if (this.authorize && !this.authorize(token, "read", filter)) {
      return {
        ok: false,
        code: "unauthorized",
        detail: "Authorization denied for diagnostics query.",
      };
    }
    return this.engine.getProtocolDiagnostics(filter);
  }
}
