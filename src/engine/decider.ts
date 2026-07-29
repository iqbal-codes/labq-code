import type {
  Command,
  Snapshot,
  ProjectSource,
  Project,
  Thread,
  Turn,
  PendingRequest,
  PendingRequestResponse,
} from "../domain/types.js";
import {
  validateImageAttachments,
  InputField,
} from "../domain/types.js";
import {
  validateModel,
  validateAccessProfile,
  validateInteractionMode,
} from "../catalog/pi-catalog.js";

export type EventDraft =
  | { kind: "ProjectCreated"; data: { project: Project } }
  | { kind: "ProjectArchived"; data: { project_id: string } }
  | { kind: "ProjectSettled"; data: { project_id: string } }
  | { kind: "ProjectDeleted"; data: { project_id: string } }
  | { kind: "ThreadCreated"; data: { thread: Thread } }
  | { kind: "ThreadArchived"; data: { thread_id: string } }
  | { kind: "ThreadSettled"; data: { thread_id: string } }
  | { kind: "ThreadDeleted"; data: { thread_id: string } }
  | { kind: "TurnQueued"; data: { turn: Turn } }
  | { kind: "TurnInterrupted"; data: { turn_id: string } }
  | { kind: "PendingRequestResolved"; data: { turn_id: string; request_id: string; response: PendingRequestResponse } }
  | { kind: "SessionStopped"; data: { thread_id: string } };

export type DeciderResult =
  | { ok: true; events: EventDraft[]; resultData: Record<string, unknown> }
  | { ok: false; code: string; detail: string };

/**
 * Shared validation for respond_approval and respond_input commands.
 * Checks: turn exists, thread_id matches, turn is paused with a pending request,
 * request_id matches, and request kind matches the expected kind.
 */
function validatePendingRequest(
  snapshot: Snapshot,
  turnId: string,
  threadId: string,
  requestId: string,
  expectedKind: "approval" | "input"
): DeciderResult {
  const turn = snapshot.turns[turnId];
  if (!turn) {
    return { ok: false, code: "turn_not_found", detail: `Turn '${turnId}' does not exist.` };
  }
  if (turn.thread_id !== threadId) {
    return { ok: false, code: "turn_thread_mismatch", detail: `Turn '${turnId}' does not belong to thread '${threadId}'.` };
  }
  if (turn.status !== "paused" || !turn.pending_request) {
    return { ok: false, code: "no_pending_request", detail: `Turn '${turnId}' has no pending ${expectedKind} request.` };
  }
  if (turn.pending_request.id !== requestId) {
    return { ok: false, code: "stale_request", detail: `Request '${requestId}' does not match the current pending request '${turn.pending_request.id}'.` };
  }
  if (turn.pending_request.kind !== expectedKind) {
    return { ok: false, code: "wrong_request_kind", detail: `Request '${requestId}' is a '${turn.pending_request.kind}' request, not an ${expectedKind} request.` };
  }
  return { ok: true, events: [], resultData: {} };
}

/**
 * Validate a single input field's value against its declared type and options.
 */
function validateFieldValue(
  field: InputField,
  value: unknown
): DeciderResult | null {
  switch (field.type) {
    case "text":
    case "multiline_text":
      if (typeof value !== "string") {
        return { ok: false, code: "invalid_field_type", detail: `Field '${field.id}' (${field.label}) expects a string, got ${typeof value}.` };
      }
      break;
    case "number":
      if (typeof value !== "number") {
        return { ok: false, code: "invalid_field_type", detail: `Field '${field.id}' (${field.label}) expects a number, got ${typeof value}.` };
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        return { ok: false, code: "invalid_field_type", detail: `Field '${field.id}' (${field.label}) expects a boolean, got ${typeof value}.` };
      }
      break;
    case "select": {
      if (typeof value !== "string") {
        return { ok: false, code: "invalid_field_type", detail: `Field '${field.id}' (${field.label}) expects a string, got ${typeof value}.` };
      }
      if (field.options && !field.options.some((o) => o.value === value)) {
        return { ok: false, code: "invalid_field_option", detail: `Field '${field.id}' (${field.label}) value '${value}' is not one of the valid options: ${field.options.map((o) => o.value).join(", ")}.` };
      }
      break;
    }
  }
  return null;
}

