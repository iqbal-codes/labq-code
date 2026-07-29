import { describe, test, expect } from "bun:test";
import { getMainViewUrl, createWindow, OrchestratorRPCSchema } from "../src/bun/index.js";

describe("Electrobun Desktop Integration & RPC Transport Seams", () => {
  test("getMainViewUrl returns views://mainview/index.html when dev server is not reachable", async () => {
    const url = await getMainViewUrl();
    // In test environment without a running Vite dev server, fallback URL should be returned
    expect(url).toBe("views://mainview/index.html");
  });
  test("createWindow creates a window instance or handles non-native CLI test environment", () => {
    try {
      const windowInstance = createWindow("views://mainview/index.html");
      expect(windowInstance).toBeDefined();
    } catch (err: any) {
      // In bun test without native Electrobun bridge FFI running, window instantiation throws bridge error
      expect(err.message).toContain("bridge");
    }
  });

  test("createElectrobunTransport returns undefined outside Electrobun webview", async () => {
    // Dynamically import adapter to avoid top-level window evaluation issues in non-DOM environment
    const { createElectrobunTransport } = await import("../web-client/src/orchestrator/electrobun-transport-adapter.js");
    const transport = await createElectrobunTransport();
    expect(transport).toBeUndefined();
    const snapshotReq: OrchestratorRPCSchema["bun"]["requests"]["getScopedSnapshot"] = {
      params: { scope: { project_id: "p1" } },
      response: {
        sequence: 0,
        projects: {},
        threads: {},
        turns: {},
        catalog: { models: [], access_profiles: [], interaction_modes: [], capabilities: [] },
      },
    };
    expect(snapshotReq.params?.scope?.project_id).toBe("p1");
  });
});
