## Problem Statement

The project currently spans a complete product surface—server, web, mobile, desktop, provider integrations, VCS, terminals, previews, relay infrastructure, and marketing—but the capability we need to reproduce is the AI orchestration layer itself.

A naive replica built as a chat screen plus a provider SDK would lose the properties that make the system dependable: durable server-authoritative state, ordered events, replay after disconnect, idempotent commands, provider-neutral runtime events, approval and user-input pauses, process lifecycle handling, and a client that converges after reconnects. Those failures would be user-visible as duplicated turns, missing assistant output, lost approvals, stale thread state, or orphaned provider processes.

The user needs a focused AI orchestrator application that preserves the project's highest-leverage behavior while intentionally leaving unrelated product surfaces out of the first delivery.

## Solution

Build a production-capable AI orchestrator layer around one deep orchestration module with a small command/query/stream interface and implementations behind explicit seams.

- accept typed project-source, project, thread, turn, interrupt, approval, input, stop, and recovery commands;
- validate project-source and orchestration commands against a server-owned read model;
- append immutable, sequenced domain events to durable storage;
- make command handling idempotent through command receipts;
- project events into durable/queryable project, source, thread, and session state;
- route provider intent through a provider service and provider adapter seam;
- support one real provider adapter initially while keeping the canonical interface provider-neutral;
- integrate the Pi coding agent as the first real provider through its embedded TypeScript SDK;
- normalize runtime events back into orchestration commands rather than allowing providers to mutate projections directly;
- stream snapshots and ordered events to clients;
- recover clients through exclusive replay, resubscription, and snapshot fallback;
- represent assistant streaming, tool activity, plans, diffs, approvals, user-input requests, errors, interruption, and completion as first-class state;
- provide a web client first, with mobile/offline delivery designed as a later client of the same interface.

The first delivery is complete when a user can add a project from an actionable local folder or generic Git URL, create a thread with a curated Pi model and supported runtime profile, send a prompt with bounded image attachments, observe streamed assistant and tool activity, answer an adapter-owned approval or structured question, interrupt or stop a turn, explicitly resume a matching persisted session when offered, reconnect without losing or duplicating state, and inspect the same result from a fresh snapshot.

## User Stories

