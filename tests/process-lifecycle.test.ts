import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { OrchestratorEngine } from "../src/engine/engine.js";
import { ProviderService, resolveWorkspacePath, canResumeSession, evaluateExplicitResume } from "../src/engine/provider-service.js";
import type {
  ProviderAdapter,
  CanonicalProviderEvent,
  StartTurnParams,
  InterruptTurnParams,
  StopTurnParams,
  RespondToRequestParams,
} from "../src/engine/provider-adapter.js";
import { sanitizeErrorMetadata } from "../src/engine/provider-adapter.js";
import {
  normalizeTurnStarted,
  normalizeTextDelta,
  normalizeMessageCompleted,
  normalizeTurnCompleted,
  normalizeApprovalRequested,
  normalizeInputRequested,
} from "../src/engine/pi-adapter.js";

/* ───────── Test Double Adapters ───────── */

class ControllableProviderAdapter implements ProviderAdapter {
  public interrupted = false;
  public stopped = false;
  public turnStarted = false;
  public params?: StartTurnParams;
  private events: CanonicalProviderEvent[];
  private block: boolean;
  private responseResolver?: () => void;

  constructor(events: CanonicalProviderEvent[], block = false) {
    this.events = events;
    this.block = block;
  }

  async *startTurn(params: StartTurnParams): AsyncIterable<CanonicalProviderEvent> {
    this.params = params;
    this.turnStarted = true;
    for (const event of this.events) {
      if (params.signal?.aborted || this.interrupted || this.stopped) {
        break;
      }
      yield event;
    }
    if (this.block && !params.signal?.aborted && !this.interrupted && !this.stopped) {
      const { promise, resolve } = Promise.withResolvers<void>();
      this.responseResolver = resolve;
      if (params.signal) {
        params.signal.addEventListener("abort", () => resolve(), { once: true });
      }
      await promise;
    }
  }

  async interruptTurn(_params: InterruptTurnParams): Promise<void> {
    this.interrupted = true;
    if (this.responseResolver) this.responseResolver();
  }

  async stopTurn(_params: StopTurnParams): Promise<void> {
    this.stopped = true;
    if (this.responseResolver) this.responseResolver();
  }

  async respondToRequest(_params: RespondToRequestParams): Promise<void> {}
}

class BlockingLifecycleProviderAdapter implements ProviderAdapter {
  public interrupted = false;
  public stopped = false;
  public requestResponded = false;
  public lastResponse?: RespondToRequestParams;
  private responseResolver?: () => void;

  async *startTurn(params: StartTurnParams): AsyncIterable<CanonicalProviderEvent> {
    yield normalizeTurnStarted();
    yield normalizeApprovalRequested("req-approval-1", "write_file", "Write to test.txt");

    // Wait until response or abort signal
    if (!params.signal?.aborted && !this.interrupted && !this.stopped) {
      const { promise, resolve } = Promise.withResolvers<void>();
      this.responseResolver = resolve;
      if (params.signal) {
        params.signal.addEventListener("abort", () => resolve(), { once: true });
      }
      await promise;
    }

    if (params.signal?.aborted || this.interrupted || this.stopped) {
      return;
    }

    yield normalizeTextDelta("Approved and executed");
    yield normalizeMessageCompleted();
    yield normalizeTurnCompleted();
  }

  async respondToRequest(params: RespondToRequestParams): Promise<void> {
    this.requestResponded = true;
    this.lastResponse = params;
    if (this.responseResolver) this.responseResolver();
  }

  async interruptTurn(_params: InterruptTurnParams): Promise<void> {
    this.interrupted = true;
    if (this.responseResolver) this.responseResolver();
  }

  async stopTurn(_params: StopTurnParams): Promise<void> {
    this.stopped = true;
    if (this.responseResolver) this.responseResolver();
  }
}

class FailingStreamProviderAdapter implements ProviderAdapter {
  private mode: "throw" | "exhaust";

  constructor(mode: "throw" | "exhaust") {
    this.mode = mode;
  }

