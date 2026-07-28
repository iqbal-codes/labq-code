import { describe, test, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { OrchestratorEngine } from "../src/engine/engine.js";
import { SourceManager } from "../src/source/source-manager.js";

describe("OrchestratorEngine", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-engine-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    tempDirs.length = 0;
  });

  test("creates project and thread with curated model, access profile, and execute mode", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();

    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-p1",
      name: "My Project",
      source: { kind: "local_folder", path: localDir },
    });

    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;

    const projectId = projRes.project_id!;
    expect(projectId).toBeDefined();

    const proj = engine.getProject(projectId);
    expect(proj).toBeDefined();
    expect(proj?.name).toBe("My Project");
    expect(proj?.source.kind).toBe("local_folder");
    expect(proj?.source.status).toBe("bound");

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-t1",
      project_id: projectId,
      title: "Initial Task",
      model: "pi-3.5-sonnet",
      access_profile: "workspace-write",
      interaction_mode: "execute",
    });

    expect(threadRes.ok).toBe(true);
    if (!threadRes.ok) return;

    const threadId = threadRes.thread_id!;
    const thread = engine.getThread(threadId);
    expect(thread).toBeDefined();
    expect(thread?.model).toBe("pi-3.5-sonnet");
    expect(thread?.access_profile).toBe("workspace-write");
    expect(thread?.interaction_mode).toBe("execute");
  });
  test("advertises only Pi execute mode in fresh durable snapshots", () => {
    const engine = new OrchestratorEngine();

    expect(engine.getSnapshot().catalog.interaction_modes).toEqual([
      {
        mode: "execute",
        supported: true,
        description: "Direct execution mode for interactive coding tasks.",
      },
    ]);
  });

  test("rejects thread lifecycle mutation after project tombstoning", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "project-for-tombstone",
      project_id: "tombstone-project",
      name: "Tombstone Project",
      source: { kind: "local_folder", path: localDir },
    });
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "thread-for-tombstone",
      thread_id: "tombstone-thread",
      project_id: "tombstone-project",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    await engine.dispatchCommand({
      kind: "delete_project",
      command_id: "tombstone-project-delete",
      project_id: "tombstone-project",
    });

    const result = await engine.dispatchCommand({
      kind: "archive_thread",
      command_id: "tombstone-thread-archive",
      thread_id: "tombstone-thread",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_project_state");
    }
    expect(engine.getEvents()).toHaveLength(3);
  });

  test("rejects approval decisions outside the canonical enum", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();
    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "approval-project",
      project_id: "approval-project",
      name: "Approval Project",
      source: { kind: "local_folder", path: localDir },
    });

    const result = await engine.dispatchCommand({
      kind: "respond_approval",
      command_id: "invalid-approval",
      turn_id: "missing-turn",
      thread_id: "missing-thread",
      request_id: "missing-request",
      decision: "maybe",
    } as any);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_command");
    }
    expect(engine.getEvents()).toHaveLength(1);
  });
  test("rejects malformed commands without changing durable state", async () => {
    const engine = new OrchestratorEngine();
    const before = engine.getSnapshot();

    const result = await engine.dispatchCommand({
      kind: "start_turn",
      command_id: "malformed-turn",
      thread_id: "missing-thread",
      content: undefined,
    } as any);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_command");
    }
    expect(engine.getEvents()).toEqual([]);
    expect(engine.getSnapshot()).toEqual(before);
  });

  test("rejects thread creation with unsupported interaction mode 'plan'", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();

    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-p1",
      name: "My Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;
    const projectId = projRes.project_id!;

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-t-plan",
      project_id: projectId,
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "plan" as any,
    });

    expect(threadRes.ok).toBe(false);
    if (!threadRes.ok) {
      expect(threadRes.code).toBe("invalid_interaction_mode");
    }
  });

  test("rejects invalid model or access profile", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();

    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-p1",
      name: "My Project",
      source: { kind: "local_folder", path: localDir },
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;
    const projectId = projRes.project_id!;

    const invalidModelRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-t-inv-mod",
      project_id: projectId,
      model: "invalid-model-xyz" as any,
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    expect(invalidModelRes.ok).toBe(false);
    if (!invalidModelRes.ok) expect(invalidModelRes.code).toBe("invalid_model");

    const invalidAccessRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-t-inv-acc",
      project_id: projectId,
      model: "pi-default",
      access_profile: "root-admin-mode" as any,
      interaction_mode: "execute",
    });
    expect(invalidAccessRes.ok).toBe(false);
    if (!invalidAccessRes.ok) expect(invalidAccessRes.code).toBe("invalid_access_profile");
  });

  test("supports multiple projects and threads with independent aggregate identity", async () => {
    const dir1 = makeTempDir();
    const dir2 = makeTempDir();
    const engine = new OrchestratorEngine();

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      project_id: "proj-1",
      name: "Project One",
      source: { kind: "local_folder", path: dir1 },
    });
    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p2",
      project_id: "proj-2",
      name: "Project Two",
      source: { kind: "local_folder", path: dir2 },
    });

    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t1",
      thread_id: "th-1",
      project_id: "proj-1",
      title: "Thread 1",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t2",
      thread_id: "th-2",
      project_id: "proj-2",
      title: "Thread 2",
      model: "pi-3-opus",
      access_profile: "full-execution",
      interaction_mode: "execute",
    });

    expect(engine.listProjects().length).toBe(2);
    expect(engine.listThreads("proj-1").length).toBe(1);
    expect(engine.listThreads("proj-2").length).toBe(1);
    expect(engine.getThread("th-1")?.project_id).toBe("proj-1");
    expect(engine.getThread("th-2")?.project_id).toBe("proj-2");
  });

  test("enforces lifecycle transitions and creates tombstones without deleting local files", async () => {
    const dir = makeTempDir();
    const dummyFile = path.join(dir, "source_code.txt");
    fs.writeFileSync(dummyFile, "const x = 1;");

    const engine = new OrchestratorEngine();

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      project_id: "proj-lifecycle",
      name: "Lifecycle Proj",
      source: { kind: "local_folder", path: dir },
    });
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t1",
      thread_id: "th-lifecycle",
      project_id: "proj-lifecycle",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });

    // Valid transitions
    const archiveRes = await engine.dispatchCommand({
      kind: "archive_thread",
      command_id: "arch-t1",
      thread_id: "th-lifecycle",
    });
    expect(archiveRes.ok).toBe(true);
    expect(engine.getThread("th-lifecycle")?.status).toBe("archived");

    const settleRes = await engine.dispatchCommand({
      kind: "settle_thread",
      command_id: "set-t1",
      thread_id: "th-lifecycle",
    });
    expect(settleRes.ok).toBe(true);
    expect(engine.getThread("th-lifecycle")?.status).toBe("settled");

    // Invalid transition: cannot archive settled thread
    const invArchive = await engine.dispatchCommand({
      kind: "archive_thread",
      command_id: "inv-arch-t1",
      thread_id: "th-lifecycle",
    });
    expect(invArchive.ok).toBe(false);
    if (!invArchive.ok) expect(invArchive.code).toBe("invalid_lifecycle_transition");

    // Delete thread (tombstone)
    const delThreadRes = await engine.dispatchCommand({
      kind: "delete_thread",
      command_id: "del-t1",
      thread_id: "th-lifecycle",
    });
    expect(delThreadRes.ok).toBe(true);
    expect(engine.getThread("th-lifecycle")).toBeUndefined(); // Excluded from normal query
    expect(engine.getThread("th-lifecycle", true)?.status).toBe("deleted"); // Present in tombstone view

    // Delete project (tombstone)
    const delProjRes = await engine.dispatchCommand({
      kind: "delete_project",
      command_id: "del-p1",
      project_id: "proj-lifecycle",
    });
    expect(delProjRes.ok).toBe(true);
    expect(engine.getProject("proj-lifecycle")).toBeUndefined();

    // Verify local file is NOT deleted!
    expect(fs.existsSync(dummyFile)).toBe(true);
  });

  test("idempotency: repeating a command ID returns original receipt without appending events", async () => {
    const dir = makeTempDir();
    const engine = new OrchestratorEngine();

    const cmd = {
      kind: "create_project" as const,
      command_id: "idempotent-cmd-1",
      project_id: "p-idem",
      name: "Idempotent Proj",
      source: { kind: "local_folder" as const, path: dir },
    };

    const res1 = await engine.dispatchCommand(cmd);
    expect(res1.ok).toBe(true);
    expect(res1.duplicate).toBeUndefined();

    const initialEvents = engine.getEvents();
    expect(initialEvents.length).toBe(1);

    const res2 = await engine.dispatchCommand(cmd);
    expect(res2.ok).toBe(true);
    expect(res2.duplicate).toBe(true);

    const res2Success = res2 as Extract<typeof res2, { ok: true }>;
    const res1Success = res1 as Extract<typeof res1, { ok: true }>;
    expect(res2Success.project_id).toBe(res1Success.project_id);

    // Event count remains 1
    expect(engine.getEvents().length).toBe(1);
  });

  test("rebuilding snapshot from history produces identical result to live projection", async () => {
    const dir1 = makeTempDir();
    const dir2 = makeTempDir();
    const engine = new OrchestratorEngine();

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      project_id: "p-1",
      name: "P1",
      source: { kind: "local_folder", path: dir1 },
    });
    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p2",
      project_id: "p-2",
      name: "P2",
      source: { kind: "local_folder", path: dir2 },
    });
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t1",
      thread_id: "t-1",
      project_id: "p-1",
      model: "pi-mini",
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    await engine.dispatchCommand({
      kind: "archive_thread",
      command_id: "t1-arch",
      thread_id: "t-1",
    });
    await engine.dispatchCommand({
      kind: "settle_project",
      command_id: "p2-settle",
      project_id: "p-2",
    });

    const liveSnapshot = engine.getSnapshot();
    const rebuiltSnapshot = engine.rebuildSnapshotFromHistory();

    expect(rebuiltSnapshot).toEqual(liveSnapshot);
  });

  test("sync replay and snapshot cursor boundaries", async () => {
    const dir = makeTempDir();
    const engine = new OrchestratorEngine();

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      name: "P1",
      source: { kind: "local_folder", path: dir },
    });

    const syncUpToDate = engine.sync(1);
    expect(syncUpToDate.mode).toBe("up_to_date");

    const syncReplay = engine.sync(0);
    expect(syncReplay.mode).toBe("replay");
    if (syncReplay.mode === "replay") {
      expect(syncReplay.events.length).toBe(1);
    }

    const syncInvalidCursor = engine.sync(999);
    expect(syncInvalidCursor.mode).toBe("snapshot");
  });
  test("hosted sources create setup_required project and reject thread creation until configured", async () => {
    const engine = new OrchestratorEngine();

    const projRes = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-p-gh",
      project_id: "proj-github",
      name: "GitHub Repo Project",
      source: { kind: "github", repo: "my-org/my-repo" },
    });

    expect(projRes.ok).toBe(true);
    const proj = engine.getProject("proj-github");
    expect(proj?.source.status).toBe("setup_required");

    const threadRes = await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-t-gh",
      project_id: "proj-github",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });

    expect(threadRes.ok).toBe(false);
    if (!threadRes.ok) {
      expect(threadRes.code).toBe("source_setup_required");
    }
  });

  test("returns deep immutable snapshot and query objects", async () => {
    const dir = makeTempDir();
    const engine = new OrchestratorEngine();

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      project_id: "p-immut",
      name: "Immutable Proj",
      source: { kind: "local_folder", path: dir },
    });

    const snap = engine.getSnapshot();
    snap.projects["p-immut"].name = "Hacked Name";

    const freshProj = engine.getProject("p-immut");
    expect(freshProj?.name).toBe("Immutable Proj");
  });

  test("cleans up acquired Git workspace when decision fails", async () => {
    const managedRoot = makeTempDir();
    const sourceManager = new SourceManager({ managedWorkspaceRoot: managedRoot });
    const engine = new OrchestratorEngine(sourceManager);

    // Create initial project p1
    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      project_id: "duplicate-id",
      name: "First Proj",
      source: { kind: "local_folder", path: makeTempDir() },
    });

    // Try to create project with duplicate ID using git_url
    const res = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p2-fail",
      project_id: "duplicate-id",
      name: "Second Proj",
      source: { kind: "git_url", url: "https://github.com/example/repo.git" },
    });

    expect(res.ok).toBe(false);
    // Verify directory was cleaned up
    const contents = fs.readdirSync(managedRoot);
    expect(contents.length).toBe(0);
  });
  test("exposes command receipts and sequence metadata via getReceipt", async () => {
    const dir = makeTempDir();
    const engine = new OrchestratorEngine();

    const res = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "receipt-cmd-1",
      project_id: "p-receipt",
      name: "Receipt Proj",
      source: { kind: "local_folder", path: dir },
    });
    expect(res.ok).toBe(true);

    const receipt = engine.getReceipt("receipt-cmd-1");
    expect(receipt).toBeDefined();
    expect(receipt?.command_id).toBe("receipt-cmd-1");
    expect(receipt?.sequences).toEqual([1]);
    expect(receipt?.result.ok).toBe(true);
  });

  test("handles in-flight command concurrency without racing or duplicate execution", async () => {
    const managedRoot = makeTempDir();
    // Use a delayed cloner to simulate async work
    const delayedCloner = async (_url: string, targetPath: string) => {
      await new Promise((r) => setTimeout(r, 50));
      fs.writeFileSync(path.join(targetPath, "cloned.txt"), "ok");
    };

    const sourceManager = new SourceManager({
      managedWorkspaceRoot: managedRoot,
      gitCloner: delayedCloner,
    });
    const engine = new OrchestratorEngine(sourceManager);

    const cmd = {
      kind: "create_project" as const,
      command_id: "concurrent-cmd-id",
      project_id: "proj-concurrent",
      name: "Concurrent Proj",
      source: { kind: "git_url" as const, url: "https://github.com/example/concurrent.git" },
    };

    // Dispatch two concurrent calls with identical command_id
    const [res1, res2] = await Promise.all([
      engine.dispatchCommand(cmd),
      engine.dispatchCommand(cmd),
    ]);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);

    // One of them is primary, the other is marked duplicate
    const duplicates = [res1.duplicate, res2.duplicate].filter(Boolean);
    expect(duplicates.length).toBe(1);

    // Only one event was created
    expect(engine.getEvents().length).toBe(1);
  });
  test("serializes concurrent create_project commands with distinct command_ids and same project_id", async () => {
    const managedRoot = makeTempDir();
    const delayedCloner = async (_url: string, targetPath: string) => {
      await new Promise((r) => setTimeout(r, 40));
      fs.writeFileSync(path.join(targetPath, "cloned.txt"), "ok");
    };

    const sourceManager = new SourceManager({
      managedWorkspaceRoot: managedRoot,
      gitCloner: delayedCloner,
    });
    const engine = new OrchestratorEngine(sourceManager);

    const cmd1 = {
      kind: "create_project" as const,
      command_id: "cmd-id-1",
      project_id: "same-explicit-id",
      name: "Proj 1",
      source: { kind: "git_url" as const, url: "https://github.com/example/repo1.git" },
    };
    const cmd2 = {
      kind: "create_project" as const,
      command_id: "cmd-id-2",
      project_id: "same-explicit-id",
      name: "Proj 2",
      source: { kind: "git_url" as const, url: "https://github.com/example/repo2.git" },
    };

    const [res1, res2] = await Promise.all([
      engine.dispatchCommand(cmd1),
      engine.dispatchCommand(cmd2),
    ]);

    // One succeeds, one is rejected with project_already_exists
    const successCount = [res1.ok, res2.ok].filter(Boolean).length;
    const failCount = [res1.ok, res2.ok].filter((ok) => !ok).length;
    expect(successCount).toBe(1);
    expect(failCount).toBe(1);

    const failedRes = (!res1.ok ? res1 : res2) as Extract<typeof res1, { ok: false }>;
    expect(failedRes.code).toBe("project_already_exists");
  });

  test("filters live event subscriptions by project_id and thread_id scope", async () => {
    const dir1 = makeTempDir();
    const dir2 = makeTempDir();
    const engine = new OrchestratorEngine();

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1-cmd",
      project_id: "proj-sub-1",
      name: "Proj 1",
      source: { kind: "local_folder", path: dir1 },
    });
    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p2-cmd",
      project_id: "proj-sub-2",
      name: "Proj 2",
      source: { kind: "local_folder", path: dir2 },
    });

    const proj1Events: any[] = [];
    engine.subscribe((e) => proj1Events.push(e), { project_id: "proj-sub-1" }, { emitInitialSnapshot: false });
    // Create thread in proj-sub-1
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t1-cmd",
      thread_id: "th-sub-1",
      project_id: "proj-sub-1",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });

    // Create thread in proj-sub-2
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t2-cmd",
      thread_id: "th-sub-2",
      project_id: "proj-sub-2",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });

    // Proj 1 listener should only receive thread 1 event, not thread 2 event
    expect(proj1Events.length).toBe(1);
    expect(proj1Events[0].data.thread.id).toBe("th-sub-1");
  });
  test("emits initial snapshot marker on subscription by default", async () => {
    const dir = makeTempDir();
    const engine = new OrchestratorEngine();

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      name: "Proj",
      source: { kind: "local_folder", path: dir },
    });

    const receivedEvents: any[] = [];
    engine.subscribe((e) => receivedEvents.push(e));

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].kind).toBe("SnapshotEmitted");
    expect(receivedEvents[0].data.snapshot.sequence).toBe(1);
  });
  test("scopes initial snapshot emission by project_id filter", async () => {
    const dir1 = makeTempDir();
    const dir2 = makeTempDir();
    const engine = new OrchestratorEngine();

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1-cmd",
      project_id: "proj-1",
      name: "Proj 1",
      source: { kind: "local_folder", path: dir1 },
    });
    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p2-cmd",
      project_id: "proj-2",
      name: "Proj 2",
      source: { kind: "local_folder", path: dir2 },
    });

    const events: any[] = [];
    engine.subscribe((e) => events.push(e), { project_id: "proj-1" });

    expect(events.length).toBe(1);
    expect(events[0].kind).toBe("SnapshotEmitted");
    const snapProjects = events[0].data.snapshot.projects;
    expect(Object.keys(snapProjects)).toEqual(["proj-1"]);
  });
  test("scopes initial snapshot emission by thread_id filter", async () => {
    const dir = makeTempDir();
    const engine = new OrchestratorEngine();

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1-cmd",
      project_id: "proj-1",
      name: "Proj 1",
      source: { kind: "local_folder", path: dir },
    });
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t1-cmd",
      thread_id: "th-1",
      project_id: "proj-1",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t2-cmd",
      thread_id: "th-2",
      project_id: "proj-1",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });

    const events: any[] = [];
    engine.subscribe((e) => events.push(e), { thread_id: "th-1" });

    expect(events.length).toBe(1);
    expect(events[0].kind).toBe("SnapshotEmitted");
    const snapThreads = events[0].data.snapshot.threads;
    expect(Object.keys(snapThreads)).toEqual(["th-1"]);
  });
  test("scopes initial snapshot emission conjunctively when both project_id and thread_id filter are supplied", async () => {
    const dir = makeTempDir();
    const engine = new OrchestratorEngine();

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1-cmd",
      project_id: "proj-A",
      name: "Proj A",
      source: { kind: "local_folder", path: dir },
    });
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t1-cmd",
      thread_id: "th-A1",
      project_id: "proj-A",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });

    // Mismatched project_id and thread_id should return empty projects/threads
    const mismatchedEvents: any[] = [];
    engine.subscribe((e) => mismatchedEvents.push(e), {
      project_id: "proj-WRONG",
      thread_id: "th-A1",
    });

    expect(mismatchedEvents.length).toBe(1);
    expect(Object.keys(mismatchedEvents[0].data.snapshot.projects).length).toBe(0);
    expect(Object.keys(mismatchedEvents[0].data.snapshot.threads).length).toBe(0);
  });
  test("rejects project creation with empty name", async () => {
    const engine = new OrchestratorEngine();
    const res = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-empty-name",
      name: "   ",
      source: { kind: "local_folder", path: makeTempDir() },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("invalid_command");
    }
  });

  test("rejects hosted source creation with empty repository locator", async () => {
    const engine = new OrchestratorEngine();
    const res = await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-empty-repo",
      name: "Empty Repo Proj",
      source: { kind: "github", repo: "  " },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("invalid_source");
    }
  });
});
