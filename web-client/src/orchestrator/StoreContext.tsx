import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { OrchestratorClientStore } from "./store";
import type { OrchestratorTransportPort } from "./transport-port";
import { createOrchestratorClientStore } from "./store";

const OrchestratorClientContext = createContext<OrchestratorClientStore | null>(null);

export interface OrchestratorClientProviderProps {
  port: OrchestratorTransportPort;
  token?: string;
  children: ReactNode;
}

/**
 * Creates one client store for the app session and provides it to the tree.
 * Components consume derived selectors and dispatch typed commands; they
 * never construct a transport, provider call, retry loop, or second cache.
 */
export function OrchestratorClientProvider({
  port,
  token,
  children,
}: OrchestratorClientProviderProps) {
  const storeRef = useRef<OrchestratorClientStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createOrchestratorClientStore(port, { token });
  }
  return (
    <OrchestratorClientContext.Provider value={storeRef.current}>
      {children}
    </OrchestratorClientContext.Provider>
  );
}

export function useOrchestratorStore<T>(
  selector: (state: ReturnType<OrchestratorClientStore["getState"]>) => T,
): T {
  const store = useContext(OrchestratorClientContext);
  if (!store) {
    throw new Error("useOrchestratorStore must be used within an OrchestratorClientProvider");
  }
  return useStore(store, selector);
}

/** Stable action surface from the client store. */
export function useClientActions() {
  return useOrchestratorStore(
    useShallow((s) => ({
      connect: s.connect,
      disconnect: s.disconnect,
      simulateDisconnect: s.simulateDisconnect,
      reconnect: s.reconnect,
      dispatch: s.dispatch,
      retry: s.retry,
    })),
  );
}
