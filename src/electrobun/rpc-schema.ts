import type { RPCSchema } from "electrobun/bun";
import type { RealPiSmokeReport } from "../acceptance/real-pi-smoke.js";
import type { Ticket08AcceptanceReport } from "../acceptance/ticket-08-smoke.js";

export interface ElectrobunAcceptanceReport {
  passed: boolean;
  deterministic: Ticket08AcceptanceReport;
  real_pi?: RealPiSmokeReport;
}

export type AcceptanceRPC = {
  bun: RPCSchema<{
    requests: {
      getReport: { params: {}; response: ElectrobunAcceptanceReport };
      rerun: { params: {}; response: ElectrobunAcceptanceReport };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {};
  }>;
};
