import { describe, test, expect, afterEach } from "bun:test";
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
  boundChangeSummary,
  MAX_SUMMARY_FILES,
  MAX_DIFF_HUNK_BYTES,
  ChangeSummary,
} from "../src/domain/types.js";
import {
  DEFAULT_PI_CATALOG,
  getPiProviderCapabilities,
  isCapabilitySupported,
  deriveTurnReviewState,
  canPerformRollback,
  canPerformCheckpoint,
  canUsePlanMode,
} from "../src/catalog/pi-catalog.js";
import { deriveChangeSummaryFromToolActivities } from "../src/engine/projector.js";

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-test-cap-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {}
  }
  tmpDirs = [];
});

class CustomTestAdapter implements ProviderAdapter {
  constructor(private eventsToYield: CanonicalProviderEvent[]) {}

  async *startTurn(_params: StartTurnParams): AsyncIterable<CanonicalProviderEvent> {
    for (const evt of this.eventsToYield) {
      yield evt;
    }
  }

  async respondToRequest(_params: RespondToRequestParams): Promise<void> {}
  async interruptTurn(_params: InterruptTurnParams): Promise<void> {}
  async stopTurn(_params: StopTurnParams): Promise<void> {}
}

async function setupEngineWithEvents(events: CanonicalProviderEvent[]) {
  const workspaceDir = makeTmpDir();
  const ps = new ProviderService();
  ps.registerAdapter("pi", new CustomTestAdapter(events));

  const engine = new OrchestratorEngine(undefined, ps);

  // 1. Create project
  const pRes = await engine.dispatchCommand({
    kind: "create_project",
    command_id: "cmd-proj-1",
    name: "Cap Test Proj",
    source: { kind: "local_folder", path: workspaceDir },
  });
  const projId = pRes.ok ? pRes.project_id! : "";

  // 2. Create thread
  const tRes = await engine.dispatchCommand({
    kind: "create_thread",
    command_id: "cmd-thread-1",
    project_id: projId,
    model: "pi-default",
    access_profile: "workspace-write",
    interaction_mode: "execute",
  });
  const threadId = tRes.ok ? tRes.thread_id! : "";

  return { engine, projId, threadId, workspaceDir };
}

