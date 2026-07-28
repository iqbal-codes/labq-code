import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { OrchestratorEngine } from "../src/engine/engine.js";
import { ProviderService } from "../src/engine/provider-service.js";
import type {
  ProviderAdapter,
  CanonicalProviderEvent,
  StartTurnParams,
  InterruptTurnParams,
  StopTurnParams,
  RespondToRequestParams,
} from "../src/engine/provider-adapter.js";
import {
  normalizeTurnStarted,
  normalizeTextDelta,
  normalizeMessageCompleted,
  normalizeTurnCompleted,
  normalizeFailure,
  normalizeApprovalRequested,
  normalizeInputRequested,
} from "../src/engine/pi-adapter.js";

/* ───────── Test Double Providers ───────── */

class TestProviderAdapter implements ProviderAdapter {
  private events: CanonicalProviderEvent[];

  constructor(events: CanonicalProviderEvent[]) {
    this.events = events;
  }

  async *startTurn(_params: StartTurnParams): AsyncIterable<CanonicalProviderEvent> {
    for (const event of this.events) {
      yield event;
    }
  }

  async interruptTurn(_params: InterruptTurnParams): Promise<void> {}
  async respondToRequest(_params: RespondToRequestParams): Promise<void> {}
  async stopTurn(_params: StopTurnParams): Promise<void> {}
}

class DelayedTestProviderAdapter implements ProviderAdapter {
  private events: CanonicalProviderEvent[];
  private delayMs: number;

  constructor(events: CanonicalProviderEvent[], delayMs = 50) {
    this.events = events;
    this.delayMs = delayMs;
  }

  async *startTurn(_params: StartTurnParams): AsyncIterable<CanonicalProviderEvent> {
    for (const event of this.events) {
      for (let i = 0; i < this.delayMs; i++) {
        await Promise.resolve();
      }
      yield event;
    }
  }

  async interruptTurn(_params: InterruptTurnParams): Promise<void> {}
  async respondToRequest(_params: RespondToRequestParams): Promise<void> {}
  async stopTurn(_params: StopTurnParams): Promise<void> {}
}

/**
 * Test adapter that blocks after an approval/input request until respondToRequest is called.
 * This simulates the real provider behavior where the stream waits for user response.
 */
class BlockingTestProviderAdapter implements ProviderAdapter {
  private initialEvents: CanonicalProviderEvent[];
  private continuationEvents: CanonicalProviderEvent[];
  private pendingResolve: (() => void) | null = null;
  private pendingPromise: Promise<void> | null = null;

  constructor(
    initialEvents: CanonicalProviderEvent[],
    continuationEvents: CanonicalProviderEvent[]
  ) {
    this.initialEvents = initialEvents;
    this.continuationEvents = continuationEvents;
  }

  async *startTurn(_params: StartTurnParams): AsyncIterable<CanonicalProviderEvent> {
    // Yield initial events
    for (const event of this.initialEvents) {
      yield event;
    }
    // Block until respondToRequest is called
    this.pendingPromise = new Promise<void>((resolve) => {
      this.pendingResolve = resolve;
    });
    await this.pendingPromise;
    this.pendingPromise = null;
    this.pendingResolve = null;
    // Yield continuation events
    for (const event of this.continuationEvents) {
      yield event;
    }
  }

  async interruptTurn(_params: InterruptTurnParams): Promise<void> {
    // Unblock if blocked
    if (this.pendingResolve) {
      this.pendingResolve();
    }
  }

  async respondToRequest(_params: RespondToRequestParams): Promise<void> {
    // Unblock the stream after response
    if (this.pendingResolve) {
      this.pendingResolve();
    }
  }

  async stopTurn(_params: StopTurnParams): Promise<void> {
    // Unblock if blocked
    if (this.pendingResolve) {
      this.pendingResolve();
    }
  }
}

/* ───────── Helpers ───────── */

