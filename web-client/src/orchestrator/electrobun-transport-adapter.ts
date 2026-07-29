import type { Command, CommandResult, DomainEvent } from "@labq/domain/types";
import type {
  OrchestratorTransportPort,
  SubscriptionScope,
  TransportSnapshotResult,
  TransportSyncResult,
} from "./transport-port";
import type { OrchestratorRPCSchema } from "@labq/bun/index";

/**
 * Electrobun RPC transport adapter.
 * Uses Electroview's public RPC SDK to connect to the Bun process.
 *
 * Returns undefined when not inside an Electrobun webview, allowing the caller
 * to fall back to the dev FakeTransport.
 */
export async function createElectrobunTransport(): Promise<OrchestratorTransportPort | undefined> {
  if (
    typeof window === "undefined" ||
    !window.__electrobunWebviewId ||
    !window.__electrobunRpcSocketPort
  ) {
    return undefined;
  }

  const { Electroview } = await import("electrobun/view");

  const eventListeners = new Set<(event: DomainEvent) => void>();

  const rpc = Electroview.defineRPC<OrchestratorRPCSchema>({
    handlers: {
      requests: {},
      messages: {
        event: (event: DomainEvent) => {
          for (const listener of eventListeners) {
            try {
              listener(event);
            } catch {
              // ignore listener errors
            }
          }
        },
      },
    },
  });

  const electroview = new Electroview({ rpc });
  const electroRpc = electroview.rpc!;

  return {
    async getScopedSnapshot(scope: SubscriptionScope): Promise<TransportSnapshotResult> {
      return electroRpc.request.getScopedSnapshot({ scope }) as Promise<TransportSnapshotResult>;
    },

    async sync(cursor: number, scope: SubscriptionScope): Promise<TransportSyncResult> {
      return electroRpc.request.sync({ cursor, scope }) as Promise<TransportSyncResult>;
    },

    subscribe(scope: SubscriptionScope, onEvent: (event: DomainEvent) => void): () => void {
      if (eventListeners.size === 0) {
        electroRpc.send.subscribe(scope);
      }
      eventListeners.add(onEvent);
      return () => {
        eventListeners.delete(onEvent);
        if (eventListeners.size === 0) {
          electroRpc.send.unsubscribe();
        }
      };
    },

    async dispatchCommand(command: Command): Promise<CommandResult> {
      return electroRpc.request.dispatchCommand({ command }) as Promise<CommandResult>;
    },
  };
}
