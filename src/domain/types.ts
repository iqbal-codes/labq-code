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

export interface Thread {
  id: string;
  project_id: string;
  title: string;
  status: LifecycleStatus;
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
  | ({ kind: "delete_thread"; thread_id: string } & CommandMeta);

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
  | ({ kind: "ProjectCreated"; data: { project: Project } } & DomainEventMeta)
  | ({ kind: "ProjectArchived"; data: { project_id: string } } & DomainEventMeta)
  | ({ kind: "ProjectSettled"; data: { project_id: string } } & DomainEventMeta)
  | ({ kind: "ProjectDeleted"; data: { project_id: string } } & DomainEventMeta)
  | ({ kind: "ThreadCreated"; data: { thread: Thread } } & DomainEventMeta)
  | ({ kind: "ThreadArchived"; data: { thread_id: string } } & DomainEventMeta)
  | ({ kind: "ThreadSettled"; data: { thread_id: string } } & DomainEventMeta)
  | ({ kind: "ThreadDeleted"; data: { thread_id: string } } & DomainEventMeta);

// Command Results & Receipts
export type CommandSuccess = {
  ok: true;
  project_id?: string;
  thread_id?: string;
  status?: LifecycleStatus;
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
  catalog: CuratedPiCatalog;
}

export type SyncResult =
  | { ok: true; mode: "up_to_date"; sequence: number }
  | { ok: true; mode: "replay"; from: number; to: number; events: DomainEvent[] }
  | { ok: true; mode: "snapshot"; sequence: number; snapshot: Snapshot; reason?: string };