1. As an orchestrator user, I want to create a project from a local folder or supported repository source, so that related agent work has a durable code context.
2. As an orchestrator user, I want to create a thread within a project, so that each task has an isolated conversation and runtime history.
3. As an orchestrator user, I want to select an available model from the Pi-backed capability catalog for a thread, so that I can control which configured model performs the work.
4. As an orchestrator user, I want to select a fixed runtime access profile, so that the agent's workspace permissions match the task's risk.
5. As an orchestrator user, I want unsupported interaction modes to be explicit, so that Pi does not imply a plan workflow it cannot guarantee.
6. As an orchestrator user, I want to send a prompt with bounded image attachments, so that the agent has supported visual context without an invented file protocol.
7. As an orchestrator user, I want my message to be durably recorded before provider execution begins, so that a reconnect cannot erase my intent.
8. As an orchestrator user, I want to see a turn transition from queued to running, so that I know whether work has been accepted or is still waiting.
9. As an orchestrator user, I want assistant text to stream incrementally, so that I can follow progress without waiting for the entire turn.
10. As an orchestrator user, I want streamed assistant deltas to be assembled into one stable message, so that partial transport updates do not create duplicate messages.
11. As an orchestrator user, I want to see tool and command activity as it happens, so that I understand what the agent is doing.
12. As an orchestrator user, I want tool activity to expose meaningful lifecycle states, so that I can distinguish work in progress, success, failure, decline, and interruption.
13. As an orchestrator user, I want changed files and relevant tool output summarized, so that I can understand the effect of agent work without reading raw provider traffic.
14. As an orchestrator user, I want the agent to pause for approval before a risky operation, so that I retain control over consequential actions.
15. As an orchestrator user, I want to see what operation requires approval, so that my decision is informed rather than a blind confirmation.
16. As an orchestrator user, I want to approve or decline a pending request, so that the provider can continue or stop according to my decision.
17. As an orchestrator user, I want approval responses correlated to the exact request and thread, so that a late response cannot affect a different turn.
18. As an orchestrator user, I want the agent to ask structured questions, so that it can collect required choices instead of guessing.
19. As an orchestrator user, I want to answer structured questions in one response, so that the agent can resume with a complete set of inputs.
20. As an orchestrator user, I want stale or already-resolved requests to fail safely, so that old UI actions cannot corrupt current work.
21. As an orchestrator user, I want to interrupt a running turn, so that I can stop an agent that is taking the wrong path.
22. As an orchestrator user, I want to stop a provider session, so that the process is terminated when the thread no longer needs it.
23. As an orchestrator user, I want interruption and stop to be reflected as durable state, so that every connected client sees the same outcome.
24. As an orchestrator user, I want the system to report provider failures as structured errors, so that I can distinguish an agent error from a connection or application error.
25. As an orchestrator user, I want a completed turn to expose its final state, so that I know whether the work completed, failed, or was interrupted.
26. As an orchestrator user, I want a proposed plan to be visible before implementation, so that I can review the intended approach.
27. As an orchestrator user, I want the system to know whether a proposed plan has been implemented, so that old plans do not appear actionable forever.
28. As an orchestrator user, I want turn diffs and checkpoint summaries to be associated with the correct turn, so that I can review changes in context.
29. As an orchestrator user, I want to revert to a prior checkpoint when supported, so that I can safely undo agent changes without losing the conversation record.
30. As an orchestrator user, I want to archive or settle a thread, so that inactive work can leave my active workspace without being destroyed.
31. As an orchestrator user, I want to delete a thread, so that I can remove work I no longer need.
32. As an orchestrator user, I want a fresh client to receive a complete snapshot, so that it can render the current state without replaying the entire history manually.
33. As an orchestrator user, I want a reconnecting client to resume from its last sequence, so that it receives only the events it missed.
34. As an orchestrator user, I want the client to detect sequence gaps, so that missing events cannot silently produce an incorrect view.
35. As an orchestrator user, I want the client to fall back to a fresh snapshot when replay is unavailable or too far behind, so that recovery remains bounded and reliable.
36. As an orchestrator user, I want a reconnect to preserve newer live state over stale cached state, so that fast reconnects do not roll the UI backward.
37. As an orchestrator user, I want duplicate submissions to return the original command result, so that retries do not create duplicate turns or messages.
38. As an orchestrator user, I want commands to be rejected when the thread state makes them invalid, so that impossible transitions cannot enter durable history.
39. As an orchestrator user, I want every event to retain command, causation, correlation, provider, and request metadata, so that a turn can be diagnosed end to end.
40. As an orchestrator user, I want provider-specific details hidden behind canonical activities and messages, so that changing providers does not require rewriting the client.
41. As an orchestrator user, I want the system to preserve provider instance identity, so that multiple configured instances of the same provider remain independently routable.
42. As an orchestrator user, I want provider sessions to be resumable when the provider supports it, so that a server restart or process replacement does not unnecessarily lose context.
43. As an orchestrator user, I want a provider process that exits unexpectedly to leave the thread in an honest error or interrupted state, so that the UI never presents a false success.
44. As an orchestrator user, I want unresolved provider requests to be finalized when a process exits, so that the application does not wait forever on an impossible response.
45. As an orchestrator user, I want the server to reject malformed commands at the transport seam, so that invalid data cannot reach domain logic.
46. As an orchestrator user, I want read operations and mutating operations to have different authorization scopes, so that observing state does not imply permission to control agents.
47. As an orchestrator user, I want subscriptions to be scoped to an environment and thread, so that one client cannot receive unrelated private activity.
48. As an orchestrator user, I want all clients to observe one server-authoritative order, so that web, mobile, and future clients converge on the same history.
49. As an orchestrator operator, I want provider adapters to expose capabilities, so that unsupported operations are communicated explicitly instead of failing through provider-specific conditionals.
50. As an orchestrator operator, I want provider runtime ingestion to be queue-backed and drainable, so that asynchronous work can be synchronized deterministically.
51. As an orchestrator operator, I want provider command execution separated from runtime ingestion, so that outgoing intent and incoming observation remain independently testable.
52. As an orchestrator operator, I want the event stream to be rebuildable into projections, so that corrupted or newly introduced read models can be recovered from durable history.
53. As an orchestrator operator, I want projection failures to be observable and retriable, so that an appended event is never silently lost from query state.
54. As an orchestrator operator, I want retention limits for large message, activity, and checkpoint collections, so that one long-running thread cannot exhaust memory or storage.
55. As an orchestrator operator, I want canonical protocol logs with correlation identifiers, so that provider and orchestration failures can be traced without exposing raw data to clients.
56. As a web client developer, I want shared state and connection modules to own retry and subscription policy, so that UI components do not create competing transports or retry loops.
57. As a web client developer, I want pure derivation functions for pending approvals, plans, timelines, and work logs, so that presentation behavior is deterministic and independently testable.
58. As a mobile client developer, I want the same command and event contract as web, so that mobile is another client of the orchestrator rather than a second implementation.
59. As a mobile client user, I want queued messages persisted while offline, so that composing a task does not require a live connection.
60. As a mobile client user, I want queued messages delivered exactly once from the user's perspective, so that reconnect retries do not duplicate turns.
61. As a future provider integrator, I want to implement one adapter interface, so that adding a provider does not require changes to the engine, projection, or client event reducer.
62. As a future client integrator, I want snapshot, replay, command, and subscription interfaces documented, so that a new client can converge on server state without copying UI internals.
63. As a product owner, I want the first delivery to focus on orchestration instead of VCS, terminals, preview, relay, and marketing, so that the core capability can be validated sooner without weakening its durable contracts.
64. As a product owner, I want one real provider supported end to end before broad provider coverage, so that the adapter seam is proven with real process behavior rather than many shallow integrations.
65. As an orchestrator user, I want Pi sessions to stay bound to one project workspace, so that an agent cannot silently cross source or project boundaries.
66. As an orchestrator user, I want to interrupt a turn without destroying its session, so that I can inspect the result and start another turn when valid.
67. As an orchestrator user, I want stopping a session to terminate its active work and require a new session, so that an explicit stop has unambiguous effect.
68. As an orchestrator user, I want the system to offer resume only for a matching persisted Pi session, so that reconnect does not duplicate or silently restart work.
69. As an orchestrator user, I want read-only, workspace-write, and full-execution access profiles, so that risk controls are understandable and server-owned.
70. As an orchestrator user, I want mutating Pi operations to require approval before execution, so that a confirmation cannot arrive after the change already happened.
71. As an orchestrator user, I want structured questions to use one atomic flat form, so that all required answers reach the provider together.
72. As an orchestrator user, I want project deletion to remove it from normal navigation without deleting my local folder, so that durable cleanup does not destroy user-owned files.
73. As an orchestrator operator, I want hosted source rows to remain visible as setup-required, so that capability gaps are discoverable without pretending integrations are ready.
74. As an orchestrator operator, I want raw Pi payloads excluded from client events, so that diagnostics do not become a provider-specific data leak.
75. As a product owner, I want Tactical Telemetry and CRT Terminal to be the single visual archetype, so that the UI does not mix contradictory soft and industrial systems.

