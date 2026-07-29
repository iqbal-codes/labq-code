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
    if (snap.sequence <= state.lastSequence) {
      return { state, applied: false, gap: false };
    }
    const next: ProjectionState = {
      snapshot: structuredClone(snap),
      lastSequence: snap.sequence,
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

export interface RecoverResult {
  state: ProjectionState;
  complete: boolean;
}

/**
 * Recover the projection from a sync result, starting strictly after the last
 * applied exclusive sequence. Replay applies only events beyond the cursor; a
 * snapshot result replaces local state with fresh authoritative state.
 */
export function recoverProjection(state: ProjectionState, sync: SyncResult): RecoverResult {
  if (sync.mode === "up_to_date") {
    return { state, complete: true };
  }
  if (sync.mode === "replay") {
    const events = sync.events;
    if (events.length === 0 && state.lastSequence < sync.to) {
      return { state, complete: false };
    }

    let current = state;
    let expectedSeq = state.lastSequence + 1;

    for (const event of events) {
      if (event.sequence <= state.lastSequence) {
        continue;
      }
      if (event.sequence !== expectedSeq) {
        return { state, complete: false };
      }
      const outcome = applyOrderedEvent(current, event);
      if (!outcome.applied || outcome.gap) {
        return { state, complete: false };
      }
      current = outcome.state;
      expectedSeq++;
    }

    if (current.lastSequence !== sync.to) {
      return { state, complete: false };
    }

    return { state: current, complete: true };
  }
  if (sync.mode === "snapshot") {
    if (sync.snapshot.sequence < state.lastSequence) {
      return { state, complete: false };
    }
    if (sync.snapshot.sequence === state.lastSequence) {
      return { state, complete: true };
    }
    return {
      state: {
        snapshot: structuredClone(sync.snapshot),
        lastSequence: sync.sequence,
      },
      complete: true,
    };
  }
  return { state, complete: false };
}
