import { describe, it, expect } from "vitest";
import type { OrchestratorTransportPort, SubscriptionScope } from "@/orchestrator/transport-port";
import { createOrchestratorClientStore } from "@/orchestrator/store";
import { OrchestratorEngine } from "@labq/engine/engine";
import { OrchestratorTransport } from "@labq/transport/transport";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Command, CommandResult, DomainEvent, Snapshot, SyncResult } from "@labq/domain/types";

/**
 * Adapter that wraps the real orchestration engine + transport to satisfy
 * the client-friendly `OrchestratorTransportPort` interface. This is the
 * high-testability seam: no browser, no provider SDK, just the typed engine.
 */
class BackendEnginePort implements OrchestratorTransportPort {
  private tempDir: string;
  private transport: OrchestratorTransport;
  private listeners = new Map<SubscriptionScope, Set<(event: DomainEvent) => void>>();

  constructor() {
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "labq-bootstrap-test-"));
    const engine = new OrchestratorEngine();
    this.transport = new OrchestratorTransport({ engine });
  }

  getTempDir(): string {
    return this.tempDir;
  }

  getScopedSnapshot(
    scope: SubscriptionScope,
  ): Snapshot | { ok: false; code: string; detail: string } {
    const snap = this.transport.getScopedSnapshot(undefined, scope);
    if ("ok" in snap && snap.ok === false) return snap;
    return snap as Snapshot;
  }

  sync(
    cursor: number,
    scope: SubscriptionScope,
  ): SyncResult | { ok: false; code: string; detail: string } {
    return this.transport.sync(undefined, cursor, scope);
  }

  subscribe(scope: SubscriptionScope, onEvent: (event: DomainEvent) => void): () => void {
    const key = scope;
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(onEvent);

    const subResult = this.transport.createSubscription(undefined, scope, {
      emitInitialSnapshot: true,
    });
    if (!subResult.ok) {
      set.delete(onEvent);
      throw new Error(`Subscription failed: ${subResult.detail}`);
    }
    const subscription = subResult.subscription;
    subscription.onEvent(onEvent);

    return () => {
      set?.delete(onEvent);
      subscription.unsubscribe();
    };
  }

  async dispatchCommand(command: Command): Promise<CommandResult> {
    // The transport dispatch is synchronous in the current implementation.
    const result = this.transport.dispatchCommand({ command, token: undefined });
    // It's actually async-returning a Promise in the engine, but the transport wraps it.
    // Let's await properly.
    return result;
  }
}

describe("real transport bootstrap", () => {
  it("bootstraps from a real engine transport snapshot through the port seam", async () => {
    const port = new BackendEnginePort();
    const store = createOrchestratorClientStore(port);

    expect(store.getState().bootstrapStatus).toBe("idle");

    await store.getState().connect();

    // After connecting to the real engine, the store should be ready with an
    // empty snapshot (no projects yet).
    expect(store.getState().bootstrapStatus).toBe("ready");
    expect(store.getState().connection).toBe("connected");
    expect(store.getState().sync).toBe("synced");

    const snapshot = store.getState().snapshot;
    expect(typeof snapshot.sequence).toBe("number");
    // The engine produces an initial snapshot with the default catalog.
    expect(snapshot.catalog.models.length).toBeGreaterThan(0);
    expect(Object.keys(snapshot.projects).length).toBe(0);
    expect(Object.keys(snapshot.threads).length).toBe(0);
  });

  it("applies engine events through the subscription seam", async () => {
    const port = new BackendEnginePort();
    const store = createOrchestratorClientStore(port);
    await store.getState().connect();

    // Dispatch a create_project command via the port directly to check.
    const testDir = port.getTempDir();
    const cmdResult = await port.dispatchCommand({
      kind: "create_project",
      name: "Engine Test Project",
      source: { kind: "local_folder", path: testDir },
      command_id: "cmd-1",
    });
    // Debug the failure
    if (!cmdResult.ok) {
      console.log("CMD ERROR", JSON.stringify(cmdResult));
    }
    expect(cmdResult.ok).toBe(true);

    // Now check the store — events fire synchronously during dispatch.
    const projects = store.getState().snapshot.projects;
    expect(Object.keys(projects).length).toBe(1);
    const project = Object.values(projects)[0];
    expect(project.name).toBe("Engine Test Project");
    expect(store.getState().recoveryCursor).toBeGreaterThan(0);
  });

  it("maintains separate connection/sync health through the adapter seam", async () => {
    const port = new BackendEnginePort();
    const store = createOrchestratorClientStore(port);

    expect(store.getState().connection).toBe("disconnected");
    expect(store.getState().sync).toBe("idle");

    await store.getState().connect();
    expect(store.getState().connection).toBe("connected");
    expect(store.getState().sync).toBe("synced");
  });
});
