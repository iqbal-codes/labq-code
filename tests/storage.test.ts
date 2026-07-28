import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { OrchestratorEngine } from "../src/engine/engine.js";
import { SourceManager } from "../src/source/source-manager.js";
import { InMemoryStorageAdapter } from "../src/engine/storage-adapter.js";
import type {
  DomainEvent,
  CommandReceipt,
  CommandResult,
  Command,
  Project,
  Thread,
  Turn,
  Snapshot,
} from "../src/domain/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEvent(seq: number, kind: string, data: Record<string, unknown> = {}): DomainEvent {
  return {
    sequence: seq,
    event_id: `evt-${seq}-test`,
    timestamp: new Date().toISOString(),
    command_id: "test-cmd",
    kind,
    data,
  } as unknown as DomainEvent;
}

function makeReceipt(
  commandId: string,
  ok: boolean,
  sequences: number[] = []
): CommandReceipt {
  return {
    command_id: commandId,
    result: ok
      ? { ok: true as const, project_id: "p1" }
      : { ok: false as const, code: "error", detail: "test error" },
    sequences,
  };
}

/** Access event data via unknown cast to avoid discriminated-union narrow errors in tests. */
function eventData(event: DomainEvent): Record<string, unknown> {
  return event.data as unknown as Record<string, unknown>;
}

// ─── InMemoryStorageAdapter Tests ────────────────────────────────────────────

describe("InMemoryStorageAdapter", () => {
  let adapter: InMemoryStorageAdapter;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
  });

  test("loadAll returns empty state for fresh adapter", async () => {
    const state = adapter.loadAll();
    expect(state.events).toEqual([]);
    expect(state.receipts.size).toBe(0);
    expect(state.nextSequence).toBe(1);
  });

  test("appendEvents stores events and makes them loadable", async () => {
    const e1 = makeEvent(1, "ProjectCreated", {
      project: { id: "p1", name: "Test" },
    });
    const e2 = makeEvent(2, "ThreadCreated", {
      thread: { id: "t1", project_id: "p1" },
    });

    await adapter.appendEvents([e1, e2]);
    const state = adapter.loadAll();
    expect(state.events).toHaveLength(2);
    expect(state.events[0].sequence).toBe(1);
    expect(state.events[1].sequence).toBe(2);
  });

  test("persistCommandResult stores events and receipt atomically", async () => {
    const events = [makeEvent(1, "ProjectCreated", { project: { id: "p1" } })];
    const receipt = makeReceipt("cmd-1", true, [1]);

    await adapter.persistCommandResult(events, receipt);
    const state = adapter.loadAll();
    expect(state.events).toHaveLength(1);
    expect(state.receipts.get("cmd-1")).toEqual(receipt);
  });

  test("storeReceipt persists receipt without events", async () => {
    const receipt = makeReceipt("error-cmd", false);
    await adapter.storeReceipt(receipt);
    const state = adapter.loadAll();
    expect(state.events).toHaveLength(0);
    expect(state.receipts.get("error-cmd")).toEqual(receipt);
  });
});

// ─── BunSqliteStorageAdapter Tests ───────────────────────────────────────────

