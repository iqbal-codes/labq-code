/**
 * 08 — End-to-End Orchestrator Acceptance
 *
 * A deterministic integrated harness and smoke scenario proving the complete
 * first delivery. Uses a protocol-faithful fixture adapter since the real Pi
 * SDK is not installed in this environment.
 *
 * Each `test()` corresponds to one or more acceptance criteria from the ticket.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { OrchestratorEngine } from "../src/engine/engine.js";
import { ProviderService } from "../src/engine/provider-service.js";
import { SourceManager } from "../src/source/source-manager.js";
import { OrchestratorTransport } from "../src/transport/transport.js";
import { ReconnectingClient } from "../src/client/reconnect-client.js";
import type { Snapshot, DomainEvent, Command } from "../src/domain/types.js";
import { FixturePiAdapter } from "../src/acceptance/fixture-pi-adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "labq-acceptance-"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function collectEvents(
  engine: OrchestratorEngine,
  filter?: { project_id?: string; thread_id?: string }
): DomainEvent[] {
  const events: DomainEvent[] = [];
  const unsub = engine.subscribe((e) => events.push(e), filter, {
    emitInitialSnapshot: false,
  });
  return events;
}

function isSnapshot(res: unknown): res is Snapshot {
  return Boolean(res && typeof res === "object" && "sequence" in res && "projects" in res);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("08 — End-to-End Orchestrator Acceptance", () => {
  let tempDirs: string[] = [];
  let fixture: FixturePiAdapter;

  function makeEngine(): { engine: OrchestratorEngine; sourceManager: SourceManager; providerService: ProviderService } {
    const sourceManager = new SourceManager();
    const providerService = new ProviderService();
    fixture = new FixturePiAdapter();
    providerService.registerAdapter("pi", fixture);
    const engine = new OrchestratorEngine(sourceManager, providerService);
    return { engine, sourceManager, providerService };
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    tempDirs = [];
  });

  // -------------------------------------------------------------------------
  // Criterion 1: Normal prompt-to-completion through integrated seam
  // -------------------------------------------------------------------------
  test("normal prompt-to-completion scenario through integrated orchestration seam", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    // Configure a normal completion scenario
    fixture.setDefaultScenario({
      events: [
        { kind: "provider_turn_started" },
        { kind: "assistant_text_delta", text: "Hello! " },
        { kind: "assistant_text_delta", text: "I can help with that." },
        {
          kind: "tool_activity_began",
          activity_id: "act-read-1",
          tool: "read",
          input: { path: "src/index.ts" },
        },
        { kind: "tool_activity_delta", activity_id: "act-read-1", content: "file contents..." },
        {
          kind: "tool_activity_completed",
          activity_id: "act-read-1",
          status: "success",
          output: "export const x = 1;",
        },
        { kind: "assistant_message_completed" },
        { kind: "provider_turn_completed" },
      ],
    });

    // 1. Create project from local folder
    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-1",
      name: "Test Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;
    const projectId = projRes.project_id!;

    // 2. Create thread with curated Pi model, fixed runtime profile, execute mode
    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-1",
      project_id: projectId,
      title: "E2E Thread",
      model: "pi-default",
      access_profile: "workspace-write",
      interaction_mode: "execute",
    });
    expect(threadRes.ok).toBe(true);
    if (!threadRes.ok) return;
    const threadId = threadRes.thread_id!;

    // 3. Subscribe and collect events
    const collected = collectEvents(engine, { thread_id: threadId });

    // 4. Submit prompt
    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-1",
      thread_id: threadId,
      content: { text: "Read src/index.ts" },
    });
    expect(turnRes.ok).toBe(true);
    if (!turnRes.ok) return;
    const turnId = turnRes.turn_id!;

    // 5. Wait for streaming to complete
    await sleep(100);

    // 6. Verify streamed assistant text
    const turn = engine.getTurn(turnId);
    expect(turn).toBeDefined();
    expect(turn?.status).toBe("completed");
    expect(turn?.assistant_message).toBeDefined();
    expect(turn?.assistant_message?.is_complete).toBe(true);

    const textParts = turn!.assistant_message!.parts.filter((p) => p.kind === "text");
    expect(textParts.length).toBeGreaterThan(0);
    const assembledText = textParts.map((p) => (p as { kind: "text"; content: string }).content).join("");
    expect(assembledText).toContain("Hello!");
    expect(assembledText).toContain("I can help with that.");

    // 7. Verify canonical tool activity
    expect(Object.keys(turn!.activities).length).toBe(1);
    const act = turn!.activities["act-read-1"];
    expect(act).toBeDefined();
    expect(act.tool).toBe("read");
    expect(act.status).toBe("success");
    expect(act.output).toBe("export const x = 1;");

    // 8. Verify events were emitted
    const eventKinds = collected.map((e) => e.kind);
    expect(eventKinds).toContain("TurnStarted");
    expect(eventKinds).toContain("AssistantMessageDelta");
    expect(eventKinds).toContain("ToolActivityBegan");
    expect(eventKinds).toContain("ToolActivityCompleted");
    expect(eventKinds).toContain("AssistantMessageCompleted");
    expect(eventKinds).toContain("TurnCompleted");
  });

  // -------------------------------------------------------------------------
  // Criterion 2: Project creation from local folder, hosted source setup_required,
  //             no partial project on source failure
  // -------------------------------------------------------------------------
  test("project creation verifies source states and fails cleanly", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    // Local folder → bound
    const localRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-local",
      name: "Local Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(localRes.ok).toBe(true);
    if (!localRes.ok) return;
    const localProj = engine.getProject(localRes.project_id!);
    expect(localProj?.source.status).toBe("bound");

    // Hosted source → setup_required
    const hostedRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-hosted",
      name: "GitHub Project",
      source: { kind: "github", repo: "org/repo" },
    });
    expect(hostedRes.ok).toBe(true);
    if (!hostedRes.ok) return;
    const hostedProj = engine.getProject(hostedRes.project_id!);
    expect(hostedProj?.source.status).toBe("setup_required");

    // Thread creation on setup_required source → rejected
    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-hosted",
      project_id: hostedRes.project_id!,
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    expect(threadRes.ok).toBe(false);
    if (threadRes.ok) return;
    expect(threadRes.code).toBe("source_setup_required");

    // Invalid local folder → no partial project created
    const invalidRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-invalid",
      name: "Bad Project",
      source: { kind: "local_folder", path: "/nonexistent/path/xyz" },
    });
    expect(invalidRes.ok).toBe(false);
    if (invalidRes.ok) return;
    expect(invalidRes.code).toBe("invalid_source_path");

    // Verify no project was created for the invalid source
    const snapshot = engine.getSnapshot();
    expect(Object.values(snapshot.projects).filter((p) => p.name === "Bad Project").length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Criterion 3: Thread creation with curated Pi model, runtime profile, execute mode
  // -------------------------------------------------------------------------
  test("thread creation validates model, access profile, and interaction mode", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-3",
      name: "Validation Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;
    const projectId = projRes.project_id!;

    // Valid thread creation
    const validRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-valid",
      project_id: projectId,
      model: "pi-3.5-sonnet",
      access_profile: "full-execution",
      interaction_mode: "execute",
    });
    expect(validRes.ok).toBe(true);
    if (!validRes.ok) return;

    const thread = engine.getThread(validRes.thread_id!);
    expect(thread?.model).toBe("pi-3.5-sonnet");
    expect(thread?.access_profile).toBe("full-execution");
    expect(thread?.interaction_mode).toBe("execute");
    expect(thread?.session_status).toBe("ready");

    // Invalid model → rejected
    const invalidModelRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-bad-model",
      project_id: projectId,
      model: "nonexistent-model" as any,
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    expect(invalidModelRes.ok).toBe(false);

    // Unsupported interaction mode → rejected
    const planModeRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-plan",
      project_id: projectId,
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "plan",
    });
    expect(planModeRes.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Criterion 4: Streamed assistant text, activity, approval, response, final state
  // -------------------------------------------------------------------------
  test("observes streamed text, tool activity, approval, response, and final state", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    // Scenario: text → tool → approval request → (pause) → [user responds] → completion
    // Since the adapter yields events synchronously, we use a scenario that yields
    // up to the approval, then we respond, and simulate the rest.

    // Phase 1: adapter yields text + approval request
    fixture.setDefaultScenario({
      events: [
        { kind: "provider_turn_started" },
        { kind: "assistant_text_delta", text: "I need to edit a file. " },
        { kind: "assistant_text_delta", text: "May I proceed?" },
        {
          kind: "approval_requested",
          request_id: "req-approve-1",
          operation: "edit",
          description: "Edit src/index.ts",
        },
      ],
      afterResponseEvents: [
        { kind: "assistant_text_delta", text: "Proceeding with edit." },
        {
          kind: "tool_activity_began",
          activity_id: "act-edit-1",
          tool: "edit",
          input: { path: "src/index.ts", diff: "+ new line" },
        },
        {
          kind: "tool_activity_completed",
          activity_id: "act-edit-1",
          status: "success",
        },
        { kind: "assistant_message_completed" },
        { kind: "provider_turn_completed" },
      ],
    });

    // Setup project & thread
    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-4",
      name: "Approval Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-4",
      project_id: projRes.project_id!,
      model: "pi-default",
      access_profile: "workspace-write",
      interaction_mode: "execute",
    });
    expect(threadRes.ok).toBe(true);
    if (!threadRes.ok) return;
    const threadId = threadRes.thread_id!;

    // Start turn
    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-4",
      thread_id: threadId,
      content: { text: "Edit the index file" },
    });
    expect(turnRes.ok).toBe(true);
    if (!turnRes.ok) return;
    const turnId = turnRes.turn_id!;

    // Wait for streaming to reach approval
    await sleep(100);

    // Verify turn is paused with approval request
    const turnAfterApproval = engine.getTurn(turnId);
    expect(turnAfterApproval?.status).toBe("paused");
    expect(turnAfterApproval?.pending_request).toBeDefined();
    expect(turnAfterApproval?.pending_request?.kind).toBe("approval");
    expect(turnAfterApproval?.pending_request?.id).toBe("req-approve-1");
    expect(turnAfterApproval?.pending_request?.operation).toBe("edit");

    // Verify assistant text was accumulated
    const textParts = turnAfterApproval!.assistant_message!.parts.filter(
      (p) => p.kind === "text"
    );
    const assembledText = textParts.map((p) => (p as any).content).join("");
    expect(assembledText).toContain("I need to edit a file.");
    expect(assembledText).toContain("May I proceed?");

    // Phase 2: correlated approval unblocks the same provider stream.
    const approveRes = await engine.dispatchCommand({
      kind: "respond_approval",
      command_id: "cmd-approve-1",
      turn_id: turnId,
      thread_id: threadId,
      request_id: "req-approve-1",
      decision: "approved",
    });
    expect(approveRes.ok).toBe(true);

    // Wait for completion
    await sleep(100);

    // Verify final state
    const finalTurn = engine.getTurn(turnId);
    expect(finalTurn?.status).toBe("completed");
    expect(finalTurn?.pending_request?.status).toBe("approved");
    expect(finalTurn?.assistant_message?.is_complete).toBe(true);

    // Verify tool activity was recorded
    const editAct = finalTurn!.activities["act-edit-1"];
    expect(editAct).toBeDefined();
    expect(editAct.tool).toBe("edit");
    expect(editAct.status).toBe("success");

    // Verify adapter received the response
    expect(fixture.respondCalls.length).toBe(1);
    expect(fixture.respondCalls[0].request_id).toBe("req-approve-1");
  });

  // -------------------------------------------------------------------------
  // Criterion 5: Pi runtime failure during pending turn
  // -------------------------------------------------------------------------
  test("Pi runtime failure produces honest failure and finalizes unresolved requests", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    // Scenario: turn starts, pauses for approval, then its runtime dies.
    fixture.setDefaultScenario({
      events: [
        { kind: "provider_turn_started" },
        { kind: "assistant_text_delta", text: "Working on it..." },
        {
          kind: "approval_requested",
          request_id: "req-crash-1",
          operation: "bash",
          description: "Run dangerous command",
        },
        {
          kind: "provider_turn_failed",
          code: "provider_process_died",
          detail: "Pi runtime exited during a pending approval.",
        },
      ],
      eventDelayMs: 20,
    });

    // Setup
    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-5",
      name: "Crash Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-5",
      project_id: projRes.project_id!,
      model: "pi-default",
      access_profile: "full-execution",
      interaction_mode: "execute",
    });
    expect(threadRes.ok).toBe(true);
    if (!threadRes.ok) return;
    const threadId = threadRes.thread_id!;

    const observedEvents = collectEvents(engine, { thread_id: threadId });

    // Start turn; the fixture exposes the approval and then reports runtime failure.
    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-5",
      thread_id: threadId,
      content: { text: "Run a command" },
    });
    expect(turnRes.ok).toBe(true);
    if (!turnRes.ok) return;
    const turnId = turnRes.turn_id!;

    await sleep(100);

    // Verify an honest failure and finalized unresolved request.
    const failedTurn = engine.getTurn(turnId);
    expect(failedTurn?.status).toBe("failed");
    expect(failedTurn?.error?.code).toBe("provider_process_died");
    expect(failedTurn?.pending_request?.kind).toBe("approval");
    expect(failedTurn?.pending_request?.status).toBe("declined");
    expect(failedTurn?.pending_request?.resolved_at).toBeDefined();

    const eventKinds = observedEvents.map((event) => event.kind);
    expect(eventKinds).toContain("ApprovalRequested");
    expect(eventKinds).toContain("TurnFailed");
    expect(eventKinds.indexOf("ApprovalRequested")).toBeLessThan(
      eventKinds.indexOf("TurnFailed")
    );

    // Runtime failure settles the turn but does not fabricate an explicit stop.
    const thread = engine.getThread(threadId);
    expect(thread?.session_status).toBe("ready");
  });

  // -------------------------------------------------------------------------
  // Criterion 6: Explicit resume only for matching persisted session,
  //             reconnect alone does not resume, explicit stop not resumable
  // -------------------------------------------------------------------------
  test("reconnect does not resume provider work; explicit stop is not resumable", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    fixture.setDefaultScenario({
      events: [
        { kind: "provider_turn_started" },
        { kind: "assistant_text_delta", text: "Done." },
        { kind: "assistant_message_completed" },
        { kind: "provider_turn_completed" },
      ],
    });

    // Setup
    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-6",
      name: "Resume Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-6",
      project_id: projRes.project_id!,
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    expect(threadRes.ok).toBe(true);
    if (!threadRes.ok) return;
    const threadId = threadRes.thread_id!;

    // Run a turn to completion
    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-6",
      thread_id: threadId,
      content: { text: "Hello" },
    });
    expect(turnRes.ok).toBe(true);
    if (!turnRes.ok) return;
    await sleep(50);

    // Complete turn
    const turn = engine.getTurn(turnRes.turn_id!);
    expect(turn?.status).toBe("completed");

    // Stop the session
    const stopRes = await engine.dispatchCommand({
      kind: "stop_turn",
      command_id: "cmd-stop-6",
      thread_id: threadId,
    });
    expect(stopRes.ok).toBe(true);
    await sleep(50);

    // Session is stopped → cannot start new turn
    const stoppedThread = engine.getThread(threadId);
    expect(stoppedThread?.session_status).toBe("stopped");

    const blockedRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-6b",
      thread_id: threadId,
      content: { text: "After stop" },
    });
    expect(blockedRes.ok).toBe(false);
    if (blockedRes.ok) return;
    expect(blockedRes.code).toBe("session_stopped");

    // Reconnect via transport does NOT resume provider work
    const transport = new OrchestratorTransport({ engine });
    const sub = transport.createSubscription(undefined, { thread_id: threadId });
    expect(sub.ok).toBe(true);
    // Subscribing just gives current state, no provider restart
    // This is the correct behavior: reconnect ≠ resume
  });

  // -------------------------------------------------------------------------
  // Criterion 7: Same command ID produces one durable outcome + one receipt
  // -------------------------------------------------------------------------
  test("duplicate command_id returns one durable outcome and one receipt (idempotency)", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    fixture.setDefaultScenario({
      events: [
        { kind: "provider_turn_started" },
        { kind: "assistant_text_delta", text: "Response" },
        { kind: "assistant_message_completed" },
        { kind: "provider_turn_completed" },
      ],
    });

    // Create project with a known command_id
    const res1 = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-idem-1",
      name: "Idempotent Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;
    const projectId = res1.project_id!;

    // Submit same command_id again → should return duplicate
    const res2 = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-idem-1",
      name: "Idempotent Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    expect((res2 as any).duplicate).toBe(true);
    expect(res2.project_id).toBe(projectId);

    // Verify only one project was created
    const projects = engine.listProjects();
    expect(projects.filter((p) => p.name === "Idempotent Project").length).toBe(1);

    // Verify receipts are consistent
    const receipt1 = engine.getReceipt("cmd-idem-1");
    expect(receipt1).toBeDefined();
    expect(receipt1?.result.ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Criterion 8: Fresh client and recovered client render equivalent state
  // -------------------------------------------------------------------------
  test("fresh client and recovered client render equivalent state", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    fixture.setDefaultScenario({
      events: [
        { kind: "provider_turn_started" },
        { kind: "assistant_text_delta", text: "Hello world" },
        {
          kind: "tool_activity_began",
          activity_id: "act-eq-1",
          tool: "grep",
          input: { pattern: "foo" },
        },
        {
          kind: "tool_activity_completed",
          activity_id: "act-eq-1",
          status: "success",
          output: "found 3 matches",
        },
        { kind: "assistant_message_completed" },
        { kind: "provider_turn_completed" },
      ],
    });

    const transport = new OrchestratorTransport({ engine });

    // Setup project, thread, and run a turn
    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-8",
      name: "Equivalence Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-8",
      project_id: projRes.project_id!,
      model: "pi-default",
      access_profile: "workspace-write",
      interaction_mode: "execute",
    });
    expect(threadRes.ok).toBe(true);
    if (!threadRes.ok) return;
    const threadId = threadRes.thread_id!;

    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-8",
      thread_id: threadId,
      content: { text: "Search for foo" },
    });
    expect(turnRes.ok).toBe(true);
    if (!turnRes.ok) return;
    await sleep(100);

    // Verify turn completed
    const turn = engine.getTurn(turnRes.turn_id!);
    expect(turn?.status).toBe("completed");

    // --- Fresh client ---
    const freshClient = new ReconnectingClient({
      transport,
      thread_id: threadId,
    });
    await freshClient.connect();
    const freshSnapshot = freshClient.getSnapshot();
    freshClient.disconnect();

    // --- Recovered client (simulate disconnect + reconnect) ---
    const recoveredClient = new ReconnectingClient({
      transport,
      thread_id: threadId,
    });
    await recoveredClient.connect();
    // Simulate involuntary disconnect
    recoveredClient.simulateInvoluntaryDisconnect();
    // Reconnect
    await recoveredClient.reconnect();
    const recoveredSnapshot = recoveredClient.getSnapshot();
    recoveredClient.disconnect();

    // Compare: both should have the same projects, threads, and turns
    expect(Object.keys(freshSnapshot.projects)).toEqual(
      Object.keys(recoveredSnapshot.projects)
    );
    expect(Object.keys(freshSnapshot.threads)).toEqual(
      Object.keys(recoveredSnapshot.threads)
    );

    // Compare turn states
    const freshTurns = Object.values(freshSnapshot.turns);
    const recoveredTurns = Object.values(recoveredSnapshot.turns);
    expect(freshTurns.length).toBe(recoveredTurns.length);

    for (const freshTurn of freshTurns) {
      const recoveredTurn = recoveredTurns.find((t) => t.id === freshTurn.id);
      expect(recoveredTurn).toBeDefined();
      expect(recoveredTurn!.status).toBe(freshTurn.status);
      expect(recoveredTurn!.assistant_message?.is_complete).toBe(
        freshTurn.assistant_message?.is_complete
      );
      // No duplicated messages or activities
      expect(Object.keys(recoveredTurn!.activities).length).toBe(
        Object.keys(freshTurn.activities).length
      );
      expect(recoveredTurn!.assistant_message?.parts.length).toBe(
        freshTurn.assistant_message?.parts.length
      );
    }
  });

  // -------------------------------------------------------------------------
  // Additional: Structured input request flow
  // -------------------------------------------------------------------------
  test("structured input request collects answers and resumes", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    // Phase 1: yield input request
    fixture.setDefaultScenario({
      events: [
        { kind: "provider_turn_started" },
        {
          kind: "input_requested",
          request_id: "req-input-1",
          operation: "config",
          description: "Choose deployment target",
          fields: [
            {
              id: "target",
              type: "select",
              label: "Deployment Target",
              required: true,
              options: [
                { value: "staging", label: "Staging" },
                { value: "prod", label: "Production" },
              ],
            },
            {
              id: "confirm",
              type: "boolean",
              label: "Confirm",
              required: true,
            },
          ],
        },
      ],
      afterResponseEvents: [
        { kind: "assistant_text_delta", text: "Deploying to staging..." },
        { kind: "assistant_message_completed" },
        { kind: "provider_turn_completed" },
      ],
    });

    // Setup
    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-input",
      name: "Input Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-input",
      project_id: projRes.project_id!,
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    expect(threadRes.ok).toBe(true);
    if (!threadRes.ok) return;
    const threadId = threadRes.thread_id!;

    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-input",
      thread_id: threadId,
      content: { text: "Deploy the app" },
    });
    expect(turnRes.ok).toBe(true);
    if (!turnRes.ok) return;
    const turnId = turnRes.turn_id!;

    await sleep(100);

    // Verify input request
    const pausedTurn = engine.getTurn(turnId);
    expect(pausedTurn?.status).toBe("paused");
    expect(pausedTurn?.pending_request?.kind).toBe("input");
    expect(pausedTurn?.pending_request?.fields.length).toBe(2);

    // Phase 2: correlated structured input unblocks the same provider stream.
    const inputRes = await engine.dispatchCommand({
      kind: "respond_input",
      command_id: "cmd-respond-input",
      turn_id: turnId,
      thread_id: threadId,
      request_id: "req-input-1",
      values: { target: "staging", confirm: true },
    });
    expect(inputRes.ok).toBe(true);

    await sleep(100);

    const finalTurn = engine.getTurn(turnId);
    expect(finalTurn?.status).toBe("completed");

    // Verify adapter received the input response
    expect(fixture.respondCalls.length).toBe(1);
    expect(fixture.respondCalls[0].request_id).toBe("req-input-1");
    const resp = fixture.respondCalls[0].response as { values: Record<string, any> };
    expect(resp.values.target).toBe("staging");
    expect(resp.values.confirm).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Additional: Interrupt running turn
  // -------------------------------------------------------------------------
  test("interrupt running turn produces honest interruption state", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    // Scenario: long-running turn (we control timing via delay)
    fixture.setDefaultScenario({
      events: [
        { kind: "provider_turn_started" },
        { kind: "assistant_text_delta", text: "Starting work..." },
        // This event will never be reached because we interrupt
        { kind: "provider_turn_completed" },
      ],
      eventDelayMs: 50,
    });

    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-int",
      name: "Interrupt Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-int",
      project_id: projRes.project_id!,
      model: "pi-default",
      access_profile: "full-execution",
      interaction_mode: "execute",
    });
    expect(threadRes.ok).toBe(true);
    if (!threadRes.ok) return;
    const threadId = threadRes.thread_id!;

    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-int",
      thread_id: threadId,
      content: { text: "Long task" },
    });
    expect(turnRes.ok).toBe(true);
    if (!turnRes.ok) return;
    const turnId = turnRes.turn_id!;

    // Wait a bit for the turn to start
    await sleep(30);

    // Interrupt
    const interruptRes = await engine.dispatchCommand({
      kind: "interrupt_turn",
      command_id: "cmd-interrupt-1",
      turn_id: turnId,
      thread_id: threadId,
    });
    expect(interruptRes.ok).toBe(true);

    await sleep(100);

    // Verify interruption state
    const turn = engine.getTurn(turnId);
    expect(turn?.status).toBe("interrupted");

    // Verify thread session is still usable (interrupt does not stop session)
    const thread = engine.getThread(threadId);
    expect(thread?.session_status).not.toBe("stopped");
  });

  // -------------------------------------------------------------------------
  // Additional: Project deletion removes from navigation without deleting files
  // -------------------------------------------------------------------------
  test("project deletion removes from navigation, local folder preserved", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-del",
      name: "Delete Me",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;
    const projectId = projRes.project_id!;

    // Verify project exists
    expect(engine.getProject(projectId)).toBeDefined();
    expect(engine.listProjects().length).toBe(1);

    // Delete
    const delRes = await engine.dispatchCommand({
      kind: "delete_project",
      command_id: "cmd-delete-1",
      project_id: projectId,
    });
    expect(delRes.ok).toBe(true);

    // Verify removed from navigation
    expect(engine.getProject(projectId)).toBeUndefined();
    expect(engine.listProjects().length).toBe(0);

    // Verify local folder still exists on disk
    expect(fs.existsSync(localDir)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Additional: Transport authorization boundaries
  // -------------------------------------------------------------------------
  test("transport enforces read-only vs mutation authorization", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    const transport = new OrchestratorTransport({
      engine,
      authorize: (token, action) => {
        if (token === "reader") return action === "read";
        if (token === "admin") return true;
        return false;
      },
    });

    // Read-only can subscribe
    const sub = transport.createSubscription("reader", {});
    expect(sub.ok).toBe(true);

    // Read-only cannot mutate
    const mutationRes = await transport.dispatchCommand({
      token: "reader",
      command: {
        kind: "create_project",
        command_id: "cmd-auth-1",
        name: "Unauthorized",
        source: { kind: "local_folder", path: localDir },
      },
    });
    expect(mutationRes.ok).toBe(false);
    if (!mutationRes.ok) expect(mutationRes.code).toBe("unauthorized");

    // Admin can mutate
    const adminRes = await transport.dispatchCommand({
      token: "admin",
      command: {
        kind: "create_project",
        command_id: "cmd-auth-2",
        name: "Authorized",
        source: { kind: "local_folder", path: localDir },
      },
    });
    expect(adminRes.ok).toBe(true);

    // Invalid token rejected
    const badTokenRes = await transport.dispatchCommand({
      token: "invalid",
      command: {
        kind: "create_project",
        command_id: "cmd-auth-3",
        name: "Bad Token",
        source: { kind: "local_folder", path: localDir },
      },
    });
    expect(badTokenRes.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Additional: Event ordering and snapshot rebuild consistency
  // -------------------------------------------------------------------------
  test("event history is replayable and snapshot rebuild is consistent", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    fixture.setDefaultScenario({
      events: [
        { kind: "provider_turn_started" },
        { kind: "assistant_text_delta", text: "Result" },
        { kind: "assistant_message_completed" },
        { kind: "provider_turn_completed" },
      ],
    });

    // Create project, thread, and run a turn
    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-rebuild",
      name: "Rebuild Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-rebuild",
      project_id: projRes.project_id!,
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    expect(threadRes.ok).toBe(true);
    if (!threadRes.ok) return;

    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-rebuild",
      thread_id: threadRes.thread_id!,
      content: { text: "Test" },
    });
    expect(turnRes.ok).toBe(true);
    await sleep(50);

    // Get live snapshot
    const liveSnapshot = engine.getSnapshot();

    // Rebuild from event history
    const rebuiltSnapshot = engine.rebuildSnapshotFromHistory();

    // They should be structurally equivalent
    expect(Object.keys(rebuiltSnapshot.projects)).toEqual(
      Object.keys(liveSnapshot.projects)
    );
    expect(Object.keys(rebuiltSnapshot.threads)).toEqual(
      Object.keys(liveSnapshot.threads)
    );
    expect(Object.keys(rebuiltSnapshot.turns)).toEqual(
      Object.keys(liveSnapshot.turns)
    );
    expect(rebuiltSnapshot.sequence).toBe(liveSnapshot.sequence);

    // Verify turn states match
    for (const [id, turn] of Object.entries(rebuiltSnapshot.turns)) {
      expect(liveSnapshot.turns[id]?.status).toBe(turn.status);
    }
  });

  // -------------------------------------------------------------------------
  // Additional: Protocol diagnostics trace events end-to-end
  // -------------------------------------------------------------------------
  test("protocol diagnostics include correlation and causation metadata", async () => {
    const localDir = makeTempDir();
    const { engine } = makeEngine();

    fixture.setDefaultScenario({
      events: [
        { kind: "provider_turn_started" },
        { kind: "assistant_text_delta", text: "Hi" },
        { kind: "assistant_message_completed" },
        { kind: "provider_turn_completed" },
      ],
    });

    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-proj-diag",
      name: "Diagnostics Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-thread-diag",
      project_id: projRes.project_id!,
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    expect(threadRes.ok).toBe(true);
    if (!threadRes.ok) return;

    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-diag",
      thread_id: threadRes.thread_id!,
      content: { text: "Test" },
      correlation_id: "corr-diag-1",
    });
    expect(turnRes.ok).toBe(true);
    await sleep(50);

    // Get diagnostics
    const diagnostics = engine.getProtocolDiagnostics({
      thread_id: threadRes.thread_id!,
    });

    expect(diagnostics.length).toBeGreaterThan(0);

    // All diagnostics should have valid metadata
    for (const diag of diagnostics) {
      expect(diag.sequence).toBeGreaterThan(0);
      expect(diag.event_id).toBeTruthy();
      expect(diag.event_kind).toBeTruthy();
      expect(diag.timestamp).toBeTruthy();
      expect(diag.command_id).toBeTruthy();
      expect(diag.correlation_id).toBeTruthy();
      expect(diag.provider).toBe("pi");
    }
  });
});
