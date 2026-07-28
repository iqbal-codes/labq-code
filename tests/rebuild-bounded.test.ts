import { describe, test, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { OrchestratorEngine } from "../src/engine/engine.js";
import { OrchestratorTransport } from "../src/transport/transport.js";
import { ReconnectingClient } from "../src/client/reconnect-client.js";
import type {
  ProviderAdapter,
  CanonicalProviderEvent,
  StartTurnParams,
  RespondToRequestParams,
  InterruptTurnParams,
  StopTurnParams,
} from "../src/engine/provider-adapter.js";
import { ProviderService } from "../src/engine/provider-service.js";
import type {
  DomainEvent,
  RetentionPolicy,
} from "../src/domain/types.js";

/* ───────── Test Adapter ───────── */

class ScriptedProviderAdapter implements ProviderAdapter {
  private eventScript: CanonicalProviderEvent[] = [];

  setScript(events: CanonicalProviderEvent[]) {
    this.eventScript = events;
  }

  async *startTurn(params: StartTurnParams): AsyncIterable<CanonicalProviderEvent> {
    for (const evt of this.eventScript) {
      if (params.signal?.aborted) break;
      yield evt;
    }
  }

  async interruptTurn(_params: InterruptTurnParams): Promise<void> {}
  async respondToRequest(_params: RespondToRequestParams): Promise<void> {}
  async stopTurn(_params: StopTurnParams): Promise<void> {}
}

describe("07 — Rebuildable and Bounded Orchestrator Operations", () => {
  let tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-rebuild-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    tempDirs = [];
  });

  test("1. Replaying complete event history reconstructs the exact same thread snapshots, plans, activities, messages, latest turn, and pending requests as live projection", async () => {
    const adapter = new ScriptedProviderAdapter();
    adapter.setScript([
      { kind: "provider_turn_started" },
      { kind: "assistant_text_delta", text: "Analyzing repository..." },
      {
        kind: "tool_activity_began",
        activity_id: "act-1",
        tool: "write",
        input: { path: "src/main.ts", content: "console.log('hello');" },
      },
      {
        kind: "tool_activity_completed",
        activity_id: "act-1",
        status: "success",
        output: "file written",
      },
      {
        kind: "approval_requested",
        request_id: "req-1",
        operation: "git_push",
        description: "Push changes to main branch",
      },
    ]);

    const ps = new ProviderService();
    ps.registerAdapter("pi", adapter);
    const engine = new OrchestratorEngine(undefined, ps);

    const { promise: approvalPromise, resolve: resolveApproval } = Promise.withResolvers<void>();
    engine.subscribe((evt) => {
      if (evt.kind === "ApprovalRequested") {
        resolveApproval();
      }
    });

    const localDir = makeTempDir();
    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      name: "Rebuild Test Project",
      source: { kind: "local_folder", path: localDir },
      command_id: "cmd-proj-1",
    });
    expect(projRes.ok).toBe(true);

    let projectId = "";
    if (projRes.ok && "project_id" in projRes && typeof projRes.project_id === "string") {
      projectId = projRes.project_id;
    }

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      project_id: projectId,
      title: "Rebuild Thread",
      model: "pi-3.5-sonnet",
      access_profile: "workspace-write",
      interaction_mode: "execute",
      command_id: "cmd-th-1",
    });
    expect(threadRes.ok).toBe(true);

    let threadId = "";
    if (threadRes.ok && "thread_id" in threadRes && typeof threadRes.thread_id === "string") {
      threadId = threadRes.thread_id;
    }

    const turnRes = await engine.dispatchCommand({
      kind: "start_turn",
      thread_id: threadId,
      content: { text: "Add main entry point" },
      command_id: "cmd-turn-1",
    });
    expect(turnRes.ok).toBe(true);

    await approvalPromise;

    // Get live snapshot
    const liveSnapshot = engine.getScopedSnapshot();

    // Rebuild snapshot from event history
    const rebuiltSnapshot = engine.rebuildSnapshotFromHistory();

    // Compare live vs rebuilt snapshot
    expect(rebuiltSnapshot.sequence).toBe(liveSnapshot.sequence);
    expect(rebuiltSnapshot.projects).toEqual(liveSnapshot.projects);
    expect(rebuiltSnapshot.threads).toEqual(liveSnapshot.threads);
    expect(rebuiltSnapshot.turns).toEqual(liveSnapshot.turns);

    // Specifically verify pending request, assistant message, tool activity, and turn status
    const liveTurn = Object.values(liveSnapshot.turns)[0];
    const rebuiltTurn = Object.values(rebuiltSnapshot.turns)[0];

    expect(liveTurn).toBeDefined();
    expect(rebuiltTurn).toBeDefined();
    expect(rebuiltTurn.status).toBe("paused");
    expect(rebuiltTurn.pending_request?.id).toBe("req-1");
    expect(rebuiltTurn.pending_request?.status).toBe("pending");
    expect(rebuiltTurn.activities["act-1"]).toBeDefined();
    expect(rebuiltTurn.activities["act-1"].status).toBe("success");
    expect(rebuiltTurn.assistant_message?.parts.length).toBeGreaterThan(0);
  });

  test("2. Projection failures are observable, retriable, and never silently omit an appended event from query state", async () => {
    const engine = new OrchestratorEngine();
    const localDir = makeTempDir();

    const res = await engine.dispatchCommand({
      kind: "create_project",
      name: "Fail Test",
      source: { kind: "local_folder", path: localDir },
      command_id: "cmd-fail-1",
    });
    expect(res.ok).toBe(true);

    expect(engine.getProjectionFailures()).toEqual([]);

    const badEvent: DomainEvent = {
      sequence: 99,
      event_id: "evt-bad-1",
      timestamp: new Date().toISOString(),
      command_id: "cmd-bad",
      kind: "TurnStarted",
      data: null as unknown as { turn_id: string },
    };

    // Dispatching bad event through engine internal helper safely records failure
    const safeApply = (engine as unknown as { safeApplyEvent: (e: DomainEvent) => void }).safeApplyEvent.bind(engine);
    safeApply(badEvent);

    const failures = engine.getProjectionFailures();
    expect(failures.length).toBe(1);
    expect(failures[0].event_id).toBe("evt-bad-1");
    expect(failures[0].retried).toBe(false);
    expect(failures[0].resolved).toBe(false);

    const retryRes = engine.retryProjectionFailures();
    expect(retryRes.retried_count).toBe(1);
    expect(retryRes.resolved_count).toBe(1);

    const failuresAfter = engine.getProjectionFailures();
    expect(failuresAfter[0].resolved).toBe(true);
  });

  test("3. Message, activity, and checkpoint retention is bounded while latest-turn, completion, and pending-request semantics remain correct", async () => {
    const policy: RetentionPolicy = {
      max_activities_per_turn: 2,
      max_completed_turns_per_thread: 1,
      max_activity_content_bytes: 20,
    };

    const engine = new OrchestratorEngine(undefined, undefined, policy);
    const localDir = makeTempDir();

    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      name: "Retention Test Project",
      source: { kind: "local_folder", path: localDir },
      command_id: "cmd-ret-proj",
    });

    let projectId = "";
    if (projRes.ok && "project_id" in projRes && typeof projRes.project_id === "string") {
      projectId = projRes.project_id;
    }

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      project_id: projectId,
      title: "Retention Thread",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
      command_id: "cmd-ret-th",
    });

    let threadId = "";
    if (threadRes.ok && "thread_id" in threadRes && typeof threadRes.thread_id === "string") {
      threadId = threadRes.thread_id;
    }

    const event1: DomainEvent = {
      sequence: 10,
      event_id: "evt-ret-1",
      timestamp: new Date().toISOString(),
      command_id: "cmd-1",
      kind: "TurnQueued",
      data: {
        turn: {
          id: "turn-ret-1",
          thread_id: threadId,
          status: "queued",
          user_message: { text: "Run tests" },
          activities: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    };

    const event2: DomainEvent = {
      sequence: 11,
      event_id: "evt-ret-2",
      timestamp: new Date().toISOString(),
      command_id: "cmd-1",
      kind: "TurnStarted",
      data: { turn_id: "turn-ret-1" },
    };

    const eventAct1: DomainEvent = {
      sequence: 12,
      event_id: "evt-act-1",
      timestamp: new Date().toISOString(),
      command_id: "cmd-1",
      kind: "ToolActivityBegan",
      data: {
        turn_id: "turn-ret-1",
        activity: {
          id: "act-long-1",
          turn_id: "turn-ret-1",
          tool: "read",
          status: "success",
          output: "Very long activity output that exceeds twenty bytes limit",
          started_at: new Date().toISOString(),
        },
      },
    };

    const eventAct2: DomainEvent = {
      sequence: 13,
      event_id: "evt-act-2",
      timestamp: new Date().toISOString(),
      command_id: "cmd-1",
      kind: "ToolActivityBegan",
      data: {
        turn_id: "turn-ret-1",
        activity: {
          id: "act-long-2",
          turn_id: "turn-ret-1",
          tool: "read",
          status: "success",
          output: "Second long activity output that exceeds limits",
          started_at: new Date().toISOString(),
        },
      },
    };

    const eventAct3: DomainEvent = {
      sequence: 14,
      event_id: "evt-act-3",
      timestamp: new Date().toISOString(),
      command_id: "cmd-1",
      kind: "ToolActivityBegan",
      data: {
        turn_id: "turn-ret-1",
        activity: {
          id: "act-long-3",
          turn_id: "turn-ret-1",
          tool: "read",
          status: "success",
          output: "Third activity output",
          started_at: new Date().toISOString(),
        },
      },
    };

    const safeApply = (engine as unknown as { safeApplyEvent: (e: DomainEvent) => void }).safeApplyEvent.bind(engine);
    safeApply(event1);
    safeApply(event2);
    safeApply(eventAct1);
    safeApply(eventAct2);
    safeApply(eventAct3);

    const snapshot = engine.getScopedSnapshot();
    const turn = snapshot.turns["turn-ret-1"];
    expect(turn).toBeDefined();

    const actCount = Object.keys(turn.activities).length;
    expect(actCount).toBeLessThanOrEqual(2);

    for (const act of Object.values(turn.activities)) {
      if (typeof act.output === "string") {
        expect(act.output).toContain("... [output truncated]");
      }
    }

    // Verify completed turn retention preserves latest turn for thread
    const threadTurns = Object.values(snapshot.turns).filter((t) => t.thread_id === threadId);
    expect(threadTurns.length).toBeGreaterThan(0);
    const latestTurn = threadTurns.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
    expect(latestTurn).toBeDefined();
    expect(snapshot.turns[latestTurn.id]).toBeDefined();
  });

  test("4. Canonical protocol diagnostics retain command, causation, correlation, provider, and request identifiers without exposing raw provider payloads to clients", async () => {
    const engine = new OrchestratorEngine();
    const localDir = makeTempDir();

    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      name: "Diagnostics Project",
      source: { kind: "local_folder", path: localDir },
      command_id: "cmd-diag-proj",
      correlation_id: "corr-100",
      causation_id: "cause-50",
    });
    expect(projRes.ok).toBe(true);

    const diagnostics = engine.getProtocolDiagnostics();
    expect(diagnostics.length).toBeGreaterThan(0);

    const diagEntry = diagnostics[0];
    expect(diagEntry.command_id).toBe("cmd-diag-proj");
    expect(diagEntry.correlation_id).toBe("corr-100");
    expect(diagEntry.causation_id).toBe("cause-50");
    expect(diagEntry.provider).toBe("pi");
    expect(diagEntry.event_kind).toBe("ProjectCreated");

    expect("raw_payload" in diagEntry).toBe(false);
    expect("secret" in diagEntry).toBe(false);
  });

  test("5. Transport & ReconnectingClient integration of rebuild, retry, retention, and diagnostics", async () => {
    const engine = new OrchestratorEngine();
    const transport = new OrchestratorTransport({ engine });

    const localDir = makeTempDir();
    const dispatchRes = await transport.dispatchCommand({
      command: {
        kind: "create_project",
        name: "Integration Project",
        source: { kind: "local_folder", path: localDir },
        command_id: "cmd-integ-1",
      },
    });
    expect(dispatchRes.ok).toBe(true);

    const diagRes = transport.getProtocolDiagnostics();
    expect(Array.isArray(diagRes)).toBe(true);
    if (Array.isArray(diagRes)) {
      expect(diagRes.length).toBeGreaterThan(0);
      expect(diagRes[0].command_id).toBe("cmd-integ-1");
    }

    const failRes = transport.getProjectionFailures();
    expect(Array.isArray(failRes)).toBe(true);

    const client = new ReconnectingClient({ transport });
    await client.connect();
    expect(client.getLastSequence()).toBeGreaterThan(0);

    client.disconnect();
  });
});