## Implementation Decisions

- The orchestration engine is the primary deep module. Callers learn commands, queries, stream semantics, ordering, and error modes; provider process details and projection mechanics remain behind the interface.
- The server is authoritative for command validation, event ordering, persistence, projections, and lifecycle state. Clients may optimistically render local intent, but durable truth comes from server events.
- Client commands and internal/server commands are distinct contract categories. Transport callers can submit only authorized client commands; provider ingestion and server reactors can submit internal commands through trusted services.
- The canonical orchestration interface includes typed commands, snapshots, sequenced events, replay from an exclusive cursor, and live thread/shell subscriptions.
- The minimum client command set is project/thread creation, turn start, turn interruption, approval response, structured user-input response, and session stop. Lifecycle and metadata commands remain part of the extensible contract.
- Project creation accepts a canonical source descriptor. Local folder and generic Git URL are actionable in the first host/runtime; GitHub repository, Azure DevOps repository, Bitbucket repository, and GitLab repository remain visible as setup-required hosted source kinds until a configured connection and host capability make them selectable.
- Project source onboarding is distinct from AI provider/model selection. Source metadata includes its kind, non-secret locator, and connection/setup/acquisition status; credentials and secrets never enter project, thread, or client-facing orchestration events.
- Source availability is server- and host-capability driven. Local folder selection binds an existing user-owned path; generic Git URL acquisition creates a managed workspace. Hosted rows marked setup-required remain visible but unavailable until configured. Source validation and acquisition are transactional: cancellation cleans only managed temporary artifacts, retrying is idempotent, and failure creates no partial project.
- The minimum internal command set is session state update, assistant delta, assistant completion, activity append, plan update, and turn-diff completion.
- Events are immutable and globally sequenced. Each event includes aggregate identity, event identity, timestamps, command identity, causation/correlation metadata, and optional provider/request metadata.
- Command IDs are idempotency keys. A duplicate command returns the existing receipt/result rather than appending another event sequence.
- The event store is append-only and supports ordered reads after an exclusive sequence cursor. Projection state is derived state and must be rebuildable from events.
- The decider owns domain invariants and command-to-event decisions. The projector owns event-to-read-model application. Neither transport code nor provider adapters may bypass these seams.
- The provider service is the only cross-provider facade. It resolves provider instances, exposes capabilities, manages sessions and turns, and emits a canonical runtime stream.
- Provider adapters implement session start, turn send, interrupt, approval response, user-input response, stop, session listing, explicit resume where supported, thread read/rollback where supported, shutdown, and runtime event streaming.
- Provider kind and provider instance identity are separate concepts. Runtime bindings persist the instance identity, project workspace binding, model/runtime profile, and resume information needed to route future actions correctly.
- Pi is the first required real provider adapter and uses `@earendil-works/pi-coding-agent` in-process. The adapter owns `ModelRuntime`, `createAgentSession`, `SessionManager`, SDK event subscription, prompt submission, abort, disposal, model capability discovery, and session persistence.
- Pi exposes a server-owned curated model catalog from authenticated/available runtime models. The client does not manage Pi credentials or underlying model-provider settings.
- Pi runtime profiles are fixed server-owned tool policies: read-only (`read`, `grep`, `find`, `ls`), workspace-write (read-only plus `edit` and `write`), and full-execution (workspace-write plus `bash`). Client commands cannot provide arbitrary tool lists.
- Pi v1 supports only the `execute` interaction mode. The canonical interaction-mode field remains provider-neutral; `plan` is advertised as unsupported rather than simulated with prompt instructions.
- Pi approval and input behavior is implemented through adapter-owned server-mediated custom tools. Mutating operations are gated before execution, normalized into canonical pending requests, and resumed only after a correlated response. Decline returns a structured denial to Pi and does not fabricate turn success.
- Pi session interruption calls the SDK abort behavior and keeps the session available when valid. Session stop aborts active work, finalizes pending requests, disposes the session, marks it stopped, and requires a new session.
- Pi sessions are bound one-to-one with a project workspace and thread. The adapter cannot switch a live session to another project or source root.
- Pi can offer explicit resume only when a persisted session matches the project workspace, model, runtime profile, and provider instance. Client reconnect performs orchestration recovery, not automatic provider resume. An explicit stop is not resumable.
- Process-backed ACP and Codex-style transports remain isolated behind protocol adapters for future providers; they are not required for the Pi v1 seam.
- One real provider adapter is required for the first end-to-end delivery. The canonical contracts remain provider-neutral so additional adapters can be added without client or engine changes.
- Raw provider payloads never enter client-facing orchestration events. Provider-native events are normalized into canonical messages, activities, sessions, approvals, inputs, plans, completion, interruption, and failure state.
- Provider command reaction and provider runtime ingestion are separate queue-backed workers. Outgoing intent is processed by the command reactor; incoming provider observations are processed by ingestion.
- Workers expose deterministic drain or completion signals. Tests and orchestration coordination wait for semantic completion rather than sleeping or polling arbitrary state.
- A provider runtime failure or process exit finalizes pending requests and produces an honest canonical failure/interruption outcome. The system must not synthesize success after provider termination.
- The first persistence implementation uses the existing SQLite-oriented service model. Durable event history, command receipts, projections, and provider runtime bindings are separate persistence responsibilities.
- Thread snapshots include messages, session state, activities, proposed plans, latest turn, pending requests, and checkpoint/diff summaries when the checkpoint capability is enabled.
- Subscription streams begin with a snapshot or synchronization marker and then emit ordered events. A client tracks its latest applied sequence and never applies an event twice.
- Reconnect recovery uses a bounded strategy: resubscribe, replay from the last exclusive sequence, and snapshot fallback when the replay cannot make progress or the gap is too large.
- Cached state must never overwrite newer live state during a fast reconnect. Connection health and data synchronization health remain separate states.
- Authorization distinguishes orchestration read access from orchestration operation access. The transport validates scope before dispatching or subscribing.
- The web client is the first client surface. It uses shared connection and state modules; UI components do not construct transports, retry loops, or raw provider calls.
- The first web client may use a desktop-style application shell with persistent project/thread navigation, a centered thread workspace, and capability-gated contextual surfaces attached to the active thread. This is a client presentation contract, not a requirement to reproduce the Electron desktop shell or native window behavior.
- Client presentation derives pending approvals, pending user input, active plans, work logs, timeline entries, and turn timing from canonical thread state.
- Mobile uses the same contract later, with a persistent serialized outbox for disconnected command delivery. Mobile-specific persistence and lifecycle code do not alter the server protocol.
- Checkpoints, diffs, and rollback retain a canonical capability seam. Pi v1 may expose bounded canonical change summaries where the adapter can prove them, but it does not expose rollback, transactional checkpoints, or full Git/VCS workflows.
- The implementation is a focused replication of the orchestration layer, not a copy of every product surface. VCS, terminals, previews, relay/cloud infrastructure, desktop packaging, marketing, and text-generation conveniences are separate capabilities.
- Existing domain vocabulary is used intentionally: the engine is a deep module, the provider adapter is an adapter at a provider seam, the event stream is the shared interface, and the design prioritizes leverage and locality over pass-through abstractions.