async function waitForTerminalTurn(
  engine: OrchestratorEngine,
  turnId: string
): Promise<void> {
  const terminal = new Set(["completed", "failed", "interrupted"]);
  for (let i = 0; i < 100; i++) {
    const turn = engine.getTurn(turnId);
    if (turn && terminal.has(turn.status)) return;
    const { promise: p, resolve: r } = Promise.withResolvers<void>();
    queueMicrotask(r);
    await p;
  }
}

async function waitForPausedTurn(
  engine: OrchestratorEngine,
  turnId: string
): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const turn = engine.getTurn(turnId);
    if (turn?.status === "paused") return;
    const { promise: p, resolve: r } = Promise.withResolvers<void>();
    queueMicrotask(r);
    await p;
  }
}

function setupTest(events: CanonicalProviderEvent[]): {
  engine: OrchestratorEngine;
  dir: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-approval-test-"));
  const providerService = new ProviderService();
  providerService.registerAdapter("pi", new TestProviderAdapter(events));
  const engine = new OrchestratorEngine(undefined, providerService);
  return { engine, dir };
}

async function createScope(
  engine: OrchestratorEngine,
  dir: string,
  projectId: string,
  threadId: string
): Promise<{ projectId: string; threadId: string }> {
  const projRes = await engine.dispatchCommand({
    kind: "create_project",
    command_id: `proj-${projectId}`,
    project_id: projectId,
    name: `Project ${projectId}`,
    source: { kind: "local_folder", path: dir },
  });
  expect(projRes.ok).toBe(true);

  const threadRes = await engine.dispatchCommand({
    kind: "create_thread",
    command_id: `th-${threadId}`,
    thread_id: threadId,
    project_id: projectId,
    model: "pi-default",
    access_profile: "read-only",
    interaction_mode: "execute",
  });
  expect(threadRes.ok).toBe(true);

  return { projectId, threadId };
}

/* ───────── Approval Request Tests ───────── */

