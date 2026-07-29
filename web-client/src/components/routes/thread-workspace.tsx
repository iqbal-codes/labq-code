import { useState, useRef } from "react";
import { Link, useParams } from "react-router";
import { useOrchestratorStore, useClientActions } from "@/orchestrator/StoreContext";
import {
  startTurnCommand,
  interruptTurnCommand,
  stopTurnCommand,
  respondApprovalCommand,
  respondInputCommand,
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
import { StatusPill, ConnectionPill, SyncPill } from "@/components/ui/status";
import { NotFound } from "@/components/routes/route-states";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import {
  validateImageAttachments,
  decodedBase64ByteLength,
  MAX_IMAGE_COUNT,
  MAX_IMAGE_SIZE_BYTES,
  type ImageAttachment,
  type InputField,
} from "@labq/domain/types";

export function ThreadWorkspace() {
  const { projectId, threadId } = useParams<{ projectId: string; threadId: string }>();
  const { dispatch } = useClientActions();
  const snapshot = useOrchestratorStore((s) => s.snapshot);
  const connection = useOrchestratorStore((s) => s.connection);
  const sync = useOrchestratorStore((s) => s.sync);

  const project = projectId ? snapshot.projects[projectId] : undefined;
  const thread = threadId ? snapshot.threads[threadId] : undefined;

  // Local composer state
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showStop, setShowStop] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Local structured-input form state
  const [inputValues, setInputValues] = useState<Record<string, string | number | boolean>>({});
  const [inputFieldErrors, setInputFieldErrors] = useState<Record<string, string>>({});
  const [inputFormSummaryError, setInputFormSummaryError] = useState<string | null>(null);
  const [responseSubmitting, setResponseSubmitting] = useState(false);
  const firstInvalidRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  if (!project && !thread) return <NotFound />;
  if (!thread || thread.status === "deleted") {
    const target = project ? `/projects/${project.id}` : "/";
    const label = project ? "Return to project" : "Return to environment";
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <StatusPill label={!thread ? "NOT FOUND" : "DELETED"} tone="hazard" />
          <p className="mt-2 text-muted-foreground">
            {!thread ? "This thread does not exist." : "This thread has been deleted."}
          </p>
          <Link
            to={target}
            className="mt-4 inline-block text-primary underline-offset-4 hover:underline text-sm font-medium"
          >
            {label}
          </Link>
        </div>
      </div>
    );
  }

  const isConnectedAndSynced = connection === "connected" && sync === "synced";

  const turns = Object.values(snapshot.turns)
    .filter((t) => t.thread_id === threadId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const activeTurn = turns.find(
    (t) => t.status === "queued" || t.status === "running" || t.status === "paused",
  );
  const hasActiveTurn = !!activeTurn;
  const canSend = !hasActiveTurn && thread.status === "active" && isConnectedAndSynced;
  const pendingRequest = activeTurn?.pending_request;

  // Disabled reason text
  let disabledReason = "";
  if (!isConnectedAndSynced) {
    disabledReason = "Connection is disconnected or synchronizing.";
  } else if (hasActiveTurn) {
    disabledReason = `A turn is ${activeTurn?.status ?? "active"}.`;
  } else if (thread.status !== "active") {
    disabledReason = `Thread is ${thread.status}.`;
  }

  // Handle image file selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachmentError(null);
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: ImageAttachment[] = [...attachments];
    let fileError: string | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) {
        fileError = `File "${file.name}" is not an image. Only image/* files are allowed.`;
        break;
      }

      try {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result as string;
            // Strip data:image/...;base64, prefix
            const commaIdx = res.indexOf(",");
            resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
          };
          reader.onerror = () => reject(new Error(`Failed to read file ${file.name}`));
          reader.readAsDataURL(file);
        });

        const decodedLen = decodedBase64ByteLength(base64Data);
        const attachment: ImageAttachment = {
          filename: file.name,
          media_type: file.type,
          size_bytes: decodedLen >= 0 ? decodedLen : file.size,
          data: base64Data,
        };
        newAttachments.push(attachment);
      } catch (err: unknown) {
        fileError = err instanceof Error ? err.message : `Failed to read file ${file.name}`;
        break;
      }
    }

    if (fileError) {
      setAttachmentError(fileError);
      return;
    }

    const validationErr = validateImageAttachments(newAttachments);
    if (validationErr) {
      setAttachmentError(validationErr);
    } else {
      setAttachments(newAttachments);
      setAttachmentError(null);
    }
    // Clear input so re-selecting same file triggers change
    e.target.value = "";
  };

  const handleRemoveAttachment = (index: number) => {
    const updated = attachments.filter((_, i) => i !== index);
    setAttachments(updated);
    setAttachmentError(validateImageAttachments(updated));
  };

  const handleSend = async () => {
    if ((!draft.trim() && attachments.length === 0) || submitting || !canSend) return;
    setSubmitting(true);
    setComposerError(null);

    const validationErr = validateImageAttachments(attachments);
    if (validationErr) {
      setAttachmentError(validationErr);
      setSubmitting(false);
      return;
    }

    try {
      const result = await dispatch(
        startTurnCommand({
          thread_id: thread.id,
          content: {
            text: draft.trim(),
            images: attachments.length > 0 ? attachments : undefined,
          },
        }),
      );

      if (result.ok) {
        setDraft("");
        setAttachments([]);
        setAttachmentError(null);
        setComposerError(null);
      } else {
        setComposerError(result.detail || `Failed to start turn (${result.code})`);
      }
    } catch (err: unknown) {
      setComposerError(err instanceof Error ? err.message : "Failed to start turn.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleInterrupt = () => {
    if (!activeTurn) return;
    dispatch(interruptTurnCommand(activeTurn.id, thread.id)).catch(() => {});
  };

  const handleStop = () => {
    setShowStop(false);
    dispatch(stopTurnCommand(thread.id)).catch(() => {});
  };

  const handleApproval = async (decision: "approved" | "declined") => {
    if (!pendingRequest || !activeTurn || responseSubmitting || !isConnectedAndSynced) return;
    setResponseSubmitting(true);
    setInputFormSummaryError(null);
    try {
      const res = await dispatch(
        respondApprovalCommand({
          project_id: project ? project.id : projectId || "",
          thread_id: thread.id,
          turn_id: activeTurn.id,
          session_id: activeTurn.session_id || thread.session_id || "",
          request_id: pendingRequest.id,
          decision,
        }),
      );
      if (!res.ok) {
        setInputFormSummaryError(res.detail || `Approval response failed (${res.code})`);
      }
    } catch (err: unknown) {
      setInputFormSummaryError(err instanceof Error ? err.message : "Approval response failed.");
    } finally {
      setResponseSubmitting(false);
    }
  };

  const handleStructuredInputSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingRequest || !activeTurn || responseSubmitting || !isConnectedAndSynced) return;

    setInputFieldErrors({});
    setInputFormSummaryError(null);

    const fieldErrors: Record<string, string> = {};
    let firstInvalidFieldId: string | null = null;

    for (const field of pendingRequest.fields) {
      const val = inputValues[field.id];
      if (field.required && (val === undefined || val === null || val === "")) {
        fieldErrors[field.id] = `Required field "${field.label}" is missing.`;
        if (!firstInvalidFieldId) firstInvalidFieldId = field.id;
        continue;
      }
      if (val !== undefined && val !== null && val !== "") {
        if (field.type === "number") {
          const num = Number(val);
          if (!Number.isFinite(num)) {
            fieldErrors[field.id] = `Field "${field.label}" must be a valid finite number.`;
            if (!firstInvalidFieldId) firstInvalidFieldId = field.id;
          }
        } else if (field.type === "select") {
          if (field.options && !field.options.some((o) => o.value === String(val))) {
            fieldErrors[field.id] = `Selected value is not a valid option for "${field.label}".`;
            if (!firstInvalidFieldId) firstInvalidFieldId = field.id;
          }
        }
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      setInputFieldErrors(fieldErrors);
      setInputFormSummaryError("Please fix the validation errors below.");
      if (firstInvalidRef.current) {
        firstInvalidRef.current.focus();
      }
      return;
    }

    // Cast numbers and booleans to proper types
    const formattedValues: Record<string, string | number | boolean> = {};
    for (const field of pendingRequest.fields) {
      if (field.id in inputValues) {
        const raw = inputValues[field.id];
        if (field.type === "number") {
          formattedValues[field.id] = Number(raw);
        } else if (field.type === "boolean") {
          formattedValues[field.id] = Boolean(raw);
        } else {
          formattedValues[field.id] = String(raw);
        }
      } else if (field.default_value !== undefined) {
        formattedValues[field.id] = field.default_value;
      }
    }

    setResponseSubmitting(true);
    try {
      const res = await dispatch(
        respondInputCommand({
          project_id: project ? project.id : projectId || "",
          thread_id: thread.id,
          turn_id: activeTurn.id,
          session_id: activeTurn.session_id || thread.session_id || "",
          request_id: pendingRequest.id,
          values: formattedValues,
        }),
      );
      if (!res.ok) {
        setInputFormSummaryError(res.detail || `Input response failed (${res.code})`);
      }
    } catch (err: unknown) {
    } finally {
      setResponseSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* Header */}
      <div>
        <Link
          to={project ? `/projects/${project.id}` : "/"}
          className="tt-mono text-xs text-muted-foreground hover:underline"
        >
          &larr; {project ? project.name : "Project"}
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{thread.title}</h1>
            <p className="tt-mono text-xs text-muted-foreground">
              Provider: Pi &middot; {thread.model} &middot; {thread.access_profile} &middot; Mode: {thread.interaction_mode}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ConnectionPill connection={connection} />
            <SyncPill sync={sync} />
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

      {/* Stop Session Dialog */}
      <AlertDialog open={showStop} onOpenChange={setShowStop}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop session</AlertDialogTitle>
            <AlertDialogDescription>
              Active work will terminate and the session will be disposed. A new session is required to resume.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStop}>Stop</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pending Approval / Input Form Card */}
      {pendingRequest && (
        <div className="border border-destructive/50 bg-card p-4 rounded shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <StatusPill
              label={pendingRequest.kind === "approval" ? "APPROVAL REQUIRED" : "INPUT REQUIRED"}
              tone="hazard"
            />
            <span className="tt-mono text-xs text-muted-foreground">
              Req: {pendingRequest.id} &middot; Turn: {activeTurn?.id}
            </span>
          </div>
          <p className="font-semibold text-sm">{pendingRequest.operation}</p>
          <div className="tt-mono text-xs text-muted-foreground mt-1 flex gap-4">
            <span>Scope: {pendingRequest.target_scope}</span>
            <span>Impact: {pendingRequest.impact}</span>
          </div>
          {pendingRequest.description && (
            <p className="mt-2 text-xs text-muted-foreground">{pendingRequest.description}</p>
          )}

          {inputFormSummaryError && (
            <div className="mt-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              {inputFormSummaryError}
            </div>
          )}

          {pendingRequest.kind === "approval" && (
            <div className="mt-3 flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={!isConnectedAndSynced || responseSubmitting || pendingRequest.status !== "pending"}
                onClick={() => handleApproval("declined")}
              >
                Decline
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={!isConnectedAndSynced || responseSubmitting || pendingRequest.status !== "pending"}
                onClick={() => handleApproval("approved")}
              >
                Approve
              </Button>
            </div>
          )}

          {pendingRequest.kind === "input" && (
            <form onSubmit={handleStructuredInputSubmit} className="mt-3 flex flex-col gap-3">
              {pendingRequest.fields.map((field: InputField, index: number) => {
                const isFirstInvalid = inputFieldErrors[field.id] && !firstInvalidRef.current;
                const setRef = isFirstInvalid
                  ? (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null) => {
                      firstInvalidRef.current = el;
                    }
                  : undefined;

                return (
                  <div key={field.id} className="flex flex-col gap-1">
                    <Label htmlFor={`field-${field.id}`} className="text-xs font-medium">
                      {field.label} {field.required ? "*" : "(optional)"}
                    </Label>
                    {field.type === "text" && (
                      <Input
                        ref={setRef as any}
                        id={`field-${field.id}`}
                        type="text"
                        placeholder={field.placeholder}
                        value={(inputValues[field.id] as string) ?? (field.default_value as string) ?? ""}
                        onChange={(e) => setInputValues({ ...inputValues, [field.id]: e.target.value })}
                        disabled={!isConnectedAndSynced || responseSubmitting || pendingRequest.status !== "pending"}
                      />
                    )}
                    {field.type === "multiline_text" && (
                      <textarea
                        ref={setRef as any}
                        id={`field-${field.id}`}
                        placeholder={field.placeholder}
                        rows={3}
                        className="w-full bg-background border border-input p-2 text-sm text-foreground rounded"
                        value={(inputValues[field.id] as string) ?? (field.default_value as string) ?? ""}
                        onChange={(e) => setInputValues({ ...inputValues, [field.id]: e.target.value })}
                        disabled={!isConnectedAndSynced || responseSubmitting || pendingRequest.status !== "pending"}
                      />
                    )}
                    {field.type === "number" && (
                      <Input
                        ref={setRef as any}
                        id={`field-${field.id}`}
                        type="number"
                        placeholder={field.placeholder}
                        value={(inputValues[field.id] as number) ?? (field.default_value as number) ?? ""}
                        onChange={(e) =>
                          setInputValues({
                            ...inputValues,
                            [field.id]: e.target.value === "" ? "" : Number(e.target.value),
                          })
                        }
                        disabled={!isConnectedAndSynced || responseSubmitting || pendingRequest.status !== "pending"}
                      />
                    )}
                    {field.type === "boolean" && (
                      <div className="flex items-center gap-2">
                        <input
                          ref={setRef as any}
                          id={`field-${field.id}`}
                          type="checkbox"
                          checked={Boolean(inputValues[field.id] ?? field.default_value ?? false)}
                          onChange={(e) => setInputValues({ ...inputValues, [field.id]: e.target.checked })}
                          disabled={!isConnectedAndSynced || responseSubmitting || pendingRequest.status !== "pending"}
                          className="h-4 w-4 rounded border-input"
                        />
                        <span className="text-xs text-muted-foreground">Enabled</span>
                      </div>
                    )}
                    {field.type === "select" && (
                      <Select
                        value={String(inputValues[field.id] ?? field.default_value ?? "")}
                        onValueChange={(val) => setInputValues({ ...inputValues, [field.id]: val ?? "" })}
                        disabled={!isConnectedAndSynced || responseSubmitting || pendingRequest.status !== "pending"}
                      >
                        <SelectTrigger id={`field-${field.id}`} className="w-full" ref={setRef as any} />
                        <SelectContent>
                          {(field.options || []).map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {inputFieldErrors[field.id] && (
                      <span className="text-xs text-destructive">{inputFieldErrors[field.id]}</span>
                    )}
                  </div>
                );
              })}
              <Button
                type="submit"
                variant="default"
                size="sm"
                disabled={!isConnectedAndSynced || responseSubmitting || pendingRequest.status !== "pending"}
              >
                {responseSubmitting ? "Submitting\u2026" : "Submit input"}
              </Button>
            </form>
          )}
        </div>
      )}

      {/* Conversation Timeline */}
      <div
        className="flex flex-1 flex-col gap-3 overflow-auto"
        role="log"
        aria-label="Conversation"
      >
        {turns.map((turn) => (
          <div key={turn.id} className="border border-border bg-card p-4 rounded">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <StatusPill
                  label={turn.status.toUpperCase()}
                  tone={
                    turn.status === "completed"
                      ? "active"
                      : turn.status === "failed" || turn.status === "interrupted"
                        ? "hazard"
                        : turn.status === "running" || turn.status === "paused"
                          ? "warn"
                          : "idle"
                  }
                />
                <span className="tt-mono text-xs text-muted-foreground">Turn: {turn.id}</span>
              </div>
              <span className="tt-mono text-xs text-muted-foreground">{turn.created_at}</span>
            </div>

            {/* User Message */}
            <p className="text-sm whitespace-pre-wrap font-medium">{turn.user_message.text}</p>

            {/* User Message Images */}
            {turn.user_message.images && turn.user_message.images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {turn.user_message.images.map((img, idx) => (
                  <div key={idx} className="flex items-center gap-2 border border-border bg-muted p-2 rounded text-xs">
                    <span className="font-semibold">{img.filename}</span>
                    <span className="tt-mono text-muted-foreground">
                      ({img.media_type}, {Math.round(img.size_bytes / 1024)} KB)
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Assistant Message */}
            {turn.assistant_message && (
              <div className="mt-3 border-t border-border pt-3">
                {turn.assistant_message.parts.map((part, i) => {
                  if (part.kind === "text") {
                    return (
                      <p key={i} className="text-sm whitespace-pre-wrap text-foreground/90">
                        {part.content}
                      </p>
                    );
                  }
                  return (
                    <div key={i} className="my-1 border-l-2 border-primary/50 pl-2 text-xs">
                      <span className="font-semibold">[Tool: {part.tool}]</span> Status:{" "}
                      <span className="tt-mono">{part.status}</span>
                      {part.output !== undefined && (
                        <p className="tt-mono text-muted-foreground mt-1 whitespace-pre-wrap">
                          {String(part.output)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Tool Activities */}
            {Object.keys(turn.activities || {}).length > 0 && (
              <div className="mt-3 border-t border-border pt-2 flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Activities</span>
                {Object.values(turn.activities).map((act) => (
                  <div key={act.id} className="flex items-center justify-between tt-mono text-xs bg-muted/40 p-1 px-2 rounded">
                    <span>{act.tool}</span>
                    <span
                      className={
                        act.status === "success"
                          ? "text-emerald-500"
                          : act.status === "failure"
                            ? "text-destructive"
                            : act.status === "decline"
                              ? "text-amber-500"
                              : "text-muted-foreground"
                      }
                    >
                      {act.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Change Summary */}
            {turn.change_summary && (
              <div className="mt-3 border-t border-border pt-2 text-xs">
                <p className="font-semibold text-muted-foreground uppercase">Change Summary</p>
                <p className="tt-mono text-muted-foreground">
                  +{turn.change_summary.total_additions} / -{turn.change_summary.total_deletions} in {turn.change_summary.files.length} files
                </p>
              </div>
            )}

            {/* Capabilities explanation */}
            <div className="mt-2 text-[10px] text-muted-foreground tt-mono">
              Plan mode unsupported in Pi v1 delivery &middot; Checkpointing unsupported &middot; Rollback unsupported
            </div>

            {turn.error && (
              <p className="mt-2 text-xs text-destructive tt-mono font-medium">
                {turn.error.code}: {turn.error.detail}
              </p>
            )}
          </div>
        ))}

        {turns.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-12">
            <p className="text-muted-foreground text-sm">No activity yet. Send a prompt to start.</p>
          </div>
        )}
      </div>

      {/* Composer Section */}
      <div className="border-t border-border pt-3">
        {composerError && (
          <div className="mb-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            {composerError}
          </div>
        )}

        {disabledReason && (
          <p className="mb-2 text-xs text-muted-foreground">{disabledReason}</p>
        )}

        {/* Attachments preview */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att, idx) => (
              <div key={idx} className="flex items-center gap-2 border border-border bg-card px-2 py-1 rounded text-xs">
                <span className="font-medium">{att.filename}</span>
                <span className="tt-mono text-muted-foreground">
                  ({Math.round(att.size_bytes / 1024)} KB)
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(idx)}
                  className="text-destructive hover:underline text-xs ml-1"
                  aria-label={`Remove ${att.filename}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {attachmentError && (
          <p className="mb-2 text-xs text-destructive">{attachmentError}</p>
        )}

        <div className="flex gap-2">
          <textarea
            className="min-h-[64px] flex-1 resize-none bg-background border border-input p-2 text-sm text-foreground rounded"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={canSend ? "Type a prompt\u2026 (Ctrl+Enter to send)" : "Composer disabled"}
            disabled={!canSend}
            aria-label="Prompt"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <div className="flex flex-col gap-2">
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={!canSend || attachments.length >= MAX_IMAGE_COUNT}
                onChange={handleFileChange}
                className="sr-only"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canSend || attachments.length >= MAX_IMAGE_COUNT}
                className="w-full"
              >
                Attach Image
              </Button>
            </label>
            <Button
              variant="default"
              disabled={submitting || !canSend || (!draft.trim() && attachments.length === 0)}
              onClick={() => void handleSend()}
            >
              {submitting ? "Sending\u2026" : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
