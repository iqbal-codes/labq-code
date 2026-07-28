import type { DomainEvent, Snapshot, SyncResult } from "@labq/domain/types";
import { applyEvent, createInitialSnapshot } from "@labq/engine/projector";

/**
 * Canonical projection state owned by the client store. `lastSequence` is the
 * exclusive recovery cursor: the highest sequence the client has applied.
 */
export interface ProjectionState {
  snapshot: Snapshot;
  lastSequence: number;
}

export function createEmptyProjection(): ProjectionState {
  return {
    snapshot: createInitialSnapshot(),
    lastSequence: 0,
  };
}

export interface ApplyOutcome {
  state: ProjectionState;
  /** Whether the event mutated the projection. */
  applied: boolean;
  /** Whether a sequence gap was detected (caller must trigger recovery). */
  gap: boolean;
}

/**
 * Apply one live, server-authoritative event at most once.
 *
 * - `SnapshotEmitted` replaces local state with the authoritative snapshot.
 * - Events with `sequence <= lastSequence` are ignored (at-most-once delivery
 *   and protection against stale cached state).
 * - A `sequence > lastSequence + 1` is a gap: the event is NOT applied and the
 *   caller must trigger exclusive-cursor replay. Newer live state never
 *   overwrites a more-recent applied sequence.
 */
export function applyOrderedEvent(state: ProjectionState, event: DomainEvent): ApplyOutcome {
  if (event.kind === "SnapshotEmitted") {
    const snap = event.data.snapshot;
    const next: ProjectionState = {
      snapshot: structuredClone(snap),
      lastSequence: Math.max(state.lastSequence, snap.sequence),
    };
    return { state: next, applied: true, gap: false };
  }

  if (event.sequence <= state.lastSequence) {
    return { state, applied: false, gap: false };
  }

  if (event.sequence > state.lastSequence + 1) {
    return { state, applied: false, gap: true };
  }

  const next: ProjectionState = {
    snapshot: applyEvent(state.snapshot, event),
    lastSequence: event.sequence,
  };
  return { state: next, applied: true, gap: false };
}

/**
 * Recover the projection from a sync result, starting strictly after the last
 * applied exclusive sequence. Replay applies only events beyond the cursor; a
 * snapshot result replaces local state with fresh authoritative state.
 */
export function recoverProjection(state: ProjectionState, sync: SyncResult): ProjectionState {
  if (sync.mode === "replay") {
    let next = state;
    for (const event of sync.events) {
      if (event.sequence > next.lastSequence) {
        next = applyOrderedEvent(next, event).state;
      }
    }
    return next;
  }
  if (sync.mode === "snapshot") {
    return {
      snapshot: structuredClone(sync.snapshot),
      lastSequence: sync.sequence,
    };
  }
  return state;
}
