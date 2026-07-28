# 04 — Interrupt, Stop, and Provider-Exit Handling

**What to build:** A user can interrupt a running turn or stop its embedded Pi session from the workspace. Explicit interruption, session stop, unexpected Pi runtime failure, and unresolved-request cleanup become honest durable outcomes rather than false success.

**Blocked by:** 03 — Approval and Structured-Input Pauses

**Status:** ready-for-agent

- [ ] Interrupt and stop commands are authorized, validated against the current lifecycle state, and idempotent.
- [ ] Pi interruption aborts the active operation while preserving a valid session when possible; session stop aborts active work, disposes the session, marks it stopped, and requires a new session.
- [ ] Provider interruption and session stop finalize unresolved approvals and structured-input requests and end runtime ingestion.
- [ ] An unexpected Pi runtime failure or process-backed provider exit produces structured failure or interruption state and never synthesizes successful turn completion.
- [ ] The settled lifecycle outcome, sanitized provider error metadata, session state, and request finalization are visible in snapshots and replayable events.
- [ ] Process-lifecycle tests cover explicit interrupt, stop/dispose, unexpected failure, unresolved-request cleanup, explicit resume matching, and consistent fresh-client state.
