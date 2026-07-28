import { BrowserView, BrowserWindow } from "electrobun/bun";
import { runRealPiOrchestrationSmoke } from "../acceptance/real-pi-smoke.js";
import { runTicket08Acceptance } from "../acceptance/ticket-08-smoke.js";
import type { AcceptanceRPC, ElectrobunAcceptanceReport } from "./rpc-schema.js";

const workspacePath = process.env.LABQ_WORKSPACE_PATH ?? process.cwd();
const includeRealPi = process.env.LABQ_REAL_PI_SMOKE === "1";

async function runAcceptance(): Promise<ElectrobunAcceptanceReport> {
  const deterministic = await runTicket08Acceptance(workspacePath);
  const realPi = includeRealPi
    ? await runRealPiOrchestrationSmoke(workspacePath)
    : undefined;
  return {
    passed: deterministic.passed && (realPi?.passed ?? true),
    deterministic,
    real_pi: realPi,
  };
}

let currentReport = await runAcceptance();
const reportPath = process.env.LABQ_ELECTROBUN_SMOKE_REPORT;

if (reportPath) {
  await Bun.write(reportPath, `${JSON.stringify(currentReport, null, 2)}\n`);
  console.log(
    `LABQ_ELECTROBUN_SMOKE ${currentReport.passed ? "PASS" : "FAIL"} ${reportPath}`
  );
  process.exit(currentReport.passed ? 0 : 1);
}

const rpc = BrowserView.defineRPC<AcceptanceRPC>({
  maxRequestTime: 180_000,
  handlers: {
    requests: {
      getReport: () => currentReport,
      rerun: async () => {
        currentReport = await runAcceptance();
        return currentReport;
      },
    },
    messages: {},
  },
});

new BrowserWindow({
  title: "LabQ Code — Ticket 08 Acceptance",
  url: "views://mainview/index.html",
  rpc,
  frame: {
    width: 980,
    height: 760,
    x: 180,
    y: 120,
  },
});
