import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { OrchestratorEngine } from "../src/engine/engine.js";
import { OrchestratorTransport, WireCommandMessage, WireSubscriptionParams } from "../src/transport/transport.js";
import { ReconnectingClient } from "../src/client/reconnect-client.js";
import type { Snapshot, DomainEvent, TurnStatus, Command } from "../src/domain/types.js";

describe("Authoritative Transport and Reconnect Recovery", () => {
  let tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-transport-test-"));
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

  test("transport validates wire shape and authorization for read-only vs mutation access", async () => {
    const engine = new OrchestratorEngine();
    const transport = new OrchestratorTransport({
      engine,
      authorize: (token, action, scope) => {
        if (token === "read-token") {
          return action === "read";
        }
        if (token === "admin-token") {
          return true;
        }
        return false;
      },
    });

    // 1. Invalid token on subscription creation
    const unauthorizedSub = transport.createSubscription("bad-token", {
      environment_id: "env-1",
      project_id: "proj-1",
    });
    expect(unauthorizedSub.ok).toBe(false);
    if (!unauthorizedSub.ok) {
      expect(unauthorizedSub.code).toBe("unauthorized");
    }

    // 2. Read token creating subscription (read access allowed)
    const readSub = transport.createSubscription("read-token", {
      environment_id: "env-1",
      project_id: "proj-1",
    });
    expect(readSub.ok).toBe(true);

    // 3. Read token attempting mutation command dispatch (denied)
    const localDir = makeTempDir();
    const mutationCmd: WireCommandMessage = {
      token: "read-token",
      command: {
        kind: "create_project",
        command_id: "cmd-read-p1",
        name: "Read Project",
        source: { kind: "local_folder", path: localDir },
      },
    };
    const dispatchRes = await transport.dispatchCommand(mutationCmd);
    expect(dispatchRes.ok).toBe(false);
    if (!dispatchRes.ok) {
      expect(dispatchRes.code).toBe("unauthorized");
    }

    // 4. Admin token attempting mutation (allowed)
    const adminCmd: WireCommandMessage = {
      token: "admin-token",
      command: {
        kind: "create_project",
        command_id: "cmd-admin-p1",
        name: "Admin Project",
        source: { kind: "local_folder", path: localDir },
      },
    };
    const adminDispatchRes = await transport.dispatchCommand(adminCmd);
    expect(adminDispatchRes.ok).toBe(true);

    // 5. Malformed command validation error
    const malformedCmd: WireCommandMessage = {
      token: "admin-token",
      command: {
        kind: "invalid_kind",
        command_id: "cmd-bad",
      } as unknown as Command,
    };
    const badDispatchRes = await transport.dispatchCommand(malformedCmd);
    expect(badDispatchRes.ok).toBe(false);
    if (!badDispatchRes.ok) {
      expect(badDispatchRes.code).toBe("invalid_wire_shape");
    }
  });

  test("subscription begins with synchronization snapshot marker and emits authoritative ordered stream", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();
    const transport = new OrchestratorTransport({ engine });

    // Populate initial state
    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      project_id: "proj-1",
      name: "Project 1",
      source: { kind: "local_folder", path: localDir },
    });

    const received: DomainEvent[] = [];
    const subRes = transport.createSubscription("guest", {
      environment_id: "default-env",
      project_id: "proj-1",
    });
    expect(subRes.ok).toBe(true);

    if (subRes.ok) {
      subRes.subscription.onEvent((evt) => received.push(evt));
    }

    expect(received.length).toBe(1);
    expect(received[0].kind).toBe("SnapshotEmitted");
    expect(received[0].sequence).toBe(1);

    // Create thread, observe ordered event sequence strictly increasing
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t1",
      thread_id: "th-1",
      project_id: "proj-1",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });

    expect(received.length).toBe(2);
    expect(received[1].kind).toBe("ThreadCreated");
    expect(received[1].sequence).toBe(2);
  });

  test("client connects, syncs snapshot, receives live ordered events, and tracks exclusive sequence cursor", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();
    const transport = new OrchestratorTransport({ engine });

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "cmd-p1",
      project_id: "proj-1",
      name: "Proj 1",
      source: { kind: "local_folder", path: localDir },
    });

    const client = new ReconnectingClient({
      transport,
      token: "guest",
      environment_id: "env-1",
      project_id: "proj-1",
    });

    await client.connect();

    expect(client.getLastSequence()).toBe(1);
    expect(client.getSnapshot().projects["proj-1"]).toBeDefined();

    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "cmd-t1",
      thread_id: "th-1",
      project_id: "proj-1",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });

    expect(client.getLastSequence()).toBe(2);
    expect(client.getSnapshot().threads["th-1"]).toBeDefined();

    client.disconnect();
  });

  test("recovery handles exact exclusive replay boundary after disconnect", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();
    const transport = new OrchestratorTransport({ engine });

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      project_id: "proj-1",
      name: "Proj 1",
      source: { kind: "local_folder", path: localDir },
    });

    const client = new ReconnectingClient({
      transport,
      token: "guest",
      environment_id: "env-1",
      project_id: "proj-1",
    });

    await client.connect();
    expect(client.getLastSequence()).toBe(1);

    // Simulate involuntary network disconnect
    client.simulateInvoluntaryDisconnect();

    // Server generates events while client is disconnected
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t1",
      thread_id: "th-1",
      project_id: "proj-1",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t2",
      thread_id: "th-2",
      project_id: "proj-1",
      model: "pi-3.5-sonnet",
      access_profile: "workspace-write",
      interaction_mode: "execute",
    });

    // Reconnect: requests replay strictly after exclusive cursor (sequence 1)
    const recoveryRes = await client.reconnect();
    expect(recoveryRes.ok).toBe(true);
    expect(recoveryRes.mode).toBe("replay");
    expect(client.getLastSequence()).toBe(3);
    expect(Object.keys(client.getSnapshot().threads)).toEqual(["th-1", "th-2"]);
  });

  test("recovery handles sequence gap, retries replay, and falls back to snapshot deterministically", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();
    const transport = new OrchestratorTransport({ engine });

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      project_id: "proj-1",
      name: "Proj 1",
      source: { kind: "local_folder", path: localDir },
    });

    const client = new ReconnectingClient({
      transport,
      token: "guest",
      environment_id: "env-1",
      project_id: "proj-1",
      maxReplayRetries: 2,
    });

    await client.connect();
    expect(client.getLastSequence()).toBe(1);

    // Client suffers sequence gap (e.g. sequence jump from 1 to 5 directly during live stream)
    const gapDetected = client.applyLiveEvent({
      sequence: 5,
      event_id: "evt-5",
      timestamp: new Date().toISOString(),
      command_id: "cmd-gap",
      kind: "ThreadCreated",
      data: {
        thread: {
          id: "th-gap",
          environment_id: "default-env",
          project_id: "proj-1",
          provider_name: "pi",
          provider_instance_id: "pi-default",
          title: "Gap Thread",
          status: "active",
          session_status: "none",
          model: "pi-default",
          access_profile: "read-only",
          interaction_mode: "execute",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    });

    expect(gapDetected.gap).toBe(true);
    expect(client.isReconnecting()).toBe(true);

    // Automatic gap recovery completes via replay or fallback
    await client.awaitRecovery();

    expect(client.isReconnecting()).toBe(false);
    expect(client.getLastSequence()).toBeGreaterThanOrEqual(1);
  });

  test("bounded snapshot fallback occurs when replay requests invalid sequence cursor", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();
    const transport = new OrchestratorTransport({ engine });

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      project_id: "proj-1",
      name: "Proj 1",
      source: { kind: "local_folder", path: localDir },
    });

    const client = new ReconnectingClient({
      transport,
      token: "guest",
      environment_id: "env-1",
      project_id: "proj-1",
    });

    await client.connect();

    // Corrupt client cursor to invalid sequence number (e.g. 9999)
    client.forceSetLastSequence(9999);

    client.simulateInvoluntaryDisconnect();
    const recoveryRes = await client.reconnect();

    expect(recoveryRes.ok).toBe(true);
    expect(recoveryRes.mode).toBe("snapshot");
    expect(client.getLastSequence()).toBe(1);
    expect(client.getSnapshot().projects["proj-1"]).toBeDefined();
  });

  test("client applies sequence at most once and preserves newer live state against stale cached state", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();
    const transport = new OrchestratorTransport({ engine });

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      project_id: "proj-1",
      name: "Proj 1",
      source: { kind: "local_folder", path: localDir },
    });
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t1",
      thread_id: "th-1",
      project_id: "proj-1",
      title: "Thread th-1",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });

    const client = new ReconnectingClient({
      transport,
      token: "guest",
      environment_id: "env-1",
      project_id: "proj-1",
    });

    await client.connect();
    expect(client.getLastSequence()).toBe(2);

    const initialThread = client.getSnapshot().threads["th-1"];
    expect(initialThread.status).toBe("active");

    // Apply duplicate event (seq 2 again) — must be ignored (at-most-once)
    const appliedDup = client.applyLiveEvent({
      sequence: 2,
      event_id: "evt-2-dup",
      timestamp: new Date().toISOString(),
      command_id: "t1",
      kind: "ThreadCreated",
      data: {
        thread: {
          ...initialThread,
          title: "Stale Duplicate Title",
        },
      },
    });

    expect(appliedDup.applied).toBe(false);
    expect(client.getSnapshot().threads["th-1"].title).toBe("Thread th-1");

    // Apply newer event (seq 3)
    await engine.dispatchCommand({
      kind: "archive_thread",
      command_id: "arch-t1",
      thread_id: "th-1",
    });

    expect(client.getLastSequence()).toBe(3);
    expect(client.getSnapshot().threads["th-1"].status).toBe("archived");

    // Try applying older event (seq 1) — must be rejected as stale
    const appliedStale = client.applyLiveEvent({
      sequence: 1,
      event_id: "evt-1-stale",
      timestamp: new Date().toISOString(),
      command_id: "p1",
      kind: "ProjectCreated",
      data: {
        project: {
          id: "proj-1",
          environment_id: "default-env",
          name: "Stale Project Name",
          source: { kind: "local_folder", status: "bound", locator: localDir },
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    });

    expect(appliedStale.applied).toBe(false);
    expect(client.getSnapshot().projects["proj-1"].name).toBe("Proj 1");
  });

  test("converges to fresh snapshot without duplicate messages, activities, approvals, or turns", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();
    const transport = new OrchestratorTransport({ engine });

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      project_id: "proj-1",
      name: "Proj 1",
      source: { kind: "local_folder", path: localDir },
    });
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t1",
      thread_id: "th-1",
      project_id: "proj-1",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });

    const client = new ReconnectingClient({
      transport,
      token: "guest",
      environment_id: "env-1",
      project_id: "proj-1",
    });

    await client.connect();

    // Trigger explicit snapshot sync
    const freshSnapshotRes = await client.syncSnapshot();
    expect(freshSnapshotRes.ok).toBe(true);

    const snapshot = client.getSnapshot();
    expect(Object.keys(snapshot.projects)).toEqual(["proj-1"]);
    expect(Object.keys(snapshot.threads)).toEqual(["th-1"]);
    expect(Object.keys(snapshot.turns).length).toBe(0);
  });

  test("rejects malformed subscription parameters before authorization", () => {
    const engine = new OrchestratorEngine();
    const transport = new OrchestratorTransport({ engine });

    const badAfterSeq = transport.createSubscription(undefined, { after_sequence: -1 } as any);
    expect(badAfterSeq.ok).toBe(false);
    if (!badAfterSeq.ok) {
      expect(badAfterSeq.code).toBe("invalid_wire_shape");
    }

    const emptyProject = transport.createSubscription(undefined, { project_id: "   " });
    expect(emptyProject.ok).toBe(false);
    if (!emptyProject.ok) {
      expect(emptyProject.code).toBe("invalid_wire_shape");
    }
  });

  test("cursor subscription with after_sequence 0 emits snapshot marker when engine cursor is 0", () => {
    const engine = new OrchestratorEngine();
    const transport = new OrchestratorTransport({ engine });

    const subRes = transport.createSubscription(undefined, { after_sequence: 0 });
    expect(subRes.ok).toBe(true);
    if (subRes.ok) {
      const received: any[] = [];
      subRes.subscription.onEvent((e) => received.push(e));
      expect(received.length).toBe(1);
      expect(received[0].kind).toBe("SnapshotEmitted");
      expect(received[0].sequence).toBe(0);
    }
  });

  test("scoped recovery sync skips non-matching projects cleanly", async () => {
    const localDir = makeTempDir();
    const engine = new OrchestratorEngine();
    const transport = new OrchestratorTransport({ engine });

    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p1",
      project_id: "proj-1",
      name: "Proj 1",
      source: { kind: "local_folder", path: localDir },
    });

    const client = new ReconnectingClient({
      transport,
      token: "guest",
      environment_id: "env-1",
      project_id: "proj-1",
    });
    await client.connect();
    expect(client.getLastSequence()).toBe(1);

    client.simulateInvoluntaryDisconnect();

    // Create project 2 while client disconnected
    await engine.dispatchCommand({
      kind: "create_project",
      command_id: "p2",
      project_id: "proj-2",
      name: "Proj 2",
      source: { kind: "local_folder", path: localDir },
    });

    // Create thread in project 1
    await engine.dispatchCommand({
      kind: "create_thread",
      command_id: "t1",
      thread_id: "th-p1",
      project_id: "proj-1",
      model: "pi-default",
      access_profile: "read-only",
      interaction_mode: "execute",
    });

    // Reconnect will encounter non-progressing sequence gap due to omitted proj-2 event
    const syncRes = await client.reconnect();
    expect(syncRes.ok).toBe(true);
    expect(client.getSnapshot().projects["proj-1"]).toBeDefined();
    expect(client.getSnapshot().projects["proj-2"]).toBeUndefined();
    expect(client.getSnapshot().threads["th-p1"]).toBeDefined();
  });
});
