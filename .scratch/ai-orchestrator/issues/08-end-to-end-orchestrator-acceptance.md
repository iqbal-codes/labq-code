# 08 — End-to-End Orchestrator Acceptance

**What to build:** A deterministic integrated harness and smoke scenario prove the complete first delivery: bind/acquire a source, create a project and thread, submit a prompt to the embedded Pi adapter, stream assistant and tool activity, pause and answer approval or structured input, complete the turn, disconnect and reconnect, compare recovered state with live state, fail the Pi runtime during a pending turn, and retry a command ID.

**Blocked by:** 05 — Authoritative Streaming and Reconnect Recovery; 06 — Canonical Plans, Diffs, and Checkpoint State; 07 — Rebuildable and Bounded Orchestrator Operations

**Status:** ready-for-agent

- [x] The normal prompt-to-completion scenario passes through the integrated orchestration seam using the embedded Pi SDK adapter, or a protocol-faithful fixture only when Pi cannot run in the environment.
- [x] The scenario creates a project from a local folder or generic Git URL, verifies hosted source setup-required state, and creates no partial project on source failure.
- [x] The scenario creates a thread with an available Pi model, fixed runtime access profile, and `execute` interaction mode.
- [x] The scenario observes streamed assistant text, canonical activity, a pre-execution pending approval or structured question, a correlated response, and a correct final turn state.
- [x] Pi runtime failure during a pending turn produces replayable honest failure or interruption state and finalizes unresolved requests.
- [x] Explicit resume is offered only for a matching persisted Pi session; reconnect alone does not resume provider work, and explicit stop is not resumable.
- [x] Submitting the same command ID twice produces one durable outcome and one command receipt.
- [x] A fresh client and a recovered client render equivalent state with no duplicated messages, activities, approvals, or turns.

## Comments

- Completed with a deterministic protocol-faithful acceptance harness, a real embedded Pi SDK normal-turn probe, and an Electrobun desktop host. Verified with 102 passing Bun tests, TypeScript typecheck, a successful macOS ARM64 Electrobun build, packaged deterministic smoke, and packaged real-Pi smoke returning `ELECTROBUN_PI_OK`.
