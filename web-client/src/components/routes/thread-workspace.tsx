import { useState } from "react";
import { Link, useParams } from "react-router";
import { useOrchestratorStore, useClientActions } from "@/orchestrator/StoreContext";
import {
  startTurnCommand,
  interruptTurnCommand,
  stopTurnCommand,
  respondApprovalCommand,
} from "@/orchestrator/commands";
import { lifecycleLabel, lifecycleTone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { StatusPill } from "@/components/ui/status";
import { NotFound } from "@/components/routes/route-states";

export function ThreadWorkspace() {
  const { projectId, threadId } = useParams<{ projectId: string; threadId: string }>();
  const { dispatch } = useClientActions();
  const snapshot = useOrchestratorStore((s) => s.snapshot);
  const project = projectId ? snapshot.projects[projectId] : undefined;
  const thread = threadId ? snapshot.threads[threadId] : undefined;

  const [draft, setDraft] = useState(""); // transient local state
  const [submitting, setSubmitting] = useState(false);
  const [showStop, setShowStop] = useState(false);

  if (!project || !thread) return <NotFound />;
  if (thread.status === "deleted") {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <StatusPill label="DELETED" tone="hazard" />
          <p className="mt-2 text-muted-foreground">This thread has been deleted.</p>
          <Link
            to={`/projects/${project.id}`}
            className="mt-4 inline-block text-primary underline-offset-4 hover:underline"
          >
            Return to project
          </Link>
        </div>
      </div>
    );
  }

  const turns = Object.values(snapshot.turns)
    .filter((t) => t.thread_id === threadId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const activeTurn = turns.find(
    (t) => t.status === "queued" || t.status === "running" || t.status === "paused",
  );
  const hasActiveTurn = !!activeTurn;
  const canSend = !hasActiveTurn && thread.status === "active";
  const pendingRequest = activeTurn?.pending_request;

  const handleSend = () => {
    if (!draft.trim() || submitting || !canSend) return;
    setSubmitting(true);
    dispatch(startTurnCommand({ thread_id: thread.id, content: draft }))
      .then(() => {
        setDraft("");
        setSubmitting(false);
      })
      .catch(() => setSubmitting(false));
  };

  const handleInterrupt = () => {
    if (!activeTurn) return;
    dispatch(interruptTurnCommand(activeTurn.id, thread.id)).catch(() => {});
  };

  const handleStop = () => {
    setShowStop(false);
    dispatch(stopTurnCommand(thread.id)).catch(() => {});
  };

  const handleApproval = (decision: "approved" | "declined") => {
    if (!pendingRequest) return;
    dispatch(
      respondApprovalCommand({
        turn_id: activeTurn!.id,
        thread_id: thread.id,
        request_id: pendingRequest.id,
        decision,
      }),
    ).catch(() => {});
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div>
        <Link
          to={`/projects/${project.id}`}
          className="tt-mono text-xs text-muted-foreground hover:underline"
        >
          &larr; {project.name}
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{thread.title}</h1>
            <p className="tt-mono text-xs text-muted-foreground">
              {thread.model} &middot; {thread.access_profile} &middot; {thread.interaction_mode}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill label={lifecycleLabel(thread.status)} tone={lifecycleTone(thread.status)} />
            {hasActiveTurn && (
              <>
                <Button variant="ghost" size="sm" onClick={handleInterrupt}>
                  Interrupt
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setShowStop(true)}>
                  Stop session
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <AlertDialog
        open={showStop}
        onOpenChange={(o) => {
          if (!o) setShowStop(false);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop session</AlertDialogTitle>
            <AlertDialogDescription>
              Active work will terminate and the session will be disposed. This requires a new
              session to resume.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStop}>Stop</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {pendingRequest && pendingRequest.kind === "approval" && (
        <div className="border border-destructive/50 bg-card p-3">
          <StatusPill label="APPROVAL REQUIRED" tone="hazard" />
          <p className="mt-1 text-sm">{pendingRequest.operation}</p>
          {pendingRequest.description && (
            <p className="mt-1 text-xs text-muted-foreground">{pendingRequest.description}</p>
          )}
          <div className="mt-2 flex gap-2">
            <Button variant="destructive" size="sm" onClick={() => handleApproval("declined")}>
              Decline
            </Button>
            <Button variant="default" size="sm" onClick={() => handleApproval("approved")}>
              Approve
            </Button>
          </div>
        </div>
      )}

      <div
        className="flex flex-1 flex-col gap-3 overflow-auto"
        role="log"
        aria-label="Conversation"
      >
        {turns.map((turn) => (
          <div key={turn.id} className="border border-border bg-card p-3">
            <div className="flex items-center gap-2 mb-2">
              <StatusPill
                label={turn.status.toUpperCase()}
                tone={
                  turn.status === "completed"
                    ? "active"
                    : turn.status === "failed" || turn.status === "interrupted"
                      ? "hazard"
                      : turn.status === "running"
                        ? "warn"
                        : "idle"
                }
              />
              <span className="tt-mono text-xs text-muted-foreground">{turn.created_at}</span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{turn.user_message.text}</p>
            {turn.assistant_message && (
              <div className="mt-2 border-t border-border pt-2">
                {(
                  turn.assistant_message.parts as {
                    kind: string;
                    content?: string;
                    tool?: string;
                  }[]
                ).map((part, i) => (
                  <p key={i} className="text-sm whitespace-pre-wrap text-foreground/90">
                    {part.kind === "text" ? part.content : `[Tool: ${part.tool ?? part.kind}]`}
                  </p>
                ))}
              </div>
            )}
            {turn.error && (
              <p className="mt-1 text-xs text-destructive tt-mono">{turn.error.detail}</p>
            )}
          </div>
        ))}
        {turns.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-muted-foreground text-sm">
              No activity yet. Send a prompt to start.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-3">
        {!canSend && hasActiveTurn && (
          <p className="mb-2 text-xs text-muted-foreground">
            A turn is {activeTurn?.status ?? "in progress"}. Wait or interrupt.
          </p>
        )}
        <div className="flex gap-2">
          <textarea
            className="min-h-[64px] flex-1 resize-none bg-background border border-input p-2 text-sm text-foreground"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={canSend ? "Type a prompt\u2026" : "Composer disabled"}
            disabled={!canSend}
            aria-label="Prompt"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            variant="default"
            disabled={submitting || !canSend || !draft.trim()}
            onClick={handleSend}
          >
            {submitting ? "Sending\u2026" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
