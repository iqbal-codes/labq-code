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
export interface PersistedSessionMetadata {
  session_id: string;
  provider_name: string;
  project_workspace_path: string;
  model: PiModelId;
  access_profile: RuntimeAccessProfile;
  session_status?: string;
}

export interface ResumeMatchParams {
  session_id: string;
  provider_name: string;
  project_workspace_path: string;
  model: PiModelId;
  access_profile: RuntimeAccessProfile;
}

export type ExplicitResumeResult =
  | { can_resume: true; reason: "matching_persisted_session" }
  | { can_resume: false; reason: "session_stopped" | "provider_mismatch" | "workspace_mismatch" | "model_mismatch" | "access_profile_mismatch" | "session_id_mismatch" };

/**
 * Evaluates whether explicit resume is offered for a persisted provider session.
 * Explicit resume is offered ONLY when persisted session identity, project workspace,
 * provider instance, model, and runtime profile match, and the session is NOT stopped.
 */
export function canResumeSession(
  persisted: PersistedSessionMetadata,
  params: ResumeMatchParams
): boolean {
  return evaluateExplicitResume(persisted, params).can_resume;
}

export function evaluateExplicitResume(
  persisted: PersistedSessionMetadata,
  params: ResumeMatchParams
): ExplicitResumeResult {
  if (persisted.session_status === "stopped") {
    return { can_resume: false, reason: "session_stopped" };
  }
  if (persisted.session_id !== params.session_id) {
    return { can_resume: false, reason: "session_id_mismatch" };
  }
  if (persisted.provider_name !== params.provider_name) {
    return { can_resume: false, reason: "provider_mismatch" };
  }
  if (persisted.project_workspace_path !== params.project_workspace_path) {
    return { can_resume: false, reason: "workspace_mismatch" };
  }
  if (persisted.model !== params.model) {
    return { can_resume: false, reason: "model_mismatch" };
  }
  if (persisted.access_profile !== params.access_profile) {
    return { can_resume: false, reason: "access_profile_mismatch" };
  }
  return { can_resume: true, reason: "matching_persisted_session" };
}