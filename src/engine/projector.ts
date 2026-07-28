import type { Snapshot, DomainEvent, CuratedPiCatalog, Turn, ToolActivityStatus } from "../domain/types.js";
import { DEFAULT_PI_CATALOG } from "../catalog/pi-catalog.js";

export function createInitialSnapshot(
  catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG
): Snapshot {
  return {
    sequence: 0,
    projects: {},
    threads: {},
    turns: {},
    catalog,
  };
}

export function applyEvent(
  snapshot: Snapshot,
  event: DomainEvent
): Snapshot {
  // Create a shallow copy with fresh object maps to preserve immutability
  const next: Snapshot = {
    sequence: event.sequence,
    projects: { ...snapshot.projects },
    threads: { ...snapshot.threads },
    turns: { ...snapshot.turns },
    catalog: snapshot.catalog,
  };

  switch (event.kind) {
    case "SnapshotEmitted": {
      return structuredClone(event.data.snapshot);
    }
    case "ProjectCreated": {
      const proj = event.data.project;
      next.projects[proj.id] = structuredClone(proj);
      break;
    }
    case "ProjectArchived": {
      const proj = next.projects[event.data.project_id];
      if (proj) {
        next.projects[proj.id] = structuredClone({
          ...proj,
          status: "archived",
          updated_at: event.timestamp,
        });
      }
      break;
    }
    case "ProjectSettled": {
      const proj = next.projects[event.data.project_id];
      if (proj) {
        next.projects[proj.id] = structuredClone({
          ...proj,
          status: "settled",
          updated_at: event.timestamp,
        });
      }
      break;
    }
    case "ProjectDeleted": {
      const proj = next.projects[event.data.project_id];
      if (proj) {
        next.projects[proj.id] = structuredClone({
          ...proj,
          status: "deleted",
          updated_at: event.timestamp,
        });
      }
      break;
    }
    case "ThreadCreated": {
      const th = event.data.thread;
      next.threads[th.id] = structuredClone({
        ...th,
        session_status: th.session_status || "ready",
      });
      break;
    }
    case "ThreadArchived": {
      const th = next.threads[event.data.thread_id];
      if (th) {
        next.threads[th.id] = structuredClone({
          ...th,
          status: "archived",
          updated_at: event.timestamp,
        });
      }
      break;
    }
    case "ThreadSettled": {
      const th = next.threads[event.data.thread_id];
      if (th) {
        next.threads[th.id] = structuredClone({
          ...th,
          status: "settled",
          updated_at: event.timestamp,
        });
      }
      break;
    }
    case "ThreadDeleted": {
      const th = next.threads[event.data.thread_id];
      if (th) {
        next.threads[th.id] = structuredClone({
          ...th,
          status: "deleted",
          updated_at: event.timestamp,
        });
      }
      break;
    }
    // Turn events
    case "TurnQueued": {
      const turn = event.data.turn;
      next.turns[turn.id] = structuredClone(turn);
      break;
    }
    case "TurnStarted": {
      const turn = next.turns[event.data.turn_id];
      if (turn) {
        const thread = next.threads[turn.thread_id];
        if (thread && thread.session_status !== "stopped") {
          next.threads[thread.id] = {
            ...thread,
            session_status: "running",
            updated_at: event.timestamp,
          };
        }
        next.turns[turn.id] = structuredClone({
          ...turn,
          status: "running",
          updated_at: event.timestamp,
          // Initialize assistant message when execution begins
          assistant_message: turn.assistant_message || {
            id: `msg-${turn.id}`,
            turn_id: turn.id,
            parts: [],
            is_complete: false,
          },
        });
      }
      break;
    }
    case "AssistantMessageDelta": {
      const turn = next.turns[event.data.turn_id];
      if (!turn) break;
      const msg = turn.assistant_message || {
        id: `msg-${turn.id}`,
        turn_id: turn.id,
        parts: [],
        is_complete: false,
      };
      // Append text delta to the last text part or create a new one
      const parts = msg.parts.length > 0 ? [...msg.parts] : [];
      const lastPart = parts.length > 0 ? parts[parts.length - 1] : null;
      if (lastPart && lastPart.kind === "text") {
        // Append to existing text part — no duplicate content because
        // we accumulate within the same part
        parts[parts.length - 1] = {
          ...lastPart,
          content: lastPart.content + event.data.text,
        };
      } else {
        parts.push({ kind: "text", content: event.data.text });
      }
      next.turns[turn.id] = structuredClone({
        ...turn,
        assistant_message: { ...msg, parts, is_complete: false },
      });
      break;
    }
    case "ToolActivityBegan": {
      const turn = next.turns[event.data.turn_id];
      if (!turn) break;
      const activity = event.data.activity;
      next.turns[turn.id] = structuredClone({
        ...turn,
        activities: { ...turn.activities, [activity.id]: structuredClone(activity) },
        // Add tool_use part to assistant message
        assistant_message: turn.assistant_message
          ? {
              ...turn.assistant_message,
              parts: [
                ...turn.assistant_message.parts,
                {
                  kind: "tool_use" as const,
                  activity_id: activity.id,
                  tool: activity.tool,
                  input: activity.input,
                  status: "in_progress" as const,
                },
              ],
            }
          : turn.assistant_message,
      });
      break;
    }
    case "ToolActivityDelta": {
      const turn = next.turns[event.data.turn_id];
      if (!turn) break;
      const activity = turn.activities[event.data.activity_id];
      if (!activity) break;
      next.turns[turn.id] = structuredClone({
        ...turn,
        activities: {
          ...turn.activities,
          [event.data.activity_id]: {
            ...activity,
            output: activity.output
              ? String(activity.output) + event.data.content
              : event.data.content,
          },
        },
      });
      break;
    }
    case "ToolActivityCompleted": {
      const turn = next.turns[event.data.turn_id];
      if (!turn) break;
      const activity = turn.activities[event.data.activity_id];
      if (!activity) break;
      const now = event.timestamp;
      const completedActivity: typeof activity = {
        ...activity,
        status: event.data.status,
        output: event.data.output !== undefined ? event.data.output : activity.output,
        error: event.data.error !== undefined ? event.data.error : activity.error,
        completed_at: now,
      };
      // Update the tool_use part status in the assistant message
      let msg = turn.assistant_message;
      if (msg) {
        const parts = msg.parts.map((p) =>
          p.kind === "tool_use" && p.activity_id === event.data.activity_id
            ? { ...p, output: completedActivity.output, status: event.data.status as ToolActivityStatus }
            : p
        );
        msg = { ...msg, parts };
      }
      next.turns[turn.id] = structuredClone({
        ...turn,
        activities: {
          ...turn.activities,
          [event.data.activity_id]: completedActivity,
        },
        assistant_message: msg,
      });
      break;
    }
    case "AssistantMessageCompleted": {
      const turn = next.turns[event.data.turn_id];
      if (!turn) break;
      // Mark assistant message as complete — no more deltas expected
      next.turns[turn.id] = structuredClone({
        ...turn,
        assistant_message: turn.assistant_message
          ? { ...turn.assistant_message, is_complete: true }
          : {
              id: `msg-${turn.id}`,
              turn_id: turn.id,
              parts: [],
              is_complete: true,
            },
      });
      break;
    }
    case "TurnPaused": {
      const turn = next.turns[event.data.turn_id];
      if (!turn) break;
      next.turns[turn.id] = structuredClone({
        ...turn,
        status: "paused",
        updated_at: event.timestamp,
      });
      break;
    }
    case "TurnCompleted": {
      const turn = next.turns[event.data.turn_id];
      if (!turn) break;
      const thread = next.threads[turn.thread_id];
      if (thread && thread.session_status !== "stopped") {
        next.threads[thread.id] = {
          ...thread,
          session_status: "ready",
          updated_at: event.timestamp,
        };
      }
      next.turns[turn.id] = structuredClone({
        ...turn,
        status: "completed",
        updated_at: event.timestamp,
      });
      break;
    }
    case "TurnFailed": {
      const turn = next.turns[event.data.turn_id];
      if (!turn) break;
      const thread = next.threads[turn.thread_id];
      if (thread && thread.session_status !== "stopped") {
        next.threads[thread.id] = {
          ...thread,
          session_status: "ready",
          updated_at: event.timestamp,
        };
      }
      // Mark all in-progress activities as failed
      const activities = { ...turn.activities };
      const failedActivityIds = new Set<string>();
      for (const [id, act] of Object.entries(activities)) {
        if (act.status === "in_progress") {
          activities[id] = {
            ...act,
            status: "failure" as const,
            completed_at: event.timestamp,
            error: act.error || event.data.error?.detail,
          };
          failedActivityIds.add(id);
        }
      }
      // Finalize unresolved pending request if present
      const pendingReq = turn.pending_request;
      const finalizedReq =
        pendingReq && pendingReq.status === "pending"
          ? {
              ...pendingReq,
              status: (pendingReq.kind === "approval" ? "declined" : "cancelled") as const,
              resolved_at: event.timestamp,
            }
          : pendingReq;

      // Update tool_use parts to reflect failed status and mark message complete
      let assistantMessage = turn.assistant_message
        ? { ...turn.assistant_message, is_complete: true }
        : undefined;
      if (assistantMessage && failedActivityIds.size > 0) {
        assistantMessage = {
          ...assistantMessage,
          parts: assistantMessage.parts.map((p) =>
            p.kind === "tool_use" && failedActivityIds.has(p.activity_id)
              ? { ...p, status: "failure" as const }
              : p
          ),
        };
      }
      next.turns[turn.id] = structuredClone({
        ...turn,
        status: "failed",
        updated_at: event.timestamp,
        error: event.data.error,
        activities,
        pending_request: finalizedReq,
        assistant_message: assistantMessage || turn.assistant_message,
      });
      break;
    }
    case "TurnInterrupted": {
      const turn = next.turns[event.data.turn_id];
      if (!turn) break;
      const thread = next.threads[turn.thread_id];
      if (thread && thread.session_status !== "stopped") {
        next.threads[thread.id] = {
          ...thread,
          session_status: "ready",
          updated_at: event.timestamp,
        };
      }
      // Mark all in-progress activities as interrupted
      const activities = { ...turn.activities };
      const interruptedActivityIds = new Set<string>();
      for (const [id, act] of Object.entries(activities)) {
        if (act.status === "in_progress") {
          activities[id] = {
            ...act,
            status: "interrupted" as const,
            completed_at: event.timestamp,
          };
          interruptedActivityIds.add(id);
        }
      }
      // Finalize unresolved pending request if present
      const pendingReq = turn.pending_request;
      const finalizedReq =
        pendingReq && pendingReq.status === "pending"
          ? {
              ...pendingReq,
              status: (pendingReq.kind === "approval" ? "declined" : "cancelled") as const,
              resolved_at: event.timestamp,
            }
          : pendingReq;

      // Mark assistant message as complete (interrupted delivery)
      // and update tool_use parts to reflect interrupted status
      let assistantMessage = turn.assistant_message
        ? { ...turn.assistant_message, is_complete: true }
        : undefined;
      if (assistantMessage && interruptedActivityIds.size > 0) {
        assistantMessage = {
          ...assistantMessage,
          parts: assistantMessage.parts.map((p) =>
            p.kind === "tool_use" && interruptedActivityIds.has(p.activity_id)
              ? { ...p, status: "interrupted" as const }
              : p
          ),
        };
      }
      next.turns[turn.id] = structuredClone({
        ...turn,
        status: "interrupted",
        updated_at: event.timestamp,
        activities,
        pending_request: finalizedReq,
        assistant_message: assistantMessage || turn.assistant_message,
      });
      break;
    }
    case "ApprovalRequested":
    case "InputRequested": {
      const turn = next.turns[event.data.turn_id];
      if (!turn) break;
      next.turns[turn.id] = structuredClone({
        ...turn,
        status: "paused",
        updated_at: event.timestamp,
        pending_request: structuredClone(event.data.request),
      });
      break;
    }
    case "PendingRequestResolved": {
      const turn = next.turns[event.data.turn_id];
      if (!turn) break;
      const pendingRequest = turn.pending_request;
      if (!pendingRequest || pendingRequest.id !== event.data.request_id) break;
      const responseStatus =
        "decision" in event.data.response
          ? event.data.response.decision
          : "answered";
      next.turns[turn.id] = structuredClone({
        ...turn,
        status: "running",
        updated_at: event.timestamp,
        pending_request: {
          ...pendingRequest,
          status: responseStatus,
          response: event.data.response,
          resolved_at: event.timestamp,
        },
      });
      break;
    }
    case "SessionStopped": {
      const th = next.threads[event.data.thread_id];
      if (th) {
        next.threads[th.id] = structuredClone({
          ...th,
          session_status: "stopped",
          updated_at: event.timestamp,
        });
      }
      break;
    }
  }

  return next;
}

export function rebuildSnapshot(
  events: DomainEvent[],
  catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG
): Snapshot {
  let snapshot = createInitialSnapshot(catalog);
  for (const event of events) {
    snapshot = applyEvent(snapshot, event);
  }
  return snapshot;
}