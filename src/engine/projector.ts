import type { Snapshot, DomainEvent, CuratedPiCatalog, Turn, ToolActivityStatus, ChangeSummary, FileChangeSummary, ToolActivity, PendingRequestStatus, RetentionPolicy } from "../domain/types.js";
import { boundChangeSummary, DEFAULT_RETENTION_POLICY } from "../domain/types.js";
import { DEFAULT_PI_CATALOG } from "../catalog/pi-catalog.js";

export function deriveChangeSummaryFromToolActivities(
  turnId: string,
  activities: Record<string, ToolActivity>,
  timestamp: string
): ChangeSummary | undefined {
  const filesMap = new Map<string, FileChangeSummary>();

  for (const act of Object.values(activities)) {
    if (act.status !== "success") continue;

    const toolName = act.tool.toLowerCase();
    if (toolName !== "edit" && toolName !== "write" && toolName !== "create_file") continue;

    const input = (act.input ?? {}) as Record<string, unknown>;
    const filePath = (input.path ?? input.file_path ?? input.file ?? "unknown") as string;
    if (!filePath || filePath === "unknown") continue;

    const existing = filesMap.get(filePath);

    if (toolName === "write" || toolName === "create_file") {
      const content = String(input.content ?? act.output ?? "");
      const lines = content.split("\n").length;
      filesMap.set(filePath, {
        path: filePath,
        kind: existing ? "modified" : "created",
        additions: (existing?.additions ?? 0) + lines,
        deletions: existing?.deletions ?? 0,
        diff_hunk: `+ ${lines} lines written to ${filePath}`,
      });
    } else if (toolName === "edit") {
      const diff = String(input.diff ?? input.patch ?? act.output ?? "");
      const addedLines = (diff.match(/^\+[^+]/gm) || []).length || 1;
      const deletedLines = (diff.match(/^-[^-]/gm) || []).length || 0;

      filesMap.set(filePath, {
        path: filePath,
        kind: "modified",
        additions: (existing?.additions ?? 0) + addedLines,
        deletions: (existing?.deletions ?? 0) + deletedLines,
        diff_hunk: diff.length > 0 ? diff : undefined,
      });
    }
  }

  const files = Array.from(filesMap.values());
  if (files.length === 0) return undefined;

  const total_additions = files.reduce((sum, f) => sum + f.additions, 0);
  const total_deletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return boundChangeSummary({
    turn_id: turnId,
    files,
    total_additions,
    total_deletions,
    created_at: timestamp,
  });
}

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

function truncateField(val: string | undefined, maxBytes: number, label: string): { val: string | undefined; modified: boolean } {
  if (typeof val === "string" && val.length > maxBytes) {
    return { val: val.slice(0, maxBytes) + `\n... [${label} truncated]`, modified: true };
  }
  return { val, modified: false };
}

