import { createStore, type StoreApi } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  Command,
  CommandReceipt,
  CommandResult,
  DomainEvent,
  Snapshot,
} from "@labq/domain/types";
import { applyOrderedEvent, createEmptyProjection, recoverProjection } from "./projection";
import {
  type OrchestratorTransportPort,
  type SubscriptionScope,
  isTransportError,
} from "./transport-port";

export type BootstrapStatus = "idle" | "connecting" | "ready" | "unauthorized" | "error";
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
export type SyncStatus = "idle" | "syncing" | "synced" | "stale" | "gap";

export interface OrchestratorClientState {
  /** Canonical authoritative projection. Never holds component-local intent. */
  snapshot: Snapshot;
  bootstrapStatus: BootstrapStatus;
  connection: ConnectionStatus;
  sync: SyncStatus;
  /** Exclusive recovery cursor: highest sequence the client has applied. */
  recoveryCursor: number;
  /** Command receipts keyed by command_id (idempotent reconciliation). */
  receipts: Record<string, CommandReceipt>;
  /** Last authoritative transport error, if any. */
  error: { code: string; detail: string } | null;
  token: string | undefined;

  connect: () => Promise<void>;
  disconnect: () => void;
  /** Simulated involuntary drop (test/dev): cached state becomes stale. */
  simulateDisconnect: () => void;
  reconnect: () => Promise<void>;
  /** Apply one live, server-authoritative event (ordered, at-most-once). */
  applyEvent: (event: DomainEvent) => void;
  /** Dispatch a typed command and record its receipt. */
  dispatch: (command: Command) => Promise<CommandResult>;
  /** Retry bootstrap after a recoverable error. */
  retry: () => Promise<void>;
  /** Optional native directory picker. */
  pickDirectory: () => Promise<{ ok: boolean; path?: string; error?: string }>;
}

export type OrchestratorClientStore = StoreApi<OrchestratorClientState>;

export interface CreateStoreOptions {
  token?: string;
  scope?: SubscriptionScope;
  maxRecoveryAttempts?: number;
}

