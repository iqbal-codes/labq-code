# 02 — Provider-Backed Streamed Turns

**What to build:** From the orchestration workspace, a user can submit a prompt with optional bounded image attachments to one embedded Pi provider adapter and observe a queued-to-running turn with streamed assistant text and canonical tool activity. Provider-specific SDK traffic stays behind the provider-neutral service and adapter seams.

**Blocked by:** 01 — Durable Project and Thread Workspace

**Status:** ready-for-agent

- [ ] Starting a turn durably records the user message before provider execution begins and exposes queued and running lifecycle state.
- [ ] The embedded Pi adapter receives the selected thread, bound project workspace, Pi provider instance, curated model, fixed runtime access profile, `execute` interaction mode, image content when present, and correlation metadata.
- [ ] Provider runtime observations are normalized into canonical assistant messages and activities; raw Pi payloads do not enter client-facing orchestration state.
- [ ] Incremental assistant deltas assemble into one stable message without duplicate content, and tool activities expose meaningful in-progress, success, failure, decline, and interruption states.
- [ ] One queued/running/paused orchestration turn is allowed per thread; Pi steer/follow-up queueing is not exposed as additional client turns.
- [ ] Provider adapter and orchestration tests verify Pi SDK routing, canonical normalization, deterministic draining, streaming assembly, image bounds, and completion of a successful turn.