describe("06 — Canonical Plans, Diffs, and Checkpoints", () => {
  test("Canonical change summaries are associated with originating turn in snapshot and event history", async () => {

    const testSummary: ChangeSummary = {
      turn_id: "", // Engine/adapter fills this
      files: [
        {
          path: "src/index.ts",
          kind: "modified",
          additions: 10,
          deletions: 2,
          diff_hunk: "@@ -1,2 +1,10 @@\n+const x = 42;",
        },
      ],
      total_additions: 10,
      total_deletions: 2,
      created_at: new Date().toISOString(),
    };

    const events: CanonicalProviderEvent[] = [
      { kind: "provider_turn_started" },
      { kind: "change_summary", summary: testSummary },
      { kind: "provider_turn_completed" },
    ];

    const { engine, threadId } = await setupEngineWithEvents(events);

    // Subscribe to TurnCompleted to wait deterministically
    const { promise: turnFinished, resolve: resolveTurn } = Promise.withResolvers<void>();
    engine.subscribe((evt) => {
      if (evt.kind === "TurnCompleted") resolveTurn();
    });

    // Start turn
    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-1",
      thread_id: threadId,
      content: { text: "Refactor index.ts" },
    });
    expect(turnRes.ok).toBe(true);
    const turnId = turnRes.ok ? turnRes.turn_id! : "";

    await turnFinished;
    // Verify snapshot turn state
    const snapshot = engine.getSnapshot();
    const turn = snapshot.turns[turnId];
    expect(turn).toBeDefined();
    expect(turn.change_summary).toBeDefined();
    expect(turn.change_summary?.turn_id).toBe(turnId);
    expect(turn.change_summary?.files).toHaveLength(1);
    expect(turn.change_summary?.files[0].path).toBe("src/index.ts");
    expect(turn.change_summary?.total_additions).toBe(10);
    expect(turn.change_summary?.total_deletions).toBe(2);

    // Verify event history contains ChangeSummaryEmitted with turn_id attached
    const summaryEvents = engine.getEvents().filter((e) => e.kind === "ChangeSummaryEmitted");
    expect(summaryEvents).toHaveLength(1);
    const summaryEvt = summaryEvents[0];
    if (summaryEvt.kind === "ChangeSummaryEmitted") {
      expect(summaryEvt.data.turn_id).toBe(turnId);
      expect(summaryEvt.data.summary.turn_id).toBe(turnId);
    }
    const rebuilt = engine.rebuildSnapshotFromHistory();
    expect(rebuilt.turns[turnId].change_summary).toEqual(turn.change_summary);
  });

  test("Bounded change summaries enforce MAX_SUMMARY_FILES and MAX_DIFF_HUNK_BYTES", () => {

    const manyFiles = Array.from({ length: 80 }, (_, i) => ({
      path: `file_${i}.txt`,
      kind: "created" as const,
      additions: 5,
      deletions: 0,
      diff_hunk: "x".repeat(5000), // Larger than MAX_DIFF_HUNK_BYTES
    }));

    const hugeSummary: ChangeSummary = {
      turn_id: "turn-1",
      files: manyFiles,
      total_additions: 400,
      total_deletions: 0,
      created_at: new Date().toISOString(),
    };

    const bounded = boundChangeSummary(hugeSummary);

    // Max files capped at 50
    expect(bounded.files.length).toBe(MAX_SUMMARY_FILES);
    expect(bounded.files.length).toBe(50);
    // Total additions/deletions recalculated for bounded files (50 * 5 = 250)
    expect(bounded.total_additions).toBe(250);

    // Diff hunks truncated
    for (const f of bounded.files) {
      expect(f.diff_hunk).toBeDefined();
      expect(f.diff_hunk!.endsWith("... [diff hunk truncated]")).toBe(true);
      expect(f.diff_hunk!.length).toBeLessThan(MAX_DIFF_HUNK_BYTES + 30);
    }
  });

  test("Change summaries are derived from edit and write tool activities when provider doesn't emit change events", async () => {

    const events: CanonicalProviderEvent[] = [
      { kind: "provider_turn_started" },
      {
        kind: "tool_activity_began",
        activity_id: "act-1",
        tool: "write",
        input: { path: "src/app.ts", content: "console.log('hello');\nconsole.log('world');" },
      },
      {
        kind: "tool_activity_completed",
        activity_id: "act-1",
        status: "success",
        output: "File written successfully",
      },
      {
        kind: "tool_activity_began",
        activity_id: "act-2",
        tool: "edit",
        input: { path: "src/app.ts", diff: "+ console.log('extra');\n- console.log('world');" },
      },
      {
        kind: "tool_activity_completed",
        activity_id: "act-2",
        status: "success",
        output: "Edit applied successfully",
      },
      { kind: "provider_turn_completed" },
    ];

    const { engine, threadId } = await setupEngineWithEvents(events);

    const { promise: turnFinished, resolve: resolveTurn } = Promise.withResolvers<void>();
    engine.subscribe((evt) => {
      if (evt.kind === "TurnCompleted") resolveTurn();
    });

    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "cmd-turn-tools",
      thread_id: threadId,
      content: { text: "Write and edit app.ts" },
    });
    expect(turnRes.ok).toBe(true);
    const turnId = turnRes.ok ? turnRes.turn_id! : "";

    await turnFinished;
    const turn = engine.getSnapshot().turns[turnId];
    expect(turn).toBeDefined();
    expect(turn.change_summary).toBeDefined();
    expect(turn.change_summary?.files.some((f) => f.path === "src/app.ts")).toBe(true);
    expect(turn.change_summary?.total_additions).toBeGreaterThan(0);
  });

  test("Provider capabilities explicitly identify plan mode, diff, checkpoint, and rollback", () => {

    const caps = getPiProviderCapabilities();
    expect(caps.provider_name).toBe("pi");

    // Plan mode is unsupported in Pi v1
    expect(caps.capabilities.plan_mode.supported).toBe(false);
    expect(caps.capabilities.plan_mode.read_only).toBe(true);
    expect(isCapabilitySupported("plan_mode")).toBe(false);

    // Diff / change summaries are supported (read-only)
    expect(caps.capabilities.diff.supported).toBe(true);
    expect(caps.capabilities.diff.read_only).toBe(true);
    expect(isCapabilitySupported("diff")).toBe(true);

    // Checkpoints are unsupported
    expect(caps.capabilities.checkpoint.supported).toBe(false);
    expect(caps.capabilities.checkpoint.read_only).toBe(true);
    expect(isCapabilitySupported("checkpoint")).toBe(false);

    // Rollback is unsupported
    expect(caps.capabilities.rollback.supported).toBe(false);
    expect(caps.capabilities.rollback.read_only).toBe(true);
    expect(isCapabilitySupported("rollback")).toBe(false);

    // Catalog exposes capabilities array
    expect(DEFAULT_PI_CATALOG.capabilities).toHaveLength(4);
  });

  test("Pi v1 turn review state is read-only and explicitly rejects rollback/checkpoint operations", () => {

    const mockTurn = {
      id: "turn-review-1",
      environment_id: "default-env",
      project_id: "proj-1",
      thread_id: "thread-1",
      provider_name: "pi" as const,
      provider_instance_id: "pi-default" as const,
      status: "completed" as const,
      user_message: { text: "Make changes" },
      activities: {},
      change_summary: {
        turn_id: "turn-review-1",
        files: [{ path: "file.ts", kind: "modified" as const, additions: 2, deletions: 1 }],
        total_additions: 2,
        total_deletions: 1,
        created_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Review state derivation
    const reviewState = deriveTurnReviewState(mockTurn);
    expect(reviewState.turn_id).toBe("turn-review-1");
    expect(reviewState.read_only).toBe(true);
    expect(reviewState.supports_checkpoint).toBe(false);
    expect(reviewState.supports_rollback).toBe(false);
    expect(reviewState.unsupported_operations).toEqual(["plan_mode", "checkpoint", "rollback"]);
    expect(reviewState.change_summary).toBeDefined();

    // Rollback rejection
    const rbCheck = canPerformRollback();
    expect(rbCheck.allowed).toBe(false);
    expect(rbCheck.reason).toContain("unsupported");

    // Checkpoint rejection
    const cpCheck = canPerformCheckpoint();
    expect(cpCheck.allowed).toBe(false);
    expect(cpCheck.reason).toContain("unsupported");

    // Plan mode rejection
    const planCheck = canUsePlanMode();
    expect(planCheck.allowed).toBe(false);
    expect(planCheck.reason).toContain("unsupported");
  });
});
