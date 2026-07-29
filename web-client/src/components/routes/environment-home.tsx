import { useState, useEffect } from "react";
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
import { StatusPill } from "@/components/ui/status";
import {
  LoadingState,
  EmptyState,
  UnauthorizedState,
  RecoverableErrorState,
} from "@/components/routes/route-states";
import type { SourceDescriptor } from "@labq/domain/types";

export type SourceKind =
  | "local_folder"
  | "git_url"
  | "github"
  | "azure_devops"
  | "bitbucket"
  | "gitlab";

export interface SourceOption {
  kind: SourceKind;
  label: string;
  description: string;
  disabled: boolean;
}

export const CANONICAL_SOURCES: SourceOption[] = [
  {
    kind: "local_folder",
    label: "Local folder",
    description: "Import a project from a folder on your local file system.",
    disabled: false,
  },
  {
    kind: "git_url",
    label: "Git URL",
    description: "Clone a repository from any accessible Git HTTPS or SSH URL.",
    disabled: false,
  },
  {
    kind: "github",
    label: "GitHub repository",
    description: "Connect to GitHub repository. Setup required.",
    disabled: true,
  },
  {
    kind: "azure_devops",
    label: "Azure DevOps repository",
    description: "Connect to Azure DevOps repository. Setup required.",
    disabled: true,
  },
  {
    kind: "bitbucket",
    label: "Bitbucket repository",
    description: "Connect to Bitbucket repository. Setup required.",
    disabled: true,
  },
  {
    kind: "gitlab",
    label: "GitLab repository",
    description: "Connect to GitLab repository. Setup required.",
    disabled: true,
  },
];

