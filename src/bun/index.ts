import { OrchestratorEngine } from "../engine/engine";
import { OrchestratorTransport } from "../transport/transport";
import { defineElectrobunRPC } from "electrobun/bun";
import type { CommandResult, DomainEvent, Snapshot, SyncResult } from "../domain/types";

export interface SubscriptionScope {
  environment_id?: string;
  project_id?: string;
  thread_id?: string;
}

/** Schema shared between Bun backend and webview via Electrobun RPC. */
export interface OrchestratorRPCSchema {
  bun: {
    requests: {
      getScopedSnapshot: {
        params: { scope?: { environment_id?: string; project_id?: string; thread_id?: string } };
        response: Snapshot | { ok: false; code: string; detail: string };
      };
      sync: {
        params: { cursor: number; scope?: { environment_id?: string; project_id?: string; thread_id?: string } };
        response: SyncResult | { ok: false; code: string; detail: string };
      };
      dispatchCommand: {
        params: { command: import("../domain/types").Command };
        response: CommandResult;
      };
    };
    messages: {
      subscribe: SubscriptionScope;
      unsubscribe: void;
    };
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      event: DomainEvent;
    };
  };
}

const engine = new OrchestratorEngine();
const transport = new OrchestratorTransport({ engine });

interface RPCSubscriptionHandle {
  offEvent: () => void;
  unsubscribe: () => void;
}

const subscriberHandles = new Map<RPC, RPCSubscriptionHandle>();

export type RPC = typeof rpc;

import { BrowserView, BrowserWindow, Updater, app } from "electrobun/bun";

const DEV_SERVER_URL = "http://localhost:5173";
export async function getMainViewUrl(): Promise<string> {
  try {
    const channel = await Updater.localInfo.channel().catch(() => "dev");
    if (channel === "dev") {
      try {
        await fetch(DEV_SERVER_URL, { method: "HEAD" });
        return DEV_SERVER_URL;
      } catch {
        // Dev server not reachable; fall back to packaged view assets.
      }
    }
  } catch {
    // If channel check fails, fall back to packaged view assets.
  }
  return "views://mainview/index.html";
}

const rpc = BrowserView.defineRPC<OrchestratorRPCSchema>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      getScopedSnapshot: (params) => {
        const scope = params?.scope;
        return transport.getScopedSnapshot(undefined, scope);
      },
      sync: (params) => {
        const cursor = params?.cursor ?? 0;
        const scope = params?.scope;
        return transport.sync(undefined, cursor, scope);
      },
      dispatchCommand: async (params) => {
        if (!params?.command) return { ok: false, code: "invalid_command", detail: "Command missing" };
        return transport.dispatchCommand({ command: params.command, token: undefined });
      },
    },
    messages: {
      subscribe: (scope) => {
        const existing = subscriberHandles.get(rpc);
        if (existing) {
          existing.unsubscribe();
          subscriberHandles.delete(rpc);
        }

        const subRes = transport.createSubscription(undefined, scope || {});
        if (subRes.ok) {
          const offEvent = subRes.subscription.onEvent((event) => {
            try {
              rpc.send.event(event);
            } catch {
              // Subscriber went away
            }
          });
          subscriberHandles.set(rpc, {
            offEvent,
            unsubscribe: () => {
              offEvent();
              subRes.subscription.unsubscribe();
            },
          });
        }
      },
      unsubscribe: () => {
        const handle = subscriberHandles.get(rpc);
        if (handle) {
          handle.unsubscribe();
          subscriberHandles.delete(rpc);
        }
      },
    },
  },
});

export function createWindow(url: string) {
  console.log(`[LabQ Code] Creating BrowserWindow with URL: ${url}`);
  const win = new BrowserWindow({
    title: "LabQ Code",
    url,
    frame: { width: 1280, height: 800, x: 200, y: 200 },
    rpc,
    hidden: false,
    activate: true,
  });

  // Open WebKit DevTools console for debugging
  try {
    win.webview.openDevTools();
  } catch (e) {
    console.error("[LabQ Code] Could not open DevTools:", e);
  }

  return win;
}

// The Bun module is imported by unit tests without Electrobun's native FFI
// bridge. Only the packaged/native process should create the application window.
if (!app.isCarrotMode) {
  const url = await getMainViewUrl();
  console.log(`[LabQ Code] Initializing window with URL: ${url}`);
  createWindow(url);
}