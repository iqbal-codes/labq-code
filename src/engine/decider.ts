import type {
  Command,
  Snapshot,
  ProjectSource,
  Project,
  Thread,
  Turn,
} from "../domain/types.js";
import {
  validateImageAttachments,
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
  | { kind: "TurnInterrupted"; data: { turn_id: string } };

export type DeciderResult =
  | { ok: true; events: EventDraft[]; resultData: Record<string, unknown> }
  | { ok: false; code: string; detail: string };

export function decideCommand(
  snapshot: Snapshot,
  command: Command,
  resolvedSource?: ProjectSource,
  nowIso: string = new Date().toISOString()
): DeciderResult {
  switch (command.kind) {
    case "create_project": {
      if (!command.name || !command.name.trim()) {
        return {
          ok: false,
          code: "invalid_command",
          detail: "Project name cannot be empty.",
        };
      }

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
      if (thread.status !== "active") {
        return {
          ok: false,
          code: "invalid_thread_state",
          detail: `Cannot start turn in thread with status '${thread.status}'. Thread must be 'active'.`,
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
      if (turn.status !== "running" && turn.status !== "paused") {
        return {
          ok: false,
          code: "invalid_turn_state",
          detail: `Cannot interrupt turn in status '${turn.status}'. Must be 'running' or 'paused'.`,
        };
      }
      return {
        ok: true,
        events: [{ kind: "TurnInterrupted", data: { turn_id: turn.id } }],
        resultData: { turn_id: turn.id, status: "interrupted" },
      };
    }

    case "stop_turn": {
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
      if (turn.status !== "running" && turn.status !== "paused" && turn.status !== "queued") {
        return {
          ok: false,
          code: "invalid_turn_state",
          detail: `Cannot stop turn in status '${turn.status}'. Must be 'queued', 'running', or 'paused'.`,
        };
      }
      // Stop also interrupts (to abort active work and dispose session)
      return {
        ok: true,
        events: [{ kind: "TurnInterrupted", data: { turn_id: turn.id } }],
        resultData: { turn_id: turn.id, status: "interrupted" },
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
