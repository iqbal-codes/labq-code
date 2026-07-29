import type { Command, CommandResult, DomainEvent, Snapshot, SyncResult } from "@labq/domain/types";
import type { OrchestratorTransportPort, SubscriptionScope, TransportSnapshotResult, TransportSyncResult, TransportError } from "./transport-port";

/**
 * Minimal Electrobun RPC client. Connects to the Bun backend over a local
 * WebSocket whose port is injected by the Electrobun native shell via
 * `window.__electrobunRpcSocketPort`. Implements the request/response and
 * message (event streaming) patterns used by the orchestration transport.
 *
 * Returns undefined when not inside an Electrobun webview, allowing the caller
 * to fall back to the dev FakeTransport.
 */
export async function createElectrobunTransport(): Promise<OrchestratorTransportPort | undefined> {
  const rpcPort = typeof window !== "undefined" ? (window as any).__electrobunRpcSocketPort : undefined;
  if (typeof rpcPort !== "number") return undefined;

  let requestId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const messageListeners = new Set<(payload: unknown) => void>();
  let ws: WebSocket;
  let wsReady: Promise<void>;

  const init = new Promise<void>((resolve, reject) => {
    ws = new WebSocket(`ws://127.0.0.1:${rpcPort}`);
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("Electrobun RPC socket failed"));
    ws.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "response" || msg.type === "reply") {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.payload);
        }
      } else if (msg.type === "message") {
        for (const listener of messageListeners) listener(msg.payload);
      }
    };
  });

  wsReady = init;

  async function rpcRequest(method: string, params: unknown): Promise<unknown> {
    await wsReady;
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ type: "request", id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`RPC request '${method}' timed out`));
        }
      }, 30_000);
    });
  }

  // Send subscribe message once connected
  wsReady.then(() => {
    ws.send(JSON.stringify({ type: "message", id: "subscribe", payload: { scope: {} } }));
  });

  const eventListeners = new Set<(event: DomainEvent) => void>();
  messageListeners.add((payload: unknown) => {
    const event = payload as DomainEvent;
    for (const listener of eventListeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  });

  return {
    async getScopedSnapshot(scope: SubscriptionScope): Promise<TransportSnapshotResult> {
      return rpcRequest("getScopedSnapshot", { scope }) as Promise<TransportSnapshotResult>;
    },

    async sync(cursor: number, scope: SubscriptionScope): Promise<TransportSyncResult> {
      return rpcRequest("sync", { cursor, scope }) as Promise<TransportSyncResult>;
    },

    subscribe(_scope: SubscriptionScope, onEvent: (event: DomainEvent) => void): () => void {
      eventListeners.add(onEvent);
      return () => { eventListeners.delete(onEvent); };
    },

    async dispatchCommand(command: Command): Promise<CommandResult> {
      return rpcRequest("dispatchCommand", { command }) as Promise<CommandResult>;
    },
  };
}