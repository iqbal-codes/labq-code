import { createAgentSession, SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  CanonicalProviderEvent,
  StartTurnParams,
  InterruptTurnParams,
  StopTurnParams,
  RespondToRequestParams,
  ProviderAdapter,
} from "./provider-adapter.js";
import { sanitizeErrorMetadata } from "./provider-adapter.js";
import type {
  ToolActivityStatus,
  RuntimeAccessProfile,
  InteractionMode,
  PiModelId,
  InputField,
  PendingRequestResponse,
  ChangeSummary,
} from "../domain/types.js";
import { validateImageAttachments, boundChangeSummary } from "../domain/types.js";

/**
 * Normalize a Pi SDK assistant text delta into a canonical provider event.
 */
export function normalizeTextDelta(text: string, providerEventId?: string): CanonicalProviderEvent {
  return { kind: "assistant_text_delta", text, provider_event_id: providerEventId };
}

/**
 * Normalize a Pi SDK tool activity event into a canonical provider event.
 */
export function normalizeToolBegan(
  activityId: string,
  tool: string,
  input?: unknown,
  providerEventId?: string
): CanonicalProviderEvent {
  return {
    kind: "tool_activity_began",
    activity_id: activityId,
    tool,
    input,
    provider_event_id: providerEventId,
  };
}

/**
 * Normalize a Pi SDK tool activity completion into a canonical provider event.
 */
export function normalizeToolCompleted(
  activityId: string,
  status: Exclude<ToolActivityStatus, "in_progress">,
  output?: unknown,
  error?: string,
  providerEventId?: string
): CanonicalProviderEvent {
  return {
    kind: "tool_activity_completed",
    activity_id: activityId,
    status,
    output,
    error,
    provider_event_id: providerEventId,
  };
}

/**
 * Normalize a Pi SDK session/turn start notification.
 */
export function normalizeTurnStarted(providerEventId?: string): CanonicalProviderEvent {
  return { kind: "provider_turn_started", provider_event_id: providerEventId };
}

/**
 * Normalize a Pi SDK message completion notification.
 */
export function normalizeMessageCompleted(providerEventId?: string): CanonicalProviderEvent {
  return { kind: "assistant_message_completed", provider_event_id: providerEventId };
}

/**
 * Normalize a Pi SDK turn completion.
 */
export function normalizeTurnCompleted(providerEventId?: string): CanonicalProviderEvent {
  return { kind: "provider_turn_completed", provider_event_id: providerEventId };
}

/**
 * Normalize a Pi SDK failure/error into a canonical event.
 */
export function normalizeFailure(code: string, detail: string, providerEventId?: string): CanonicalProviderEvent {
  return { kind: "provider_turn_failed", code, detail, provider_event_id: providerEventId };
}

/**
 * Normalize a Pi SDK approval request into a canonical provider event.
 */
export function normalizeApprovalRequested(
  requestId: string,
  operation: string,
  targetScopeOrDesc?: string,
  impact?: string,
  description?: string,
  providerEventId?: string
): CanonicalProviderEvent {
  let targetScope = "workspace";
  let imp = "medium";
  let desc: string | undefined;

  if (impact === undefined) {
    desc = targetScopeOrDesc;
  } else {
    targetScope = targetScopeOrDesc || "workspace";
    imp = impact;
    desc = description;
  }

  return {
    kind: "approval_requested",
    request_id: requestId,
    operation,
    target_scope: targetScope,
    impact: imp,
    description: desc,
    provider_event_id: providerEventId,
  };
}

/**
 * Normalize a Pi SDK structured-input request into a canonical provider event.
 */
export function normalizeInputRequested(
  requestId: string,
  operation: string,
  targetScopeOrFields: string | InputField[],
  impactOrDescription?: string | InputField[],
  fieldsOrDesc?: InputField[] | string,
  description?: string,
  providerEventId?: string
): CanonicalProviderEvent {
  let targetScope = "workspace";
  let impact = "low";
  let fields: InputField[] = [];
  let desc: string | undefined;

  if (Array.isArray(targetScopeOrFields)) {
    fields = targetScopeOrFields;
    desc = typeof impactOrDescription === "string" ? impactOrDescription : undefined;
  } else {
    targetScope = targetScopeOrFields;
    impact = typeof impactOrDescription === "string" ? impactOrDescription : "low";
    fields = Array.isArray(fieldsOrDesc) ? fieldsOrDesc : [];
    desc = typeof description === "string" ? description : (typeof fieldsOrDesc === "string" ? fieldsOrDesc : undefined);
  }

  return {
    kind: "input_requested",
    request_id: requestId,
    operation,
    target_scope: targetScope,
    impact,
    description: desc,
    fields,
    provider_event_id: providerEventId,
  };
}

