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
  validateImageBounds,
  normalizeTextDelta,
  normalizeToolBegan,
  normalizeToolCompleted,
  normalizeTurnStarted,
  normalizeMessageCompleted,
  normalizeTurnCompleted,
  normalizeFailure,
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
      // Yield to microtask queue this.delayMs times — each yield lets the
      // engine's synchronous dispatch queue process between ticks
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

/* ───────── Helpers ───────── */

/**
 * Wait for a turn to reach a terminal state (completed/failed/interrupted).
 * Polls the snapshot with microtask yields to avoid real-time delays.
 */
async function waitForTerminalTurn(
  engine: OrchestratorEngine,
  turnId: string
): Promise<void> {
  const terminal = new Set(["completed", "failed", "interrupted"]);
  for (let i = 0; i < 100; i++) {
    const turn = engine.getTurn(turnId);
    if (turn && terminal.has(turn.status)) return;
    // Yield to microtask queue twice to let streaming resolve
    const { promise: p1, resolve: r1 } = Promise.withResolvers<void>();
    queueMicrotask(r1);
    await p1;
  }
}

interface TestScope {
  providerService?: ProviderService;
  engine: OrchestratorEngine;
  dir: string;
}

function setupTest(events?: CanonicalProviderEvent[]): TestScope {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-turn-test-"));

  let providerService: ProviderService | undefined;
  if (events) {
    providerService = new ProviderService();
    providerService.registerAdapter("pi", new TestProviderAdapter(events));
  } else {
    // Empty provider service — no PiAdapter registered, so tests that
    // don't need streaming won't trigger Pi SDK errors
    providerService = new ProviderService();
  }

  const engine = new OrchestratorEngine(undefined, providerService);
  return { providerService, engine, dir };
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

/* ───────── Turn Orchestration Tests ───────── */

describe("Turn Orchestration", () => {
  test("start_turn durably records user message before provider execution", async () => {
    // Use delayed provider so we can observe queued state before streaming yields
    const providerService = new ProviderService();
    providerService.registerAdapter(
      "pi",
      new DelayedTestProviderAdapter(
        [
          normalizeTurnStarted(),
          normalizeTextDelta("Hello"),
          normalizeMessageCompleted(),
          normalizeTurnCompleted(),
        ],
        30
      )
    );
    const engine = new OrchestratorEngine(undefined, providerService);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-turn-test-"));
    await createScope(engine, dir, "proj-2-1", "th-2-1");

    // Submit turn — command returns immediately with queued state
    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-1",
      thread_id: "th-2-1",
      turn_id: "turn-2-1",
      content: { text: "Hello, agent!" },
    });

    expect(turnRes.ok).toBe(true);
    if (turnRes.ok) {
      expect(turnRes.turn_id).toBe("turn-2-1");
      expect(turnRes.status).toBe("queued");
    }

    // User message is durably recorded in snapshot immediately
    const turn = engine.getTurn("turn-2-1");
    expect(turn).toBeDefined();
    expect(turn?.thread_id).toBe("th-2-1");
    expect(turn?.status).toBe("queued");
    expect(turn?.user_message.text).toBe("Hello, agent!");
    expect(turn?.activities).toEqual({});
    expect(turn?.created_at).toBeDefined();

    // TurnQueued event is in the event log
    const events = engine.getEvents();
    const queuedEvents = events.filter((e) => e.kind === "TurnQueued");
    expect(queuedEvents.length).toBe(1);
  });

  test("start_turn exposes lifecycle state through event history", async () => {
    const { engine, dir } = setupTest([
      normalizeTurnStarted(),
      normalizeTextDelta("Processing..."),
      normalizeMessageCompleted(),
      normalizeTurnCompleted(),
    ]);
    await createScope(engine, dir, "proj-life-1", "th-life-1");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-life",
      thread_id: "th-life-1",
      turn_id: "turn-life",
      content: { text: "Test lifecycle" },
    });

    await waitForTerminalTurn(engine, "turn-life");

    // Event history contains turn lifecycle events
    const kinds = engine.getEvents().map((e) => e.kind);
    expect(kinds).toContain("TurnQueued");
    expect(kinds).toContain("TurnStarted");
    expect(kinds).toContain("TurnCompleted");
  });

  test("enforces one queued/running/paused turn per thread", async () => {
    // Use slow provider so the first turn stays queued while we submit the second
    const providerService = new ProviderService();
    providerService.registerAdapter(
      "pi",
      new DelayedTestProviderAdapter(
        [
          normalizeTurnStarted(),
          normalizeTextDelta("Working..."),
          normalizeMessageCompleted(),
          normalizeTurnCompleted(),
        ],
        50
      )
    );
    const engine = new OrchestratorEngine(undefined, providerService);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-turn-test-"));
    await createScope(engine, dir, "proj-one", "th-one");

    // First turn succeeds
    const turn1Res = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-one",
      thread_id: "th-one",
      turn_id: "turn-one",
      content: { text: "First" },
    });
    expect(turn1Res.ok).toBe(true);

    // Second turn on same thread — rejected while first is active
    const turn2Res = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-two",
      thread_id: "th-one",
      turn_id: "turn-two",
      content: { text: "Second" },
    });
    expect(turn2Res.ok).toBe(false);
    if (!turn2Res.ok) {
      expect(turn2Res.code).toBe("turn_already_active");
    }

    // Only one turn exists
    expect(engine.listTurns("th-one").length).toBe(1);
  });

  test("rejects start_turn for non-existent thread", async () => {
    const { engine, dir } = setupTest();
    const res = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-bad-th",
      thread_id: "nonexistent",
      content: { text: "hi" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("thread_not_found");
  });

  test("rejects start_turn in non-active thread", async () => {
    const { engine, dir } = setupTest();
    await createScope(engine, dir, "proj-arch", "th-arch");

    // Archive the thread
    await engine.dispatchCommand({
      kind: "archive_thread",
      command_id: "cmd-arch",
      thread_id: "th-arch",
    });

    const res = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-arch",
      thread_id: "th-arch",
      content: { text: "hi" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_thread_state");
  });

  test("validates image count and size bounds", async () => {
    const { engine, dir } = setupTest();
    await createScope(engine, dir, "proj-img", "th-img");

    // Too many images (6 > max 5)
    const tooMany = Array.from({ length: 6 }, (_, i) => ({
      filename: `img${i}.png`,
      media_type: "image/png",
      size_bytes: 100,
      data: Buffer.alloc(100).toString("base64"),
    }));
    const res1 = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-img-bad",
      thread_id: "th-img",
      content: { text: "desc", images: tooMany },
    });
    expect(res1.ok).toBe(false);
    if (!res1.ok) expect(res1.code).toBe("image_bounds_exceeded");

    // Under limit works
    const okImages = Array.from({ length: 5 }, (_, i) => ({
      filename: `img${i}.png`,
      media_type: "image/png",
      size_bytes: 100,
      data: Buffer.alloc(100).toString("base64"),
    }));
    const res2 = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-img-ok",
      thread_id: "th-img",
      content: { text: "desc", images: okImages },
    });
    expect(res2.ok).toBe(true);

    const hugeBuf = Buffer.alloc(30 * 1024 * 1024);
    const huge = {
      filename: "huge.png",
      media_type: "image/png",
      size_bytes: hugeBuf.length,
      data: hugeBuf.toString("base64"),
    };
    const res3 = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-img-huge",
      thread_id: "th-img",
      content: { text: "too big", images: [huge] },
    });
    expect(res3.ok).toBe(false);
    if (!res3.ok) expect(res3.code).toBe("image_size_exceeded");
  });

  test("interrupt_turn requires running or paused state", async () => {
    const { engine, dir } = setupTest();
    await createScope(engine, dir, "proj-int", "th-int");

    // Non-existent turn
    const bad = await engine.dispatchCommand({
      kind: "interrupt_turn",
      command_id: "cmd-int-bad",
      turn_id: "nonexistent",
      thread_id: "th-int",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("turn_not_found");

    // Queued turn cannot be interrupted (decider requires running/paused)
    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-int-start",
      thread_id: "th-int",
      turn_id: "turn-int",
      content: { text: "test" },
    });

    const early = await engine.dispatchCommand({
      kind: "interrupt_turn",
      command_id: "cmd-int-early",
      turn_id: "turn-int",
      thread_id: "th-int",
    });
    expect(early.ok).toBe(false);
  });

  test("stop_turn hard-interrupts a queued turn", async () => {
    // Use a delayed provider to keep the turn queued while we submit stop
    const providerService = new ProviderService();
    providerService.registerAdapter(
      "pi",
      new DelayedTestProviderAdapter(
        [normalizeTurnStarted(), normalizeTurnCompleted()],
        50
      )
    );
    const engine = new OrchestratorEngine(undefined, providerService);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-turn-test-"));
    await createScope(engine, dir, "proj-stop", "th-stop");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-start",
      thread_id: "th-stop",
      turn_id: "turn-stop",
      content: { text: "test" },
    });

    // Stop works on queued turn
    const stopRes = await engine.dispatchCommand({
      kind: "stop_turn",
      command_id: "cmd-stop",
      turn_id: "turn-stop",
      thread_id: "th-stop",
    });
    expect(stopRes.ok).toBe(true);
    if (stopRes.ok) expect(stopRes.status).toBe("stopped");

    // TurnInterrupted event recorded
    const events = engine.getEvents();
    expect(events.filter((e) => e.kind === "TurnInterrupted").length).toBe(1);
  });

  test("stop_turn rejects completed turn", async () => {
    const providerService = new ProviderService();
    providerService.registerAdapter(
      "pi",
      new TestProviderAdapter([
        normalizeTurnStarted(),
        normalizeTextDelta("Done"),
        normalizeMessageCompleted(),
        normalizeTurnCompleted(),
      ])
    );
    const engine = new OrchestratorEngine(undefined, providerService);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-turn-test-"));
    await createScope(engine, dir, "proj-stop2", "th-stop2");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-sp",
      thread_id: "th-stop2",
      turn_id: "turn-stop2",
      content: { text: "test" },
    });

    await waitForTerminalTurn(engine, "turn-stop2");

    // Turn completed via streaming
    const stopRes = await engine.dispatchCommand({
      kind: "stop_turn",
      command_id: "cmd-stop-done",
      turn_id: "turn-stop2",
      thread_id: "th-stop2",
    });
    // Should be rejected — turn is already completed
    expect(stopRes.ok).toBe(false);
  });

  test("streaming assembly: deltas assemble into one stable message without duplicates", async () => {
    const { engine, dir } = setupTest([
      normalizeTurnStarted(),
      normalizeTextDelta("Hello"),
      normalizeTextDelta(", "),
      normalizeTextDelta("world!"),
      normalizeToolBegan("tool-1", "read", { path: "file.txt" }),
      normalizeToolCompleted("tool-1", "success", "file content"),
      normalizeMessageCompleted(),
      normalizeTurnCompleted(),
    ]);
    await createScope(engine, dir, "proj-stream", "th-stream");

    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-s",
      thread_id: "th-stream",
      turn_id: "turn-s",
      content: { text: "Write a greeting" },
    });
    expect(turnRes.ok).toBe(true);

    await waitForTerminalTurn(engine, "turn-s");

    const turn = engine.getTurn("turn-s");
    expect(turn).toBeDefined();
    expect(turn?.status).toBe("completed");
    expect(turn?.assistant_message).toBeDefined();
    expect(turn?.assistant_message?.is_complete).toBe(true);

    // Deltas assembled: one text part with full concatenated content
    const textParts = turn?.assistant_message?.parts.filter((p) => p.kind === "text");
    expect(textParts?.length).toBe(1);
    const firstText = textParts?.[0];
    if (firstText && typeof firstText === "object" && "content" in firstText) {
      expect(firstText.content).toBe("Hello, world!");
    }

    // Tool activity lifecycle
    expect(Object.keys(turn?.activities || {}).length).toBe(1);
    const activity = turn?.activities["tool-1"];
    expect(activity).toBeDefined();
    expect(activity?.status).toBe("success");
    expect(activity?.tool).toBe("read");
    expect(activity?.input).toEqual({ path: "file.txt" });

    // Tool use part in assistant message
    const toolUseParts = turn?.assistant_message?.parts.filter((p) => p.kind === "tool_use");
    expect(toolUseParts?.length).toBe(1);
  });

  test("provider failure results in TurnFailed canonical state", async () => {
    const { engine, dir } = setupTest([
      normalizeTurnStarted(),
      normalizeTextDelta("Starting..."),
      normalizeFailure("provider_timeout", "The Pi provider timed out"),
    ]);
    await createScope(engine, dir, "proj-fail", "th-fail");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-f",
      thread_id: "th-fail",
      turn_id: "turn-f",
      content: { text: "Do something" },
    });

    await waitForTerminalTurn(engine, "turn-f");

    const turn = engine.getTurn("turn-f");
    expect(turn).toBeDefined();
    expect(turn?.status).toBe("failed");
    expect(turn?.error).toBeDefined();
    expect(turn?.error?.code).toBe("provider_timeout");
    expect(turn?.error?.detail).toBe("The Pi provider timed out");
  });

  test("deterministic draining produces canonical domain events for all provider emissions", async () => {
    const { engine, dir } = setupTest([
      normalizeTurnStarted(),
      normalizeTextDelta("Delta 1..."),
      normalizeTextDelta("Delta 2..."),
      normalizeToolBegan("act-1", "bash", { command: "ls" }),
      normalizeToolCompleted("act-1", "success", "files"),
      normalizeMessageCompleted(),
      normalizeTurnCompleted(),
    ]);
    await createScope(engine, dir, "proj-drain", "th-drain");

    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-d",
      thread_id: "th-drain",
      turn_id: "turn-d",
      content: { text: "List files" },
    });

    await waitForTerminalTurn(engine, "turn-d");

    const kinds = engine.getEvents().map((e) => e.kind);
    expect(kinds).toContain("TurnQueued");
    expect(kinds).toContain("TurnStarted");
    expect(kinds).toContain("AssistantMessageDelta");
    expect(kinds).toContain("ToolActivityBegan");
    expect(kinds).toContain("ToolActivityCompleted");
    expect(kinds).toContain("AssistantMessageCompleted");
    expect(kinds).toContain("TurnCompleted");

    // Exactly 2 text deltas
    expect(kinds.filter((k) => k === "AssistantMessageDelta").length).toBe(2);

    // Snapshot reflects terminal state
    const snap = engine.getSnapshot();
    expect(snap.turns["turn-d"].status).toBe("completed");
  });

  test("turn notification scoping via subscription filtering", async () => {
    const providerEvents = [
      normalizeTurnStarted(),
      normalizeTextDelta("Done"),
      normalizeMessageCompleted(),
      normalizeTurnCompleted(),
    ];

    const providerService = new ProviderService();
    providerService.registerAdapter("pi", new TestProviderAdapter(providerEvents));
    const engine = new OrchestratorEngine(undefined, providerService);

    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), "labq-turn-test-"));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "labq-turn-test-2"));

    await createScope(engine, dir1, "proj-sub-a", "th-sub-a");
    await createScope(engine, dir2, "proj-sub-b", "th-sub-b");

    // Subscribe to project A only
    const captured: any[] = [];
    engine.subscribe(
      (e) => captured.push(e),
      { project_id: "proj-sub-a" },
      { emitInitialSnapshot: false }
    );

    // Submit turn to thread in project B
    await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-sub",
      thread_id: "th-sub-b",
      turn_id: "turn-sub-b",
      content: { text: "Test" },
    });

    await waitForTerminalTurn(engine, "turn-sub-b");

    // Project A subscriber should not receive any turn events from project B
    const turnEvents = captured.filter(
      (e) =>
        e.kind === "TurnQueued" ||
        e.kind === "TurnStarted" ||
        e.kind === "TurnCompleted"
    );
    expect(turnEvents.length).toBe(0);
  });
});

