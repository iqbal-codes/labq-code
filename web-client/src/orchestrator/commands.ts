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
  name: string;
  source: SourceDescriptor;
  project_id?: string;
}): Command {
  return {
    kind: "create_project",
    name: input.name,
    source: input.source,
    project_id: input.project_id,
    command_id: newCommandId(),
  };
}

export function archiveProjectCommand(project_id: string): Command {
  return { kind: "archive_project", project_id, command_id: newCommandId() };
}
export function settleProjectCommand(project_id: string): Command {
  return { kind: "settle_project", project_id, command_id: newCommandId() };
}
export function deleteProjectCommand(project_id: string): Command {
  return { kind: "delete_project", project_id, command_id: newCommandId() };
}

export function createThreadCommand(input: {
  project_id: string;
  title?: string;
  model: PiModelId;
  access_profile: RuntimeAccessProfile;
  interaction_mode: InteractionMode;
  thread_id?: string;
}): Command {
  return {
    kind: "create_thread",
    project_id: input.project_id,
    title: input.title,
    model: input.model,
    access_profile: input.access_profile,
    interaction_mode: input.interaction_mode,
    thread_id: input.thread_id,
    command_id: newCommandId(),
  };
}

export function archiveThreadCommand(thread_id: string): Command {
  return { kind: "archive_thread", thread_id, command_id: newCommandId() };
}
export function settleThreadCommand(thread_id: string): Command {
  return { kind: "settle_thread", thread_id, command_id: newCommandId() };
}
export function deleteThreadCommand(thread_id: string): Command {
  return { kind: "delete_thread", thread_id, command_id: newCommandId() };
}

export function startTurnCommand(input: {
  thread_id: string;
  content: string;
  turn_id?: string;
}): Command {
  return {
    kind: "start_turn",
    thread_id: input.thread_id,
    content: { text: input.content },
    turn_id: input.turn_id,
    command_id: newCommandId(),
  };
}

export function interruptTurnCommand(turn_id: string, thread_id: string): Command {
  return {
    kind: "interrupt_turn",
    turn_id,
    thread_id,
    command_id: newCommandId(),
  };
}

export function stopTurnCommand(thread_id: string, turn_id?: string): Command {
  return {
    kind: "stop_turn",
    thread_id,
    turn_id,
    command_id: newCommandId(),
  };
}

export function respondApprovalCommand(input: {
  turn_id: string;
  thread_id: string;
  request_id: string;
  decision: "approved" | "declined";
}): Command {
  return {
    kind: "respond_approval",
    turn_id: input.turn_id,
    thread_id: input.thread_id,
    request_id: input.request_id,
    decision: input.decision,
    command_id: newCommandId(),
  };
}

export function respondInputCommand(input: {
  turn_id: string;
  thread_id: string;
  request_id: string;
  values: Record<string, string | number | boolean>;
}): Command {
  return {
    kind: "respond_input",
    turn_id: input.turn_id,
    thread_id: input.thread_id,
    request_id: input.request_id,
    values: input.values,
    command_id: newCommandId(),
  };
}
