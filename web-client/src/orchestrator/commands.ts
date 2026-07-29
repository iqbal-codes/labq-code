import { DEFAULT_ENVIRONMENT_ID } from "@labq/domain/types";

import type {
  Command,
  InteractionMode,
  PiModelId,
  RuntimeAccessProfile,
  SourceDescriptor,
} from "@labq/domain/types";

export function newCommandId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cmd-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function createProjectCommand(input: {
  environment_id?: string;
  name: string;
  source: SourceDescriptor;
  project_id?: string;
  command_id?: string;
}): Command {
  return {
    kind: "create_project",
    environment_id: input.environment_id ?? DEFAULT_ENVIRONMENT_ID,
    name: input.name,
    source: input.source,
    project_id: input.project_id,
    command_id: input.command_id ?? newCommandId(),
  };
}

export function archiveProjectCommand(project_id: string, environment_id?: string): Command {
  return { kind: "archive_project", environment_id: environment_id ?? DEFAULT_ENVIRONMENT_ID, project_id, command_id: newCommandId() };
}
export function settleProjectCommand(project_id: string, environment_id?: string): Command {
  return { kind: "settle_project", environment_id: environment_id ?? DEFAULT_ENVIRONMENT_ID, project_id, command_id: newCommandId() };
}
export function deleteProjectCommand(project_id: string, environment_id?: string): Command {
  return { kind: "delete_project", environment_id: environment_id ?? DEFAULT_ENVIRONMENT_ID, project_id, command_id: newCommandId() };
}

export function createThreadCommand(input: {
  environment_id?: string;
  project_id: string;
  title?: string;
  model: PiModelId;
  access_profile: RuntimeAccessProfile;
  interaction_mode: InteractionMode;
  thread_id?: string;
  command_id?: string;
}): Command {
  return {
    kind: "create_thread",
    environment_id: input.environment_id ?? DEFAULT_ENVIRONMENT_ID,
    project_id: input.project_id,
    title: input.title,
    model: input.model,
    access_profile: input.access_profile,
    interaction_mode: input.interaction_mode,
    thread_id: input.thread_id,
    command_id: input.command_id ?? newCommandId(),
  };
}

export function archiveThreadCommand(thread_id: string, environment_id?: string): Command {
  return { kind: "archive_thread", environment_id: environment_id ?? DEFAULT_ENVIRONMENT_ID, thread_id, command_id: newCommandId() };
}
export function settleThreadCommand(thread_id: string, environment_id?: string): Command {
  return { kind: "settle_thread", environment_id: environment_id ?? DEFAULT_ENVIRONMENT_ID, thread_id, command_id: newCommandId() };
}
export function deleteThreadCommand(thread_id: string, environment_id?: string): Command {
  return { kind: "delete_thread", environment_id: environment_id ?? DEFAULT_ENVIRONMENT_ID, thread_id, command_id: newCommandId() };
}

export function startTurnCommand(input: {
  environment_id?: string;
  thread_id: string;
  content: { text: string; images?: Array<{ filename: string; media_type: string; size_bytes: number; data: string }> };
  turn_id?: string;
  command_id?: string;
}): Command {
  return {
    kind: "start_turn",
    environment_id: input.environment_id ?? DEFAULT_ENVIRONMENT_ID,
    thread_id: input.thread_id,
    content: input.content,
    turn_id: input.turn_id,
    command_id: input.command_id ?? newCommandId(),
  };
}

export function interruptTurnCommand(turn_id: string, thread_id: string, environment_id?: string): Command {
  return {
    kind: "interrupt_turn",
    environment_id: environment_id ?? DEFAULT_ENVIRONMENT_ID,
    turn_id,
    thread_id,
    command_id: newCommandId(),
  };
}

export function stopTurnCommand(thread_id: string, turn_id?: string, environment_id?: string): Command {
  return {
    kind: "stop_turn",
    environment_id: environment_id ?? DEFAULT_ENVIRONMENT_ID,
    thread_id,
    turn_id,
    command_id: newCommandId(),
  };
}

export function respondApprovalCommand(input: {
  environment_id?: string;
  project_id: string;
  thread_id: string;
  turn_id: string;
  provider_name?: "pi";
  provider_instance_id?: "pi-default";
  session_id: string;
  request_id: string;
  decision: "approved" | "declined";
  command_id?: string;
}): Command {
  return {
    kind: "respond_approval",
    environment_id: input.environment_id ?? DEFAULT_ENVIRONMENT_ID,
    project_id: input.project_id,
    thread_id: input.thread_id,
    turn_id: input.turn_id,
    provider_name: input.provider_name ?? "pi",
    provider_instance_id: input.provider_instance_id ?? "pi-default",
    session_id: input.session_id,
    request_id: input.request_id,
    decision: input.decision,
    command_id: input.command_id ?? newCommandId(),
  };
}

export function respondInputCommand(input: {
  environment_id?: string;
  project_id: string;
  thread_id: string;
  turn_id: string;
  provider_name?: "pi";
  provider_instance_id?: "pi-default";
  session_id: string;
  request_id: string;
  values: Record<string, string | number | boolean>;
  command_id?: string;
}): Command {
  return {
    kind: "respond_input",
    environment_id: input.environment_id ?? DEFAULT_ENVIRONMENT_ID,
    project_id: input.project_id,
    thread_id: input.thread_id,
    turn_id: input.turn_id,
    provider_name: input.provider_name ?? "pi",
    provider_instance_id: input.provider_instance_id ?? "pi-default",
    session_id: input.session_id,
    request_id: input.request_id,
    values: input.values,
    command_id: input.command_id ?? newCommandId(),
  };
}
