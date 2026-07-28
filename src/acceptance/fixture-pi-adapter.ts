import type {
  CanonicalProviderEvent,
  InterruptTurnParams,
  ProviderAdapter,
  RespondToRequestParams,
  StartTurnParams,
  StopTurnParams,
} from "../engine/provider-adapter.js";

/** Protocol-faithful Pi fixture used when a real provider turn is unavailable. */
export interface TurnScenario {
  events: CanonicalProviderEvent[];
  afterResponseEvents?: CanonicalProviderEvent[];
  eventDelayMs?: number;
}

interface DeferredResponse {
  promise: Promise<void>;
  resolve: () => void;
}

export class FixturePiAdapter implements ProviderAdapter {
  private scenarios = new Map<string, TurnScenario>();
  private pendingResponses = new Map<string, DeferredResponse>();
  private defaultScenario: TurnScenario = {
    events: [
      { kind: "provider_turn_started" },
      { kind: "assistant_text_delta", text: "I'll help you with that." },
      { kind: "assistant_message_completed" },
      { kind: "provider_turn_completed" },
    ],
  };

  public startTurnCalls: StartTurnParams[] = [];
  public interruptCalls: InterruptTurnParams[] = [];
  public stopCalls: StopTurnParams[] = [];
  public respondCalls: RespondToRequestParams[] = [];

  setScenario(threadId: string, scenario: TurnScenario): void {
    this.scenarios.set(threadId, scenario);
  }

  setDefaultScenario(scenario: TurnScenario): void {
    this.defaultScenario = scenario;
  }

  async *startTurn(params: StartTurnParams): AsyncIterable<CanonicalProviderEvent> {
    this.startTurnCalls.push({ ...params });
    const scenario = this.scenarios.get(params.thread_id) ?? this.defaultScenario;
    const delay = scenario.eventDelayMs ?? 0;
    let pendingRequestId: string | undefined;

    for (const event of scenario.events) {
      if (params.signal?.aborted) return;

      if (event.kind === "approval_requested" || event.kind === "input_requested") {
        pendingRequestId = event.request_id;
        let resolve!: () => void;
        const promise = new Promise<void>((done) => {
          resolve = done;
        });
        this.pendingResponses.set(pendingRequestId, { promise, resolve });
      }

      yield event;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (scenario.afterResponseEvents && pendingRequestId) {
      const pending = this.pendingResponses.get(pendingRequestId);
      if (pending) {
        await Promise.race([
          pending.promise,
          new Promise<void>((resolve) => {
            if (params.signal?.aborted) {
              resolve();
              return;
            }
            params.signal?.addEventListener("abort", () => resolve(), { once: true });
          }),
        ]);
      }
      this.pendingResponses.delete(pendingRequestId);
      if (params.signal?.aborted) return;

      for (const event of scenario.afterResponseEvents) {
        if (params.signal?.aborted) return;
        yield event;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async respondToRequest(params: RespondToRequestParams): Promise<void> {
    this.respondCalls.push({ ...params });
    this.pendingResponses.get(params.request_id)?.resolve();
  }

  async interruptTurn(params: InterruptTurnParams): Promise<void> {
    this.interruptCalls.push({ ...params });
  }

  async stopTurn(params: StopTurnParams): Promise<void> {
    this.stopCalls.push({ ...params });
  }
}
