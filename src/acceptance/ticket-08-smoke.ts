import { ReconnectingClient } from "../client/reconnect-client.js";
import type { DomainEvent, Snapshot } from "../domain/types.js";
import { OrchestratorEngine } from "../engine/engine.js";
import { evaluateExplicitResume, ProviderService } from "../engine/provider-service.js";
import { SourceManager } from "../source/source-manager.js";
import { OrchestratorTransport } from "../transport/transport.js";
import { FixturePiAdapter } from "./fixture-pi-adapter.js";

export interface AcceptanceCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface Ticket08AcceptanceReport {
  passed: boolean;
  runtime: string;
  started_at: string;
  completed_at: string;
  checks: AcceptanceCheck[];
  event_kinds: string[];
  live_sequence: number;
  recovered_sequence: number;
}

function snapshotsEquivalent(left: Snapshot, right: Snapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function waitForEvent(
  engine: OrchestratorEngine,
  predicate: (event: DomainEvent) => boolean,
  timeoutMs = 5_000
): Promise<DomainEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for semantic event.`));
    }, timeoutMs);

    const unsubscribe = engine.subscribe(
      (event) => {
        if (!predicate(event)) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve(event);
      },
      undefined,
      { emitInitialSnapshot: false }
    );
  });
}

function check(
  checks: AcceptanceCheck[],
  id: string,
  label: string,
  passed: boolean,
  detail: string
): void {
  checks.push({ id, label, passed, detail });
}

/**
 * Runs ticket 08 through the same typed transport used by clients.
 * The protocol fixture is deterministic and intentionally replaces Pi only for
 * approval/failure branches that cannot safely be automated against a live model.
 */
export async function runTicket08Acceptance(
  workspacePath: string
): Promise<Ticket08AcceptanceReport> {
  const startedAt = new Date().toISOString();
  const checks: AcceptanceCheck[] = [];
  const fixture = new FixturePiAdapter();
  const providers = new ProviderService();
  providers.registerAdapter("pi", fixture);
  const engine = new OrchestratorEngine(new SourceManager(), providers);
  const transport = new OrchestratorTransport({ engine });
  const observedEvents: DomainEvent[] = [];
  engine.subscribe(
    (event) => observedEvents.push(event),
    undefined,
    { emitInitialSnapshot: false }
  );

  const invalidProject = await transport.dispatchCommand({
    command: {
      kind: "create_project",
      command_id: "accept-invalid-project",
      name: "Invalid source",
      source: { kind: "local_folder", path: `${workspacePath}/does-not-exist` },
    },
  });
  check(
    checks,
    "source-failure",
    "Source failure creates no partial project",
    !invalidProject.ok && engine.listProjects().length === 0,
    invalidProject.ok ? "Unexpected success" : invalidProject.code
  );

  const hostedProject = await transport.dispatchCommand({
    command: {
      kind: "create_project",
      command_id: "accept-hosted-project",
      name: "Hosted setup",
      source: { kind: "github", repo: "labq/setup-required" },
    },
  });
  const hostedState = hostedProject.ok
    ? engine.getProject(hostedProject.project_id!)?.source.status
    : undefined;
  check(
    checks,
    "hosted-source",
    "Hosted source remains setup-required",
    hostedProject.ok && hostedState === "setup_required",
    `status=${hostedState ?? "missing"}`
  );

  const project = await transport.dispatchCommand({
    command: {
      kind: "create_project",
      command_id: "accept-local-project",
      name: "Electrobun acceptance",
      source: { kind: "local_folder", path: workspacePath },
    },
  });
  if (!project.ok || !project.project_id) {
    throw new Error(`Acceptance project failed: ${project.ok ? "missing id" : project.detail}`);
  }
  check(
    checks,
    "local-source",
    "Local folder binds authoritatively",
    engine.getProject(project.project_id)?.source.status === "bound",
    engine.getProject(project.project_id)?.source.workspace_path ?? "missing"
  );

  const threadCommand = {
    kind: "create_thread" as const,
    command_id: "accept-thread",
    project_id: project.project_id,
    title: "Ticket 08",
    model: "pi-default" as const,
    access_profile: "workspace-write" as const,
    interaction_mode: "execute" as const,
    thread_id: "accept-thread-1",
  };
  const thread = await transport.dispatchCommand({ command: threadCommand });
  const duplicateThread = await transport.dispatchCommand({ command: threadCommand });
  if (!thread.ok || !thread.thread_id) {
    throw new Error(`Acceptance thread failed: ${thread.ok ? "missing id" : thread.detail}`);
  }
  check(
    checks,
    "thread-config",
    "Thread uses an available model, fixed profile, and execute mode",
    engine.getThread(thread.thread_id)?.model === "pi-default" &&
      engine.getThread(thread.thread_id)?.access_profile === "workspace-write" &&
      engine.getThread(thread.thread_id)?.interaction_mode === "execute",
    JSON.stringify(engine.getThread(thread.thread_id))
  );
  check(
    checks,
    "idempotency",
    "Duplicate command ID has one receipt and durable outcome",
    duplicateThread.ok && duplicateThread.duplicate === true &&
      engine.listThreads(project.project_id).length === 1 &&
      engine.getReceipt(threadCommand.command_id)?.sequences.length === 1,
    `duplicate=${duplicateThread.duplicate === true}`
  );

  fixture.setScenario(thread.thread_id, {
    events: [
      { kind: "provider_turn_started" },
      { kind: "assistant_text_delta", text: "Inspecting workspace. " },
      {
        kind: "tool_activity_began",
        activity_id: "accept-read",
        tool: "read",
        input: { path: "package.json" },
      },
      {
        kind: "tool_activity_completed",
        activity_id: "accept-read",
        status: "success",
        output: "package inspected",
      },
      {
        kind: "approval_requested",
        request_id: "accept-approval",
        operation: "edit",
        description: "Apply the accepted change",
      },
    ],
    afterResponseEvents: [
      { kind: "assistant_text_delta", text: "Approved and complete." },
      { kind: "assistant_message_completed" },
      { kind: "provider_turn_completed" },
    ],
  });

  const recoveredClient = new ReconnectingClient({
    transport,
    project_id: project.project_id,
    thread_id: thread.thread_id,
  });
  await recoveredClient.connect();

  const approvalObserved = waitForEvent(
    engine,
    (event) => event.kind === "ApprovalRequested"
  );
  const turn = await transport.dispatchCommand({
    command: {
      kind: "start_turn",
      command_id: "accept-turn",
      turn_id: "accept-turn-1",
      thread_id: thread.thread_id,
      content: { text: "Run ticket 08 acceptance" },
    },
  });
  if (!turn.ok || !turn.turn_id) {
    throw new Error(`Acceptance turn failed: ${turn.ok ? "missing id" : turn.detail}`);
  }
  await approvalObserved;
  const pausedTurn = engine.getTurn(turn.turn_id);
  recoveredClient.simulateInvoluntaryDisconnect();
  const providerCallsBeforeReconnect = fixture.startTurnCalls.length;

  const completedObserved = waitForEvent(
    engine,
    (event) => event.kind === "TurnCompleted"
  );
  const approval = await transport.dispatchCommand({
    command: {
      kind: "respond_approval",
      command_id: "accept-approval-response",
      turn_id: turn.turn_id,
      thread_id: thread.thread_id,
      request_id: "accept-approval",
      decision: "approved",
    },
  });
  await completedObserved;
  const completedTurn = engine.getTurn(turn.turn_id);

  check(
    checks,
    "stream-pause-complete",
    "Text/activity stream pauses pre-execution and completes after correlated response",
    pausedTurn?.status === "paused" &&
      pausedTurn.pending_request?.id === "accept-approval" &&
      approval.ok &&
      completedTurn?.status === "completed" &&
      completedTurn.pending_request?.status === "approved" &&
      completedTurn.activities["accept-read"]?.status === "success",
    `paused=${pausedTurn?.status}; final=${completedTurn?.status}`
  );

  await recoveredClient.reconnect();
  const recoveredSnapshot = recoveredClient.getSnapshot();
  const freshClient = new ReconnectingClient({
    transport,
    project_id: project.project_id,
    thread_id: thread.thread_id,
  });
  await freshClient.connect();
  const freshSnapshot = freshClient.getSnapshot();
  check(
    checks,
    "recovery-convergence",
    "Fresh and recovered clients converge without duplicated state",
    snapshotsEquivalent(recoveredSnapshot, freshSnapshot),
    `fresh=${freshSnapshot.sequence}; recovered=${recoveredSnapshot.sequence}`
  );
  check(
    checks,
    "no-auto-resume",
    "Reconnect does not restart provider work",
    fixture.startTurnCalls.length === providerCallsBeforeReconnect,
    `providerStarts=${fixture.startTurnCalls.length}`
  );
  freshClient.disconnect();
  recoveredClient.disconnect();

  const failureThread = await transport.dispatchCommand({
    command: {
      kind: "create_thread",
      command_id: "accept-failure-thread",
      project_id: project.project_id,
      title: "Runtime failure",
      model: "pi-default",
      access_profile: "full-execution",
      interaction_mode: "execute",
      thread_id: "accept-thread-failure",
    },
  });
  if (!failureThread.ok || !failureThread.thread_id) {
    throw new Error("Could not create failure scenario thread.");
  }
  fixture.setScenario(failureThread.thread_id, {
    events: [
      { kind: "provider_turn_started" },
      {
        kind: "input_requested",
        request_id: "accept-input",
        operation: "configure",
        fields: [
          { id: "target", type: "text", label: "Target", required: true },
        ],
      },
      {
        kind: "provider_turn_failed",
        code: "provider_process_died",
        detail: "Fixture runtime exited while input was pending.",
      },
    ],
  });
  const failedObserved = waitForEvent(engine, (event) => event.kind === "TurnFailed");
  const failureTurn = await transport.dispatchCommand({
    command: {
      kind: "start_turn",
      command_id: "accept-failure-turn",
      turn_id: "accept-turn-failure",
      thread_id: failureThread.thread_id,
      content: { text: "Trigger runtime failure" },
    },
  });
  await failedObserved;
  const failed = failureTurn.ok ? engine.getTurn(failureTurn.turn_id!) : undefined;
  check(
    checks,
    "runtime-failure",
    "Runtime failure is honest, replayable, and finalizes pending requests",
    failed?.status === "failed" &&
      failed.error?.code === "provider_process_died" &&
      failed.pending_request?.status === "cancelled" &&
      engine.rebuildSnapshotFromHistory().turns[failed.id]?.status === "failed",
    `status=${failed?.status}; request=${failed?.pending_request?.status}`
  );

  const persisted = {
    session_id: "session-1",
    provider_name: "pi",
    project_workspace_path: workspacePath,
    model: "pi-default" as const,
    access_profile: "workspace-write" as const,
  };
  const match = evaluateExplicitResume(persisted, persisted);
  const stopped = evaluateExplicitResume(
    { ...persisted, session_status: "stopped" },
    persisted
  );
  check(
    checks,
    "explicit-resume",
    "Resume is offered only for matching persisted, non-stopped sessions",
    match.can_resume && !stopped.can_resume && stopped.reason === "session_stopped",
    `match=${match.can_resume}; stopped=${stopped.can_resume}`
  );

  const live = engine.getSnapshot();
  const rebuilt = engine.rebuildSnapshotFromHistory();
  check(
    checks,
    "rebuild",
    "Canonical event history rebuilds equivalent state",
    snapshotsEquivalent(live, rebuilt),
    `events=${engine.getEvents().length}; sequence=${live.sequence}`
  );

  return {
    passed: checks.every((item) => item.passed),
    runtime: `Electrobun/Bun ${Bun.version}`,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    checks,
    event_kinds: observedEvents.map((event) => event.kind),
    live_sequence: live.sequence,
    recovered_sequence: recoveredSnapshot.sequence,
  };
}