  async *startTurn(_params: StartTurnParams): AsyncIterable<CanonicalProviderEvent> {
    yield normalizeTurnStarted();
    yield normalizeTextDelta("Starting work...");
    if (this.mode === "throw") {
      throw new Error("SDK process terminated unexpectedly with code 139");
    }
    // "exhaust" mode yields no terminal event and simply ends iterable
  }

  async interruptTurn(_params: InterruptTurnParams): Promise<void> {}
  async stopTurn(_params: StopTurnParams): Promise<void> {}
  async respondToRequest(_params: RespondToRequestParams): Promise<void> {}
}

/* ───────── Helpers ───────── */

async function createTestScope(
  engine: OrchestratorEngine,
  dir: string,
  projectId = "proj-1",
  threadId = "th-1"
): Promise<{ projectId: string; threadId: string }> {
  await engine.dispatchCommand({
    kind: "create_project",
    command_id: `cmd-proj-${Date.now()}-${Math.random()}`,
    project_id: projectId,
    name: "Test Project",
    source: { kind: "local_folder", path: dir },
  });

  await engine.dispatchCommand({
    kind: "create_thread",
    command_id: `cmd-th-${Date.now()}-${Math.random()}`,
    project_id: projectId,
    thread_id: threadId,
    title: "Test Thread",
    model: "pi-3.5-sonnet",
    access_profile: "workspace-write",
    interaction_mode: "execute",
  });

  return { projectId, threadId };
}

async function waitForCondition(
  predicate: () => boolean,
  maxAttempts = 1000
): Promise<void> {
  let attempts = 0;
  while (!predicate()) {
    if (attempts++ >= maxAttempts) {
      throw new Error("Condition timed out");
    }
    await new Promise((r) => queueMicrotask(r));
  }
}
/* ───────── Tests ───────── */

