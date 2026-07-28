# 07 — Rebuildable and Bounded Orchestrator Operations

**What to build:** Operators can rebuild projections from immutable history, observe and retry projection failures, inspect correlation-safe protocol diagnostics, and enforce retention bounds without changing latest-turn or pending-request semantics.

**Blocked by:** 05 — Authoritative Streaming and Reconnect Recovery; 06 — Canonical Plans, Diffs, and Checkpoint State

**Status:** done

- [x] Replaying complete event history reconstructs the same thread snapshots, plans, activities, messages, latest turn, and pending requests as live projection.
- [x] Projection failures are observable, retriable, and never silently omit an appended event from query state.
- [x] Message, activity, and checkpoint retention is bounded while latest-turn, completion, and pending-request semantics remain correct.
- [x] Canonical protocol diagnostics retain command, causation, correlation, provider, and request identifiers without exposing raw provider payloads to clients.
- [x] Rebuild, retry, retention, and diagnostics tests verify deterministic recovery and bounded read models.
