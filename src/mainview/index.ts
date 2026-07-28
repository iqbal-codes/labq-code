import Electrobun, { Electroview } from "electrobun/view";
import type { AcceptanceRPC, ElectrobunAcceptanceReport } from "../electrobun/rpc-schema.js";

const app = new Electrobun.Electroview({
  rpc: Electroview.defineRPC<AcceptanceRPC>({
    maxRequestTime: 180_000,
    handlers: { requests: {}, messages: {} },
  }),
});

const status = document.querySelector<HTMLElement>("#status")!;
const summary = document.querySelector<HTMLElement>("#summary")!;
const checks = document.querySelector<HTMLElement>("#checks")!;
const events = document.querySelector<HTMLElement>("#events")!;
const rerun = document.querySelector<HTMLButtonElement>("#rerun")!;

function render(report: ElectrobunAcceptanceReport): void {
  document.body.dataset.result = report.passed ? "pass" : "fail";
  status.textContent = report.passed ? "PASS" : "FAIL";
  summary.textContent = `${report.deterministic.checks.filter((item) => item.passed).length}/${report.deterministic.checks.length} deterministic checks · sequence ${report.deterministic.live_sequence}`;
  checks.innerHTML = report.deterministic.checks
    .map(
      (item) => `<article class="check ${item.passed ? "pass" : "fail"}">
        <span class="icon">${item.passed ? "✓" : "×"}</span>
        <div><strong>${item.label}</strong><code>${item.id}</code><p>${item.detail}</p></div>
      </article>`
    )
    .join("");
  const pi = report.real_pi;
  events.textContent = pi
    ? `Real Pi SDK: ${pi.passed ? "PASS" : "FAIL"} · ${pi.final_status} · ${pi.model_response || pi.failure || "no output"}`
    : `Fixture event stream: ${report.deterministic.event_kinds.join(" → ")}`;
}

async function load(): Promise<void> {
  render(await app.rpc!.request.getReport({}));
}

rerun.addEventListener("click", async () => {
  rerun.disabled = true;
  rerun.textContent = "Running…";
  try {
    render(await app.rpc!.request.rerun({}));
  } finally {
    rerun.disabled = false;
    rerun.textContent = "Run acceptance again";
  }
});

void load();
