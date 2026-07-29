export const DEFAULT_ENVIRONMENT_ID = "default-env";

export type SourceKind =
  | "local_folder"
  | "git_url"
  | "github"
  | "azure_devops"
  | "bitbucket"
  | "gitlab";

export type SourceStatus = "bound" | "acquired" | "setup_required";

export type SourceDescriptor =
  | { kind: "local_folder"; path: string }
  | { kind: "git_url"; url: string }
  | { kind: "github"; repo: string }
  | { kind: "azure_devops"; repo: string }
  | { kind: "bitbucket"; repo: string }
  | { kind: "gitlab"; repo: string };

export interface ProjectSource {
  kind: SourceKind;
  status: SourceStatus;
  locator: string;
  workspace_path?: string;
}

export type LifecycleStatus = "active" | "archived" | "settled" | "deleted";

export interface Project {
  id: string;
  environment_id: string;
  name: string;
  source: ProjectSource;
  status: LifecycleStatus;
  created_at: string;
  updated_at: string;
}

export type PiModelId =
  | "pi-default"
  | "pi-3.5-sonnet"
  | "pi-3-opus"
  | "pi-mini";

export type RuntimeAccessProfile =
  | "read-only"
  | "workspace-write"
  | "full-execution";

export type InteractionMode = "execute" | "plan";

export type SessionStatus = "none" | "ready" | "running" | "stopped";

export interface Thread {
  id: string;
  environment_id: string;
  project_id: string;
  provider_name: "pi";
  provider_instance_id: "pi-default";
  session_id?: string;
  title: string;
  status: LifecycleStatus;
  session_status: SessionStatus;
  model: PiModelId;
  access_profile: RuntimeAccessProfile;
  interaction_mode: InteractionMode;
  created_at: string;
  updated_at: string;
}

export interface CuratedModel {
  id: PiModelId;
  name: string;
  authenticated: boolean;
  available: boolean;
}

export interface AccessProfileDefinition {
  profile: RuntimeAccessProfile;
  name: string;
  tools: string[];
}

export interface InteractionModeDefinition {
  mode: InteractionMode;
  supported: boolean;
  description: string;
}

export type CapabilityKind = "plan_mode" | "diff" | "checkpoint" | "rollback";

export interface ProviderCapability {
  kind: CapabilityKind;
  supported: boolean;
  read_only: boolean;
  description: string;
}

export interface ProviderCapabilities {
  provider_name: string;
  capabilities: Record<CapabilityKind, ProviderCapability>;
}

export interface CuratedPiCatalog {
  models: CuratedModel[];
  access_profiles: AccessProfileDefinition[];
  interaction_modes: InteractionModeDefinition[];
  capabilities: ProviderCapability[];
}

export type FileChangeKind = "created" | "modified" | "deleted";

export interface FileChangeSummary {
  path: string;
  kind: FileChangeKind;
  additions: number;
  deletions: number;
  diff_hunk?: string;
}

export interface ChangeSummary {
  turn_id: string;
  files: FileChangeSummary[];
  total_additions: number;
  total_deletions: number;
  created_at: string;
}

export const MAX_SUMMARY_FILES = 50;
export const MAX_DIFF_HUNK_BYTES = 4 * 1024; // 4 KiB max per diff hunk

export function boundChangeSummary(summary: ChangeSummary): ChangeSummary {
  const boundedFiles = summary.files.slice(0, MAX_SUMMARY_FILES).map((f) => {
    if (!f.diff_hunk || f.diff_hunk.length <= MAX_DIFF_HUNK_BYTES) {
      return f;
    }
    return {
      ...f,
      diff_hunk: f.diff_hunk.slice(0, MAX_DIFF_HUNK_BYTES) + "\n... [diff hunk truncated]",
    };
  });

  const total_additions = boundedFiles.reduce((sum, f) => sum + f.additions, 0);
  const total_deletions = boundedFiles.reduce((sum, f) => sum + f.deletions, 0);

  return {
    ...summary,
    files: boundedFiles,
    total_additions,
    total_deletions,
  };
}