/* ───────── PiAdapter Normalization Tests ───────── */

describe("PiAdapter normalization", () => {
  test("validateImageBounds accepts valid images and rejects over-limit", () => {
    expect(validateImageBounds([])).toBeNull();
    expect(validateImageBounds(undefined as any)).toBeNull();

    const validB64 = Buffer.alloc(3).toString("base64");
    const five = Array.from({ length: 5 }, () => ({
      media_type: "image/png",
      data: validB64,
    }));
    expect(validateImageBounds(five)).toBeNull();

    const six = Array.from({ length: 6 }, () => ({
      media_type: "image/png",
      data: validB64,
    }));
    expect(validateImageBounds(six)).toContain("exceeds maximum of 5");
  });

  test("normalizers produce correct canonical event types and fields", () => {
    // Text delta
    const td = normalizeTextDelta("Hello");
    expect(td.kind).toBe("assistant_text_delta");
    if (td.kind === "assistant_text_delta") expect(td.text).toBe("Hello");

    // Tool began
    const tb = normalizeToolBegan("a1", "read", { p: "x" });
    expect(tb.kind).toBe("tool_activity_began");
    if (tb.kind === "tool_activity_began") {
      expect(tb.activity_id).toBe("a1");
      expect(tb.tool).toBe("read");
    }

    // Tool completed — success
    const tc1 = normalizeToolCompleted("a1", "success", "out");
    expect(tc1.kind).toBe("tool_activity_completed");
    if (tc1.kind === "tool_activity_completed") {
      expect(tc1.status).toBe("success");
      expect(tc1.output).toBe("out");
    }

    // Tool completed — failure
    const tc2 = normalizeToolCompleted("a2", "failure", undefined, "err");
    expect(tc2.kind).toBe("tool_activity_completed");
    if (tc2.kind === "tool_activity_completed") {
      expect(tc2.status).toBe("failure");
      expect(tc2.error).toBe("err");
    }

    // Tool completed — decline
    const tc3 = normalizeToolCompleted("a3", "decline");
    expect(tc3.kind).toBe("tool_activity_completed");
    if (tc3.kind === "tool_activity_completed") {
      expect(tc3.status).toBe("decline");
    }

    // Failure
    const f = normalizeFailure("err_code", "Something broke");
    expect(f.kind).toBe("provider_turn_failed");
    if (f.kind === "provider_turn_failed") {
      expect(f.code).toBe("err_code");
      expect(f.detail).toBe("Something broke");
    }

    // Lifecycle
    expect(normalizeTurnStarted().kind).toBe("provider_turn_started");
    expect(normalizeTurnCompleted().kind).toBe("provider_turn_completed");
    expect(normalizeMessageCompleted().kind).toBe("assistant_message_completed");
  });
});