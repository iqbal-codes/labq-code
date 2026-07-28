import type {
  CanonicalProviderEvent,
  StartTurnParams,
  InterruptTurnParams,
  StopTurnParams,
  RespondToRequestParams,
  ProviderAdapter,
} from "./provider-adapter.js";
import type { ToolActivityStatus, RuntimeAccessProfile, InputField, ChangeSummary } from "../domain/types.js";
import { validateImageAttachments, boundChangeSummary } from "../domain/types.js";

/**
 * Normalize a Pi SDK assistant text delta into a canonical provider event.
 */
export function normalizeTextDelta(text: string): CanonicalProviderEvent {
  return { kind: "assistant_text_delta", text };
}

/**
 * Normalize a Pi SDK tool activity event into a canonical provider event.
 */
export function normalizeToolBegan(
  activityId: string,
  tool: string,
  input?: unknown
): CanonicalProviderEvent {
  return {
    kind: "tool_activity_began",
    activity_id: activityId,
    tool,
    input,
  };
}

/**
 * Normalize a Pi SDK tool activity completion into a canonical provider event.
 */
export function normalizeToolCompleted(
  activityId: string,
  status: Exclude<ToolActivityStatus, "in_progress">,
  output?: unknown,
  error?: string
): CanonicalProviderEvent {
  return {
    kind: "tool_activity_completed",
    activity_id: activityId,
    status,
    output,
    error,
  };
}

/**
 * Normalize a Pi SDK session/turn start notification.
 */
export function normalizeTurnStarted(): CanonicalProviderEvent {
  return { kind: "provider_turn_started" };
}

/**
 * Normalize a Pi SDK message completion notification.
 */
export function normalizeMessageCompleted(): CanonicalProviderEvent {
  return { kind: "assistant_message_completed" };
}

/**
 * Normalize a Pi SDK turn completion.
 */
export function normalizeTurnCompleted(): CanonicalProviderEvent {
  return { kind: "provider_turn_completed" };
}

/**
 * Normalize a Pi SDK failure/error into a canonical event.
 */
export function normalizeFailure(code: string, detail: string): CanonicalProviderEvent {
  return { kind: "provider_turn_failed", code, detail };
}

/**
 * Normalize a Pi SDK approval request into a canonical provider event.
 */
export function normalizeApprovalRequested(
  requestId: string,
  operation: string,
  description?: string
): CanonicalProviderEvent {
  return { kind: "approval_requested", request_id: requestId, operation, description };
}

/**
 * Normalize a Pi SDK structured-input request into a canonical provider event.
 */
export function normalizeInputRequested(
  requestId: string,
  operation: string,
  fields: InputField[],
  description?: string
): CanonicalProviderEvent {
  return { kind: "input_requested", request_id: requestId, operation, description, fields };
}

/**
 * Normalize a Pi SDK change summary into a canonical provider event.
 */
export function normalizeChangeSummary(
  summary: ChangeSummary
): CanonicalProviderEvent {
  return { kind: "change_summary", turn_id: summary.turn_id, summary: boundChangeSummary(summary) };
}

/**
 * Validate image attachments against bounds (max 5 images, max 20 MiB total).
 * Returns a validation error message, or null if valid.
 */
export function validateImageBounds(images?: { media_type: string; data: string }[]): string | null {
  return validateImageAttachments(images);
}

/**
 * Pi Adapter implementing ProviderAdapter.
 *
 * In production, this adapter would wrap the Pi SDK:
 *   import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
 *
 * The adapter:
 * - Receives the selected thread, bound project workspace, Pi provider instance,
 *   curated model, fixed runtime access profile, `execute` interaction mode,
 *   image content when present, and correlation metadata.
 * - Normalizes Pi SDK events into canonical provider events.
 * - Raw Pi payloads never enter client-facing orchestration state.
 *
 * For testing, supply a test double that returns a controlled AsyncIterable.
 */
export class PiAdapter implements ProviderAdapter {
  /**
   * Start a turn with the Pi SDK.
   * Yields canonical provider events by normalizing Pi SDK events.
   */
  async *startTurn(params: StartTurnParams): AsyncIterable<CanonicalProviderEvent> {
    // Validate image bounds before starting
    const imageError = validateImageBounds(params.images);
    if (imageError) {
      yield normalizeFailure("image_bounds_exceeded", imageError);
      return;
    }

    if (params.signal?.aborted) return;

    // Pi SDK (@earendil-works/pi-coding-agent) is not installed in this
    // environment. Install it to enable real Pi provider-backed turns:
    //   npm install @earendil-works/pi-coding-agent
    //
    // When installed, this adapter would:
    //   1. Create or resume a Pi agent session via createAgentSession()
    //   2. Submit the prompt with optional images via session.prompt()
    //   3. Subscribe to Pi SDK events and normalize each one
    //   4. Use params.signal to abort when cancelled
    yield normalizeFailure(
      "sdk_not_installed",
      "Pi SDK (@earendil-works/pi-coding-agent) is not installed. " +
        "Run `npm install @earendil-works/pi-coding-agent` to enable the Pi provider."
    );
  }

  async interruptTurn(_params: InterruptTurnParams): Promise<void> {
    // In production, would call session.abort() or similar
    // to interrupt the active Pi operation while preserving the session.
  }

  async respondToRequest(_params: RespondToRequestParams): Promise<void> {
    // In production, would route the correlated result back to the Pi SDK
    // via the server-mediated custom tool result, unblocking the provider stream.
  }

  async stopTurn(_params: StopTurnParams): Promise<void> {
    // In production, would call session.dispose() or similar
    // to kill the Pi session entirely.
  }
}

/**
 * Resolve the tool set for a given runtime access profile.
 */
export function getProfileTools(profile: RuntimeAccessProfile): string[] {
  switch (profile) {
    case "read-only":
      return ["read", "grep", "find", "ls"];
    case "workspace-write":
      return ["read", "grep", "find", "ls", "edit", "write"];
    case "full-execution":
      return ["read", "grep", "find", "ls", "edit", "write", "bash"];
    default:
      return [];
  }
}