## Testing Decisions

- Tests assert externally observable behavior at the highest available seam. They do not inspect private queues, implementation-specific fibers, SQL statements, or incidental data structures.
- The primary deterministic seam is the orchestration engine interface. Engine tests use deterministic service layers and an in-memory persistence implementation to verify command acceptance/rejection, event ordering, idempotency, projection convergence, and replay behavior.
- The primary integrated seam is the typed orchestration transport. A focused harness dispatches client commands, consumes snapshot/event subscriptions, disconnects and reconnects, and asserts that the resulting client-visible state converges.
- Provider behavior is tested through the provider adapter interface at the integrated SDK seam, with a controllable Pi runtime fixture or SDK-compatible test double. Tests verify intent routing, canonical normalization, deterministic draining, and lifecycle cleanup without coupling the engine to Pi SDK internals.
- Process-backed protocol tests remain applicable to future ACP and Codex-style adapters; they are not substituted for Pi SDK tests.
- Provider command reactor tests verify that orchestration intent reaches the adapter with the correct thread, provider instance, model, runtime profile, execute interaction mode, and correlation metadata.
- Provider runtime ingestion tests verify that Pi assistant deltas, completion, tool activity, approval bridge calls, structured questions, errors, explicit interruption, session stop, explicit resume, and turn completion become the correct internal commands and durable events.
- Projection tests verify that a sequence of valid events produces the expected snapshot and that replaying the same history reconstructs the same read model.
- Command invariant tests cover missing aggregates, invalid lifecycle transitions, duplicate commands, stale approvals, stale user-input responses, conflicting turns, invalid runtime modes, and invalid model selections.
- Source onboarding tests cover local-folder binding, generic Git URL validation and managed acquisition, hosted-source setup-required states, source capability filtering, duplicate project commands, cancellation cleanup, and safe failure without creating a partial project.
- Recovery tests cover initial bootstrap, an exact replay boundary, a sequence gap, a failed replay, no-progress retry limits, resubscription after an involuntary disconnect, and snapshot fallback for a large gap.
- Streaming tests verify that assistant deltas assemble into one message, repeated deltas do not duplicate content, completion settles the turn, and late events cannot mutate a settled or replaced turn incorrectly.
- Approval and user-input tests verify pending-state derivation, response correlation, resolution, decline, stale-request rejection, and process-exit cleanup.
- Process lifecycle tests verify that interrupt aborts the active operation while preserving a valid session, stop aborts and disposes the session, unresolved requests are finalized, runtime streams end, and canonical thread state remains consistent.
- Authorization tests verify that read-only callers can snapshot/replay/subscribe but cannot dispatch mutations, while authorized operation callers can dispatch only valid client commands.
- Retention tests verify bounded message, activity, and checkpoint projections without changing the latest turn or pending-request semantics.
- Mobile outbox tests are deferred until the mobile client is included, but the contract must preserve idempotent command metadata so an outbox can retry safely.
- Prior art includes the existing orchestration engine, projection pipeline, provider command reactor, provider runtime ingestion, protocol, connection supervisor, client reducer, and recovery tests. New tests should follow those deterministic Effect service-layer and receipt/drain patterns rather than introducing sleep-based synchronization.
- Focused verification runs the changed package tests and type checks only. A final end-to-end smoke scenario must exercise the embedded Pi SDK adapter, or a protocol-faithful fixture only when Pi cannot run in the test environment, through the integrated orchestration seam.

