import { useState, useEffect } from "react";
import { RouterProvider } from "react-router";
import { OrchestratorClientProvider } from "@/orchestrator/StoreContext";
import { FakeTransport } from "@/orchestrator/fake-transport";
import { createInitialSnapshot } from "@labq/engine/projector";
import { createElectrobunTransport } from "@/orchestrator/electrobun-transport-adapter";
import type { OrchestratorTransportPort } from "@/orchestrator/transport-port";
import { router } from "./router";

async function createTransport(): Promise<OrchestratorTransportPort> {
  // Try Electrobun RPC first (desktop app)
  const eb = await createElectrobunTransport();
  if (eb) return eb;

  // Fall back to in-memory fake for dev / browser
  const transport = new FakeTransport();
  const initial = createInitialSnapshot();
  transport.setSnapshot(initial);
  return transport;
}

function AppInner({ transport }: { transport: OrchestratorTransportPort }) {
  return (
    <OrchestratorClientProvider port={transport}>
      <RouterProvider router={router} />
    </OrchestratorClientProvider>
  );
}

export function App() {
  const [transport, setTransport] = useState<OrchestratorTransportPort | null>(null);

  useEffect(() => {
    createTransport().then(setTransport);
  }, []);

  if (!transport) {
    return (
      <div
        style={{
          background: "#0a0a0a",
          color: "#d8d8d8",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
        }}
      >
        Loading\u2026
      </div>
    );
  }

  return <AppInner transport={transport} />;
}