export interface TurnReviewState {
  turn_id: string;
  read_only: true;
  supports_checkpoint: false;
  supports_rollback: false;
  change_summary?: ChangeSummary;
  unsupported_operations: CapabilityKind[];
}

// Turn types
export type TurnStatus = "queued" | "running" | "paused" | "completed" | "failed" | "interrupted";

export type ToolActivityStatus = "in_progress" | "success" | "failure" | "decline" | "interrupted";

export interface ImageAttachment {
  filename: string;
  media_type: string;
  size_bytes: number;
  data: string; // base64-encoded, bounded in size
}

export interface UserMessageContent {
  text: string;
  images?: ImageAttachment[];
}

export interface ToolActivity {
  id: string;
  turn_id: string;
  tool: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  status: ToolActivityStatus;
  started_at: string;
  completed_at?: string;
}

export interface AssistantMessage {
  id: string;
  turn_id: string;
  parts: AssistantMessagePart[];
  is_complete: boolean;
}

export type AssistantMessagePart =
  | { kind: "text"; content: string }
  | { kind: "tool_use"; activity_id: string; tool: string; input?: unknown; output?: unknown; status: ToolActivityStatus };

export interface Turn {
  id: string;
  environment_id: string;
  project_id: string;
  thread_id: string;
  provider_name: "pi";
  provider_instance_id: "pi-default";
  session_id?: string;
  status: TurnStatus;
  user_message: UserMessageContent;
  assistant_message?: AssistantMessage;
  activities: Record<string, ToolActivity>;
  pending_request?: PendingRequest;
  change_summary?: ChangeSummary;
  created_at: string;
  updated_at: string;
  error?: { code: string; detail: string };
}

// Pending request types
export type InputFieldType = "text" | "multiline_text" | "number" | "boolean" | "select";

export interface SelectOption {
  value: string;
  label: string;
}

export interface InputField {
  id: string;
  type: InputFieldType;
  label: string;
  required: boolean;
  default_value?: string | number | boolean;
  options?: SelectOption[];
  placeholder?: string;
}

export type PendingRequestKind = "approval" | "input";
export type PendingRequestStatus = "pending" | "approved" | "declined" | "answered" | "cancelled";

export interface PendingRequest {
  id: string;
  environment_id: string;
  project_id: string;
  thread_id: string;
  turn_id: string;
  provider_name: "pi";
  provider_instance_id: "pi-default";
  session_id: string;
  operation: string;
  target_scope: string;
  impact: string;
  kind: PendingRequestKind;
  description?: string;
  fields: InputField[];
  status: PendingRequestStatus;
  response?: PendingRequestResponse;
  created_at: string;
  resolved_at?: string;
}

export interface ApprovalResponse {
  decision: "approved" | "declined";
}

export interface StructuredInputResponse {
  values: Record<string, string | number | boolean>;
}

export type PendingRequestResponse = ApprovalResponse | StructuredInputResponse;

// Image bounds constants
export const MAX_IMAGE_COUNT = 5;
export const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MiB total per turn

/**
 * Validate image attachments against bounds.
 * Returns a validation error message, or null if valid.
 */
export function decodedBase64ByteLength(data: string): number {
  const clean = data.trim();
  if (clean.length === 0) return 0;
  if (clean.length % 4 !== 0) return -1;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return -1;
  let padding = 0;
  if (clean.endsWith("==")) padding = 2;
  else if (clean.endsWith("=")) padding = 1;
  return (clean.length * 3) / 4 - padding;
}

