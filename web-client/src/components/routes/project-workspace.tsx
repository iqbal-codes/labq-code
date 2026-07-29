import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { useOrchestratorStore, useClientActions } from "@/orchestrator/StoreContext";
import {
  createThreadCommand,
  archiveProjectCommand,
  settleProjectCommand,
  deleteProjectCommand,
} from "@/orchestrator/commands";
import { lifecycleLabel, lifecycleTone, sourceSummary } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { StatusPill, ConnectionPill, SyncPill } from "@/components/ui/status";
import { NotFound } from "@/components/routes/route-states";

export function ProjectWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { dispatch } = useClientActions();
  const snapshot = useOrchestratorStore((s) => s.snapshot);
  const connection = useOrchestratorStore((s) => s.connection);
  const sync = useOrchestratorStore((s) => s.sync);
  const project = projectId ? snapshot.projects[projectId] : undefined;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [threadTitle, setThreadTitle] = useState("");
  const [model, setModel] = useState("pi-default");
  const [accessProfile, setAccessProfile] = useState("read-only");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"archive" | "settle" | "delete" | null>(null);
  if (!project) return <NotFound />;
  if (project.status === "deleted") {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <StatusPill label="DELETED" tone="hazard" />
          <p className="mt-2 text-muted-foreground">This project has been deleted.</p>
          <Link
            to="/"
            className="mt-4 inline-block text-primary underline-offset-4 hover:underline"
          >
            Return to environment
          </Link>
        </div>
      </div>
    );
  }

  const threads = Object.values(snapshot.threads).filter(
    (t) => t.project_id === projectId && t.status !== "deleted",
  );
  const activeThreads = threads.filter((t) => t.status === "active");
  const archivedSettled = threads.filter((t) => t.status === "archived" || t.status === "settled");

  const canMutate =
    project?.status === "active" &&
    project?.source.status !== "setup_required" &&
    connection === "connected" &&
    sync === "synced";

  const handleCreateThread = async () => {
    if (!threadTitle.trim() || submitting || !canMutate) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await dispatch(
        createThreadCommand({
          project_id: project!.id,
          title: threadTitle.trim(),
          model: model as "pi-default" | "pi-3.5-sonnet" | "pi-3-opus" | "pi-mini",
          access_profile: accessProfile as "read-only" | "workspace-write" | "full-execution",
          interaction_mode: "execute",
        }),
      );
      if (result.ok && result.thread_id) {
        setDialogOpen(false);
        setThreadTitle("");
        setFormError(null);
        navigate(`/projects/${projectId}/threads/${result.thread_id}`);
      } else if (!result.ok) {
        setFormError(result.detail || `Failed to create thread (${result.code})`);
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to create thread.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLifecycle = async (action: "archive" | "settle" | "delete") => {
    setConfirmAction(null);
    if (action === "archive") await dispatch(archiveProjectCommand(project.id));
    else if (action === "settle") await dispatch(settleProjectCommand(project.id));
    else await dispatch(deleteProjectCommand(project.id));
    navigate("/");
  };

  const renderLifecycleConfirm = (action: "archive" | "settle" | "delete") => {
    const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);
    return (
      <AlertDialog
        key={action}
        open={confirmAction === action}
        onOpenChange={(o) => {
          if (!o) setConfirmAction(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{actionLabel} project</AlertDialogTitle>
            <AlertDialogDescription>
              {action === "delete"
                ? `This permanently removes "${project.name}". User-owned source folders are not deleted.`
                : `Mark "${project.name}" as ${action}ed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleLifecycle(action);
              }}
            >
              {actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/" className="tt-mono text-xs text-muted-foreground hover:underline">
            &larr; Environment
          </Link>
          <h1 className="mt-1 text-lg font-semibold">{project.name}</h1>
          <p className="tt-mono text-xs text-muted-foreground">
            {sourceSummary(project.source)} &middot; Kind: {project.source.kind} &middot; Status: {project.source.status}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionPill connection={connection} />
          <SyncPill sync={sync} />
          <StatusPill label={lifecycleLabel(project.status)} tone={lifecycleTone(project.status)} />
          {canMutate && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirmAction("archive")}>
                Archive
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmAction("settle")}>
                Settle
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setConfirmAction("delete")}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      {["archive", "settle", "delete"] as const}.map(renderLifecycleConfirm)
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Threads
        </h2>
        {canMutate && (
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) setFormError(null);
            }}
          >
            <DialogTrigger
              render={
                <Button variant="default" size="sm">
                  New thread
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New thread</DialogTitle>
                <DialogDescription>
                  Configure a new agent session in {project.name}.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                {formError && (
                  <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                    {formError}
                  </div>
                )}
                <div>
                  <Label htmlFor="thread-provider">Provider</Label>
                  <p id="thread-provider" className="tt-mono mt-1 text-sm font-medium">
                    Pi (Fixed)
                  </p>
                </div>
                <Label htmlFor="thread-title">Title</Label>
                <Input
                  id="thread-title"
                  value={threadTitle}
                  onChange={(e) => setThreadTitle(e.target.value)}
                  placeholder="Task name"
                />
                <Label htmlFor="thread-model">Model</Label>
                <Select value={model} onValueChange={(v) => setModel(v ?? "pi-default")}>
                  <SelectTrigger id="thread-model" className="w-full" />
                  <SelectContent>
                    {snapshot.catalog.models.length > 0 ? (
                      snapshot.catalog.models.map((m) => (
                        <SelectItem key={m.id} value={m.id} disabled={!m.available}>
                          {m.name}
                          {m.authenticated ? "" : " (auth req)"}
                        </SelectItem>
                      ))
                    ) : (
                      <>
                        <SelectItem value="pi-default">Pi Default</SelectItem>
                        <SelectItem value="pi-3.5-sonnet">Pi 3.5 Sonnet</SelectItem>
                        <SelectItem value="pi-3-opus">Pi 3 Opus</SelectItem>
                        <SelectItem value="pi-mini">Pi Mini</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
                <Label htmlFor="thread-access">Access profile</Label>
                <Select
                  value={accessProfile}
                  onValueChange={(v) => setAccessProfile(v ?? "read-only")}
                >
                  <SelectTrigger id="thread-access" className="w-full" />
                  <SelectContent>
                    {snapshot.catalog.access_profiles.length > 0 ? (
                      snapshot.catalog.access_profiles.map((a) => (
                        <SelectItem key={a.profile} value={a.profile}>
                          {a.name}
                        </SelectItem>
                      ))
                    ) : (
                      <>
                        <SelectItem value="read-only">Read only</SelectItem>
                        <SelectItem value="workspace-write">Workspace write</SelectItem>
                        <SelectItem value="full-execution">Full execution</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
                <div>
                  <Label>Interaction mode</Label>
                  <p className="tt-mono mt-1 text-sm font-medium">Execute</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Plan workflow mode is unsupported in Pi v1 delivery.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                <Button
                  variant="default"
                  disabled={submitting || !threadTitle.trim()}
                  onClick={() => {
                    void handleCreateThread();
                  }}
                >
                  {submitting ? "Creating\u2026" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {threads.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No threads yet. Create one to start working.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {activeThreads.length > 0 && (
            <div className="flex flex-col gap-1" role="list" aria-label="Active Threads">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Active Threads ({activeThreads.length})
              </h3>
              {activeThreads.map((t) => (
                <Link
                  key={t.id}
                  to={`/projects/${project.id}/threads/${t.id}`}
                  role="listitem"
                  className="flex items-center gap-3 rounded-none border border-border bg-card px-4 py-3 text-left hover:bg-accent"
                >
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{t.title}</p>
                    <p className="tt-mono text-xs text-muted-foreground">
                      {t.model} &middot; {t.access_profile}
                    </p>
                  </div>
                  <StatusPill label={lifecycleLabel(t.status)} tone={lifecycleTone(t.status)} />
                </Link>
              ))}
            </div>
          )}
          {archivedSettled.length > 0 && (
            <div className="flex flex-col gap-1" role="list" aria-label="Archived & Settled Threads">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Archived & Settled ({archivedSettled.length})
              </h3>
              {archivedSettled.map((t) => (
                <Link
                  key={t.id}
                  to={`/projects/${project.id}/threads/${t.id}`}
                  role="listitem"
                  className="flex items-center gap-3 rounded-none border border-border bg-card px-4 py-3 text-left hover:bg-accent"
                >
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{t.title}</p>
                    <p className="tt-mono text-xs text-muted-foreground">
                      {t.model} &middot; {t.access_profile}
                    </p>
                  </div>
                  <StatusPill label={lifecycleLabel(t.status)} tone={lifecycleTone(t.status)} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