export function applyRetentionPolicy(
  snapshot: Snapshot,
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY
): Snapshot {
  const next: Snapshot = {
    ...snapshot,
    turns: { ...snapshot.turns },
    threads: { ...snapshot.threads },
  };
  const {
    max_activities_per_turn = DEFAULT_RETENTION_POLICY.max_activities_per_turn!,
    max_completed_turns_per_thread = DEFAULT_RETENTION_POLICY.max_completed_turns_per_thread!,
    max_activity_content_bytes = DEFAULT_RETENTION_POLICY.max_activity_content_bytes!,
    max_message_part_bytes = DEFAULT_RETENTION_POLICY.max_message_part_bytes!,
  } = policy;

  for (const [turnId, turn] of Object.entries(next.turns)) {
    let modified = false;
    let activities = turn.activities;
    let assistantMessage = turn.assistant_message;

    if (assistantMessage && assistantMessage.parts.length > 0) {
      let msgModified = false;
      const parts = assistantMessage.parts.map((p) => {
        if (p.kind === "text") {
          const trunc = truncateField(p.content, max_message_part_bytes, "text");
          if (trunc.modified) {
            msgModified = true;
            return { ...p, content: trunc.val! };
          }
        }
        return p;
      });
      if (msgModified) {
        assistantMessage = { ...assistantMessage, parts };
        modified = true;
      }
    }

    if (activities) {
      const newActivities: Record<string, ToolActivity> = {};
      for (const [actId, act] of Object.entries(activities)) {
        const truncOut = truncateField(typeof act.output === "string" ? act.output : undefined, max_activity_content_bytes, "output");
        const truncErr = truncateField(act.error, max_activity_content_bytes, "error");

        if (truncOut.modified || truncErr.modified) {
          newActivities[actId] = {
            ...act,
            output: truncOut.modified ? truncOut.val : act.output,
            error: truncErr.modified ? truncErr.val : act.error,
          };
          modified = true;
        } else {
          newActivities[actId] = act;
        }
      }
      activities = newActivities;
    }

    if (activities && Object.keys(activities).length > max_activities_per_turn) {
      const actEntries = Object.entries(activities);
      const mandatoryActs = actEntries.filter(
        ([_, a]) => a.status === "in_progress" || a.status === "failure" || a.status === "decline"
      );
      const optionalActs = actEntries.filter(
        ([_, a]) => a.status === "success" || a.status === "interrupted"
      );

      const allowedOptionalCount = Math.max(0, max_activities_per_turn - mandatoryActs.length);
      const retainedOptionalActs = optionalActs.slice(-allowedOptionalCount);

      const prunedActivities: Record<string, ToolActivity> = {};
      for (const [id, act] of [...mandatoryActs, ...retainedOptionalActs]) {
        prunedActivities[id] = act;
      }
      activities = prunedActivities;
      modified = true;
    }

    if (modified) {
      next.turns[turnId] = {
        ...turn,
        activities,
        assistant_message: assistantMessage,
      };
    }
  }

  for (const threadId of Object.keys(next.threads)) {
    const threadTurns = Object.values(next.turns).filter((t) => t.thread_id === threadId);
    const latestTurn = threadTurns.slice().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
    const completedTurns = threadTurns.filter(
      (t) => t.status === "completed" && t.id !== latestTurn?.id
    );
    if (completedTurns.length > max_completed_turns_per_thread) {
      completedTurns.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
      const excessCount = completedTurns.length - max_completed_turns_per_thread;
      const toRemove = completedTurns.slice(0, excessCount);

      for (const t of toRemove) {
        delete next.turns[t.id];
      }
    }
  }

  return next;
}

export function applyEvent(
  snapshot: Snapshot,
  event: DomainEvent,
  retentionPolicy?: RetentionPolicy
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
      const updatedActivities = {
        ...turn.activities,
        [event.data.activity_id]: completedActivity,
      };
      const derivedSummary = deriveChangeSummaryFromToolActivities(turn.id, updatedActivities, now);
      const finalSummary = derivedSummary ?? turn.change_summary;
      next.turns[turn.id] = structuredClone({
        ...turn,
        activities: updatedActivities,
        change_summary: finalSummary,
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
      const derivedSummary = deriveChangeSummaryFromToolActivities(turn.id, turn.activities, event.timestamp);
      const finalSummary = derivedSummary ?? turn.change_summary;
      next.turns[turn.id] = structuredClone({
        ...turn,
        status: "completed",
        change_summary: finalSummary,
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
              status: (pendingReq.kind === "approval" ? "declined" : "cancelled") as PendingRequestStatus,
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
              status: (pendingReq.kind === "approval" ? "declined" : "cancelled") as PendingRequestStatus,
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
    case "ChangeSummaryEmitted": {
      const turn = next.turns[event.data.turn_id];
      if (!turn) break;
      next.turns[turn.id] = structuredClone({
        ...turn,
        change_summary: boundChangeSummary(event.data.summary),
        updated_at: event.timestamp,
      });
      break;
    }
  }

  return retentionPolicy ? applyRetentionPolicy(next, retentionPolicy) : next;
}

export function rebuildSnapshot(
  events: DomainEvent[],
  catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG,
  retentionPolicy?: RetentionPolicy
): Snapshot {
  let snapshot = createInitialSnapshot(catalog);
  for (const event of events) {
    snapshot = applyEvent(snapshot, event, retentionPolicy);
  }
  return snapshot;
}