export function validateImageAttachments(
  images?: ImageAttachment[]
): string | null {
  if (!images || images.length === 0) return null;
  if (images.length > MAX_IMAGE_COUNT) {
    return `Image count ${images.length} exceeds maximum of ${MAX_IMAGE_COUNT}.`;
  }
  let totalBytes = 0;
  for (const img of images) {
    if (!img.filename || typeof img.filename !== "string") {
      return "Image filename is required.";
    }
    if (!img.media_type || !img.media_type.startsWith("image/")) {
      return `Invalid image media type: ${img.media_type}. Must be an image/* type.`;
    }
    if (typeof img.size_bytes !== "number" || !Number.isFinite(img.size_bytes) || img.size_bytes <= 0) {
      return `Invalid image size_bytes: ${img.size_bytes}. Must be a positive finite number.`;
    }
    const decodedLen = decodedBase64ByteLength(img.data || "");
    if (decodedLen < 0) {
      return `Invalid base64 encoding in image ${img.filename}.`;
    }
    if (decodedLen !== img.size_bytes) {
      return `Image size_bytes mismatch for ${img.filename}: claimed ${img.size_bytes}, decoded ${decodedLen}.`;
    }
    totalBytes += img.size_bytes;
  }
  if (totalBytes > MAX_IMAGE_SIZE_BYTES) {
    return `Total image size exceeds ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)} MiB limit (claimed ${Math.round(totalBytes / (1024 * 1024))} MiB).`;
  }
  return null;
}

// Commands
export interface CommandMeta {
  command_id: string;
  correlation_id?: string;
  causation_id?: string;
}

export type Command =
  | ({ kind: "create_project"; environment_id?: string; name: string; source: SourceDescriptor; project_id?: string } & CommandMeta)
  | ({ kind: "archive_project"; environment_id?: string; project_id: string } & CommandMeta)
  | ({ kind: "settle_project"; environment_id?: string; project_id: string } & CommandMeta)
  | ({ kind: "delete_project"; environment_id?: string; project_id: string } & CommandMeta)
  | ({ kind: "create_thread"; environment_id?: string; project_id: string; title?: string; model: PiModelId; access_profile: RuntimeAccessProfile; interaction_mode: InteractionMode; thread_id?: string } & CommandMeta)
  | ({ kind: "archive_thread"; environment_id?: string; thread_id: string } & CommandMeta)
  | ({ kind: "settle_thread"; environment_id?: string; thread_id: string } & CommandMeta)
  | ({ kind: "delete_thread"; environment_id?: string; thread_id: string } & CommandMeta)
  | ({ kind: "start_turn"; environment_id?: string; thread_id: string; content: UserMessageContent; turn_id?: string } & CommandMeta)
  | ({ kind: "interrupt_turn"; environment_id?: string; thread_id: string; turn_id: string } & CommandMeta)
  | ({ kind: "stop_turn"; environment_id?: string; thread_id: string; turn_id?: string } & CommandMeta)
  | ({ kind: "respond_approval"; environment_id?: string; project_id?: string; thread_id: string; turn_id: string; provider_name?: "pi"; provider_instance_id?: "pi-default"; session_id?: string; request_id: string; decision: "approved" | "declined" } & CommandMeta)
  | ({ kind: "respond_input"; environment_id?: string; project_id?: string; thread_id: string; turn_id: string; provider_name?: "pi"; provider_instance_id?: "pi-default"; session_id?: string; request_id: string; values: Record<string, string | number | boolean> } & CommandMeta);

export interface DomainEventMeta {
  event_id: string;
  sequence: number;
  timestamp: string;
  command_id?: string;
  correlation_id?: string;
  causation_id?: string;
  provider_name?: string;
  provider_instance_id?: string;
  session_id?: string;
  request_id?: string;
  provider_event_id?: string;
}

