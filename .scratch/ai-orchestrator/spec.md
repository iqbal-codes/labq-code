# AI Orchestrator Delivery Spec

**Status:** ready-for-agent
**Triage:** ready-for-agent
**Source:** Consolidated from the approved product specification, the AI Orchestrator UI specification, the disposable orchestration prototype, the implementation tickets, and the settled Pi-provider decisions from the product review. Pi integration facts are grounded in the [Pi SDK documentation](https://pi.dev/docs/latest/sdk).
**Scope:** The first web-facing orchestration delivery: source-aware project onboarding, durable projects and threads, one embedded Pi provider adapter, canonical streamed turns, approvals and structured input, interruption and recovery, and provider-neutral snapshots/events.

## Problem Statement

The product needs a dependable AI orchestration layer rather than a chat screen coupled directly to a provider SDK. Users need durable project context, isolated threads, server-authoritative turns, streamed assistant and activity state, control over consequential operations, and recovery after client or provider failure. A pass-through provider integration would lose ordering, idempotency, request correlation, session lifecycle, and rebuildable state.

The first real provider is the Pi coding agent. Pi is an embeddable coding-agent runtime with model discovery, persistent sessions, streamed messages and tool activity, prompt submission, interruption, and cleanup. Its provider-specific runtime behavior must remain behind an adapter so clients and orchestration projections consume one canonical contract.

Project creation is source-aware. A project is not ready until a local folder binding or repository acquisition is validated and authoritatively confirmed. Hosted repository rows may be visible before their connections are configured, but setup-required state must not become a false success or create a partial project.

## Solution

Build one deep orchestration module with typed commands, durable event history, rebuildable projections, ordered subscriptions, and provider-neutral runtime state. The first vertical slice uses an embedded Pi SDK adapter and a server-owned capability catalog.

The system will:

- validate source, project, thread, turn, approval, input, stop, lifecycle, authorization, and recovery commands;
- persist immutable sequenced events and idempotent command receipts;
- bind local folders without copying or deleting user-owned files;
- acquire generic Git URLs into managed workspaces with transactional cleanup;
- keep hosted GitHub, Azure DevOps, Bitbucket, and GitLab rows visible as setup-required until configured;
- expose Pi's authenticated/available models through a curated provider-neutral catalog;
- expose fixed read-only, workspace-write, and full-execution runtime profiles;
- preserve an interaction-mode field while advertising only Pi's `execute` mode in the first delivery;
- normalize Pi assistant, tool, approval, input, completion, interruption, failure, and session events into canonical state;
- use adapter-owned server-mediated tools for pre-execution approval and structured input;
- stream snapshots and ordered events to clients, with exclusive-cursor replay and bounded snapshot fallback;
- support explicit resume only for a matching persisted Pi session;
- provide a web client with a project/thread shell and Tactical Telemetry & CRT Terminal visual direction.

## User Stories

1. As an orchestrator user, I want to create a project from a local folder or supported repository source, so that related agent work has a durable code context.
2. As an orchestrator user, I want to create a thread within a project, so that each task has isolated conversation and runtime history.
3. As an orchestrator user, I want to select an available Pi-backed model for a thread, so that I can control which configured model performs the work.
4. As an orchestrator user, I want to select a runtime access profile, so that workspace permissions match the task's risk.
5. As an orchestrator user, I want unsupported interaction modes to be explicit, so that the UI never promises a plan workflow Pi cannot guarantee.
6. As an orchestrator user, I want to send a prompt with bounded image attachments, so that the agent has supported visual context.
7. As an orchestrator user, I want my message recorded before provider execution, so that reconnect cannot erase my intent.
8. As an orchestrator user, I want to see queued and running turn states, so that I know whether work is accepted or waiting.
9. As an orchestrator user, I want assistant text to stream incrementally, so that I can follow progress without waiting for completion.
10. As an orchestrator user, I want deltas assembled into one stable message, so that transport updates do not create duplicates.
11. As an orchestrator user, I want to see tool activity as it happens, so that I understand what the agent is doing.
12. As an orchestrator user, I want activity lifecycle states, so that I can distinguish running, success, failure, decline, and interruption.
13. As an orchestrator user, I want changed-file and relevant activity summaries, so that I can understand results without reading raw provider traffic.
14. As an orchestrator user, I want risky operations to pause before execution, so that I retain control over consequential work.
15. As an orchestrator user, I want approval requests to name their operation and scope, so that decisions are informed.
16. As an orchestrator user, I want to approve or decline a pending request, so that Pi can continue with a correlated result.
17. As an orchestrator user, I want late approval responses rejected safely, so that an old UI action cannot affect another turn.
18. As an orchestrator user, I want Pi to ask structured questions, so that it collects required choices instead of guessing.
19. As an orchestrator user, I want to answer all required fields atomically, so that the provider resumes with a complete response.
20. As an orchestrator user, I want stale input responses rejected safely, so that old forms cannot mutate current work.
21. As an orchestrator user, I want to interrupt a running turn, so that I can stop an agent taking the wrong path.
22. As an orchestrator user, I want interruption to preserve a valid session when possible, so that I can inspect the result and continue deliberately.
23. As an orchestrator user, I want to stop a provider session, so that active work and unresolved requests are terminated explicitly.
24. As an orchestrator user, I want a stopped session to require a new session, so that Stop has unambiguous effect.
25. As an orchestrator user, I want provider failures represented as structured errors, so that I can distinguish runtime failure from connection failure.
26. As an orchestrator user, I want completed turns to expose final state, so that I know whether work completed, failed, or was interrupted.
27. As an orchestrator user, I want canonical plans or change summaries when supported, so that I can review implementation intent without raw provider traffic.
28. As an orchestrator user, I want unsupported rollback to be explained, so that I am not offered a dangerous fake operation.
29. As an orchestrator user, I want turn-associated change summaries, so that review data cannot attach to the wrong turn.
30. As an orchestrator user, I want to archive or settle a thread, so that inactive work leaves active navigation without deletion.
31. As an orchestrator user, I want to delete a thread, so that I can remove work from normal navigation.
32. As an orchestrator user, I want to create, archive, settle, and delete projects, so that project lifecycle is explicit rather than implicit.
33. As an orchestrator user, I want deletion not to remove my local folder, so that orchestration cleanup cannot destroy user-owned source.
34. As an orchestrator user, I want deleted aggregates hidden from normal queries, so that active navigation remains trustworthy.
35. As an orchestrator user, I want a fresh client to receive a complete snapshot, so that it can render current state independently.
36. As an orchestrator user, I want reconnect replay from my last exclusive sequence, so that I receive only missed events.
37. As an orchestrator user, I want sequence gaps detected, so that missing events cannot silently corrupt the view.
38. As an orchestrator user, I want snapshot fallback after bounded replay failure, so that recovery remains reliable.
39. As an orchestrator user, I want newer live state to beat stale cache, so that reconnect cannot roll the UI backward.
40. As an orchestrator user, I want duplicate commands to return the original receipt, so that retries do not duplicate work.
41. As an orchestrator user, I want invalid lifecycle transitions rejected, so that impossible state cannot enter history.
42. As an orchestrator user, I want event metadata to retain command and correlation identity, so that failures can be traced safely.
43. As an orchestrator user, I want provider details hidden behind canonical activities and messages, so that the client remains provider-neutral.
44. As an orchestrator user, I want a Pi session bound to one project workspace, so that an agent cannot cross source boundaries.
45. As an orchestrator user, I want explicit resume when a matching persisted Pi session exists, so that server recovery does not unnecessarily lose context.
46. As an orchestrator user, I want reconnect not to auto-resume Pi, so that network recovery cannot silently restart work.
47. As an orchestrator user, I want a provider runtime exit to finalize pending requests, so that the UI never waits forever.
48. As an orchestrator user, I want read access separate from operation access, so that observing state does not imply control.
49. As an orchestrator user, I want subscriptions scoped to my environment and thread, so that unrelated private activity is not exposed.
50. As an orchestrator operator, I want provider capabilities advertised, so that unsupported actions are explicit.
51. As an orchestrator operator, I want a curated Pi model catalog, so that client choices reflect server authentication and availability.
52. As an orchestrator operator, I want Pi credentials outside orchestration events, so that secrets cannot leak through snapshots.
53. As an orchestrator operator, I want fixed access profiles, so that clients cannot submit arbitrary tool permissions.
54. As an orchestrator operator, I want mutating tools gated before execution, so that approval is a real safety boundary.
55. As an orchestrator operator, I want canonical diagnostics with safe metadata, so that failures are actionable without raw payload exposure.
56. As an orchestrator operator, I want managed remote acquisition cleaned on cancellation, so that failed onboarding does not leak workspaces.
57. As an orchestrator operator, I want local binding and remote acquisition distinguished, so that ownership and cleanup are unambiguous.
58. As an orchestrator operator, I want projection history rebuildable, so that read models can be recovered.
59. As an orchestrator operator, I want projection failures observable and retriable, so that appended events are not silently omitted.
60. As an orchestrator operator, I want bounded message, activity, and checkpoint projections, so that long threads cannot exhaust storage.
61. As a web client developer, I want shared connection and state modules to own retry and subscription policy, so that components do not create competing transports.
62. As a web client developer, I want pure derivations for approvals, plans, timelines, and work logs, so that presentation is deterministic.
63. As a web client developer, I want client events to be canonical, so that Pi SDK changes do not rewrite UI components.
64. As a mobile client developer, I want the same snapshot, replay, and command contract later, so that mobile is another client.
65. As a future provider integrator, I want one adapter interface, so that adding a provider does not change the engine or reducer.
66. As a future client integrator, I want the orchestration interface documented, so that a client can converge without copying internals.
67. As a product owner, I want one real provider end to end before broad coverage, so that the adapter seam is proven.
68. As a product owner, I want the first delivery focused on orchestration, so that VCS, terminal, browser, and hosting scope do not dilute the core.
69. As a product owner, I want hosted source rows visible as setup-required, so that future capability is discoverable without a fake integration.
70. As a product owner, I want a desktop-style web shell without native Electron behavior, so that the presentation contract stays focused.
71. As a product owner, I want no Pi settings page in v1, so that authentication and provider configuration remain outside orchestration.
72. As a product owner, I want no raw Pi payloads in the client, so that diagnostics do not become a provider-specific data channel.
73. As a product owner, I want no plan mode presented as supported for Pi, so that interaction semantics remain honest.
74. As a product owner, I want no rollback presented for Pi, so that a patch is not confused with a transactional checkpoint.
75. As a product owner, I want the web client to use Tactical Telemetry & CRT Terminal as one visual archetype, so that state and risk read consistently.

## Implementation Decisions

- The orchestration engine is the primary deep module. It owns typed commands, invariants, event ordering, receipts, projections, replay, and recovery.
- Transport owns authentication, authorization-scope checks, wire validation, and scoped subscriptions. It does not expose provider calls directly.
- The provider service is the only cross-provider facade. It routes provider instance identity, model, runtime profile, interaction mode, session, turn, approval, input, stop, resume, and capability commands.
- The first real adapter is an embedded Pi SDK adapter using `@earendil-works/pi-coding-agent`.
- The Pi adapter owns `ModelRuntime`, `createAgentSession`, `SessionManager`, SDK event subscriptions, `prompt`, `abort`, `dispose`, model availability, and persisted session selection. Those SDK details never cross the canonical client boundary.
- Pi model selection comes from a server-owned curated catalog of authenticated/available runtime models. Underlying model-provider credentials and settings are outside orchestration state and outside the first UI delivery.
- Pi sessions are one-to-one with threads and are bound to the authoritative project workspace. A live session cannot switch project, source root, model profile, or workspace.
- Pi access profiles are fixed: read-only uses `read`, `grep`, `find`, and `ls`; workspace-write adds `edit` and `write`; full-execution adds `bash`. The client cannot supply arbitrary tool lists.
- The canonical interaction-mode field remains provider-neutral. Pi advertises `execute` only; `plan` is an explicit unsupported capability in v1.
- Pi's SDK event stream is normalized into canonical assistant message deltas, message completion, activities, session state, turn state, approvals, structured inputs, change summaries, interruptions, failures, and completion. Raw event payloads never enter client snapshots/events.
- Approval and structured-input pauses use adapter-owned server-mediated custom tools. Mutating operations are blocked before execution, normalized into pending requests, and resumed only after a response correlated to environment, project, thread, turn, session, and request identity.
- Approval decline returns a structured denial to Pi. It does not synthesize turn success or automatically force a turn settlement; Pi may continue or settle from the denial, while explicit interruption remains available.
- Structured input is a flat, atomic schema with required/optional text, multiline text, number, boolean, and single-select enum fields. Nested objects, arbitrary arrays, conditional fields, and provider-specific widgets are not canonical v1 capabilities.
- Interrupt aborts the active Pi operation and preserves the session when the lifecycle remains valid. Stop aborts active work, finalizes pending requests, disposes the session, marks it stopped, and requires a new session.
- Explicit resume is offered only when persisted session identity, project workspace, provider instance, model, and runtime profile match. Client reconnect performs orchestration replay and never triggers automatic provider resume. An explicitly stopped session is not resumable.
- One queued, running, or paused orchestration turn is allowed per thread. Pi `steer` and `followUp` queueing is not exposed as additional client turns in v1.
- Local folder source selection binds an existing user-owned path without copying or deleting it. Generic Git URL acquisition creates an orchestrator-managed workspace. Hosted sources remain setup-required until the relevant connection/capability is configured.
- Source validation and acquisition are transactional. Cancellation cleans only managed temporary artifacts; retries are idempotent; invalid, inaccessible, unauthorized, or failed acquisition creates no partial project.
- Projects and threads support create, archive, settle, and delete. Delete creates a durable tombstone, removes the aggregate from normal navigation and mutation queries, does not delete user-owned local source, and retains only bounded history according to retention policy. No v1 restore UI is required.
- The canonical event stream is immutable and globally sequenced. Command IDs are idempotency keys. Projections are rebuildable and snapshots include project/source/thread/session/turn state, activities, pending requests, plans/change summaries, and lifecycle status when supported.
- The integrated seam is the typed orchestration transport over the provider service and Pi adapter. The highest-value proof is a client command through transport, durable event/projection state, and a canonical snapshot/event subscription; provider SDK internals are tested behind the adapter seam.
- Process-backed ACP and Codex-style protocol adapters remain future-provider seams and are not required for Pi v1.
- The first web client uses a desktop-style project/thread shell. Browser, Terminal, Files, and full Diff surfaces are reserved capability slots only; no contextual surface implementation is implied. Pi settings/authentication UI is not part of the first delivery.

## Testing Decisions

- Tests assert externally observable behavior at the highest available seam. They verify commands, receipts, snapshots, ordered events, canonical activities, pending requests, and lifecycle outcomes rather than private queues, SDK object layout, SQL statements, or incidental data structures.
- The primary deterministic seam is the orchestration engine interface with deterministic service layers and in-memory persistence. It covers command acceptance/rejection, lifecycle invariants, idempotency, event order, projection convergence, retention, and replay.
- The primary integrated seam is the typed orchestration transport connected to the provider service and Pi adapter. The harness dispatches client commands, consumes canonical snapshots/events, disconnects/reconnects, and asserts convergence.
- Pi adapter tests use a controllable SDK-compatible runtime fixture or test double at the adapter seam. They cover model catalog filtering, project-workspace binding, fixed tool profiles, prompt acceptance, streamed message/tool normalization, explicit execute mode, abort, dispose, explicit resume matching, and provider failure.
- Approval/input tests drive adapter-owned custom-tool requests through the orchestration seam. They cover pre-execution gating, normalized operation/scope, atomic field validation, correlated responses, decline denial, stale/duplicate/late responses, and provider continuation or finalization.
- Source tests cover local binding, generic Git URL validation and managed acquisition, hosted setup-required capability, cancellation cleanup, retry idempotency, duplicate project commands, and no partial project on failure.
- Projection and recovery tests cover snapshots, exclusive replay, sequence gaps, no-progress limits, snapshot fallback, duplicate suppression, and newer live state winning over stale cache.
- Lifecycle tests cover one active turn per thread, interrupt preserving a valid session, stop aborting and disposing, pending-request finalization, explicit resume, unexpected runtime failure, and honest failure/interruption state.
- Authorization tests cover read-only snapshot/replay/subscribe access, operation-scope mutation access, scoped project/thread subscriptions, and safe 401/403 outcomes without source or credential leakage.
- UI validation covers source chooser keyboard behavior, setup-required states, Pi catalog and access-profile selection, execute-only interaction mode, image attachment limits, approval/input focus management, interruption/stop outcomes, project/thread lifecycle, responsive narrow layouts, 200% zoom, reduced motion, and status text that does not rely on color.
- A final smoke scenario must exercise a real embedded Pi runtime when available, or a protocol-faithful fixture only when Pi cannot run in the environment. It must pass through the integrated transport/engine/provider seam rather than calling the adapter directly.
- Existing disposable TUI reducer/model behavior is a presentation reference and smoke-test aid, not a substitute for the production orchestration seam. No production frontend or backend implementation currently exists in the repository.

## Out of Scope

- Full Electron/native desktop shell reproduction, native menus, auto-update, or platform window behavior.
- Full mobile/React Native parity and offline mobile outbox implementation.
- Cloud relay, hosted multi-tenant operations, Clerk/APNs integration, SSH, Tailscale, remote discovery, and cross-machine brokerage.
- Full Git/VCS, pull requests, worktrees, transactional checkpoints, and rollback implementation.
- Browser automation, terminal/PTTY rendering, port previews, file-browser surfaces, and preview mini-players.
- Arbitrary provider-specific controls, arbitrary Pi tool lists, raw Pi payloads, and Pi's full settings/authentication console.
- Pi plan mode in the first delivery. The canonical interaction-mode seam remains for future providers/capabilities.
- Pi rollback in the first delivery. A tool patch or diff is not treated as a checkpoint transaction.
- Arbitrary file attachments. Pi v1 supports bounded images only through the documented prompt capability.
- Text generation for thread titles, branch names, commits, pull requests, or project labels.
- Supporting every provider in the first delivery. Pi is the only real adapter required initially.
- Performance work beyond bounded projections, ordered delivery, deterministic draining, process/session cleanup, and recovery correctness.

## Further Notes

The first acceptance scenario starts with Local folder or Git URL onboarding, validates and authoritatively binds/acquires the source, creates a project, creates a thread with an available Pi model, a fixed runtime profile, and `execute` interaction mode, submits a prompt with optional bounded image attachments, observes canonical streamed assistant text and activity, pauses through the approval or structured-input bridge, responds, completes the turn, disconnects, reconnects from an exclusive sequence, and verifies an equivalent recovered snapshot with no duplicate messages, activities, requests, or turns.

A second acceptance scenario fatally fails the Pi runtime during a pending request and verifies an honest failure/interruption outcome, request finalization, replayable history, and equivalent fresh-client state.

A third acceptance scenario submits one command ID twice and verifies one durable outcome and one command receipt.

The product spec and UI spec are both required inputs for future tickets that include UI work. The UI specification owns journeys, scenes, state presentation, accessibility, responsive behavior, content, and the Tactical Telemetry & CRT Terminal visual system; this product spec owns orchestration behavior and provider/source boundaries.