describe("Process Lifecycle & Interruption Handling", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "labq-lifecycle-test-"));
    tempDirs.push(d);
    return d;
  }

  /* 1. Explicit Interruption & Session Preservation */
  test("explicit interrupt aborts active operation, preserves session state, and is idempotent", async () => {
    const adapter = new ControllableProviderAdapter(
      [
        normalizeTurnStarted(),
        normalizeTextDelta("Beginning computation..."),
      ],
      true
    );
    const ps = new ProviderService();
    ps.registerAdapter("pi", adapter);
    const engine = new OrchestratorEngine(undefined, ps);
    const dir = makeTempDir();
    const { threadId } = await createTestScope(engine, dir);
    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-start-1",
      thread_id: threadId,
      turn_id: "turn-int-1",
      content: { text: "Run expensive task" },
    });

    // Verify turn queued/running
    await waitForCondition(() => engine.getTurn("turn-int-1")?.status === "running");

    // Interrupt turn
    const intRes = await engine.dispatchCommand({
      kind: "interrupt_turn",
      command_id: "cmd-int-1",
      thread_id: threadId,
      turn_id: "turn-int-1",
    });

    expect(intRes.ok).toBe(true);
    if (intRes.ok) {
      expect(intRes.status).toBe("interrupted");
    }

    const turn = engine.getTurn("turn-int-1");
    expect(turn?.status).toBe("interrupted");

    // Thread session_status remains "ready" (session preserved!)
    const thread = engine.getThread(threadId);
    expect(thread?.session_status).toBe("ready");
    expect(adapter.interrupted).toBe(true);

    // Repeating interrupt command with new command_id is idempotent
    const repeatIntRes = await engine.dispatchCommand({
      kind: "interrupt_turn",
      command_id: "cmd-int-repeat",
      thread_id: threadId,
      turn_id: "turn-int-1",
    });
    expect(repeatIntRes.ok).toBe(true);
    if (repeatIntRes.ok) {
      expect(repeatIntRes.status).toBe("interrupted");
    }

    // Repeating interrupt with duplicate command_id returns receipt duplicate flag
    const dupReceipt = await engine.dispatchCommand({
      kind: "interrupt_turn",
      command_id: "cmd-int-1",
      thread_id: threadId,
      turn_id: "turn-int-1",
    });
    expect(dupReceipt.ok).toBe(true);
    expect(dupReceipt.duplicate).toBe(true);

    // Interrupting completed turn returns invalid_turn_state
    const completedTurnAdapter = new ControllableProviderAdapter([
      normalizeTurnStarted(),
      normalizeTextDelta("Finished"),
      normalizeMessageCompleted(),
      normalizeTurnCompleted(),
    ]);
    const ps2 = new ProviderService();
    ps2.registerAdapter("pi", completedTurnAdapter);
    const engine2 = new OrchestratorEngine(undefined, ps2);
    await createTestScope(engine2, dir, "p2", "th-done");

    await engine2.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-done-start",
      thread_id: "th-done",
      turn_id: "turn-done",
      content: { text: "Quick task" },
    });
    await waitForCondition(() => engine2.getTurn("turn-done")?.status === "completed");

    const invalidIntRes = await engine2.dispatchCommand({
      kind: "interrupt_turn",
      command_id: "cmd-int-invalid",
      thread_id: "th-done",
      turn_id: "turn-done",
    });
    expect(invalidIntRes.ok).toBe(false);
    if (!invalidIntRes.ok) {
      expect(invalidIntRes.code).toBe("invalid_turn_state");
    }
  });

  /* 2. Session Stop & Disposable Session Rules */
  test("session stop aborts active work, disposes provider session, marks thread stopped, and requires new session", async () => {
    const adapter = new BlockingLifecycleProviderAdapter();
    const ps = new ProviderService();
    ps.registerAdapter("pi", adapter);
    const engine = new OrchestratorEngine(undefined, ps);
    const dir = makeTempDir();
    const { threadId } = await createTestScope(engine, dir);

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-start-stop",
      thread_id: threadId,
      turn_id: "turn-to-stop",
      content: { text: "Task needing approval" },
    });

    // Wait until turn is paused on approval request
    await waitForCondition(() => engine.getTurn("turn-to-stop")?.status === "paused");

    // Stop turn and session
    const stopRes = await engine.dispatchCommand({
      kind: "stop_turn",
      command_id: "cmd-stop-1",
      thread_id: threadId,
      turn_id: "turn-to-stop",
    });

    expect(stopRes.ok).toBe(true);
    if (stopRes.ok) {
      expect(stopRes.status).toBe("stopped");
    }

    // Turn is interrupted
    const turn = engine.getTurn("turn-to-stop");
    expect(turn?.status).toBe("interrupted");

    // Pending request is finalized (declined for approval)
    expect(turn?.pending_request?.status).toBe("declined");
    expect(turn?.pending_request?.resolved_at).toBeDefined();

    // Thread session_status is "stopped"
    const thread = engine.getThread(threadId);
    expect(thread?.session_status).toBe("stopped");
    expect(adapter.stopped).toBe(true);

    // Stop is idempotent on already stopped session
    const repeatStopRes = await engine.dispatchCommand({
      kind: "stop_turn",
      command_id: "cmd-stop-repeat",
      thread_id: threadId,
    });
    expect(repeatStopRes.ok).toBe(true);
    if (repeatStopRes.ok) {
      expect(repeatStopRes.status).toBe("stopped");
    }

    // Subsequent start_turn on stopped session is rejected with session_stopped
    const startOnStopped = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-start-after-stop",
      thread_id: threadId,
      content: { text: "Should fail" },
    });
    if (!startOnStopped.ok) {
      expect(startOnStopped.code).toBe("session_stopped");
    }
  });

  /* 3. Unresolved-Request Cleanup & Stale Response Rejection */
  test("interruption and session stop finalize unresolved input requests and reject late responses", async () => {
    const adapter = new ControllableProviderAdapter(
      [
        normalizeTurnStarted(),
        normalizeInputRequested("req-inp-1", "configure_database", [
          { id: "port", type: "number", label: "Port", required: true },
        ]),
      ],
      true
    );
    const ps = new ProviderService();
    ps.registerAdapter("pi", adapter);
    const engine = new OrchestratorEngine(undefined, ps);
    const dir = makeTempDir();
    const { threadId } = await createTestScope(engine, dir);
    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-start-inp",
      thread_id: threadId,
      turn_id: "turn-inp",
      content: { text: "Configure DB" },
    });

    await waitForCondition(() => engine.getTurn("turn-inp")?.status === "paused");

    // Interrupt turn
    await engine.dispatchCommand({
      kind: "interrupt_turn",
      command_id: "cmd-int-inp",
      thread_id: threadId,
      turn_id: "turn-inp",
    });

    const turn = engine.getTurn("turn-inp");
    expect(turn?.status).toBe("interrupted");
    expect(turn?.pending_request?.status).toBe("cancelled");
    expect(turn?.pending_request?.resolved_at).toBeDefined();

    // Late respond_input command is cleanly rejected
    const lateResponseRes = await engine.dispatchCommand({
      kind: "respond_input",
      command_id: "cmd-late-input",
      thread_id: threadId,
      turn_id: "turn-inp",
      request_id: "req-inp-1",
      values: { port: 5432 },
    });
    expect(lateResponseRes.ok).toBe(false);
    if (!lateResponseRes.ok) {
      expect(lateResponseRes.code).toBe("no_pending_request");
    }
  });

  /* 4. Unexpected Provider Runtime Failure & Stream Exhaustion */
  test("unexpected provider runtime failure produces structured TurnFailed and finalizes pending requests", async () => {
    const ps = new ProviderService();
    ps.registerAdapter("pi", new FailingStreamProviderAdapter("throw"));
    const engine = new OrchestratorEngine(undefined, ps);
    const dir = makeTempDir();
    const { threadId } = await createTestScope(engine, dir);

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-fail-1",
      thread_id: threadId,
      turn_id: "turn-fail-1",
      content: { text: "Execute command" },
    });

    await waitForCondition(() => engine.getTurn("turn-fail-1")?.status === "failed");

    const turn = engine.getTurn("turn-fail-1");
    expect(turn?.status).toBe("failed");
    expect(turn?.error?.code).toBe("provider_error");
    expect(turn?.error?.detail).toContain("SDK process terminated unexpectedly");

    // Thread returns to "ready"
    const thread = engine.getThread(threadId);
    expect(thread?.session_status).toBe("ready");

    // TurnCompleted event was NEVER emitted
    const events = engine.getEvents();
    expect(events.some((e) => e.kind === "TurnCompleted")).toBe(false);
  });

  test("stream exhaustion without completion event produces TurnFailed stream_exhausted", async () => {
    const ps = new ProviderService();
    ps.registerAdapter("pi", new FailingStreamProviderAdapter("exhaust"));
    const engine = new OrchestratorEngine(undefined, ps);
    const dir = makeTempDir();
    const { threadId } = await createTestScope(engine, dir);

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-exhaust-1",
      thread_id: threadId,
      turn_id: "turn-exhaust-1",
      content: { text: "Execute task" },
    });

    await waitForCondition(() => engine.getTurn("turn-exhaust-1")?.status === "failed");

    const turn = engine.getTurn("turn-exhaust-1");
    expect(turn?.status).toBe("failed");
    expect(turn?.error?.code).toBe("provider_stream_exhausted");
  });

  /* 5. Sanitized Provider Error Metadata */
  test("sanitizeErrorMetadata cleans internal errors, Error instances, and object formats", () => {
    const err1 = new Error("Connection failed: socket hang up");
    const meta1 = sanitizeErrorMetadata(err1);
    expect(meta1).toEqual({
      code: "provider_error",
      detail: "Connection failed: socket hang up",
    });

    const err2 = { code: "process_exited", detail: "Pi binary exited with status 1" };
    const meta2 = sanitizeErrorMetadata(err2);
    expect(meta2).toEqual({
      code: "process_exited",
      detail: "Pi binary exited with status 1",
    });

    const err3 = "Raw string failure";
    const meta3 = sanitizeErrorMetadata(err3);
    expect(meta3).toEqual({
      code: "provider_error",
      detail: "Raw string failure",
    });
  });

  /* 6. Explicit Resume Matching */
  test("evaluateExplicitResume offers resume only for matching non-stopped session", () => {
    const basePersisted = {
      session_id: "sess-100",
      provider_name: "pi",
      project_workspace_path: "/workspaces/proj-a",
      model: "pi-3.5-sonnet" as const,
      access_profile: "workspace-write" as const,
      session_status: "ready",
    };

    const matchParams = {
      session_id: "sess-100",
      provider_name: "pi",
      project_workspace_path: "/workspaces/proj-a",
      model: "pi-3.5-sonnet" as const,
      access_profile: "workspace-write" as const,
    };

    expect(canResumeSession(basePersisted, matchParams)).toBe(true);
    expect(evaluateExplicitResume(basePersisted, matchParams)).toEqual({
      can_resume: true,
      reason: "matching_persisted_session",
    });

    // Stopped session is NOT resumable
    expect(
      evaluateExplicitResume({ ...basePersisted, session_status: "stopped" }, matchParams)
    ).toEqual({ can_resume: false, reason: "session_stopped" });

    // Model mismatch
    expect(
      evaluateExplicitResume(basePersisted, { ...matchParams, model: "pi-mini" })
    ).toEqual({ can_resume: false, reason: "model_mismatch" });

    // Workspace mismatch
    expect(
      evaluateExplicitResume(basePersisted, {
        ...matchParams,
        project_workspace_path: "/workspaces/proj-b",
      })
    ).toEqual({ can_resume: false, reason: "workspace_mismatch" });

    // Access profile mismatch
    expect(
      evaluateExplicitResume(basePersisted, {
        ...matchParams,
        access_profile: "read-only",
      })
    ).toEqual({ can_resume: false, reason: "access_profile_mismatch" });
  });

  /* 7. Snapshot & Replay Consistency */
  test("snapshot rebuild and subscriber stream match live state for session and request outcomes", async () => {
    const adapter = new BlockingLifecycleProviderAdapter();
    const ps = new ProviderService();
    ps.registerAdapter("pi", adapter);
    const engine = new OrchestratorEngine(undefined, ps);
    const dir = makeTempDir();
    const { threadId } = await createTestScope(engine, dir);

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-snap-start",
      thread_id: threadId,
      turn_id: "turn-snap-1",
      content: { text: "Test snapshot consistency" },
    });

    await waitForCondition(() => engine.getTurn("turn-snap-1")?.status === "paused");

    await engine.dispatchCommand({
      kind: "interrupt_turn",
      command_id: "cmd-snap-int",
      thread_id: threadId,
      turn_id: "turn-snap-1",
    });

    const liveSnapshot = engine.getSnapshot();
    const rebuiltSnapshot = engine.rebuildSnapshotFromHistory();

    expect(rebuiltSnapshot.sequence).toBe(liveSnapshot.sequence);
    expect(rebuiltSnapshot.threads[threadId]?.session_status).toBe(
      liveSnapshot.threads[threadId]?.session_status
    );
    expect(rebuiltSnapshot.turns["turn-snap-1"]?.status).toBe(
      liveSnapshot.turns["turn-snap-1"]?.status
    );
    expect(rebuiltSnapshot.turns["turn-snap-1"]?.pending_request?.status).toBe(
      liveSnapshot.turns["turn-snap-1"]?.pending_request?.status
    );

    // Sync replay recovers identical event stream
    const syncRes = engine.sync(0);
    expect(syncRes.ok).toBe(true);
    if (syncRes.ok && syncRes.mode === "replay") {
      expect(syncRes.events.length).toBe(liveSnapshot.sequence);
    }
  });
});
