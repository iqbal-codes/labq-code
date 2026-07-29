import { vi } from "vitest";
import { describe, it, expect } from "vitest";
import { FakeTransport } from "./fake-transport";
import {
  createOrchestratorClientStore,
  type BootstrapStatus,
  type ConnectionStatus,
  type SyncStatus,
} from "./store";
import { applyOrderedEvent, createEmptyProjection } from "./projection";
import { createProjectCommand, createThreadCommand, startTurnCommand } from "./commands";
import type { DomainEvent, Snapshot } from "@labq/domain/types";
import { applyEvent } from "@labq/engine/projector";

/** Wait for store condition, with a timeout. */
function waitForStore(
  store: ReturnType<typeof createOrchestratorClientStore>,
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (predicate()) return resolve();
    const unsub = store.subscribe(() => {
      if (predicate()) {
        unsub();
        resolve();
      }
    });
    setTimeout(() => {
      unsub();
      reject(new Error("Store condition timed out"));
    }, timeoutMs);
  });
}

describe("OrchestratorClientStore", () => {
  it("connects and transitions from idle to ready", async () => {
    const transport = new FakeTransport();
    const store = createOrchestratorClientStore(transport);

    expect(store.getState().bootstrapStatus).toBe("idle");
    expect(store.getState().connection).toBe("disconnected");

    await store.getState().connect();
    expect(store.getState().bootstrapStatus).toBe("ready");
    expect(store.getState().connection).toBe("connected");
    expect(store.getState().sync).toBe("synced");
    expect(store.getState().recoveryCursor).toBe(0);
  });

  it("sets unauthorized status when snapshot access is denied", async () => {
    const transport = new FakeTransport({
      snapshotError: { ok: false as const, code: "unauthorized", detail: "Not allowed" },
    });
    const store = createOrchestratorClientStore(transport);
    await store.getState().connect();

    expect(store.getState().bootstrapStatus).toBe("unauthorized");
    expect(store.getState().connection).toBe("disconnected");
    expect(store.getState().error?.code).toBe("unauthorized");
  });

  it("sets error status on transport failure", async () => {
    const transport = new FakeTransport({
      snapshotError: { ok: false as const, code: "engine_unavailable", detail: "Engine down" },
    });
    const store = createOrchestratorClientStore(transport);
    await store.getState().connect();

    expect(store.getState().bootstrapStatus).toBe("error");
    expect(store.getState().error?.code).toBe("engine_unavailable");
  });

  it("applies events and updates snapshot + recovery cursor", async () => {
    const transport = new FakeTransport();
    const store = createOrchestratorClientStore(transport);
    await store.getState().connect();

    const result = await store.getState().dispatch(
      createProjectCommand({
        name: "test-project",
        source: { kind: "local_folder", path: "/code" },
      }),
    );
    expect(result.ok).toBe(true);
    await waitForStore(store, () => Object.keys(store.getState().snapshot.projects).length > 0);

    const projects = store.getState().snapshot.projects;
    expect(Object.keys(projects).length).toBe(1);
    const proj: Record<string, unknown> = Object.values(projects)[0]!;
    expect((proj as { name: string }).name).toBe("test-project");
    expect(store.getState().recoveryCursor).toBeGreaterThan(0);
  });

  it("records command receipts and appends event sequences", async () => {
    const transport = new FakeTransport();
    const store = createOrchestratorClientStore(transport);
    await store.getState().connect();

    const cmd = createProjectCommand({
      name: "receipt-test",
      source: { kind: "git_url", url: "https://example.com/repo.git" },
    });
    const result = await store.getState().dispatch(cmd);
    expect(result.ok).toBe(true);
    expect(result.project_id).toBeTruthy();

    // Wait for events to be applied
    await waitForStore(store, () => store.getState().recoveryCursor > 0);

    const receipt = store.getState().receipts[cmd.command_id];
    expect(receipt).toBeTruthy();
    // At least one event should have been applied for this command.
    expect(receipt.sequences.length).toBeGreaterThanOrEqual(1);
    expect(receipt.result.ok).toBe(true);
  });

  it("recovers from sequence gaps via reconnect", async () => {
    const transport = new FakeTransport();
    const store = createOrchestratorClientStore(transport);
    await store.getState().connect();

    const fake = transport as FakeTransport;

    // Emit an event with a sequence gap (jumps from 0 to 10).
    fake.emit({
      kind: "ProjectCreated",
      data: {
        project: {
          id: "p1",
          name: "gap-project",
          source: { kind: "git_url", status: "acquired", locator: "url" },
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
      sequence: 10,
      event_id: "e1",
      timestamp: new Date().toISOString(),
      command_id: "c1",
    });

    // The store should detect a gap and trigger recovery.
    // Recovery succeeds synchronously and the project appears.
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (Object.keys(store.getState().snapshot.projects).length === 1) resolve();
        else if (Date.now() - start > 1000) reject(new Error("Timeout waiting for gap recovery"));
        else setTimeout(check, 10);
      };
      check();
    });
    expect(store.getState().snapshot.projects.p1.name).toBe("gap-project");
  });

  it("ignores duplicate or older events (at-most-once)", async () => {
    const transport = new FakeTransport();
    const store = createOrchestratorClientStore(transport);
    await store.getState().connect();

    // Dispatch a command to advance sequence
    const cmd = createProjectCommand({
      name: "dup-test",
      source: { kind: "local_folder", path: "/code" },
    });
    await store.getState().dispatch(cmd);
    await waitForStore(store, () => store.getState().recoveryCursor > 0);

    const cursor = store.getState().recoveryCursor;
    // Send an event with an old sequence
    const oldEvent: DomainEvent = {
      kind: "ThreadCreated",
      data: {
        thread: {
          id: "t1",
          project_id: "p1",
          title: "old-thread",
          status: "active",
          session_status: "none",
          model: "pi-default",
          access_profile: "read-only",
          interaction_mode: "execute",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
      sequence: cursor - 1,
      event_id: "old",
      timestamp: new Date().toISOString(),
      command_id: "old-cmd",
    };
    store.getState().applyEvent(oldEvent);
    // Cursor should not have changed
    expect(store.getState().recoveryCursor).toBe(cursor);
  });

  it("replaces state on SnapshotEmitted", async () => {
    const transport = new FakeTransport();
    const store = createOrchestratorClientStore(transport);
    await store.getState().connect();

    const newSnapshot: Snapshot = {
      sequence: 100,
      projects: {
        p2: {
          id: "p2",
          name: "snapshot-project",
          source: { kind: "git_url", status: "acquired", locator: "url" },
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
      threads: {},
      turns: {},
      catalog: {
        models: [{ id: "pi-default", name: "Pi Default", authenticated: true, available: true }],
        access_profiles: [],
        interaction_modes: [],
        capabilities: [],
      },
    };

    store.getState().applyEvent({
      kind: "SnapshotEmitted",
      data: { snapshot: newSnapshot },
      sequence: 100,
      event_id: "snap",
      timestamp: new Date().toISOString(),
      command_id: "",
    });

    expect(store.getState().recoveryCursor).toBe(100);
    expect((Object.values(store.getState().snapshot.projects)[0] as { name: string }).name).toBe(
      "snapshot-project",
    );
  });

  it("separates transient local state from canonical state", () => {
    // Canonical state lives in the store; transient local state (drafts, chooser
    // values) lives in React component state. This test verifies the store
    // contains no local-draft fields and that a React-worded local state does
    // not leak into the snapshot.
    const transport = new FakeTransport();
    const store = createOrchestratorClientStore(transport);

    const state: Record<string, unknown> = store.getState() as unknown as Record<string, unknown>;
    // The store should have canonical fields, NOT local transient fields.
    expect(state).toHaveProperty("snapshot");
    expect(state).toHaveProperty("receipts");
    expect(state).toHaveProperty("recoveryCursor");
    expect(state).toHaveProperty("connection");
    expect(state).toHaveProperty("sync");
    expect(state).toHaveProperty("bootstrapStatus");
    // No local transient fields
    expect((state as Record<string, unknown>).draft).toBeUndefined();
    expect((state as Record<string, unknown>).formValues).toBeUndefined();
    expect((state as Record<string, unknown>).chooserHighlight).toBeUndefined();
  });
});

describe("projection (pure)", () => {
  it("creates empty projection with default catalog", () => {
    const proj = createEmptyProjection();
    expect(proj.lastSequence).toBe(0);
    expect(proj.snapshot.catalog.models.length).toBeGreaterThan(0);
  });

  it("applyOrderedEvent ignores events before or at current sequence", () => {
    let state = createEmptyProjection();
    state.lastSequence = 5;
    const ev: DomainEvent = {
      kind: "ProjectCreated",
      data: {
        project: {
          id: "p1",
          name: "t",
          source: { kind: "git_url", status: "acquired", locator: "url" },
          status: "active",
          created_at: "",
          updated_at: "",
        },
      },
      sequence: 3,
      event_id: "e",
      timestamp: "",
      command_id: "c",
    };
    const outcome = applyOrderedEvent(state, ev);
    expect(outcome.applied).toBe(false);
    expect(outcome.gap).toBe(false);
  });

  it("applyOrderedEvent detects gaps", () => {
    let state = createEmptyProjection();
    state.lastSequence = 5;
    const ev: DomainEvent = {
      kind: "ProjectCreated",
      data: {
        project: {
          id: "p1",
          name: "t",
          source: { kind: "local_folder", path: "/p" },
          status: "active",
          created_at: "",
          updated_at: "",
        },
      },
      sequence: 7,
      event_id: "e",
      timestamp: "",
      command_id: "c",
    } as DomainEvent;
    const outcome = applyOrderedEvent(state, ev);
    expect(outcome.applied).toBe(false);
    expect(outcome.gap).toBe(true);
  });

  it("applyOrderedEvent applies exact next event", () => {
    let state = createEmptyProjection();
    state.lastSequence = 5;
    const ev: DomainEvent = {
      kind: "ProjectCreated",
      data: {
        project: {
          id: "p1",
          name: "t",
          source: { kind: "local_folder", path: "/p" },
          status: "active",
          created_at: "",
          updated_at: "",
        },
      },
      sequence: 6,
      event_id: "e",
      timestamp: "",
      command_id: "c",
    } as DomainEvent;
    const outcome = applyOrderedEvent(state, ev);
    expect(outcome.applied).toBe(true);
    expect(outcome.gap).toBe(false);
    expect(outcome.state.lastSequence).toBe(6);
    expect(Object.keys(outcome.state.snapshot.projects).length).toBe(1);
  });
});
