# 01 — Durable Project and Thread Workspace

**What to build:** A user can create, configure, archive, settle, and delete multiple projects and threads through the typed orchestration command/query seam. Project creation binds a local folder or acquires a generic Git URL transactionally, while hosted source rows remain setup-required until configured. The server validates lifecycle transitions, persists immutable sequenced events and command receipts, and projects them into a fresh snapshot.

**Blocked by:** None — can start immediately

**Status:** complete

- [x] Project and thread commands accept the curated Pi model, fixed runtime access profile, and canonical interaction mode; Pi advertises only `execute`, and a fresh query exposes those choices in durable state.
- [x] Project source commands validate local binding and managed Git URL acquisition, clean managed cancellation artifacts, and never create a partial project on failure.
- [x] Multiple projects and threads have independent aggregate identity, scoped queries, lifecycle state, and subscriptions; delete creates a durable tombstone without deleting a user-owned local folder.
- [x] Valid commands append immutable, globally ordered events with command identity and correlation metadata; malformed or impossible transitions are rejected without changing state.
- [x] Repeating a command ID returns the original command result and receipt without appending another outcome.
- [x] Rebuilding the project and thread snapshot from the event history produces the same result as the live projection.
- [x] Deterministic engine tests cover creation, source lifecycle, thread configuration, lifecycle validation, invalid configuration, idempotency, event ordering, tombstones, and projection convergence.