## Out of Scope

- Reproducing the marketing site or public product pages.
- Reproducing the full Electron desktop shell, auto-update system, native menus, or platform-specific window behavior.
- Full Expo/React Native UI parity in the first delivery.
- Offline mobile outbox implementation in the first server/web vertical slice.
- Cloud relay deployment, Clerk-managed hosted environments, APNs delivery, and multi-tenant cloud operations.
- SSH, Tailscale, remote environment discovery, and cross-machine connection brokerage.
- Full Git/VCS, pull request, worktree, checkpoint, and diff workflows beyond the canonical project-source acquisition seam.
- Browser, Terminal, Files, and full Diff contextual surfaces are not implemented in the first delivery; only canonical capability-gated plan/change summaries may appear in the review seam.
- Text generation for thread titles, branch names, commit messages, or pull request content.
- Supporting every provider in the first delivery. Provider-neutral contracts are required, but Pi is the only real adapter required initially.
- Provider-specific UI controls that do not map to canonical capabilities.
- Raw provider event exposure to clients except for explicitly separate diagnostics tooling.
- Replacing the project's existing architecture wholesale or maintaining parallel legacy and new orchestration paths.
- Optimistic client behavior that can become an alternate source of truth.
- Performance optimization beyond bounded projections, ordered delivery, process cleanup, and replay correctness.

