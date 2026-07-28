import { ProviderService } from "../engine/provider-service.js";
import { OrchestratorEngine } from "../engine/engine.js";
import { PiAdapter } from "../engine/pi-adapter.js";
import { SourceManager } from "../source/source-manager.js";
import { OrchestratorTransport } from "../transport/transport.js";

export interface RealPiSmokeReport {
  passed: boolean;
  model_response: string;
  final_status: string;
  failure?: string;
}

function waitForTerminalTurn(
  engine: OrchestratorEngine,
  turnId: string,
  timeoutMs = 120_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Real Pi turn '${turnId}' timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const unsubscribe = engine.subscribe(
      (event) => {
        const data = event.data as Record<string, unknown>;
        if (data.turn_id !== turnId) return;
        if (!["TurnCompleted", "TurnFailed", "TurnInterrupted"].includes(event.kind)) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      },
      undefined,
      { emitInitialSnapshot: false }
    );
  });
}

/** Executes one normal orchestration turn against the real embedded Pi SDK. */
export async function runRealPiOrchestrationSmoke(
  workspacePath: string
): Promise<RealPiSmokeReport> {
  const adapter = new PiAdapter();
  const providers = new ProviderService();
  providers.registerAdapter("pi", adapter);
  const engine = new OrchestratorEngine(new SourceManager(), providers);
  const transport = new OrchestratorTransport({ engine });

  try {
    const project = await transport.dispatchCommand({
      command: {
        kind: "create_project",
        command_id: "real-pi-project",
        name: "Embedded Pi smoke",
        source: { kind: "local_folder", path: workspacePath },
      },
    });
    if (!project.ok || !project.project_id) {
      throw new Error(project.ok ? "Real Pi project ID was not returned." : project.detail);
    }

    const thread = await transport.dispatchCommand({
      command: {
        kind: "create_thread",
        command_id: "real-pi-thread",
        thread_id: "real-pi-thread",
        project_id: project.project_id,
        title: "Embedded Pi SDK",
        model: "pi-default",
        access_profile: "read-only",
        interaction_mode: "execute",
      },
    });
    if (!thread.ok || !thread.thread_id) {
      throw new Error(thread.ok ? "Real Pi thread ID was not returned." : thread.detail);
    }

    const terminal = waitForTerminalTurn(engine, "real-pi-turn");
    const turnResult = await transport.dispatchCommand({
      command: {
        kind: "start_turn",
        command_id: "real-pi-turn",
        turn_id: "real-pi-turn",
        thread_id: thread.thread_id,
        content: {
          text: "Reply with exactly ELECTROBUN_PI_OK. Do not call any tools.",
        },
      },
    });
    if (!turnResult.ok) throw new Error(turnResult.detail);
    await terminal;

    const turn = engine.getTurn("real-pi-turn");
    const modelResponse =
      turn?.assistant_message?.parts
        .filter((part) => part.kind === "text")
        .map((part) => part.content)
        .join("") ?? "";
    const passed = turn?.status === "completed" && modelResponse.trim() === "ELECTROBUN_PI_OK";

    return {
      passed,
      model_response: modelResponse,
      final_status: turn?.status ?? "missing",
      failure: turn?.error?.detail,
    };
  } catch (error: unknown) {
    return {
      passed: false,
      model_response: "",
      final_status: "failed",
      failure: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await adapter.shutdown();
  }
}
