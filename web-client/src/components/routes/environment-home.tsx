import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useOrchestratorStore, useClientActions } from "@/orchestrator/StoreContext";
import { createProjectCommand } from "@/orchestrator/commands";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status";
import {
  LoadingState,
  EmptyState,
  UnauthorizedState,
  RecoverableErrorState,
} from "@/components/routes/route-states";

const SOURCE_KINDS = [
  { value: "local_folder", label: "Local folder", disabled: false },
  { value: "git_url", label: "Git URL", disabled: false },
  { value: "github", label: "GitHub", disabled: true },
  { value: "azure_devops", label: "Azure DevOps", disabled: true },
  { value: "bitbucket", label: "Bitbucket", disabled: true },
  { value: "gitlab", label: "GitLab", disabled: true },
] as const;

export function EnvironmentHome() {
  const navigate = useNavigate();
  const { dispatch } = useClientActions();
  const bootstrapStatus = useOrchestratorStore((s) => s.bootstrapStatus);
  const error = useOrchestratorStore((s) => s.error);
  const snapshot = useOrchestratorStore((s) => s.snapshot);
  const projects = Object.values(snapshot.projects).filter((p) => p.status !== "deleted");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [sourceKind, setSourceKind] = useState<string>("local_folder");
  const [locator, setLocator] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (bootstrapStatus === "connecting" || bootstrapStatus === "idle") {
    return <LoadingState message="Connecting to environment\u2026" />;
  }
  if (bootstrapStatus === "unauthorized") {
    return <UnauthorizedState detail={error?.detail} />;
  }
  if (bootstrapStatus === "error") {
    return <RecoverableErrorState detail={error?.detail} />;
  }

  const empty = projects.length === 0;

  const handleCreateProject = async () => {
    if (!projectName.trim() || submitting) return;
    setSubmitting(true);
    try {
      const source =
        sourceKind === "local_folder"
          ? { kind: "local_folder" as const, path: locator.trim() || `/path/to/${projectName}` }
          : {
              kind: "git_url" as const,
              url: locator.trim() || `https://example.com/${projectName}.git`,
            };
      const result = await dispatch(createProjectCommand({ name: projectName.trim(), source }));
      if (result.ok && result.project_id) {
        navigate(`/projects/${result.project_id}`);
      }
    } finally {
      setSubmitting(false);
      setDialogOpen(false);
      setProjectName("");
      setLocator("");
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Projects</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button variant="default">Add project</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add project</DialogTitle>
              <DialogDescription>Create a new project from a source.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="my-project"
              />
              <Label htmlFor="source-kind">Source</Label>
              <Select value={sourceKind} onValueChange={(v) => setSourceKind(v ?? "local_folder")}>
                <SelectTrigger id="source-kind" className="w-full" />
                <SelectContent>
                  {SOURCE_KINDS.map((sk) => (
                    <SelectItem key={sk.value} value={sk.value} disabled={sk.disabled}>
                      {sk.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label htmlFor="locator">
                {sourceKind === "local_folder" ? "Folder path" : "Repository URL"}
              </Label>
              <Input
                id="locator"
                value={locator}
                onChange={(e) => setLocator(e.target.value)}
                placeholder={
                  sourceKind === "local_folder" ? "/path/to/code" : "https://github.com/user/repo"
                }
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost">Cancel</Button>} />
              <Button
                variant="default"
                disabled={submitting || !projectName.trim()}
                onClick={() => {
                  void handleCreateProject();
                }}
              >
                {submitting ? "Creating\u2026" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {empty ? (
        <EmptyState
          title="No projects yet"
          description="Create your first project to start orchestrating agent work."
          action={
            <Button variant="default" onClick={() => setDialogOpen(true)}>
              Add project
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-1" role="list" aria-label="Projects">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              role="listitem"
              className="flex items-center gap-3 rounded-none border border-border bg-card px-4 py-3 text-left hover:bg-accent"
            >
              <div className="flex-1">
                <p className="font-medium text-foreground">{p.name}</p>
                <p className="tt-mono text-xs text-muted-foreground">{sourceSummary(p.source)}</p>
              </div>
              <StatusPill label={lifecycleLabel(p.status)} tone={lifecycleTone(p.status)} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