describe("Approval and Structured-Input Pauses", () => {
  test("approval request pauses turn and appears as pending request in snapshot", async () => {
    const { engine, dir } = setupTest([
      normalizeTurnStarted(),
      normalizeTextDelta("About to delete..."),
      normalizeApprovalRequested("req-approve-1", "delete_file", "Confirm file deletion"),
      normalizeTextDelta("Done."),
      normalizeMessageCompleted(),
      normalizeTurnCompleted(),
    ]);
    await createScope(engine, dir, "proj-approve", "th-approve");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-approve",
      thread_id: "th-approve",
      turn_id: "turn-approve",
      content: { text: "Delete the file" },
    });

    await waitForPausedTurn(engine, "turn-approve");

    const turn = engine.getTurn("turn-approve");
    expect(turn).toBeDefined();
    expect(turn?.status).toBe("paused");
    expect(turn?.pending_request).toBeDefined();
    expect(turn?.pending_request?.kind).toBe("approval");
    expect(turn?.pending_request?.operation).toBe("delete_file");
    expect(turn?.pending_request?.id).toBe("req-approve-1");
    expect(turn?.pending_request?.status).toBe("pending");

    const events = engine.getEvents();
    expect(events.some((e) => e.kind === "ApprovalRequested")).toBe(true);
  });

  test("respond_approval resolves pending request and resumes turn", async () => {
    const { engine, dir } = setupTest([
      normalizeTurnStarted(),
      normalizeApprovalRequested("req-approve-2", "git_push", "Push to main"),
      normalizeTextDelta("Pushed."),
      normalizeMessageCompleted(),
      normalizeTurnCompleted(),
    ]);
    await createScope(engine, dir, "proj-approve2", "th-approve2");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-approve2",
      thread_id: "th-approve2",
      turn_id: "turn-approve2",
      content: { text: "Push changes" },
    });

    await waitForPausedTurn(engine, "turn-approve2");

    const approveRes = await engine.dispatchCommand({
      kind: "respond_approval",
      command_id: "cmd-resp-approve",
      turn_id: "turn-approve2",
      thread_id: "th-approve2",
      request_id: "req-approve-2",
      decision: "approved",
    });
    expect(approveRes.ok).toBe(true);

    await waitForTerminalTurn(engine, "turn-approve2");

    const turn = engine.getTurn("turn-approve2");
    expect(turn?.status).toBe("completed");
    expect(turn?.pending_request?.status).toBe("approved");
    expect(turn?.pending_request?.resolved_at).toBeDefined();

    const events = engine.getEvents();
    expect(events.some((e) => e.kind === "PendingRequestResolved")).toBe(true);
  });

  test("decline returns structured denial without fabricating turn success", async () => {
    const { engine, dir } = setupTest([
      normalizeTurnStarted(),
      normalizeApprovalRequested("req-decline-1", "rm_rf", "Remove directory"),
      normalizeTextDelta("Deletion declined by user."),
      normalizeMessageCompleted(),
      normalizeTurnCompleted(),
    ]);
    await createScope(engine, dir, "proj-decline", "th-decline");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-decline",
      thread_id: "th-decline",
      turn_id: "turn-decline",
      content: { text: "Remove directory" },
    });

    await waitForPausedTurn(engine, "turn-decline");

    const declineRes = await engine.dispatchCommand({
      kind: "respond_approval",
      command_id: "cmd-resp-decline",
      turn_id: "turn-decline",
      thread_id: "th-decline",
      request_id: "req-decline-1",
      decision: "declined",
    });
    expect(declineRes.ok).toBe(true);

    await waitForTerminalTurn(engine, "turn-decline");

    const turn = engine.getTurn("turn-decline");
    expect(turn?.status).toBe("completed");
    expect(turn?.pending_request?.status).toBe("declined");

    const msg = turn?.assistant_message;
    expect(msg?.is_complete).toBe(true);
    const textParts = msg?.parts.filter((p) => p.kind === "text");
    expect(textParts?.length).toBeGreaterThan(0);
  });

  /* ───────── Structured Input Tests ───────── */

  test("structured input pause with fields and atomic response", async () => {
    const { engine, dir } = setupTest([
      normalizeTurnStarted(),
      normalizeInputRequested(
        "req-input-1",
        "configure_build",
        [
          { id: "target", type: "select", label: "Build target", required: true, options: [{ value: "prod", label: "Production" }, { value: "dev", label: "Development" }] },
          { id: "debug", type: "boolean", label: "Enable debug", required: false },
          { id: "count", type: "number", label: "Parallel jobs", required: true },
          { id: "notes", type: "multiline_text", label: "Notes", required: false },
        ],
        "Configure build settings"
      ),
      normalizeTextDelta("Build configured."),
      normalizeMessageCompleted(),
      normalizeTurnCompleted(),
    ]);
    await createScope(engine, dir, "proj-input", "th-input");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-input",
      thread_id: "th-input",
      turn_id: "turn-input",
      content: { text: "Configure the build" },
    });

    await waitForPausedTurn(engine, "turn-input");

    const turn = engine.getTurn("turn-input");
    expect(turn?.status).toBe("paused");
    expect(turn?.pending_request?.kind).toBe("input");
    expect(turn?.pending_request?.fields).toHaveLength(4);
    expect(turn?.pending_request?.fields[0].type).toBe("select");
    expect(turn?.pending_request?.fields[1].type).toBe("boolean");
    expect(turn?.pending_request?.fields[2].type).toBe("number");
    expect(turn?.pending_request?.fields[3].type).toBe("multiline_text");

    const inputRes = await engine.dispatchCommand({
      kind: "respond_input",
      command_id: "cmd-resp-input",
      turn_id: "turn-input",
      thread_id: "th-input",
      request_id: "req-input-1",
      values: {
        target: "prod",
        debug: false,
        count: 4,
        notes: "Optimized build",
      },
    });
    expect(inputRes.ok).toBe(true);

    await waitForTerminalTurn(engine, "turn-input");

    const completedTurn = engine.getTurn("turn-input");
    expect(completedTurn?.status).toBe("completed");
    expect(completedTurn?.pending_request?.status).toBe("answered");
  });

  /* ───────── Stale / Duplicate / Late Response Rejection ───────── */

  test("stale response for already-resolved request is rejected", async () => {
    const { engine, dir } = setupTest([
      normalizeTurnStarted(),
      normalizeApprovalRequested("req-stale-1", "operation_a", "First operation"),
      normalizeTextDelta("Continued."),
      normalizeMessageCompleted(),
      normalizeTurnCompleted(),
    ]);
    await createScope(engine, dir, "proj-stale", "th-stale");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-stale",
      thread_id: "th-stale",
      turn_id: "turn-stale",
      content: { text: "Do something" },
    });

    await waitForPausedTurn(engine, "turn-stale");

    const approveRes = await engine.dispatchCommand({
      kind: "respond_approval",
      command_id: "cmd-resp-stale-1",
      turn_id: "turn-stale",
      thread_id: "th-stale",
      request_id: "req-stale-1",
      decision: "approved",
    });
    expect(approveRes.ok).toBe(true);

    await waitForTerminalTurn(engine, "turn-stale");

    const staleRes = await engine.dispatchCommand({
      kind: "respond_approval",
      command_id: "cmd-resp-stale-2",
      turn_id: "turn-stale",
      thread_id: "th-stale",
      request_id: "req-stale-1",
      decision: "declined",
    });
    expect(staleRes.ok).toBe(false);
    if (!staleRes.ok) {
      expect(staleRes.code).toBe("no_pending_request");
    }
  });

  test("response with wrong request_id is rejected as stale", async () => {
    // Use blocking provider to keep stream open after approval request
    const providerService = new ProviderService();
    providerService.registerAdapter(
      "pi",
      new BlockingTestProviderAdapter(
        [
          normalizeTurnStarted(),
          normalizeApprovalRequested("req-correct", "operation_x", "The real request"),
        ],
        []
      )
    );
    const engine = new OrchestratorEngine(undefined, providerService);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-approval-test-"));
    await createScope(engine, dir, "proj-wrong-id", "th-wrong-id");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-wrong-id",
      thread_id: "th-wrong-id",
      turn_id: "turn-wrong-id",
      content: { text: "Do something" },
    });

    await waitForPausedTurn(engine, "turn-wrong-id");

    const wrongIdRes = await engine.dispatchCommand({
      kind: "respond_approval",
      command_id: "cmd-wrong-id-resp",
      turn_id: "turn-wrong-id",
      thread_id: "th-wrong-id",
      request_id: "req-nonexistent",
      decision: "approved",
    });
    expect(wrongIdRes.ok).toBe(false);
    if (!wrongIdRes.ok) {
      // Turn is paused but request_id doesn't match
      expect(wrongIdRes.code).toBe("stale_request");
    }
  });

  test("response to approval request with input command is rejected as wrong kind", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-approval-test-"));
    const providerService = new ProviderService();
    providerService.registerAdapter(
      "pi",
      new BlockingTestProviderAdapter(
        [
          normalizeTurnStarted(),
          normalizeApprovalRequested("req-kind-1", "confirm_action", "Please confirm"),
        ],
        []
      )
    );
    const engine = new OrchestratorEngine(undefined, providerService);
    await createScope(engine, dir, "proj-wrong-kind", "th-wrong-kind");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-wrong-kind",
      thread_id: "th-wrong-kind",
      turn_id: "turn-wrong-kind",
      content: { text: "Confirm action" },
    });

    await waitForPausedTurn(engine, "turn-wrong-kind");

    const wrongKindRes = await engine.dispatchCommand({
      kind: "respond_input",
      command_id: "cmd-wrong-kind-resp",
      turn_id: "turn-wrong-kind",
      thread_id: "th-wrong-kind",
      request_id: "req-kind-1",
      values: { answer: "yes" },
    });
    expect(wrongKindRes.ok).toBe(false);
    if (!wrongKindRes.ok) {
      expect(wrongKindRes.code).toBe("wrong_request_kind");
    }
  });

  test("response with missing required field is rejected", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-approval-test-"));
    const providerService = new ProviderService();
    providerService.registerAdapter(
      "pi",
      new BlockingTestProviderAdapter(
        [
          normalizeTurnStarted(),
          normalizeInputRequested(
            "req-required",
            "fill_form",
            [
              { id: "name", type: "text", label: "Name", required: true },
              { id: "opt", type: "text", label: "Optional", required: false },
            ]
          ),
        ],
        []
      )
    );
    const engine = new OrchestratorEngine(undefined, providerService);
    await createScope(engine, dir, "proj-required", "th-required");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-required",
      thread_id: "th-required",
      turn_id: "turn-required",
      content: { text: "Fill the form" },
    });

    await waitForPausedTurn(engine, "turn-required");

    const missingRes = await engine.dispatchCommand({
      kind: "respond_input",
      command_id: "cmd-required-resp",
      turn_id: "turn-required",
      thread_id: "th-required",
      request_id: "req-required",
      values: { opt: "optional value" }, // missing 'name'
    });
    expect(missingRes.ok).toBe(false);
    if (!missingRes.ok) {
      expect(missingRes.code).toBe("missing_required_field");
    }
  });

  /* ───────── Response Correlation Tests ───────── */

  test("response correlation: matching turn_id, thread_id, and request_id", async () => {
    const providerService = new ProviderService();
    providerService.registerAdapter(
      "pi",
      new BlockingTestProviderAdapter(
        [
          normalizeTurnStarted(),
          normalizeApprovalRequested("req-corr-a", "op_a", "Request A"),
        ],
        []
      )
    );
    const engine = new OrchestratorEngine(undefined, providerService);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-approval-test-"));

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "proj-corr-a",
      project_id: "proj-corr-a",
      name: "Project A",
      source: { kind: "local_folder", path: dir },
    });
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "th-corr-a",
      thread_id: "th-corr-a",
      project_id: "proj-corr-a",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "th-corr-b",
      thread_id: "th-corr-b",
      project_id: "proj-corr-a",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-corr-a",
      thread_id: "th-corr-a",
      turn_id: "turn-corr-a",
      content: { text: "Task A" },
    });

    await waitForPausedTurn(engine, "turn-corr-a");

    const wrongThreadRes = await engine.dispatchCommand({
      kind: "respond_approval",
      command_id: "cmd-corr-wrong",
      turn_id: "turn-corr-a",
      thread_id: "th-corr-b", // wrong thread
      request_id: "req-corr-a",
      decision: "approved",
    });
    expect(wrongThreadRes.ok).toBe(false);
    if (!wrongThreadRes.ok) {
      expect(wrongThreadRes.code).toBe("turn_thread_mismatch");
    }

    const correctRes = await engine.dispatchCommand({
      kind: "respond_approval",
      command_id: "cmd-corr-correct",
      turn_id: "turn-corr-a",
      thread_id: "th-corr-a",
      request_id: "req-corr-a",
      decision: "approved",
    });
    expect(correctRes.ok).toBe(true);
  });

  test("interrupt clears pending request", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-approval-test-"));
    const providerService = new ProviderService();
    providerService.registerAdapter(
      "pi",
      new BlockingTestProviderAdapter(
        [
          normalizeTurnStarted(),
          normalizeApprovalRequested("req-interrupt", "long_op", "Long operation"),
        ],
        []
      )
    );
    const engine = new OrchestratorEngine(undefined, providerService);
    await createScope(engine, dir, "proj-int-pending", "th-int-pending");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-int-pending",
      thread_id: "th-int-pending",
      turn_id: "turn-int-pending",
      content: { text: "Long operation" },
    });

    await waitForPausedTurn(engine, "turn-int-pending");

    const turnBefore = engine.getTurn("turn-int-pending");
    expect(turnBefore?.status).toBe("paused");
    expect(turnBefore?.pending_request).toBeDefined();

    const interruptRes = await engine.dispatchCommand({
      kind: "interrupt_turn",
      command_id: "cmd-int-pending-resp",
      turn_id: "turn-int-pending",
      thread_id: "th-int-pending",
    });
    expect(interruptRes.ok).toBe(true);

    const turnAfter = engine.getTurn("turn-int-pending");
    expect(turnAfter?.status).toBe("interrupted");
  });

  test("pending request appears deterministically in snapshot for connected clients", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-approval-test-"));
    const providerService = new ProviderService();
    providerService.registerAdapter(
      "pi",
      new BlockingTestProviderAdapter(
        [
          normalizeTurnStarted(),
          normalizeApprovalRequested("req-snap", "write_file", "Write to disk"),
        ],
        []
      )
    );
    const engine = new OrchestratorEngine(undefined, providerService);
    await createScope(engine, dir, "proj-snap-pending", "th-snap-pending");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-snap",
      thread_id: "th-snap-pending",
      turn_id: "turn-snap",
      content: { text: "Write file" },
    });

    await waitForPausedTurn(engine, "turn-snap");

    const snapshot = engine.getSnapshot();
    const turn = snapshot.turns["turn-snap"];
    expect(turn).toBeDefined();
    expect(turn.status).toBe("paused");
    expect(turn.pending_request).toBeDefined();
    expect(turn.pending_request?.id).toBe("req-snap");
    expect(turn.pending_request?.kind).toBe("approval");
    expect(turn.pending_request?.operation).toBe("write_file");
    expect(turn.pending_request?.status).toBe("pending");

    const syncResult = engine.sync(0);
    expect(syncResult.mode).toBe("replay");
    if (syncResult.mode === "replay") {
      const approvalEvent = syncResult.events.find((e) => e.kind === "ApprovalRequested");
      expect(approvalEvent).toBeDefined();
    }
  });

  test("duplicate command ID for respond_approval returns original receipt", async () => {
    const { engine, dir } = setupTest([
      normalizeTurnStarted(),
      normalizeApprovalRequested("req-dup", "confirm", "Confirm?"),
      normalizeTextDelta("Done."),
      normalizeMessageCompleted(),
      normalizeTurnCompleted(),
    ]);
    await createScope(engine, dir, "proj-dup", "th-dup");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-dup",
      thread_id: "th-dup",
      turn_id: "turn-dup",
      content: { text: "Confirm" },
    });

    await waitForPausedTurn(engine, "turn-dup");

    const res1 = await engine.dispatchCommand({
      kind: "respond_approval",
      command_id: "cmd-dup-resp",
      turn_id: "turn-dup",
      thread_id: "th-dup",
      request_id: "req-dup",
      decision: "approved",
    });
    expect(res1.ok).toBe(true);
    expect(res1.duplicate).toBeUndefined();

    const res2 = await engine.dispatchCommand({
      kind: "respond_approval",
      command_id: "cmd-dup-resp",
      turn_id: "turn-dup",
      thread_id: "th-dup",
      request_id: "req-dup",
      decision: "approved",
    });
    expect(res2.ok).toBe(true);
    expect(res2.duplicate).toBe(true);
  });

  test("provider failure during pending request finalizes the turn", async () => {
    const { engine, dir } = setupTest([
      normalizeTurnStarted(),
      normalizeApprovalRequested("req-fail", "dangerous_op", "Dangerous operation"),
      normalizeFailure("provider_crash", "Provider crashed during approval wait"),
    ]);
    await createScope(engine, dir, "proj-fail-pending", "th-fail-pending");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-fail-pending",
      thread_id: "th-fail-pending",
      turn_id: "turn-fail-pending",
      content: { text: "Dangerous operation" },
    });

    await waitForTerminalTurn(engine, "turn-fail-pending");

    const turn = engine.getTurn("turn-fail-pending");
    expect(turn).toBeDefined();
    expect(turn?.status).toBe("failed");
    expect(turn?.error?.code).toBe("provider_crash");
  });
});