/**
 * Normalize a Pi SDK change summary into a canonical provider event.
 */
export function normalizeChangeSummary(
  summary: ChangeSummary,
  providerEventId?: string
): CanonicalProviderEvent {
  return {
    kind: "change_summary",
    turn_id: summary.turn_id,
    summary: boundChangeSummary(summary),
    provider_event_id: providerEventId,
  };
}

/**
 * Validate image attachments against bounds (max 5 images, max 20 MiB total).
 * Returns a validation error message, or null if valid.
 */
export function validateImageBounds(
  images?: Array<{ filename?: string; media_type: string; size_bytes?: number; data: string }>
): string | null {
  if (!images) return null;
  const fullImages = images.map((img, i) => {
    const data = img.data || "";
    const len = (data.length * 3) / 4;
    return {
      filename: img.filename || `image_${i + 1}.png`,
      media_type: img.media_type || "image/png",
      size_bytes:
        typeof img.size_bytes === "number" && Number.isFinite(img.size_bytes) && img.size_bytes > 0
          ? img.size_bytes
          : Math.max(1, Math.floor(len)),
      data,
    };
  });
  return validateImageAttachments(fullImages);
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

interface PendingRequestGate {
  requestId: string;
  resolve: (response: PendingRequestResponse) => void;
  reject: (err: Error) => void;
}

interface PiSessionRecord {
  sessionId: string;
  threadId: string;
  workspacePath: string;
  model: PiModelId;
  accessProfile: RuntimeAccessProfile;
  interactionMode: InteractionMode;
  session: AgentSession;
  stopped: boolean;
  pendingRequests: Map<string, PendingRequestGate>;
}

/**
 * Evaluate explicit resume rules for an existing session record.
 */
export function evaluateExplicitResume(
  record: PiSessionRecord | undefined,
  params: StartTurnParams
): { ok: true } | { ok: false; code: string; detail: string } {
  if (!record) return { ok: true };
  if (record.stopped) {
    return {
      ok: false,
      code: "session_stopped",
      detail: `Thread '${params.thread_id}' session is stopped and cannot accept new turns. A new session is required.`,
    };
  }
  if (
    record.workspacePath !== params.project_workspace_path ||
    record.model !== params.model ||
    record.accessProfile !== params.access_profile
  ) {
    return {
      ok: false,
      code: "session_mismatch",
      detail: "Cannot switch active session workspace, model, or access profile for existing session.",
    };
  }
  return { ok: true };
}

/**
 * Pi Adapter implementing ProviderAdapter.
 * Manages Pi SDK agent sessions keyed by thread_id.
 */
export class PiAdapter implements ProviderAdapter {
  private sessions = new Map<string, PiSessionRecord>();

  async *startTurn(params: StartTurnParams): AsyncIterable<CanonicalProviderEvent> {
    const imageError = validateImageBounds(params.images);
    if (imageError) {
      yield normalizeFailure("image_bounds_exceeded", imageError);
      return;
    }

    if (params.signal?.aborted) return;

    let record = this.sessions.get(params.thread_id);
    const check = evaluateExplicitResume(record, params);
    if (!check.ok) {
      yield normalizeFailure(check.code, check.detail);
      return;
    }

    if (!record) {
      try {
        const sessionManager = SessionManager.create(params.project_workspace_path);
        const { session } = await createAgentSession({
          sessionManager,
          cwd: params.project_workspace_path,
        });

        record = {
          sessionId: session.sessionId || `session-${Date.now()}`,
          threadId: params.thread_id,
          workspacePath: params.project_workspace_path,
          model: params.model,
          accessProfile: params.access_profile,
          interactionMode: params.interaction_mode,
          session,
          stopped: false,
          pendingRequests: new Map(),
        };

        this.sessions.set(params.thread_id, record);
      } catch (err: unknown) {
        const meta = sanitizeErrorMetadata(err);
        yield normalizeFailure(meta.code, meta.detail);
        return;
      }
    }

    // Set allowed tools based on access profile
    const allowedTools = getProfileTools(params.access_profile);
    if (typeof record.session.setActiveToolsByName === "function") {
      try {
        record.session.setActiveToolsByName(allowedTools);
      } catch {}
    }

    // Prepare async event queue for yielding normalized provider events
    const eventQueue: CanonicalProviderEvent[] = [];
    let resolveQueue: (() => void) | null = null;
    let turnDone = false;

    const pushEvent = (evt: CanonicalProviderEvent) => {
      eventQueue.push(evt);
      if (resolveQueue) {
        const r = resolveQueue;
        resolveQueue = null;
        r();
      }
    };

    const unsubscribe = record.session.subscribe((sdkEvent: Record<string, unknown>) => {
      if (!sdkEvent || typeof sdkEvent !== "object") return;
      const type = sdkEvent.type as string | undefined;

      if (type === "turn_start" || type === "agent_start") {
        pushEvent(normalizeTurnStarted(sdkEvent.id as string | undefined));
      } else if (type === "message_update") {
        const text = (sdkEvent.text || sdkEvent.delta || (sdkEvent.assistantMessage as { content?: Array<{ text?: string }> })?.content?.[0]?.text || "") as string;
        if (text) {
          pushEvent(normalizeTextDelta(text, sdkEvent.id as string | undefined));
        }
      } else if (type === "tool_execution_start" || type === "tool_start") {
        const activityId = ((sdkEvent.toolCallId || sdkEvent.activityId || sdkEvent.id || `act-${Date.now()}`)) as string;
        const tool = (sdkEvent.tool || sdkEvent.name || "tool") as string;
        const input = sdkEvent.input || sdkEvent.args;
        pushEvent(normalizeToolBegan(activityId, tool, input, sdkEvent.id as string | undefined));
      } else if (type === "tool_execution_update" || type === "tool_update") {
        const activityId = ((sdkEvent.toolCallId || sdkEvent.activityId || sdkEvent.id || `act-${Date.now()}`)) as string;
        const content = String(sdkEvent.content || sdkEvent.delta || "");
        if (content) {
          pushEvent({
            kind: "tool_activity_delta",
            activity_id: activityId,
            content,
            provider_event_id: sdkEvent.id as string | undefined,
          });
        }
      } else if (type === "tool_execution_end" || type === "tool_end") {
        const activityId = ((sdkEvent.toolCallId || sdkEvent.activityId || sdkEvent.id || `act-${Date.now()}`)) as string;
        const status = sdkEvent.isError || sdkEvent.error ? "failure" : "success";
        const output = sdkEvent.output || sdkEvent.result;
        const error = sdkEvent.error ? String(sdkEvent.error) : undefined;
        pushEvent(normalizeToolCompleted(activityId, status, output, error, sdkEvent.id as string | undefined));
      } else if (type === "turn_end" || type === "agent_end" || type === "agent_settled") {
        pushEvent(normalizeMessageCompleted(sdkEvent.id as string | undefined));
        pushEvent(normalizeTurnCompleted(sdkEvent.id as string | undefined));
        turnDone = true;
      } else if (type === "error" || type === "exception") {
        const meta = sanitizeErrorMetadata(sdkEvent.error || sdkEvent.message || "Provider error");
        pushEvent(normalizeFailure(meta.code, meta.detail, sdkEvent.id as string | undefined));
        turnDone = true;
      }
    });

    const abortHandler = () => {
      try {
        record?.session.abort();
      } catch {}
    };
    if (params.signal) {
      params.signal.addEventListener("abort", abortHandler, { once: true });
    }

    // Start turn prompt
    record.session.prompt(params.prompt).catch((err: unknown) => {
      const meta = sanitizeErrorMetadata(err);
      pushEvent(normalizeFailure(meta.code, meta.detail));
      turnDone = true;
    });

    try {
      while (!turnDone || eventQueue.length > 0) {
        if (eventQueue.length > 0) {
          const nextEvt = eventQueue.shift()!;
          yield nextEvt;
          if (nextEvt.kind === "provider_turn_completed" || nextEvt.kind === "provider_turn_failed") {
            break;
          }
        } else {
          await new Promise<void>((resolve) => {
            resolveQueue = resolve;
          });
        }
      }
    } finally {
      unsubscribe();
      if (params.signal) {
        params.signal.removeEventListener("abort", abortHandler);
      }
    }
  }

  async interruptTurn(params: InterruptTurnParams): Promise<void> {
    const record = this.sessions.get(params.thread_id);
    if (!record) return;
    try {
      record.session.abort();
    } catch {}
    for (const [id, req] of record.pendingRequests.entries()) {
      req.reject(new Error("Turn interrupted"));
      record.pendingRequests.delete(id);
    }
  }

  async respondToRequest(params: RespondToRequestParams): Promise<void> {
    const record = this.sessions.get(params.thread_id);
    if (!record) return;
    const req = record.pendingRequests.get(params.request_id);
    if (req) {
      req.resolve(params.response);
      record.pendingRequests.delete(params.request_id);
    }
  }

  async stopTurn(params: StopTurnParams): Promise<void> {
    const record = this.sessions.get(params.thread_id);
    if (!record) return;
    try {
      record.session.abort();
    } catch {}
    try {
      record.session.dispose();
    } catch {}
    record.stopped = true;
    for (const [id, req] of record.pendingRequests.entries()) {
      req.reject(new Error("Turn stopped"));
      record.pendingRequests.delete(id);
    }
  }
}
