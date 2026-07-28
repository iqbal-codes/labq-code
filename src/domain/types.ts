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
  project_id: string;
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

export interface CuratedPiCatalog {
  models: CuratedModel[];
  access_profiles: AccessProfileDefinition[];
  interaction_modes: InteractionModeDefinition[];
}

// Turn types
export type TurnStatus = "queued" | "running" | "paused" | "completed" | "failed" | "interrupted";

export type ToolActivityStatus = "in_progress" | "success" | "failure" | "decline" | "interrupted";

export interface ImageAttachment {
  media_type: string;
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
  thread_id: string;
  status: TurnStatus;
  user_message: UserMessageContent;
  assistant_message?: AssistantMessage;
  activities: Record<string, ToolActivity>;
  pending_request?: PendingRequest;
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
  turn_id: string;
  thread_id: string;
  kind: PendingRequestKind;
  operation: string;
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
export function validateImageAttachments(
  images?: ImageAttachment[]
): string | null {
  if (!images || images.length === 0) return null;
  if (images.length > MAX_IMAGE_COUNT) {
    return `Image count ${images.length} exceeds maximum of ${MAX_IMAGE_COUNT}.`;
  }
  const totalBytes = images.reduce((sum, img) => sum + img.data.length, 0);
  // data is base64-encoded; actual byte size is ~3/4 of base64 length
  const approxBytes = Math.ceil(totalBytes * 0.75);
  if (approxBytes > MAX_IMAGE_SIZE_BYTES) {
    return `Total image size exceeds ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)} MiB limit (approx ${Math.round(approxBytes / (1024 * 1024))} MiB).`;
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
  | ({ kind: "create_project"; name: string; source: SourceDescriptor; project_id?: string } & CommandMeta)
  | ({ kind: "archive_project"; project_id: string } & CommandMeta)
  | ({ kind: "settle_project"; project_id: string } & CommandMeta)
  | ({ kind: "delete_project"; project_id: string } & CommandMeta)
  | ({ kind: "create_thread"; project_id: string; title?: string; model: PiModelId; access_profile: RuntimeAccessProfile; interaction_mode: InteractionMode; thread_id?: string } & CommandMeta)
  | ({ kind: "archive_thread"; thread_id: string } & CommandMeta)
  | ({ kind: "settle_thread"; thread_id: string } & CommandMeta)
  | ({ kind: "delete_thread"; thread_id: string } & CommandMeta)
  | ({ kind: "start_turn"; thread_id: string; content: UserMessageContent; turn_id?: string } & CommandMeta)
  | ({ kind: "interrupt_turn"; turn_id: string; thread_id: string } & CommandMeta)
  | ({ kind: "stop_turn"; thread_id: string; turn_id?: string } & CommandMeta)
  | ({ kind: "respond_approval"; turn_id: string; thread_id: string; request_id: string; decision: "approved" | "declined" } & CommandMeta)
  | ({ kind: "respond_input"; turn_id: string; thread_id: string; request_id: string; values: Record<string, string | number | boolean> } & CommandMeta);

// Events
export interface DomainEventMeta {
  sequence: number;
  event_id: string;
  timestamp: string;
  command_id: string;
  correlation_id?: string;
  causation_id?: string;
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
  | ({ kind: "SessionStopped"; data: { thread_id: string } } & DomainEventMeta);

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