function validateCommandShape(command: Command): DeciderResult | null {
  if (command === null || typeof command !== "object") {
    return {
      ok: false,
      code: "invalid_command",
      detail: "Command must be an object.",
    };
  }

  const value = command as unknown as {
    command_id?: unknown;
    kind?: unknown;
    name?: unknown;
    source?: unknown;
    project_id?: unknown;
    model?: unknown;
    access_profile?: unknown;
    interaction_mode?: unknown;
    thread_id?: unknown;
    turn_id?: unknown;
    request_id?: unknown;
    decision?: unknown;
    content?: unknown;
    values?: unknown;
  };
  const requireString = (field: keyof typeof value): DeciderResult | null =>
    typeof value[field] === "string" && (value[field] as string).trim()
      ? null
      : {
          ok: false,
          code: "invalid_command",
          detail: `Command field '${field}' must be a non-empty string.`,
        };

  const commandIdError = requireString("command_id");
  if (commandIdError) return commandIdError;
  const kindError = requireString("kind");
  if (kindError) return kindError;

  switch (command.kind) {
    case "create_project": {
      const nameError = requireString("name");
      if (nameError) return nameError;
      if (
        value.source === null ||
        typeof value.source !== "object" ||
        Array.isArray(value.source)
      ) {
        return {
          ok: false,
          code: "invalid_command",
          detail: "Project creation requires a source descriptor.",
        };
      }
      break;
    }
    case "archive_project":
    case "settle_project":
    case "delete_project":
      return requireString("project_id");
    case "create_thread":
      for (const field of ["project_id", "model", "access_profile", "interaction_mode"] as const) {
        const error = requireString(field);
        if (error) return error;
      }
      break;
    case "archive_thread":
    case "settle_thread":
    case "delete_thread":
      return requireString("thread_id");
    case "start_turn": {
      const threadError = requireString("thread_id");
      if (threadError) return threadError;
      if (
        value.content === null ||
        typeof value.content !== "object" ||
        Array.isArray(value.content) ||
        typeof (value.content as { text?: unknown }).text !== "string"
      ) {
        return {
          ok: false,
          code: "invalid_command",
          detail: "Start-turn content must include a text string.",
        };
      }
      break;
    }
    case "interrupt_turn":
      for (const field of ["turn_id", "thread_id"] as const) {
        const error = requireString(field);
        if (error) return error;
      }
      break;
    case "stop_turn":
      return requireString("thread_id");
    case "respond_approval":
      for (const field of ["turn_id", "thread_id", "request_id"] as const) {
        const error = requireString(field);
        if (error) return error;
      }
      if (value.decision !== "approved" && value.decision !== "declined") {
        return {
          ok: false,
          code: "invalid_command",
          detail: "Approval decision must be 'approved' or 'declined'.",
        };
      }
      break;
    case "respond_input":
      for (const field of ["turn_id", "thread_id", "request_id"] as const) {
        const error = requireString(field);
        if (error) return error;
      }
      if (
        value.values === null ||
        typeof value.values !== "object" ||
        Array.isArray(value.values)
      ) {
        return {
          ok: false,
          code: "invalid_command",
          detail: "Input response values must be an object.",
        };
      }
      break;
    default:
      break;
  }

  return null;
}
function validateThreadProject(snapshot: Snapshot, thread: Thread | undefined): DeciderResult | null {
  if (!thread) {
    return {
      ok: false,
      code: "thread_not_found",
      detail: "Thread does not exist.",
    };
  }
  const project = snapshot.projects[thread.project_id];
  if (!project) {
    return {
      ok: false,
      code: "project_not_found",
      detail: `Project '${thread.project_id}' does not exist.`,
    };
  }
  if (project.status === "deleted") {
    return {
      ok: false,
      code: "invalid_project_state",
      detail: `Cannot mutate thread '${thread.id}' after project '${project.id}' was deleted.`,
    };
  }
  return null;
}


