# 03 — Approval and Structured-Input Pauses

**What to build:** When the embedded Pi adapter's server-mediated custom tool requests approval or structured user input, the workspace presents the exact pending request and pauses the turn. The user can approve, decline, or answer all requested fields in one response, after which the adapter returns a correlated result to Pi and the turn resumes or settles.

**Blocked by:** 02 — Provider-Backed Streamed Turns

**Status:** ready-for-agent

- [ ] Adapter-owned Pi custom tools create canonical approval requests before mutating operations execute and create canonical structured-input requests for supported questions.
- [ ] Provider approval requests and structured questions appear as canonical pending requests in snapshots and ordered events with their operation, fields, and request metadata.
- [ ] Approval and input responses are accepted only for the matching environment, project, thread, turn, provider session, and request identity.
- [ ] Approval, decline, and complete structured-input responses resolve the pending request durably and route the response back through the provider service.
- [ ] Decline returns a structured denial to Pi without fabricating turn success; Pi may continue or settle from the denial.
- [ ] Structured input supports flat required/optional text, multiline text, number, boolean, and single-select enum fields in one atomic response.
- [ ] Stale, duplicate, late, or already-resolved responses are rejected safely without mutating the current turn or another request.
- [ ] Connected clients derive pending requests deterministically, and tests cover pre-execution gating, pause, response correlation, resolution, decline, stale-response rejection, and provider continuation.