## Further Notes

The repository already contains much of the target architecture. This specification should be treated as a focused replication/consolidation cut rather than permission to introduce a second orchestration convention beside the existing one.

The implementation should preserve the existing separation of concerns: transport handles authentication and wire validation; orchestration handles commands, events, projections, and recovery semantics; provider services handle provider routing and lifecycle; adapters handle provider-specific behavior; protocol modules handle process communication; clients handle local projections and presentation.

- The first acceptance scenario starts with Local folder or Git URL source onboarding, creates a project only after authoritative binding/acquisition, creates a thread with an available Pi model, one of the fixed runtime profiles, and `execute` interaction mode, submits a prompt with optional bounded image attachments, observes canonical streamed assistant/activity state, pauses through the Pi approval or structured-input bridge, responds, completes the turn, explicitly interrupts or stops where applicable, disconnects the client, reconnects from a prior sequence, and verifies that the recovered snapshot matches the live state without duplicated messages or activities.
- A second acceptance scenario terminates or fatally fails the Pi runtime during a pending turn and verifies that the client receives an honest failure/interruption state, unresolved requests are finalized, the event history remains replayable, and a fresh client renders the same result.

A third acceptance scenario must submit the same command ID twice and verify one durable outcome and one command receipt. This is a required correctness property, not an optimization.

The design intentionally favors a small, deep interface over a broad pass-through facade. Every future provider and client should pay the contract cost once and receive the leverage of the durable event, projection, and recovery machinery behind it.
