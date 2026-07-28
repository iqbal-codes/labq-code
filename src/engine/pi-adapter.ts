import type { ImageContent, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
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

/** Active embedded Pi session bound to one orchestration thread/workspace. */
interface ActivePiSession {
  session: AgentSession;
  workspacePath: string;
  modelId: string;
  accessProfile: RuntimeAccessProfile;
}

/**
 * Embedded Pi SDK adapter.
 *
 * Pi sessions stay in-process, remain bound to one thread/workspace, and emit
 * only provider-neutral canonical events to the orchestration engine.
 */
export class PiAdapter implements ProviderAdapter {
  private modelRuntimePromise?: Promise<ModelRuntime>;
  private sessions = new Map<string, ActivePiSession>();

  async *startTurn(params: StartTurnParams): AsyncIterable<CanonicalProviderEvent> {
    const imageError = validateImageBounds(params.images);
    if (imageError) {
      yield normalizeFailure("image_bounds_exceeded", imageError);
      return;
    }

    if (params.signal?.aborted) return;

    try {
      const active = await this.getOrCreateSession(params);
      const queuedEvents: CanonicalProviderEvent[] = [];
      let wakeConsumer: (() => void) | undefined;
      let settled = false;

      const push = (event: CanonicalProviderEvent): void => {
        queuedEvents.push(event);
        wakeConsumer?.();
        wakeConsumer = undefined;
      };

      const unsubscribe = active.session.subscribe((event) => {
        switch (event.type) {
          case "message_update":
            if (event.assistantMessageEvent.type === "text_delta") {
              push(normalizeTextDelta(event.assistantMessageEvent.delta));
            }
            break;
          case "tool_execution_start":
            push(normalizeToolBegan(event.toolCallId, event.toolName, event.args));
            break;
          case "tool_execution_update":
            push({
              kind: "tool_activity_delta",
              activity_id: event.toolCallId,
              content: stringifyToolPayload(event.partialResult),
            });
            break;
          case "tool_execution_end":
            push(
              normalizeToolCompleted(
                event.toolCallId,
                event.isError ? "failure" : "success",
                event.result,
                event.isError ? stringifyToolPayload(event.result) : undefined
              )
            );
            break;
        }
      });

      const abort = (): void => {
        void active.session.abort();
      };
      params.signal?.addEventListener("abort", abort, { once: true });

      yield normalizeTurnStarted();

      void active.session
        .prompt(params.prompt, {
          images: params.images?.map((image) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              mediaType: image.media_type,
              data: image.data,
            },
          })) as ImageContent[] | undefined,
        })
        .then(() => {
          if (!params.signal?.aborted) {
            push(normalizeMessageCompleted());
            push(normalizeTurnCompleted());
          }
        })
        .catch((error: unknown) => {
          if (!params.signal?.aborted) {
            const detail = error instanceof Error ? error.message : String(error);
            push(normalizeFailure("pi_sdk_error", detail));
          }
        })
        .finally(() => {
          settled = true;
          wakeConsumer?.();
          wakeConsumer = undefined;
          unsubscribe();
          params.signal?.removeEventListener("abort", abort);
        });

      while (!settled || queuedEvents.length > 0) {
        if (queuedEvents.length === 0) {
          await new Promise<void>((resolve) => {
            wakeConsumer = resolve;
          });
          continue;
        }
        yield queuedEvents.shift()!;
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      yield normalizeFailure("pi_sdk_initialization_failed", detail);
    }
  }

  async interruptTurn(params: InterruptTurnParams): Promise<void> {
    await this.sessions.get(params.thread_id)?.session.abort();
  }

  async respondToRequest(_params: RespondToRequestParams): Promise<void> {
    throw new Error(
      "Real Pi approval/input bridges require adapter-owned custom tools; use the protocol fixture for deterministic acceptance coverage."
    );
  }

  async stopTurn(params: StopTurnParams): Promise<void> {
    const active = this.sessions.get(params.thread_id);
    if (!active) return;
    await active.session.abort();
    active.session.dispose();
    this.sessions.delete(params.thread_id);
  }

  async shutdown(): Promise<void> {
    for (const active of this.sessions.values()) {
      await active.session.abort();
      active.session.dispose();
    }
    this.sessions.clear();
  }

  private async getOrCreateSession(params: StartTurnParams): Promise<ActivePiSession> {
    const existing = this.sessions.get(params.thread_id);
    if (existing) {
      if (
        existing.workspacePath !== params.project_workspace_path ||
        existing.modelId !== params.model ||
        existing.accessProfile !== params.access_profile
      ) {
        throw new Error(
          `Pi session '${params.thread_id}' cannot switch workspace, model, or access profile.`
        );
      }
      return existing;
    }

    const modelRuntime = await this.getModelRuntime();
    const availableModels = await modelRuntime.getAvailable();
    const model = selectModel(params.model, availableModels);
    if (!model) {
      throw new Error(`No authenticated Pi model is available for '${params.model}'.`);
    }

    const { session } = await createAgentSession({
      cwd: params.project_workspace_path,
      modelRuntime,
      model,
      sessionManager: SessionManager.inMemory(),
      tools: getProfileTools(params.access_profile),
    });

    const active: ActivePiSession = {
      session,
      workspacePath: params.project_workspace_path,
      modelId: params.model,
      accessProfile: params.access_profile,
    };
    this.sessions.set(params.thread_id, active);
    return active;
  }

  private getModelRuntime(): Promise<ModelRuntime> {
    this.modelRuntimePromise ??= ModelRuntime.create();
    return this.modelRuntimePromise;
  }
}

function stringifyToolPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function selectModel(
  requested: string,
  available: readonly Model<any>[]
): Model<any> | undefined {
  if (available.length === 0) return undefined;
  if (requested === "pi-default") return available[0];

  const needle = requested.replace(/^pi-/, "").replaceAll("-", "").toLowerCase();
  return (
    available.find((model) =>
      model.id.replaceAll("-", "").replaceAll(".", "").toLowerCase().includes(needle)
    ) ?? available[0]
  );
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