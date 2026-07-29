import { OrchestratorEngine } from "../engine/engine";
import { OrchestratorTransport } from "../transport/transport";
import { defineElectrobunRPC } from "electrobun/bun";
import type { CommandResult, DomainEvent, Snapshot, SyncResult } from "../domain/types";

/** Schema shared between Bun backend and webview via Electrobun RPC. */
export interface OrchestratorRPCSchema {
  bun: {
    requests: {
      getScopedSnapshot: (params: { scope?: { environment_id?: string; project_id?: string; thread_id?: string } }) => Snapshot | { ok: false; code: string; detail: string };
      sync: (params: { cursor: number; scope?: { environment_id?: string; project_id?: string; thread_id?: string } }) => SyncResult | { ok: false; code: string; detail: string };
      dispatchCommand: (params: { command: import("../domain/types").Command }) => Promise<CommandResult>;
    };
    messages: {
      event: (payload: DomainEvent) => void;
    };
  };
  webview: {
    requests: Record<string, never>;
    messages: Record<string, never>;
  };
}

const engine = new OrchestratorEngine();
const transport = new OrchestratorTransport({ engine });

// Active subscribers: set of functions to send events to.
const subscribers = new Set<(event: DomainEvent) => void>();

// Subscribe the engine to broadcast events to all RPC subscribers.
engine.subscribe((event) => {
  for (const send of subscribers) {
    try {
      send(event);
    } catch {
      // Subscriber went away; skip.
    }
  }
});

export type RPC = typeof rpc;

const rpc = defineElectrobunRPC<OrchestratorRPCSchema, "bun">("bun", {
  handlers: {
    requests: {
      getScopedSnapshot: ({ scope }) => {
        return transport.getScopedSnapshot(undefined, scope as any) as any;
      },
      sync: ({ cursor, scope }) => {
        return transport.sync(undefined, cursor, scope as any) as any;
      },
      dispatchCommand: async ({ command }) => {
        return transport.dispatchCommand({ command, token: undefined });
      },
    },
  },
  extraRequestHandlers: {
    /** Subscribe the caller to live domain events. Returns an unsubscribe token. */
    subscribe: ({ scope }: { scope?: { environment_id?: string; project_id?: string; thread_id?: string } }) => {
      let unsubscribed = false;
      const send = (event: DomainEvent) => {
        if (unsubscribed) return;
        // The RPC framework sends a message back to the webview.
        rpc.send.event(event);
      };
      subscribers.add(send);
      return () => {
        unsubscribed = true;
        subscribers.delete(send);
      };
    },
    /** Unsubscribe a previous subscription by the returned token. */
    unsubscribe: ({ unsubscribe }: { unsubscribe: () => void }) => {
      unsubscribe();
      return { ok: true };
    },
  },
});