export function createOrchestratorClientStore(
  port: OrchestratorTransportPort,
  opts: CreateStoreOptions = {},
): OrchestratorClientStore {
  const scope: SubscriptionScope = opts.scope ?? {};
  const maxRecoveryAttempts = Math.max(1, opts.maxRecoveryAttempts ?? 3);

  return createStore<OrchestratorClientState>()(
    subscribeWithSelector((set, get) => {
      let unsubscribe: (() => void) | null = null;
      let recoveryPromise: Promise<void> | null = null;

      const clearSubscription = () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };

      const ensureSubscription = () => {
        if (unsubscribe) return;
        unsubscribe = port.subscribe(scope, (event) => {
          get().applyEvent(event);
        });
      };

      const recordReceipt = (commandId: string, result: CommandResult, sequence: number | null) => {
        set((state) => {
          const existing = state.receipts[commandId];
          if (existing && result.duplicate) return state;
          const sequences =
            sequence == null
              ? (existing?.sequences ?? [])
              : [...(existing?.sequences ?? []), sequence];
          const receipt: CommandReceipt = { command_id: commandId, result, sequences };
          return { receipts: { ...state.receipts, [commandId]: receipt } };
        });
      };

      return {
        snapshot: createEmptyProjection().snapshot,
        bootstrapStatus: "idle",
        connection: "disconnected",
        sync: "idle",
        recoveryCursor: 0,
        receipts: {},
        error: null,
        token: opts.token,

        async connect() {
          set({
            bootstrapStatus: "connecting",
            connection: "connecting",
            error: null,
            sync: "syncing",
          });
          const snap = await port.getScopedSnapshot(scope);
          if (isTransportError(snap)) {
            clearSubscription();
            set({
              connection: "disconnected",
              sync: "stale",
              error: { code: snap.code, detail: snap.detail },
              bootstrapStatus: snap.code === "unauthorized" ? "unauthorized" : "error",
            });
            return;
          }
          set({
            snapshot: structuredClone(snap),
            recoveryCursor: snap.sequence,
            connection: "connected",
            sync: "synced",
            bootstrapStatus: "ready",
          });
          ensureSubscription();
        },

        disconnect() {
          clearSubscription();
          set({ connection: "disconnected", sync: "idle" });
        },

        simulateDisconnect() {
          clearSubscription();
          // Cached canonical state is retained but labelled stale; the client
          // does not erase a settled view during an ordinary drop.
          set({ connection: "reconnecting", sync: "stale" });
          void get().reconnect();
        },

        async reconnect() {
          if (recoveryPromise) {
            return recoveryPromise;
          }

          const performRecovery = async () => {
            set({ connection: "reconnecting", sync: "syncing" });
            clearSubscription();

            let attempts = 0;
            while (attempts < maxRecoveryAttempts) {
              attempts++;
              const cursor = get().recoveryCursor;
              const syncRes = await port.sync(cursor, scope);

              if (isTransportError(syncRes)) {
                continue;
              }

              const recovered = recoverProjection(
                { snapshot: get().snapshot, lastSequence: get().recoveryCursor },
                syncRes
              );

              if (recovered.complete) {
                set({
                  snapshot: recovered.state.snapshot,
                  recoveryCursor: recovered.state.lastSequence,
                  connection: "connected",
                  sync: "synced",
                });
                ensureSubscription();
                return;
              }
            }

            // Fresh snapshot fallback after maxRecoveryAttempts
            const snap = await port.getScopedSnapshot(scope);
            if (isTransportError(snap)) {
              set({
                connection: "disconnected",
                sync: "stale",
                error: { code: snap.code, detail: snap.detail },
                bootstrapStatus: snap.code === "unauthorized" ? "unauthorized" : "error",
              });
              return;
            }

            const currentCursor = get().recoveryCursor;
            if (snap.sequence >= currentCursor) {
              set({
                snapshot: snap.sequence > currentCursor ? structuredClone(snap) : get().snapshot,
                recoveryCursor: Math.max(currentCursor, snap.sequence),
                connection: "connected",
                sync: "synced",
                bootstrapStatus: "ready",
              });
              ensureSubscription();
            } else {
              set({
                connection: "disconnected",
                sync: "stale",
                error: { code: "stale_snapshot", detail: "Returned snapshot sequence is older than current recovery cursor." },
              });
            }
          };

          recoveryPromise = performRecovery().finally(() => {
            recoveryPromise = null;
          });

          return recoveryPromise;
        },

        applyEvent(event: DomainEvent) {
          const outcome = applyOrderedEvent(
            { snapshot: get().snapshot, lastSequence: get().recoveryCursor },
            event,
          );
          if (outcome.gap) {
            // Sequence gap: do not apply; trigger exclusive-cursor replay.
            set({ sync: "gap", connection: "reconnecting" });
            void get().reconnect();
            return;
          }
          set({
            snapshot: outcome.state.snapshot,
            recoveryCursor: outcome.state.lastSequence,
            sync: "synced",
            connection: get().connection === "reconnecting" ? "connected" : get().connection,
          });
          if (outcome.applied && event.command_id) {
            recordReceipt(event.command_id, { ok: true }, event.sequence);
          }
        },

        async dispatch(command: Command) {
          const result = await port.dispatchCommand(command);
          recordReceipt(command.command_id, result, null);
          if (!result.ok) {
            set({
              error:
                result.code === "unauthorized"
                  ? { code: result.code, detail: result.detail }
                  : get().error,
            });
          }
          return result;
        },

        async retry() {
          await get().connect();
        },

        async pickDirectory() {
          if (typeof port.pickDirectory === "function") {
            return port.pickDirectory();
          }
          return { ok: false, error: "Native directory picker not available" };
        },
      };
    }),
  );
}