describe("BunSqliteStorageAdapter", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `sqlite-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  });

  afterEach(() => {
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // cleanup best-effort
    }
  });

  test("loadAll returns empty state for fresh database", async () => {
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);
    const state = adapter.loadAll();
    expect(state.events).toEqual([]);
    expect(state.receipts.size).toBe(0);
    expect(state.nextSequence).toBe(1);
    adapter.close();
  });

  test("appendEvents persists and reconstructs events", async () => {
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);

    const events = [
      makeEvent(1, "ProjectCreated", { project: { id: "p1", name: "Proj A" } }),
      makeEvent(2, "ThreadCreated", { thread: { id: "t1", project_id: "p1", title: "Thread 1" } }),
    ];
    await adapter.appendEvents(events);
    adapter.close();

    // Re-open
    const adapter2 = new BunSqliteStorageAdapter(dbPath);
    const state = adapter2.loadAll();
    expect(state.events).toHaveLength(2);
    expect(state.events[0].kind).toBe("ProjectCreated");
    expect((eventData(state.events[0]).project as { id: string }).id).toBe("p1");
    expect(state.events[1].kind).toBe("ThreadCreated");
    expect((eventData(state.events[1]).thread as { title: string }).title).toBe("Thread 1");
    expect(state.nextSequence).toBe(3);
    adapter2.close();
  });

  test("persistCommandResult atomically stores events and receipt", async () => {
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);

    const events = [makeEvent(1, "ProjectCreated", { project: { id: "p1" } })];
    const receipt = makeReceipt("cmd-1", true, [1]);

    await adapter.persistCommandResult(events, receipt);
    adapter.close();

    // Re-open
    const adapter2 = new BunSqliteStorageAdapter(dbPath);
    const state = adapter2.loadAll();
    expect(state.events).toHaveLength(1);
    expect(state.receipts.get("cmd-1")?.command_id).toBe("cmd-1");
    expect(state.receipts.get("cmd-1")?.sequences).toEqual([1]);
    expect(state.receipts.get("cmd-1")?.result.ok).toBe(true);
    expect(state.nextSequence).toBe(2);
    adapter2.close();
  });

  test("storeReceipt persists error receipts without events", async () => {
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);

    const receipt = makeReceipt("err-cmd", false);
    await adapter.storeReceipt(receipt);
    adapter.close();

    // Re-open
    const adapter2 = new BunSqliteStorageAdapter(dbPath);
    const state = adapter2.loadAll();
    expect(state.events).toHaveLength(0);
    expect(state.receipts.get("err-cmd")?.result.ok).toBe(false);
    expect((state.receipts.get("err-cmd")?.result as { code: string }).code).toBe("error");
    expect(state.nextSequence).toBe(1);
    adapter2.close();
  });

  test("restart recovery: events and receipts survive process restart", async () => {
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);

    // Write multiple command results
    await adapter.persistCommandResult(
      [makeEvent(1, "ProjectCreated", { project: { id: "p1" } })],
      makeReceipt("cmd-1", true, [1])
    );
    await adapter.persistCommandResult(
      [makeEvent(2, "ThreadCreated", { thread: { id: "t1", project_id: "p1" } })],
      makeReceipt("cmd-2", true, [2])
    );
    await adapter.storeReceipt(makeReceipt("err-cmd", false));
    adapter.close();

    // Simulate restart
    const adapter2 = new BunSqliteStorageAdapter(dbPath);
    const state = adapter2.loadAll();
    expect(state.events).toHaveLength(2);
    expect(state.receipts.size).toBe(3);
    expect(state.nextSequence).toBe(3);
    adapter2.close();
  });

  test("event ordering is preserved across restarts", async () => {
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);

    const events = [
      makeEvent(1, "ProjectCreated", { project: { id: "p1" } }),
      makeEvent(2, "ThreadCreated", { thread: { id: "t1", project_id: "p1" } }),
      makeEvent(3, "TurnQueued", { turn: { id: "tn1", thread_id: "t1" } }),
      makeEvent(4, "TurnStarted", { turn_id: "tn1" }),
    ];
    await adapter.appendEvents(events);
    adapter.close();

    const adapter2 = new BunSqliteStorageAdapter(dbPath);
    const state = adapter2.loadAll();
    expect(state.events.map((e) => e.kind)).toEqual([
      "ProjectCreated",
      "ThreadCreated",
      "TurnQueued",
      "TurnStarted",
    ]);
    adapter2.close();
  });

  test("receipt idempotency: storing same receipt doesn't duplicate", async () => {
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);

    const receipt = makeReceipt("cmd-1", true, [1]);
    await adapter.storeReceipt(receipt);
    await adapter.storeReceipt(receipt); // same command_id
    adapter.close();

    const adapter2 = new BunSqliteStorageAdapter(dbPath);
    const state = adapter2.loadAll();
    expect(state.receipts.size).toBe(1);
    adapter2.close();
  });

  test("failure rollback: partial persistCommandResult does not leave torn state", async () => {
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);

    // Write a valid command first
    await adapter.persistCommandResult(
      [makeEvent(1, "ProjectCreated", { project: { id: "p1" } })],
      makeReceipt("cmd-1", true, [1])
    );

    // Attempt a persistCommandResult with a DUPLICATE sequence (violates UNIQUE).
    // The transaction should roll back the entire persistCommandResult, leaving
    // only cmd-1's state.
    const dupResult = adapter.persistCommandResult(
      [makeEvent(1, "ProjectCreated", { project: { id: "p2" } })],
      makeReceipt("cmd-2", true, [1])
    );
    await expect(dupResult).rejects.toThrow();

    // Verify only cmd-1's data survives — cmd-2's events and receipt both rolled back
    const state = adapter.loadAll();
    expect(state.events).toHaveLength(1);
    expect(state.events[0].sequence).toBe(1);
    expect(state.receipts.has("cmd-1")).toBe(true);
    expect(state.receipts.has("cmd-2")).toBe(false);
    expect(state.nextSequence).toBe(2);
    adapter.close();
  });
});

// ─── Engine Recovery Tests ───────────────────────────────────────────────────

describe("Engine recovery with SQLite storage", () => {
  let dbPath: string;
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-storage-test-"));
    tempDirs.push(dir);
    return dir;
  }

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `engine-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  });

  afterEach(() => {
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // best-effort cleanup
    }
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
    tempDirs.length = 0;
  });

  async function createEngine(): Promise<OrchestratorEngine> {
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);
    return new OrchestratorEngine(undefined, undefined, adapter);
  }

  test("fresh engine has empty snapshot and default catalog", async () => {
    const engine = await createEngine();
    const snap = engine.getSnapshot();
    expect(snap.sequence).toBe(0);
    expect(Object.keys(snap.projects)).toHaveLength(0);
    expect(Object.keys(snap.threads)).toHaveLength(0);
    expect(Object.keys(snap.turns)).toHaveLength(0);
    expect(snap.catalog.models.length).toBeGreaterThan(0);
  });

  test("engine persists and recovers project and thread", async () => {
    const wsDir = makeTempDir();
    let engine = await createEngine();

    // Create a project
    const createResult = await engine.dispatchCommand({
      kind: "create_project",
      name: "Test Project",
      source: { kind: "local_folder", path: wsDir },
      command_id: "cmd-create-1",
    } as Command);
    expect(createResult.ok).toBe(true);

    // Create a thread
    const pid = (createResult as { project_id?: string }).project_id || "";
    const threadResult = await engine.dispatchCommand({
      kind: "create_thread",
      project_id: pid,
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
      command_id: "cmd-create-2",
      title: "Test Thread",
    } as Command);
    expect(threadResult.ok).toBe(true);

    // Shut down engine (discard in-memory state) by creating a fresh engine from the same DB
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);
    engine = new OrchestratorEngine(undefined, undefined, adapter);

    // Recovered engine should have project + thread
    const projects = engine.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Test Project");

    const threads = engine.listThreads(projects[0].id);
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe("Test Thread");
  });

  test("recovery preserves receipt idempotency", async () => {
    const wsDir = makeTempDir();
    let engine = await createEngine();

    const result1 = await engine.dispatchCommand({
      kind: "create_project",
      name: "Idempotent Project",
      source: { kind: "local_folder", path: wsDir },
      command_id: "idem-cmd-1",
    } as Command);
    expect(result1.ok).toBe(true);

    // Shut down and restart
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);
    engine = new OrchestratorEngine(undefined, undefined, adapter);

    // Repeat the same command — should return original result, not duplicate
    const result2 = await engine.dispatchCommand({
      kind: "create_project",
      name: "Idempotent Project",
      source: { kind: "local_folder", path: wsDir },
      command_id: "idem-cmd-1",
    } as Command);
    expect(result2.ok).toBe(true);
    expect((result2 as { duplicate?: boolean }).duplicate).toBe(true);

    // Only 1 project should exist
    const projects = engine.listProjects();
    expect(projects).toHaveLength(1);
  });

  test("rebuild from history produces identical snapshot to live projection", async () => {
    const wsDir = makeTempDir();
    let engine = await createEngine();

    const result1 = await engine.dispatchCommand({
      kind: "create_project",
      name: "Rebuild Test",
      source: { kind: "local_folder", path: wsDir },
      command_id: "rebuild-cmd-1",
    } as Command);
    expect(result1.ok).toBe(true);

    // Shut down and restart
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);
    engine = new OrchestratorEngine(undefined, undefined, adapter);

    // Live snapshot
    const liveSnap = engine.getSnapshot();
    // Rebuild from persisted events
    const rebuiltSnap = engine.rebuildSnapshotFromHistory();

    expect(liveSnap.sequence).toBe(rebuiltSnap.sequence);
    const liveKeys = Object.keys(liveSnap.projects);
    const rebuiltKeys = Object.keys(rebuiltSnap.projects);
    expect(liveKeys).toEqual(rebuiltKeys);
    if (liveKeys.length > 0) {
      expect(liveSnap.projects[liveKeys[0]].name).toBe(
        rebuiltSnap.projects[rebuiltKeys[0]].name
      );
    }
  });

  test("latest sequence matches persisted event count", async () => {
    const wsDir = makeTempDir();
    let engine = await createEngine();

    await engine.dispatchCommand({
      kind: "create_project",
      name: "Seq Test",
      source: { kind: "local_folder", path: wsDir },
      command_id: "seq-cmd-1",
    } as Command);

    const snap1 = engine.getSnapshot();
    expect(snap1.sequence).toBeGreaterThan(0);

    // Restart
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);
    engine = new OrchestratorEngine(undefined, undefined, adapter);

    const snap2 = engine.getSnapshot();
    expect(snap2.sequence).toBe(snap1.sequence);
  });

  test("error receipt recovery: failed command receipts survive restart", async () => {
    let engine = await createEngine();

    // Dispatch a command that will fail (empty path)
    const result = await engine.dispatchCommand({
      kind: "create_project",
      name: "Bad Source",
      source: { kind: "local_folder", path: "" },
      command_id: "err-cmd-1",
    } as Command);
    expect(result.ok).toBe(false);

    // Restart
    const { BunSqliteStorageAdapter } = await import("../src/engine/sqlite-adapter.js");
    const adapter = new BunSqliteStorageAdapter(dbPath);
    engine = new OrchestratorEngine(undefined, undefined, adapter);

    // Repeat error command — should return original error as duplicate
    const repeatResult = await engine.dispatchCommand({
      kind: "create_project",
      name: "Bad Source",
      source: { kind: "local_folder", path: "" },
      command_id: "err-cmd-1",
    } as Command);
    expect(repeatResult.ok).toBe(false);
    expect((repeatResult as { duplicate?: boolean }).duplicate).toBe(true);
  });
});