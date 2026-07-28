import {
  Command,
  Snapshot,
  ProjectSource,
  Project,
  Thread,
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
  | { kind: "ThreadDeleted"; data: { thread_id: string } };

export type DeciderResult =
  | { ok: true; events: EventDraft[]; resultData: Record<string, any> }
  | { ok: false; code: string; detail: string };

export function decideCommand(
  snapshot: Snapshot,
  command: Command,
  resolvedSource?: ProjectSource,
  nowIso: string = new Date().toISOString()
): DeciderResult {
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

    default:
      return {
        ok: false,
        code: "unknown_command",
        detail: `Unknown command kind: ${(command as any).kind}`,
      };
  }
}
