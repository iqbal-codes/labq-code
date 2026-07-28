import type {
  ProviderAdapter,
  CanonicalProviderEvent,
  StartTurnParams,
  InterruptTurnParams,
  StopTurnParams,
  RespondToRequestParams,
} from "./provider-adapter.js";
import type {
  PiModelId,
  RuntimeAccessProfile,
  InteractionMode,
} from "../domain/types.js";

/**
 * Provider service — the only cross-provider facade.
 * Routes provider instance identity, model, runtime profile, interaction mode,
 * session, turn, approval, input, stop, resume, and capability commands.
 *
 * In v1, only Pi is registered. The facade exists so future providers
 * are added without changing the engine or client contracts.
 */
export class ProviderService {
  private adapters: Map<string, ProviderAdapter> = new Map();

  /**
   * Register a named provider adapter.
   * Pi is registered as "pi" in v1.
   */
  registerAdapter(providerName: string, adapter: ProviderAdapter): void {
    this.adapters.set(providerName, adapter);
  }

  /**
   * Get a registered adapter by name.
   */
  getAdapter(providerName: string): ProviderAdapter | undefined {
    return this.adapters.get(providerName);
  }

  /**
   * Check if a provider is registered.
   */
  hasAdapter(providerName: string): boolean {
    return this.adapters.has(providerName);
  }

  /**
   * Start a turn on the specified provider.
   * Returns an async iterable of canonical provider events.
   */
  startTurn(
    providerName: string,
    params: StartTurnParams
  ): AsyncIterable<CanonicalProviderEvent> {
    const adapter = this.adapters.get(providerName);
    if (!adapter) {
      return this.singleEventIterable({
        kind: "provider_turn_failed",
        code: "provider_not_found",
        detail: `Provider '${providerName}' is not registered.`,
      });
    }
    return adapter.startTurn(params);
  }

  /**
   * Interrupt an active turn on the specified provider.
   */
  async interruptTurn(
    providerName: string,
    params: InterruptTurnParams
  ): Promise<void> {
    const adapter = this.adapters.get(providerName);
    if (!adapter) return;
    return adapter.interruptTurn(params);
  }

  /**
   * Stop (hard-dispose) a turn on the specified provider.
   */
  async stopTurn(
    providerName: string,
    params: StopTurnParams
  ): Promise<void> {
    const adapter = this.adapters.get(providerName);
    if (!adapter) return;
    return adapter.stopTurn(params);
  }

  /**
   * Respond to a pending approval or structured-input request.
   * Routes the correlated result back through the provider adapter.
   */
  async respondToRequest(
    providerName: string,
    params: RespondToRequestParams
  ): Promise<void> {
    const adapter = this.adapters.get(providerName);
    if (!adapter) return;
    return adapter.respondToRequest(params);
  }

  private async *singleEventIterable(
    event: CanonicalProviderEvent
  ): AsyncIterable<CanonicalProviderEvent> {
    yield event;
  }
}

/**
 * Resolve a thread's project workspace path from the snapshot.
 */
export function resolveWorkspacePath(
  thread: { project_id: string },
  projects: Record<string, { source?: { workspace_path?: string } }>
): string | undefined {
  const project = projects[thread.project_id];
  if (!project) return undefined;
  return project.source?.workspace_path;
}