export function decideCommand(
  snapshot: Snapshot,
  command: Command,
  resolvedSource?: ProjectSource,
  nowIso: string = new Date().toISOString()
): DeciderResult {
  const commandError = validateCommandShape(command);
  if (commandError) return commandError;

  switch (command.kind) {
    case "create_project": {

      if (!resolvedSource) {
        return {
          ok: false,
          code: "missing_resolved_source",
          detail: "Project creation requires a resolved ProjectSource.",
        };
      }
      const projectId =
        command.project_id ||
        `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (snapshot.projects[projectId]) {
        return {
          ok: false,
          code: "project_already_exists",
          detail: `Project with ID '${projectId}' already exists.`,
        };
      }

      const project: Project = {
        id: projectId,
        name: command.name,
        source: resolvedSource,
        status: "active",
        created_at: nowIso,
        updated_at: nowIso,
      };

      return {
        ok: true,
        events: [{ kind: "ProjectCreated", data: { project } }],
        resultData: { project_id: projectId, status: "active" },
      };
    }

    case "archive_project": {
      const project = snapshot.projects[command.project_id];
      if (!project) {
        return {
          ok: false,
          code: "project_not_found",
          detail: `Project '${command.project_id}' does not exist.`,
        };
      }
      if (project.status !== "active") {
        return {
          ok: false,
          code: "invalid_lifecycle_transition",
          detail: `Cannot archive project in status '${project.status}'. Must be 'active'.`,
        };
      }
      return {
        ok: true,
        events: [
          { kind: "ProjectArchived", data: { project_id: project.id } },
        ],
        resultData: { project_id: project.id, status: "archived" },
      };
    }

    case "settle_project": {
      const project = snapshot.projects[command.project_id];
      if (!project) {
        return {
          ok: false,
          code: "project_not_found",
          detail: `Project '${command.project_id}' does not exist.`,
        };
      }
      if (project.status !== "active" && project.status !== "archived") {
        return {
          ok: false,
          code: "invalid_lifecycle_transition",
          detail: `Cannot settle project in status '${project.status}'. Must be 'active' or 'archived'.`,
        };
      }
      return {
        ok: true,
        events: [
          { kind: "ProjectSettled", data: { project_id: project.id } },
        ],
        resultData: { project_id: project.id, status: "settled" },
      };
    }

    case "delete_project": {
      const project = snapshot.projects[command.project_id];
      if (!project) {
        return {
          ok: false,
          code: "project_not_found",
          detail: `Project '${command.project_id}' does not exist.`,
        };
      }
      if (project.status === "deleted") {
        return {
          ok: false,
          code: "invalid_lifecycle_transition",
          detail: "Project is already deleted.",
        };
      }
      return {
        ok: true,
        events: [
          { kind: "ProjectDeleted", data: { project_id: project.id } },
        ],
        resultData: { project_id: project.id, status: "deleted" },
      };
    }

    case "create_thread": {
      const project = snapshot.projects[command.project_id];
      if (!project) {
        return {
          ok: false,
          code: "project_not_found",
          detail: `Project '${command.project_id}' does not exist.`,
        };
      }
      if (project.status === "deleted" || project.status === "settled") {
        return {
          ok: false,
          code: "invalid_project_state",
          detail: `Cannot create thread in project with status '${project.status}'.`,
        };
      }

      if (project.source.status === "setup_required") {
        return {
          ok: false,
          code: "source_setup_required",
          detail: `Project source '${project.source.locator}' is setup-required and must be configured before creating threads.`,
        };
      }

      if (!validateModel(command.model, snapshot.catalog)) {
        return {
          ok: false,
          code: "invalid_model",
          detail: `Model '${command.model}' is not available in the curated Pi catalog.`,
        };
      }

      if (!validateAccessProfile(command.access_profile, snapshot.catalog)) {
        return {
          ok: false,
          code: "invalid_access_profile",
          detail: `Runtime access profile '${command.access_profile}' is invalid.`,
        };
      }

      if (!validateInteractionMode(command.interaction_mode, snapshot.catalog)) {
        return {
          ok: false,
          code: "invalid_interaction_mode",
          detail: `Interaction mode '${command.interaction_mode}' is unsupported in Pi v1. Only 'execute' mode is supported.`,
        };
      }

      const threadId =
        command.thread_id ||
        `th-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (snapshot.threads[threadId]) {
        return {
          ok: false,
          code: "thread_already_exists",
          detail: `Thread with ID '${threadId}' already exists.`,
        };
      }

      const thread: Thread = {
        id: threadId,
        project_id: command.project_id,
        title: command.title || "New Thread",
        status: "active",
        session_status: "ready",
        model: command.model,
        access_profile: command.access_profile,
        interaction_mode: command.interaction_mode,
        created_at: nowIso,
        updated_at: nowIso,
      };
      return {
        ok: true,
        events: [{ kind: "ThreadCreated", data: { thread } }],
        resultData: { thread_id: threadId, status: "active" },
      };
    }

    case "archive_thread": {
      const thread = snapshot.threads[command.thread_id];
      if (!thread) {
        return {
          ok: false,
          code: "thread_not_found",
          detail: `Thread '${command.thread_id}' does not exist.`,
        };
      }
      const projectError = validateThreadProject(snapshot, thread);
      if (projectError) return projectError;
      if (thread.status !== "active") {
        return {
          ok: false,
          code: "invalid_lifecycle_transition",
          detail: `Cannot archive thread in status '${thread.status}'. Must be 'active'.`,
        };
      }
      return {
        ok: true,
        events: [{ kind: "ThreadArchived", data: { thread_id: thread.id } }],
        resultData: { thread_id: thread.id, status: "archived" },
      };
    }

    case "settle_thread": {
      const thread = snapshot.threads[command.thread_id];
      if (!thread) {
        return {
          ok: false,
          code: "thread_not_found",
          detail: `Thread '${command.thread_id}' does not exist.`,
        };
      }
      const projectError = validateThreadProject(snapshot, thread);
      if (projectError) return projectError;
      if (thread.status !== "active" && thread.status !== "archived") {
        return {
          ok: false,
          code: "invalid_lifecycle_transition",
          detail: `Cannot settle thread in status '${thread.status}'. Must be 'active' or 'archived'.`,
        };
      }
      return {
        ok: true,
        events: [{ kind: "ThreadSettled", data: { thread_id: thread.id } }],
        resultData: { thread_id: thread.id, status: "settled" },
      };
    }

    case "delete_thread": {
      const thread = snapshot.threads[command.thread_id];
      if (!thread) {
        return {
          ok: false,
          code: "thread_not_found",
          detail: `Thread '${command.thread_id}' does not exist.`,
        };
      }
      const projectError = validateThreadProject(snapshot, thread);
      if (projectError) return projectError;
      if (thread.status === "deleted") {
        return {
          ok: false,
          code: "invalid_lifecycle_transition",
          detail: "Thread is already deleted.",
        };
      }
      return {
        ok: true,
        events: [{ kind: "ThreadDeleted", data: { thread_id: thread.id } }],
        resultData: { thread_id: thread.id, status: "deleted" },
      };
    }

    case "start_turn": {
      const thread = snapshot.threads[command.thread_id];
      if (!thread) {
        return {
          ok: false,
          code: "thread_not_found",
          detail: `Thread '${command.thread_id}' does not exist.`,
        };
      }
      const projectError = validateThreadProject(snapshot, thread);
      if (projectError) return projectError;
      if (thread.status !== "active") {
        return {
          ok: false,
          code: "invalid_thread_state",
          detail: `Cannot start turn in thread with status '${thread.status}'. Thread must be 'active'.`,
        };
      }

      if (thread.session_status === "stopped") {
        return {
          ok: false,
          code: "session_stopped",
          detail: `Thread '${command.thread_id}' session is stopped and cannot accept new turns. A new session is required.`,
        };
      }

      // One queued/running/paused turn allowed per thread
      const existingTurn = Object.values(snapshot.turns).find(
        (t) =>
          t.thread_id === command.thread_id &&
          (t.status === "queued" || t.status === "running" || t.status === "paused")
      );
      if (existingTurn) {
        return {
          ok: false,
          code: "turn_already_active",
          detail: `Thread '${command.thread_id}' already has an active turn '${existingTurn.id}' (${existingTurn.status}). One queued/running/paused turn is allowed per thread.`,
        };
      }

      // Validate image bounds using shared validator
      const imageError = validateImageAttachments(command.content.images);
      if (imageError) {
        const isCount = imageError.includes("exceeds maximum");
        return {
          ok: false,
          code: isCount ? "image_bounds_exceeded" : "image_size_exceeded",
          detail: imageError,
        };
      }

      const turnId =
        command.turn_id ||
        `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (snapshot.turns[turnId]) {
        return {
          ok: false,
          code: "turn_already_exists",
          detail: `Turn with ID '${turnId}' already exists.`,
        };
      }

      const turn: Turn = {
        id: turnId,
        thread_id: command.thread_id,
        status: "queued",
        user_message: command.content,
        activities: {},
        created_at: nowIso,
        updated_at: nowIso,
      };

      return {
        ok: true,
        events: [{ kind: "TurnQueued", data: { turn } }],
        resultData: { turn_id: turnId, status: "queued" },
      };
    }

    case "interrupt_turn": {
      const thread = snapshot.threads[command.thread_id];
      const projectError = validateThreadProject(snapshot, thread);
      if (projectError) return projectError;

      if (thread?.status === "deleted") {
        return {
          ok: false,
          code: "invalid_thread_state",
          detail: `Cannot interrupt turn in thread with status '${thread.status}'.`,
        };
      }

      const turn = snapshot.turns[command.turn_id];
      if (!turn) {
        return {
          ok: false,
          code: "turn_not_found",
          detail: `Turn '${command.turn_id}' does not exist.`,
        };
      }
      if (turn.thread_id !== command.thread_id) {
        return {
          ok: false,
          code: "turn_thread_mismatch",
          detail: `Turn '${command.turn_id}' does not belong to thread '${command.thread_id}'.`,
        };
      }
      if (turn.status === "interrupted") {
        return {
          ok: true,
          events: [],
          resultData: { turn_id: turn.id, status: "interrupted" },
        };
      }
      if (turn.status !== "running" && turn.status !== "paused" && turn.status !== "queued") {
        return {
          ok: false,
          code: "invalid_turn_state",
          detail: `Cannot interrupt turn in status '${turn.status}'. Must be 'queued', 'running', or 'paused'.`,
        };
      }
      return {
        ok: true,
        events: [{ kind: "TurnInterrupted", data: { turn_id: turn.id } }],
        resultData: { turn_id: turn.id, status: "interrupted" },
      };
    }

    case "stop_turn": {
      const thread = snapshot.threads[command.thread_id];
      if (!thread) {
        return {
          ok: false,
          code: "thread_not_found",
          detail: `Thread '${command.thread_id}' does not exist.`,
        };
      }
      const projectError = validateThreadProject(snapshot, thread);
      if (projectError) return projectError;
      if (thread.status === "deleted") {
        return {
          ok: false,
          code: "invalid_thread_state",
          detail: `Cannot stop session in thread with status '${thread.status}'.`,
        };
      }
      if (thread.session_status === "stopped") {
        return {
          ok: true,
          events: [],
          resultData: { thread_id: thread.id, status: "stopped" },
        };
      }

      let turn: Turn | undefined;
      if (command.turn_id) {
        turn = snapshot.turns[command.turn_id];
        if (!turn) {
          return {
            ok: false,
            code: "turn_not_found",
            detail: `Turn '${command.turn_id}' does not exist.`,
          };
        }
        if (turn.thread_id !== command.thread_id) {
          return {
            ok: false,
            code: "turn_thread_mismatch",
            detail: `Turn '${command.turn_id}' does not belong to thread '${command.thread_id}'.`,
          };
        }
        if (turn.status === "completed" || turn.status === "failed") {
          return {
            ok: false,
            code: "invalid_turn_state",
            detail: `Cannot stop turn in status '${turn.status}'. Must be 'queued', 'running', or 'paused'.`,
          };
        }
      } else {
        turn = Object.values(snapshot.turns).find(
          (t) =>
            t.thread_id === command.thread_id &&
            (t.status === "queued" || t.status === "running" || t.status === "paused")
        );
      }
      const events: EventDraft[] = [];
      if (turn && (turn.status === "running" || turn.status === "paused" || turn.status === "queued")) {
        events.push({ kind: "TurnInterrupted", data: { turn_id: turn.id } });
      }
      events.push({ kind: "SessionStopped", data: { thread_id: thread.id } });
      return {
        ok: true,
        events,
        resultData: { thread_id: thread.id, status: "stopped" },
      };
    }

    case "respond_approval": {
      const baseCheck = validatePendingRequest(
        snapshot, command.turn_id, command.thread_id, command.request_id, "approval"
      );
      if (!baseCheck.ok) return baseCheck;
      const approvalTurn = snapshot.turns[command.turn_id];
      const projectError = validateThreadProject(
        snapshot,
        approvalTurn ? snapshot.threads[approvalTurn.thread_id] : undefined
      );
      if (projectError) return projectError;
      return {
        ok: true,
        events: [{
          kind: "PendingRequestResolved",
          data: {
            turn_id: command.turn_id,
            request_id: command.request_id,
            response: { decision: command.decision },
          },
        }],
        resultData: { turn_id: command.turn_id, request_id: command.request_id, status: "running" },
      };
    }

    case "respond_input": {
      const baseCheck = validatePendingRequest(
        snapshot, command.turn_id, command.thread_id, command.request_id, "input"
      );
      if (!baseCheck.ok) return baseCheck;
      const inputTurn = snapshot.turns[command.turn_id];
      const projectError = validateThreadProject(
        snapshot,
        inputTurn ? snapshot.threads[inputTurn.thread_id] : undefined
      );
      if (projectError) return projectError;

      const turn = snapshot.turns[command.turn_id]!;

      // Validate required fields
      for (const field of turn.pending_request!.fields) {
        if (field.required && !(field.id in command.values)) {
          return {
            ok: false,
            code: "missing_required_field",
            detail: `Required field '${field.id}' (${field.label}) is missing from the response.`,
          };
        }
      }

      // Validate field value types and select options
      for (const field of turn.pending_request!.fields) {
        if (!(field.id in command.values)) continue; // optional absent field is fine
        const value = command.values[field.id];
        const typeError = validateFieldValue(field, value);
        if (typeError) return typeError;
      }

      return {
        ok: true,
        events: [{
          kind: "PendingRequestResolved",
          data: {
            turn_id: command.turn_id,
            request_id: command.request_id,
            response: { values: command.values },
          },
        }],
        resultData: { turn_id: command.turn_id, request_id: command.request_id, status: "running" },
      };
    }

    default:
      return {
        ok: false,
        code: "unknown_command",
        detail: `Unknown command kind: ${(command as { kind: string }).kind}`,
      };
  }
}
