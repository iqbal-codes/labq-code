import type { Command, CommandResult, DomainEvent, Snapshot, SyncResult } from "@labq/domain/types";

/**
 * Scope for a subscription / snapshot / sync query. Mirrors the canonical
 * environment → project → thread scoping used by the orchestration transport.
 */
export interface SubscriptionScope {
  environment_id?: string;
  project_id?: string;
  thread_id?: string;
}

/**
 * Authoritative transport failure shape. Matches the `{ ok: false; code; detail }`
 * result the real orchestration transport returns for denied or failed reads.
 */
export interface TransportError {
  ok: false;
  code: string;
  detail: string;
}

export function isTransportError(value: unknown): value is TransportError {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.ok === false && typeof record.code === "string";
}

export type TransportSnapshotResult = Snapshot | TransportError;
export type TransportSyncResult = SyncResult | TransportError;

/**
 * The adapter seam. The client store depends only on this port; it can be
 * satisfied by an in-memory fake (dev/tests) or by a real typed orchestration
 * transport behind a WebSocket adapter. No component or the store constructs a
 * concrete transport, provider call, or a second server-state cache.
 */
export interface OrchestratorTransportPort {
  /** Fetch the authoritative snapshot scoped to the given environment/project/thread. */
  getScopedSnapshot(
    scope: SubscriptionScope,
  ): TransportSnapshotResult | Promise<TransportSnapshotResult>;
  /** Cursor-based replay or snapshot fallback. */
  sync(
    cursor: number,
    scope: SubscriptionScope,
  ): TransportSyncResult | Promise<TransportSyncResult>;
  /** Open a scoped subscription; returns an unsubscribe function. */
  subscribe(scope: SubscriptionScope, onEvent: (event: DomainEvent) => void): () => void;
  /** Dispatch a typed command and resolve to its authoritative result. */
  dispatchCommand(command: Command): Promise<CommandResult>;
  /** Optional native directory picker request. */
  pickDirectory?(): Promise<{ ok: boolean; path?: string; error?: string }>;
}
