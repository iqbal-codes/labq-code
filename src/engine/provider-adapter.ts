import type {
  PiModelId,
  RuntimeAccessProfile,
  InteractionMode,
  ImageAttachment,
  ToolActivityStatus,
  InputField,
  PendingRequestResponse,
} from "../domain/types.js";

/**
 * Canonical provider event — normalized from any provider's SDK events.
 * Raw provider payloads never cross into orchestration state.
 */
export type CanonicalProviderEvent =
  | { kind: "provider_turn_started" }
  | { kind: "assistant_text_delta"; text: string }
  | { kind: "tool_activity_began"; activity_id: string; tool: string; input?: unknown }
  | { kind: "tool_activity_delta"; activity_id: string; content: string }
  | { kind: "tool_activity_completed"; activity_id: string; status: Exclude<ToolActivityStatus, "in_progress">; output?: unknown; error?: string }
  | { kind: "assistant_message_completed" }
  | { kind: "provider_turn_completed" }
  | { kind: "provider_turn_failed"; code: string; detail: string }
  | { kind: "approval_requested"; request_id: string; operation: string; description?: string }
  | { kind: "input_requested"; request_id: string; operation: string; description?: string; fields: InputField[] };

/**
 * Parameters for starting a turn on a provider.
 */
export interface StartTurnParams {
  turn_id: string;
  thread_id: string;
  project_workspace_path: string;
  model: PiModelId;
  access_profile: RuntimeAccessProfile;
  interaction_mode: InteractionMode;
  prompt: string;
  images?: ImageAttachment[];
  correlation_id: string;
  command_id: string;
  /** Signal to observe cancellation requests (interrupt/stop). */
  signal?: AbortSignal;
}

/**
 * Parameters for responding to a pending approval or structured-input request.
 */
export interface RespondToRequestParams {
  request_id: string;
  turn_id: string;
  thread_id: string;
  response: PendingRequestResponse;
}

/**
 * Parameters for interrupting an active turn.
 */
export interface InterruptTurnParams {
  turn_id: string;
  thread_id: string;
}

/**
 * Parameters for stopping (hard-disposing) a turn.
 */
export interface StopTurnParams {
  turn_id: string;
  thread_id: string;
}

/**
 * Provider adapter interface.
 * Each provider (Pi, future) implements this seam.
 * The orchestration engine consumes these; raw SDK details stay behind the adapter.
 */
export interface ProviderAdapter {
  /**
   * Start a turn with the given parameters.
   * Returns an async iterable of canonical provider events.
   * The caller must drain the iterable to completion.
   */
  startTurn(params: StartTurnParams): AsyncIterable<CanonicalProviderEvent>;

  /**
   * Respond to a pending approval or structured-input request.
   * Routes the correlated result back to the provider, unblocking execution.
   */
  respondToRequest(params: RespondToRequestParams): Promise<void>;

  /**
   * Interrupt an active turn. Preserves the provider session if possible.
   */
  interruptTurn(params: InterruptTurnParams): Promise<void>;

  /**
   * Stop a turn: abort active work, dispose the session.
   */
  stopTurn(params: StopTurnParams): Promise<void>;
}
/**
 * Sanitize raw provider or runtime errors into provider-neutral error metadata.
 * Ensures raw internal payloads, paths, or secrets never enter client snapshots/events.
 */
export function sanitizeErrorMetadata(err: unknown): { code: string; detail: string } {
  if (typeof err === "object" && err !== null && "code" in err && "detail" in err) {
    const code = String((err as { code: unknown }).code || "provider_error");
    const detail = String((err as { detail: unknown }).detail || "An unexpected provider error occurred.");
    return { code, detail };
  }
  if (err instanceof Error) {
    return {
      code: "provider_error",
      detail: err.message || "An unexpected error occurred during provider execution.",
    };
  }
  return {
    code: "provider_error",
    detail: typeof err === "string" ? err : "An unexpected error occurred during provider execution.",
  };
}