export function EnvironmentHome() {
  const navigate = useNavigate();
  const { dispatch } = useClientActions();
  const bootstrapStatus = useOrchestratorStore((s) => s.bootstrapStatus);
  const error = useOrchestratorStore((s) => s.error);
  const snapshot = useOrchestratorStore((s) => s.snapshot);
  const projects = Object.values(snapshot.projects).filter((p) => p.status !== "deleted");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<"choose" | "form">("choose");
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const [sourceKind, setSourceKind] = useState<SourceKind>("local_folder");
  const [projectName, setProjectName] = useState("");
  const [locator, setLocator] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [createCommandId, setCreateCommandId] = useState<string | undefined>();

  const filteredSources = CANONICAL_SOURCES.filter(
    (s) =>
      s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    if (highlightedIndex >= filteredSources.length) {
      setHighlightedIndex(Math.max(0, filteredSources.length - 1));
    }
  }, [filteredSources.length, highlightedIndex]);

  if (bootstrapStatus === "connecting" || bootstrapStatus === "idle") {
    return <LoadingState message="Connecting to environment…" />;
  }
  if (bootstrapStatus === "unauthorized") {
    return <UnauthorizedState detail={error?.detail} />;
  }
  if (bootstrapStatus === "error") {
    return <RecoverableErrorState detail={error?.detail} />;
  }

  const empty = projects.length === 0;

  const handleSelectSource = (source: SourceOption) => {
    if (source.disabled) {
      const msg = `${source.label} requires setup before use and cannot be selected.`;
      setAnnouncement(msg);
      return;
    }
    setSourceKind(source.kind);
    setStep("form");
    setFormError(null);
    setAnnouncement(`Selected ${source.label}. Enter project details.`);
  };

  const handleCreateProject = async () => {
    if (submitting) return;

    const trimmedName = projectName.trim();
    const trimmedLocator = locator.trim();

    if (!trimmedName || !trimmedLocator) {
      const err = !trimmedName
        ? "Project name is required."
        : sourceKind === "local_folder"
        ? "Folder path is required."
        : "Repository URL is required.";
      setFormError(err);
      setAnnouncement(err);
      return;
    }

    const selectedSource = CANONICAL_SOURCES.find((s) => s.kind === sourceKind);
    if (!selectedSource || selectedSource.disabled) {
      const err = `${selectedSource?.label || "Hosted source"} requires setup before use and cannot create a project.`;
      setFormError(err);
      setAnnouncement(err);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setAnnouncement("Creating project…");

    try {
      const source: SourceDescriptor =
        sourceKind === "local_folder"
          ? { kind: "local_folder", path: trimmedLocator }
          : { kind: "git_url", url: trimmedLocator };
      const command = createProjectCommand({
        name: trimmedName,
        source,
        command_id: createCommandId,
      });
      if (!createCommandId) setCreateCommandId(command.command_id);
      const result = await dispatch(command);

      if (result.ok && result.project_id) {
        setProjectName("");
        setLocator("");
        setSearchQuery("");
        setCreateCommandId(undefined);
        setStep("choose");
        setFormError(null);
        setDialogOpen(false);
        navigate(`/projects/${result.project_id}`);
      } else {
        const detail = !result.ok
          ? result.detail || result.code || "Failed to create project."
          : "Failed to create project.";
        setFormError(detail);
        setAnnouncement(`Failed to create project: ${detail}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      setFormError(message);
      setAnnouncement(`Failed to create project: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleChooserKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredSources.length === 0) return;
      const next = Math.min(highlightedIndex + 1, filteredSources.length - 1);
      setHighlightedIndex(next);
      const target = filteredSources[next];
      if (target) {
        setAnnouncement(`${target.label}${target.disabled ? " - Setup required" : ""}`);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredSources.length === 0) return;
      const prev = Math.max(highlightedIndex - 1, 0);
      setHighlightedIndex(prev);
      const target = filteredSources[prev];
      if (target) {
        setAnnouncement(`${target.label}${target.disabled ? " - Setup required" : ""}`);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredSources[highlightedIndex]) {
        handleSelectSource(filteredSources[highlightedIndex]);
      }
    }
  };
  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && e.currentTarget.value === "") {
      e.preventDefault();
      setStep("choose");
      setFormError(null);
      setAnnouncement("Returned to source chooser.");
    }
  };

  const selectedSourceObj = CANONICAL_SOURCES.find((s) => s.kind === sourceKind);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Projects</h1>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (open) {
              setStep("choose");
              setSearchQuery("");
              setHighlightedIndex(0);
              setFormError(null);
              setCreateCommandId(undefined);
              setAnnouncement("Select a source to create your project. 6 sources available.");
            } else if (!submitting) {
              setStep("choose");
              setFormError(null);
              setCreateCommandId(undefined);
            }
          }}
        >
          <DialogTrigger render={<Button variant="default">Add project</Button>} />
          <DialogContent className="sm:max-w-md">
            <div className="sr-only" role="status" aria-live="polite">
              {announcement}
            </div>

            {step === "choose" ? (
              <>
                <DialogHeader>
                  <DialogTitle>Add project</DialogTitle>
                  <DialogDescription>
                    Select a project source to get started.
                  </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3 my-2" onKeyDown={handleChooserKeyDown}>
                  <Label htmlFor="source-search" className="sr-only">
                    Search sources
                  </Label>
                  <Input
                    id="source-search"
                    type="search"
                    placeholder="Search sources…"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setHighlightedIndex(0);
                      setAnnouncement(`Filter updated: ${e.target.value}`);
                    }}
                    autoFocus
                  />

                  <div
                    role="listbox"
                    aria-label="Project sources"
                    className="flex flex-col gap-1.5 max-h-72 overflow-y-auto py-1"
                  >
                    {filteredSources.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        No sources matching &quot;{searchQuery}&quot;.
                      </div>
                    ) : (
                      filteredSources.map((source, index) => {
                        const isHighlighted = index === highlightedIndex;
                        return (
                          <div
                            key={source.kind}
                            role="option"
                            id={`source-option-${source.kind}`}
                            aria-selected={isHighlighted}
                            aria-disabled={source.disabled}
                            tabIndex={isHighlighted ? 0 : -1}
                            onClick={() => handleSelectSource(source)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            className={`flex items-center justify-between rounded-md border p-3 cursor-pointer text-left transition-colors ${
                              isHighlighted
                                ? "bg-accent border-primary text-accent-foreground"
                                : "border-border hover:bg-accent/50 text-foreground"
                            } ${
                              source.disabled
                                ? "opacity-70 cursor-not-allowed bg-muted/40"
                                : ""
                            }`}
                          >
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-sm">
                                {source.label}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {source.description}
                              </span>
                            </div>
                            {source.disabled && (
                              <span className="ml-2 shrink-0 rounded bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground border border-border">
                                Setup required
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <DialogFooter>
                  <DialogClose render={<Button variant="outline">Cancel</Button>} />
                </DialogFooter>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleCreateProject();
                }}
              >
                <DialogHeader>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setStep("choose");
                        setFormError(null);
                        setAnnouncement("Returned to source chooser.");
                      }}
                      aria-label="Back to source chooser"
                    >
                      &larr; Back
                    </Button>
                    <DialogTitle>Add project &ndash; {selectedSourceObj?.label}</DialogTitle>
                  </div>
                  <DialogDescription>
                    {sourceKind === "local_folder"
                      ? "Enter a project name and local directory path."
                      : "Enter a project name and Git repository URL."}
                  </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3 my-3">
                  {formError && (
                    <div
                      className="rounded border border-destructive/50 bg-destructive/10 p-2.5 text-xs font-medium text-destructive"
                      role="alert"
                    >
                      {formError}
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="project-name">Project name</Label>
                    <Input
                      id="project-name"
                      value={projectName}
                      onChange={(e) => {
                        setProjectName(e.target.value);
                        setFormError(null);
                      }}
                      onKeyDown={handleFormKeyDown}
                      placeholder="my-project"
                      autoFocus
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="source-locator">
                      {sourceKind === "local_folder" ? "Folder path" : "Repository URL"}
                    </Label>
                    <Input
                      id="source-locator"
                      value={locator}
                      onChange={(e) => {
                        setLocator(e.target.value);
                        setFormError(null);
                      }}
                      onKeyDown={handleFormKeyDown}
                      placeholder={
                        sourceKind === "local_folder"
                          ? "/path/to/code"
                          : "https://github.com/user/repo.git"
                      }
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setStep("choose");
                      setFormError(null);
                      setAnnouncement("Returned to source chooser.");
                    }}
                  >
                    Back
                  </Button>
                  <DialogClose render={<Button type="button" variant="outline">Cancel</Button>} />
                  <Button
                    type="submit"
                    variant="default"
                    disabled={submitting || !projectName.trim() || !locator.trim()}
                  >
                    {submitting ? "Creating project…" : "Create project"}
                  </Button>
                </DialogFooter>
              </form>
            )}
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