export type DomainEvent =
  | ({ kind: "SnapshotEmitted"; data: { snapshot: Snapshot } } & DomainEventMeta)
  | ({ kind: "ProjectCreated"; data: { project: Project } } & DomainEventMeta)
  | ({ kind: "ProjectArchived"; data: { project_id: string } } & DomainEventMeta)
  | ({ kind: "ProjectSettled"; data: { project_id: string } } & DomainEventMeta)
  | ({ kind: "ProjectDeleted"; data: { project_id: string } } & DomainEventMeta)
  | ({ kind: "ThreadCreated"; data: { thread: Thread } } & DomainEventMeta)
  | ({ kind: "ThreadArchived"; data: { thread_id: string } } & DomainEventMeta)
  | ({ kind: "ThreadSettled"; data: { thread_id: string } } & DomainEventMeta)
  | ({ kind: "ThreadDeleted"; data: { thread_id: string } } & DomainEventMeta)
  | ({ kind: "SessionStarted"; data: { environment_id: string; project_id: string; thread_id: string; turn_id: string; provider_name: "pi"; provider_instance_id: "pi-default"; session_id: string } } & DomainEventMeta)
  | ({ kind: "TurnQueued"; data: { turn: Turn } } & DomainEventMeta)
  | ({ kind: "TurnStarted"; data: { turn_id: string } } & DomainEventMeta)
  | ({ kind: "AssistantMessageDelta"; data: { turn_id: string; text: string } } & DomainEventMeta)
  | ({ kind: "ToolActivityBegan"; data: { turn_id: string; activity: ToolActivity } } & DomainEventMeta)
  | ({ kind: "ToolActivityDelta"; data: { turn_id: string; activity_id: string; content: string } } & DomainEventMeta)
  | ({ kind: "ToolActivityCompleted"; data: { turn_id: string; activity_id: string; status: ToolActivityStatus; output?: unknown; error?: string } } & DomainEventMeta)
  | ({ kind: "AssistantMessageCompleted"; data: { turn_id: string } } & DomainEventMeta)
  | ({ kind: "TurnPaused"; data: { turn_id: string } } & DomainEventMeta)
  | ({ kind: "TurnCompleted"; data: { turn_id: string } } & DomainEventMeta)
  | ({ kind: "TurnFailed"; data: { turn_id: string; error: { code: string; detail: string } } } & DomainEventMeta)
  | ({ kind: "TurnInterrupted"; data: { turn_id: string } } & DomainEventMeta)
  | ({ kind: "ApprovalRequested"; data: { turn_id: string; request: PendingRequest } } & DomainEventMeta)
  | ({ kind: "InputRequested"; data: { turn_id: string; request: PendingRequest } } & DomainEventMeta)
  | ({ kind: "PendingRequestResolved"; data: { turn_id: string; request_id: string; response: PendingRequestResponse } } & DomainEventMeta)
  | ({ kind: "SessionStopped"; data: { thread_id: string } } & DomainEventMeta)
  | ({ kind: "ChangeSummaryEmitted"; data: { turn_id: string; summary: ChangeSummary } } & DomainEventMeta);
// Command Results & Receipts
export type CommandSuccess = {
  ok: true;
  project_id?: string;
  thread_id?: string;
  turn_id?: string;
  status?: LifecycleStatus | TurnStatus | SessionStatus;
  duplicate?: boolean;
};

export type CommandError = {
  ok: false;
  code: string;
  detail: string;
  duplicate?: boolean;
};

export type CommandResult = CommandSuccess | CommandError;

export interface CommandReceipt {
  command_id: string;
  result: CommandResult;
  sequences: number[];
}

// Snapshot & Sync
export interface Snapshot {
  sequence: number;
  projects: Record<string, Project>;
  threads: Record<string, Thread>;
  turns: Record<string, Turn>;
  catalog: CuratedPiCatalog;
}

export type SyncResult =
  | { ok: true; mode: "up_to_date"; sequence: number }
  | { ok: true; mode: "replay"; from: number; to: number; events: DomainEvent[] }
  | { ok: true; mode: "snapshot"; sequence: number; snapshot: Snapshot; reason?: string };