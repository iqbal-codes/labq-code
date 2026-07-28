import { RouterProvider } from "react-router";
import { OrchestratorClientProvider } from "@/orchestrator/StoreContext";
import { FakeTransport } from "@/orchestrator/fake-transport";
import { router } from "./router";
import { createInitialSnapshot } from "@labq/engine/projector";

/** Seed a FakeTransport with sample data for dev bootstrap. */
function createDevTransport() {
  const transport = new FakeTransport();
  const initial = createInitialSnapshot();
  transport.setSnapshot(initial);
  return transport;
}

export function App() {
  return (
    <OrchestratorClientProvider port={createDevTransport()}>
      <RouterProvider router={router} />
    </OrchestratorClientProvider>
  );
}
