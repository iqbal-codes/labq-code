# AI Orchestrator Web Client

**Status:** ready-for-agent
**Triage:** ready-for-agent
**Source:** `docs/ui-specs/ai-orchestrator.md`, the approved orchestration and product specifications, the existing canonical domain/transport/recovery contracts, and the completed Ticket 08 integrated acceptance harness.

## Problem Statement

An orchestrator user currently has a durable orchestration core and an integrated Pi acceptance harness, but no first-delivery web client through which they can use that capability. The existing browser view is an acceptance-report surface: it displays deterministic and real-Pi smoke results and can rerun the report, but it does not provide project onboarding, thread creation, prompt composition, streamed turns, approval/input pauses, lifecycle controls, or reconnect-aware state presentation.

A client that talks directly to the Pi SDK or treats local component state as truth would undermine the properties already established by the orchestration layer. It could show a prompt before the server records it, duplicate streamed deltas after reconnect, allow a stale approval to affect a new turn, resume provider work silently, present provider failure as success, or expose source credentials and raw provider payloads. The user needs one honest client projection of the canonical snapshot and ordered event stream, with controls gated by authorization, lifecycle, synchronization, and provider capability state.

The first client must also make source ownership and provider boundaries legible. A local folder is user-owned and must never be copied or deleted by orchestration cleanup. A generic Git URL is acquired into managed storage. Hosted repository rows can be discoverable while remaining setup-required. Pi is the first provider, but the client language and event consumption must remain provider-neutral. Pi v1 offers curated available models, fixed runtime access profiles, and `execute` only; unsupported plan, rollback, checkpoint, Browser, Terminal, Files, and full Diff capabilities must be explained rather than simulated.

## Solution

Build the first web-facing AI Orchestrator client as a desktop-style application shell backed exclusively by the typed orchestration transport and its canonical snapshots, receipts, and sequenced events.

The client will provide three hierarchical surfaces:

1. **Environment/project home** for authenticated project discovery and source-aware project creation.
2. **Project workspace** for project lifecycle, source status, and isolated thread management.
3. **Thread orchestration workspace** for configuration context, conversation, composer, streamed assistant work, pending decisions, review summaries, session controls, and recovery state.

A shared connection/state module will own bootstrap, scoped subscription, reconnect, exclusive-cursor replay, sequence-gap detection, snapshot fallback, and mutation retry policy. Components will consume derived state and dispatch typed client commands; they will not construct transports, provider calls, or competing retry loops. The client will treat server-confirmed state as durable truth and local drafts as disposable intent.

The visual system is **Tactical Telemetry & CRT Terminal**: dark rigid compartments, square edges, visible dividers, monospaced operational data, readable assistant content, neutral text-first state labels, and hazard red reserved for consequential or unhealthy states. The layout must remain usable with keyboard navigation, screen readers, 200% zoom, narrow viewports, reduced motion, and high contrast.

The primary proof seam is the highest client-visible seam already present: a browser client command sent through the typed orchestration transport and a scoped snapshot/event subscription consumed by a client reducer or projection. The proof must exercise the real command/receipt/event/recovery contract and use the provider fixture or embedded Pi only behind the existing provider adapter seam. It must not test UI by reaching into provider SDK objects or private engine queues.

## User Stories

1. As an authenticated orchestrator user, I want to see the environment identity and connection health, so that I know which workspace I am using and whether displayed data is live.
2. As an orchestrator user, I want to see all of my active projects in one navigation surface, so that I can move between durable code contexts without losing orientation.
3. As an orchestrator user, I want to see an honest empty-project state, so that an empty list is not confused with a loading or failed query.
4. As an orchestrator user, I want one prominent **Add project** action, so that I can create a durable code context from the environment home.
5. As an orchestrator user, I want each project row to show its name, source summary, lifecycle, latest activity, and available thread count, so that I can choose the correct project before opening it.
6. As an orchestrator user, I want active, archived, and settled project states to be distinguishable in navigation, so that inactive work does not appear active.
7. As an orchestrator user, I want deleted projects removed from normal navigation, so that the project list remains trustworthy.
8. As an orchestrator user, I want the project source chooser to list Local folder, Git URL, GitHub repository, Azure DevOps repository, Bitbucket repository, and GitLab repository, so that supported and future source options are discoverable.
9. As an orchestrator user, I want to search the source catalog, so that I can find a source kind quickly.
10. As an orchestrator user, I want hosted sources without configured connections to remain visible as **Setup required**, so that I understand why they cannot be selected rather than seeing a fake unavailable integration.
11. As a keyboard user, I want arrow keys to move through source rows, so that I can select a source without a pointer.
12. As a keyboard user, I want Enter to select the highlighted source and Escape to close the chooser, so that the source flow has predictable keyboard controls.
13. As a keyboard user, I want Backspace from an empty chooser search field to return to the previous project surface, so that I can navigate without losing context.
14. As a screen-reader user, I want the source chooser to expose its heading, search field, result count, active row, and availability state semantically, so that I can understand and operate it.
15. As an orchestrator user, I want to select a local folder through the host's folder picker when available, so that I can bind existing source code without manually copying a path.
16. As an orchestrator user, I want to see and confirm the selected local path before submission, so that I know exactly which user-owned folder will become the project source.
17. As an orchestrator user, I want a local folder to become a project only after authoritative validation and binding, so that inaccessible paths never create partial projects.
18. As an orchestrator user, I want to enter a generic Git URL, so that I can acquire a repository even when a hosted provider connection is not configured.
19. As an orchestrator user, I want Git URL validation errors to identify the invalid locator, so that I can correct the source without guessing.
20. As an orchestrator user, I want remote acquisition progress to be visible, so that I know the project is being prepared rather than assuming the operation completed.
21. As an orchestrator user, I want acquisition failure to distinguish invalid locator, permission, unavailable connection, and acquisition failure, so that I know whether to correct the source or retry the operation.
22. As an orchestrator user, I want safe entered source values preserved after a recoverable error, so that a retry does not force me to re-enter the entire form.
23. As an orchestrator user, I want cancellation to clean only managed temporary acquisition artifacts, so that orchestration never deletes or alters a user-owned local folder.
24. As an orchestrator user, I want a failed source operation to create no partial project, so that normal navigation never contains an unusable project.
25. As an orchestrator user, I want project creation retries to reuse the same command identity when safe, so that a network retry cannot create duplicate projects.
26. As an orchestrator user, I want the project workspace to show the source kind, location label, source status, and project lifecycle, so that the code context is visible before I start agent work.
27. As an orchestrator user, I want to see **New thread** only when project lifecycle, authorization, and synchronization permit mutation, so that disabled controls explain the actual constraint.
28. As an orchestrator user, I want the project workspace to distinguish active threads from archived and settled threads, so that current work stays in the primary reading path.
29. As an orchestrator user, I want a project with no threads to explain why I should create one, so that I understand how a thread isolates a task.
30. As an orchestrator user, I want to create multiple isolated threads in one project, so that separate tasks do not share accidental conversation or session state.
31. As an orchestrator user, I want thread rows to show identity, lifecycle, latest turn status, model, runtime profile, and interaction mode, so that I can select the right task context.
32. As an orchestrator user, I want thread creation to show the server-advertised curated Pi model catalog, so that I can choose only authenticated and available models.
33. As an orchestrator user, I want the Pi provider identity to be explicit and fixed for v1, so that I know which runtime will execute the thread.
34. As an orchestrator user, I want to choose read-only, workspace-write, or full-execution access, so that the runtime permissions match the risk of my task.
35. As an orchestrator user, I want each access profile to explain its permission boundary, so that I can choose a profile based on consequences rather than a cryptic label.
36. As an orchestrator user, I want `execute` to be the supported Pi interaction mode, so that the client does not imply a plan workflow Pi cannot guarantee.
37. As an orchestrator user, I want unsupported plan mode to be explained explicitly when relevant, so that I am not offered a simulated or misleading alternative.
38. As an orchestrator user, I want invalid model and profile selections rejected without losing the rest of my form, so that server capability changes remain recoverable.
39. As an orchestrator user, I want a thread to appear only after the creation receipt and snapshot confirm it, so that I never see a phantom thread.
40. As an orchestrator user, I want a ready thread workspace to show project/thread identity, source context, Pi model, access profile, interaction mode, session state, lifecycle, and synchronization status, so that I understand the execution context before sending work.
41. As an orchestrator user, I want to compose a prompt locally before submission, so that an unfinished draft is never mistaken for a durable message.
42. As an orchestrator user, I want the prompt to be recorded before provider execution begins, so that reconnect cannot erase my intent.
43. As an orchestrator user, I want the submitted turn to show **Submitting** and then **Queued**, so that I can distinguish local intent from accepted orchestration state.
44. As an orchestrator user, I want only one queued, running, or paused turn per thread, so that concurrent submissions cannot create ambiguous provider work.
45. As an orchestrator user, I want the composer disabled with a reason while a conflicting turn is active, so that I understand why another prompt cannot be sent.
46. As an orchestrator user, I want to attach bounded images to a prompt, so that the Pi runtime can receive supported visual context.
47. As an orchestrator user, I want each image attachment to show filename, type, size, and a keyboard-removable control, so that I can review the outgoing context.
48. As an orchestrator user, I want unsupported image types, excessive image count, and excessive total size rejected before dispatch, so that invalid commands never enter orchestration.
49. As an orchestrator user, I want a failed send to preserve my safe draft and attachment values, so that I can retry or edit without losing work.
50. As an orchestrator user, I want the timeline to show user and assistant messages with clear turn boundaries, so that each result remains associated with its originating prompt.
51. As an orchestrator user, I want assistant deltas assembled into one stable message, so that streaming never creates duplicate fragments.
52. As an orchestrator user, I want to see a running turn without a fabricated percentage, so that progress language remains honest.
53. As an orchestrator user, I want canonical tool activity shown as concise provider-neutral summaries, so that I can understand what the agent is doing without reading raw Pi events.
54. As an orchestrator user, I want activity lifecycle labels for running, succeeded, failed, declined, and interrupted work, so that I can distinguish outcomes.
55. As an orchestrator user, I want repeated runtime event IDs and command IDs to produce one visible activity or outcome, so that reconnect does not duplicate work in the timeline.
56. As an orchestrator user, I want the active activity emphasized while historical activity remains available behind disclosure, so that the current work stays readable.
57. As an orchestrator user, I want an **Interrupt turn** action for queued, running, and paused turns, so that I can stop work taking the wrong path.
58. As an orchestrator user, I want interruption to explain its effect and reason, so that I know whether partial work and the session remain available.
59. As an orchestrator user, I want an interrupt command to be idempotent, so that a retry cannot append duplicate lifecycle outcomes.
60. As an orchestrator user, I want a pending approval card to identify the exact operation, target, scope, affected turn, session, and request, so that I can make an informed decision.
61. As an orchestrator user, I want every mutating provider operation gated before execution, so that approval is a real safety boundary.
62. As an orchestrator user, I want to approve or decline one exact pending request, so that the provider receives a correlated decision.
63. As an orchestrator user, I want approval actions disabled while responding, disconnected, unauthorized, or stale, so that I cannot send a response against uncertain state.
64. As an orchestrator user, I want a declined approval to be represented as a structured denial rather than fabricated success, so that the final outcome remains honest.
65. As an orchestrator user, I want a late approval response rejected safely, so that an old card cannot affect another request or turn.
66. As a keyboard and screen-reader user, I want the first actionable approval control announced when a new pending request becomes primary, so that I can respond without hunting through the page.
67. As an orchestrator user, I want a structured-input request to display its complete question and all required fields in one form, so that I can answer without guessing what is missing.
68. As an orchestrator user, I want structured fields to support text, multiline text, number, boolean, and single-select values, so that the request can express the supported canonical schema.
69. As an orchestrator user, I want all structured answers validated together before dispatch, so that the provider receives one complete atomic response.
70. As an orchestrator user, I want field-specific validation and focus on the first invalid field, so that I can correct an input efficiently.
71. As an orchestrator user, I want values retained after a recoverable input submission failure, so that I can retry the same response safely.
72. As an orchestrator user, I want leaving an input form not to auto-decline the request, so that navigation does not make an unintended decision.
73. As an orchestrator user, I want stale or resolved input forms replaced with an explanation, so that a late answer cannot mutate current work.
74. As an orchestrator user, I want a completed turn to show final assistant text, prompt context, activity outcomes, and turn status, so that I can understand the durable result.
75. As an orchestrator user, I want partial output visibly labeled when a turn is interrupted or failed, so that incomplete work is never styled as a successful completion.
76. As an orchestrator user, I want safe structured failure metadata when Pi exits or a provider operation fails, so that I can choose a valid recovery action without seeing secrets or raw payloads.
77. As an orchestrator user, I want unresolved approvals and input requests finalized when the provider exits, so that no pending card waits forever.
78. As an orchestrator user, I want **Stop session** to explain that active work will terminate and the session will be disposed, so that Stop has an unambiguous consequence.
79. As an orchestrator user, I want a stopped session to require a new session, so that an explicit Stop cannot silently resume provider work.
80. As an orchestrator user, I want **Resume session** offered only when a matching persisted Pi session exists for the project workspace, provider instance, model, and access profile, so that resumption is deliberate and safe.
81. As an orchestrator user, I want reconnect to recover orchestration state without automatically resuming Pi work, so that network recovery cannot silently restart execution.
82. As an orchestrator user, I want a turn-associated canonical change summary when supported, so that I can review affected files and bounded results without a full VCS surface.
83. As an orchestrator user, I want change summaries to be read-only in Pi v1, so that review cannot be mistaken for rollback or checkpoint control.
84. As an orchestrator user, I want unsupported plan, diff, checkpoint, and rollback capabilities explained in the review panel, so that the absence of a capability is clear and honest.
85. As an orchestrator user, I want a change summary associated with its originating turn, so that activity from another turn cannot appear as the current result.
86. As an orchestrator user, I want to archive or settle a thread through an explicit confirmation, so that inactive work leaves the active workspace without accidental deletion.
87. As an orchestrator user, I want lifecycle actions disabled or guarded while a conflicting turn is active, so that an aggregate cannot enter an invalid state.
88. As an orchestrator user, I want to delete a thread through a destructive confirmation naming the thread, so that deletion is deliberate.
89. As an orchestrator user, I want deleted threads removed from normal navigation and routed back to their owning project, so that the current route cannot point to an unavailable aggregate.
90. As an orchestrator user, I want to archive, settle, or delete a project with explicit consequences, so that project lifecycle is intentional.
91. As an orchestrator user, I want project deletion not to remove a user-owned local folder, so that orchestration cleanup cannot destroy source code.
92. As an orchestrator user, I want managed-source cleanup to follow the authoritative retention outcome, so that temporary acquisition workspaces do not leak after deletion or failure.
93. As an orchestrator user, I want an initial route to show a loading shell until a snapshot or synchronization marker arrives, so that loading is not represented as an empty workspace.
94. As an orchestrator user, I want a browser refresh to return to the last addressable project or thread only after bootstrap, so that route state cannot outrun authoritative data.
95. As an orchestrator user, I want a connection drop to label cached state as stale and show **Reconnecting**, so that I do not mistake old data for current truth.
96. As an orchestrator user, I want data synchronization health separated from connection health, so that connected-but-replaying is not confused with disconnected.
97. As an orchestrator user, I want reconnect replay to begin strictly after my last applied exclusive sequence, so that no event is applied twice.
98. As an orchestrator user, I want sequence gaps and no-progress replay to trigger bounded recovery, so that missing events cannot silently corrupt the projection.
99. As an orchestrator user, I want snapshot fallback to replace local state with fresh authoritative state, so that recovery succeeds even when replay is unavailable.
100. As an orchestrator user, I want newer live state to win over stale cached state, so that a fast reconnect cannot roll the interface backward.
101. As an orchestrator user, I want recovery completion announced without focus being moved unnecessarily, so that ordinary reconnect does not disrupt typing or reading.
102. As an orchestrator user, I want **Refresh state** and **Retry connection** when bounded recovery needs user action, so that I have a clear next step.
103. As an orchestrator user, I want a duplicate command to return the original receipt and one durable outcome, so that retries do not create duplicate messages, turns, approvals, or lifecycle events.
104. As an orchestrator user, I want unauthorized reads and mutations to produce safe, distinct feedback, so that observing a thread does not imply permission to control it.
105. As an orchestrator user, I want subscriptions scoped to my environment, project, and thread, so that unrelated private activity is never rendered.
106. As an orchestrator user, I want malformed commands and unsupported choices rejected before state changes, so that invalid UI state cannot enter durable history.
107. As an orchestrator user, I want the client to preserve the last readable settled view during ordinary reconnect, so that transient transport issues do not erase useful context.
108. As an orchestrator user, I want all durable statuses to have visible text equivalents, so that color, icons, animation, and visual position are never the only way to understand state.
109. As a keyboard user, I want dialogs, source selection, forms, disclosures, and lifecycle confirmations to have deterministic focus paths, so that every operation is possible without a pointer.
110. As a user who prefers reduced motion, I want streaming and synchronization effects simplified, so that no critical state depends on animation.
111. As a user viewing the client at 200% zoom or a narrow viewport, I want content to wrap and compartments to stack in a labeled order, so that I never need horizontal scrolling to operate the core flow.
112. As an orchestrator user, I want the primary reading path to prioritize the current turn and pending decision over diagnostics, so that the interface does not become a noisy raw-event dashboard.
113. As an orchestrator user, I want reserved Browser, Terminal, Files, and full Diff slots to explain capability absence without becoming alternate sources of truth, so that future surfaces do not dilute the first delivery.
114. As an orchestrator user, I want no Pi settings or credential screen in this client, so that secrets and provider configuration remain in their owning subsystem.
115. As a future client developer, I want the web client to consume provider-neutral canonical state, so that Pi SDK changes do not require rewriting presentation components.
116. As a future mobile client developer, I want the same snapshot, event, receipt, and command contract, so that mobile can become another client without changing orchestration semantics.
117. As a product owner, I want the client to prove one real provider end to end through the existing integrated seam, so that the UI validates the durable orchestration contract rather than a mock-only happy path.

## Implementation Decisions

- The web client is a presentation client of the existing orchestration engine, provider service, source manager, transport, projector, and reconnecting client contracts. It must not introduce a second orchestration convention or a direct Pi SDK path.
- The web frontend uses Vite Plus (`vp`) as its unified toolchain for development, production builds, Vitest execution, linting, formatting, and task orchestration. The frontend package must expose the corresponding `vp dev`, `vp build`, `vp test`, and `vp check` workflows.
- The UI uses project-owned shadcn components backed by Base UI primitives. Base UI supplies accessible behavior, focus management, keyboard interaction, dialogs, confirmations, fields, selects/comboboxes, tabs, and disclosures; shadcn component source and the CRT/telemetry styling remain owned by this repository.
- The frontend uses React and React Router for the browser application, with the route hierarchy environment → project → thread. It does not use Electrobun RPC or Pi SDK types directly from presentation modules.
- Zustand is the implementation behind the `OrchestratorClientStore` seam. It stores canonical snapshot projection, ordered event application, command receipts, connection health, synchronization health, and recovery cursor. React-local state owns drafts, chooser search/highlight, form values, attachment previews, and confirmation state.
- The frontend has no second server-state cache and does not persist canonical state in localStorage, IndexedDB, or persisted Zustand storage. The canonical snapshot/event stream remains authoritative; browser-local state is transient only.
- The frontend styling uses the shadcn/Base UI composition with project-owned design tokens and utility styles. Components must preserve the Tactical Telemetry & CRT Terminal direction rather than the default rounded, soft, or decorative shadcn treatment.
- Frontend tests run through Vite Plus/Vitest at the client-store and presentation seams; existing Bun tests continue to cover the orchestration core, and browser acceptance covers the integrated typed transport seam.
- The client-facing boundary is the typed orchestration transport. It provides authorized command dispatch, scoped subscriptions, snapshots, ordered domain events, command receipts, and synchronization results. The client does not call provider adapters directly.
- A single shared environment connection/state module owns authentication token handling, connection health, bootstrap, subscription lifecycle, exclusive-cursor tracking, replay, sequence-gap detection, bounded retries, snapshot fallback, and synchronization announcements.
- The shared state module maintains server-authoritative projection state and local transient state separately. Local prompt drafts, chooser search text, highlighted source row, form values, attachment previews, and confirmation state are not presented as durable server state.
- Presentation components receive derived state and dispatch typed commands. They do not create transports, subscriptions, retry loops, provider sessions, timers used as synchronization, or alternate caches.
- The client must consume the canonical project, source, thread, session, turn, activity, pending-request, change-summary, lifecycle, receipt, and synchronization vocabulary already established by the domain contract.
- The client must handle the currently supported source kinds in the canonical order: local folder and generic Git URL are actionable when host capabilities permit; GitHub, Azure DevOps, Bitbucket, and GitLab remain visible as setup-required until authoritative connection capability is available.
- Local folder selection binds an existing user-owned path. The UI may display and confirm the path, but it never copies, deletes, or mutates user-owned source as part of project lifecycle.
- Generic Git URL acquisition is represented as a source configuration/acquisition flow. The UI shows authoritative progress and failure, preserves safe input, and does not show a project as ready until the source manager confirms the result.
- Project and thread creation are submitted with one command identity per user intent. The UI disables duplicate submission while awaiting a receipt and reconciles retries through the original command ID where the contract permits.
- Project and thread lifecycle actions are explicit, confirmation-based, and driven by the latest snapshot. Delete is destructive, names the affected aggregate, routes to the owning context after success, and never presents a deleted aggregate as active.
- Thread configuration shows the fixed Pi provider, the server-owned curated model catalog, one of the fixed runtime access profiles, and the canonical interaction mode. Pi v1 exposes `execute`; `plan` is represented only as an explicit unsupported capability.
- Runtime access profiles are read-only, workspace-write, and full-execution. The client renders the server-provided descriptions and cannot submit arbitrary tool lists or permissions.
- A thread has at most one queued, running, or paused turn. Composer availability is derived from current thread lifecycle, authorization, connection/synchronization health, session state, and active-turn conflict.
- Prompt submission records the user message through the server before provider execution. The UI may show a transient **Submitting** affordance but must not make it durable until the resulting canonical event or snapshot is applied.
- Prompt attachments are image-only and use the existing bounds: at most five images and at most 20 MiB total per turn. Validation occurs before dispatch and displays actionable errors beside the affected attachment or form.
- Streamed assistant deltas are applied through the existing canonical projector/reducer and keyed by turn/message identity. The UI renders one assembled assistant message and does not append arbitrary transport fragments.
- Tool activity is rendered from canonical activity state with provider-neutral kind, summary, lifecycle, and bounded output. Raw Pi event payloads are not rendered in the normal client.
- Approval and structured-input pauses are rendered as one primary pending request for the current turn. A pending request is actionable only when the latest authoritative state says it is pending, synchronized, authorized, and correlated to the current environment, thread, turn, session, and request identity.
- Approval responses are one decision per request. Decline is presented as a structured denial outcome; the UI never converts a decline into completed success.
- Structured-input responses use one flat atomic form. Supported field types are text, multiline text, number, boolean, and single-select. All required values validate before one response command is dispatched.
- Leaving an input form does not implicitly answer or decline the request. Returning to a stale form shows that it is no longer active and prevents late mutation.
- Interrupt and Stop have distinct UI copy and state effects. Interrupt targets a turn and preserves a valid session when possible. Stop terminates active work, finalizes pending requests, disposes the provider session, marks it stopped, and requires a new session.
- **Resume session** is rendered only when the canonical provider/session capability says a matching persisted Pi session exists for the project workspace, provider instance, model, and access profile. Reconnect itself never triggers provider resume, and an explicitly stopped session is never offered as resumable.
- Completed, failed, and interrupted turns retain their user prompt, assistant content, activity outcomes, final reason, and associated canonical change summaries. Partial output is explicitly labeled and never styled as success.
- Change summaries are bounded, read-only, and associated by turn identity. Pi v1 does not expose rollback, transactional checkpoint mutation, or full VCS interaction; unsupported capabilities are explained in text.
- The shell contains only reference slots for Browser, Terminal, Files, and full Diff. These slots may explain unavailable capabilities but do not render alternate orchestration state or imply implementation of those surfaces.
- The information architecture is environment → project/source → thread. Browser refresh and reconnect preserve a route only when the target aggregate remains addressable after bootstrap; missing or deleted threads route to the owning project with an explanation.
- Wide layouts use persistent project/thread navigation, a centered conversation workspace, and a subordinate review/activity compartment. Narrow layouts stack context, current turn or pending request, conversation, and review detail in that order.
- The visual direction is Tactical Telemetry & CRT Terminal: dark surfaces near `#0A0A0A` and `#121212`, light readable foreground, visible borders and dividers, square edges, monospaced telemetry, generous assistant reading width, and no gradients, glassmorphism, translucency, rounded cards, or soft shadows.
- Hazard red reinforces approval-required, setup-required, failed, interrupted, and destructive states. Green is reserved for the explicit synchronized readout. Every state also has a visible textual label and does not rely on color.
- Technical markers, scanline/noise texture, and motion are optional. They cannot reduce contrast, replace semantic content, or make a critical state depend on animation. Reduced-motion and high-contrast preferences simplify or remove them.
- Accessibility is part of the state contract: landmarks, headings, semantic lists/forms, labels, error associations, live regions for concise transitions, keyboard activation, deterministic focus restoration, and no character-by-character streaming announcements are required.
- Dialog focus is trapped only while a dialog is open, Escape cancels where appropriate, and focus returns to the trigger after cancellation or closure. Route replacement and newly actionable pending requests move focus only when necessary and announce the reason.
- Connection health and data synchronization health are separate derived states. The UI labels cached state stale while disconnected, permits reading where safe, disables unsafe mutation, and does not erase a settled view during ordinary reconnect.
- Recovery applies events at most once, starts replay after the last exclusive sequence, detects gaps/no progress, and falls back to a fresh snapshot within bounded policy. Newer live state cannot be overwritten by older cached state.
- Authorization errors distinguish read access from operation access and do not expose project names, source locators, credentials, or provider details outside the authorized scope.
- The current Electrobun acceptance view remains evidence tooling rather than the product workspace. The production web client must not be modeled as a report-only screen or depend on acceptance-report RPC methods.
- Existing desktop/native packaging behavior, menus, update behavior, and native window reproduction are not part of the web client contract, even though the repository now contains an Electrobun host for acceptance evidence.

## Testing Decisions

- Tests must assert externally observable user behavior at the highest seam available. They should verify rendered state, available actions, command payloads, receipts, and convergence after canonical snapshots/events; they must not inspect private component state, provider SDK object layout, private queues, SQL statements, or CSS implementation details.
- The single primary integration seam is a browser client connected to the typed orchestration transport, with a deterministic fixture provider registered behind the existing provider adapter interface. The harness should dispatch source, project, thread, turn, approval/input, lifecycle, and recovery intents through transport and render the resulting canonical projection.
- The integrated seam must prove that the user message is visible only after server confirmation, that queued/running/paused/completed/failed/interrupted states are derived from canonical state, and that streamed deltas assemble into one assistant message.
- Existing engine, projector, provider-service, source-manager, transport, and reconnecting-client tests are prior art for command receipts, lifecycle invariants, event ordering, source validation, canonical normalization, replay, sequence gaps, snapshot fallback, and stale-state protection. New client tests should preserve their deterministic semantic-drain and receipt patterns rather than use arbitrary sleeps.
- The completed Ticket 08 acceptance harness is the end-to-end prior art. The client proof should drive its highest transport seam and retain the fixture branches for approval, structured input, provider failure, explicit resume, disconnect/reconnect, and duplicate commands. The real embedded Pi smoke remains a complementary runtime proof, not a reason to couple UI tests to live model text.
- Source onboarding tests must cover the empty environment, chooser filtering and keyboard navigation, local-folder confirmation, generic Git URL validation, hosted setup-required rows, acquisition progress, cancellation cleanup messaging, source failure with no partial project, and idempotent retry.
- Project and thread navigation tests must cover authoritative success, loading versus empty versus recoverable error, archived/settled/deleted visibility, missing/deleted route handling, create-thread capability validation, and disabled mutation controls for lifecycle, authorization, or synchronization reasons.
- Thread configuration tests must cover the curated Pi catalog, fixed access profiles, execute-only interaction mode, explicit plan unsupported state, preservation of unrelated form values after capability changes, server rejection mapping, and one authoritative thread row after duplicate submission.
- Composer tests must cover draft-only text, durable submission order, bounded image acceptance/rejection, attachment removal, disabled duplicate send, active-turn conflict, safe retry with the same command identity, and preservation of the draft after a recoverable failure.
- Streaming tests must cover duplicate deltas, repeated event delivery, activity begin/delta/complete transitions, partial assistant output, completion, and late events after a settled turn. Assertions must compare visible canonical content, not implementation-specific array shapes.
- Approval tests must cover pre-execution gating, operation/scope/request identity, pending/responding/resolved/stale states, approve and decline, duplicate response, late response, disconnected response, unauthorized response, and provider continuation or honest finalization.
- Structured-input tests must cover every supported field type, required and optional fields, all-at-once validation, error summary and first-invalid focus, value retention after transport failure, leaving without auto-response, stale form replacement, duplicate response, and provider continuation.
- Interruption and session tests must cover queued/running/paused interrupt, confirmation behavior, idempotent interrupt, preserved session when valid, Stop disposal, pending-request finalization, stopped-session non-resumability, explicit matching resume, mismatched resume rejection, and provider exit without success styling.
- Review tests must cover turn-associated change summaries, bounded file/path presentation, no-summary empty state, unsupported plan/checkpoint/rollback explanation, read-only review, and preservation of the final conversation when review loading fails.
- Recovery tests must cover initial bootstrap, refresh routing, scoped subscription, disconnect during streaming, stale cached display, exact exclusive replay, duplicate suppression, sequence gap, no-progress bound, snapshot fallback, newer live state winning over stale cache, and recovery completion without unnecessary focus movement.
- Authorization tests must cover read-only snapshot/replay/subscribe access, denied mutation, denied subscription scope, safe unauthorized messaging, and absence of source/credential/provider leakage.
- Accessibility tests must cover semantic landmarks, headings, source listbox behavior, dialog focus trapping/restoration, form labels and error associations, keyboard-only operation, concise live announcements, no per-delta announcement spam, reduced-motion behavior, high-contrast readability, 200% zoom, narrow layout, and no horizontal scrolling in the primary flow.
- Visual tests should assert only stable, user-relevant presentation contracts such as visible status text, action labels, responsive ordering, and hazard/synchronization semantics. They should not lock the implementation to incidental class names or pixel-level decoration.
- The final smoke scenario must run the primary project → thread → prompt → stream → pause → response → completion → disconnect → reconnect path through the browser client and typed transport. It should use the embedded Pi runtime when available and a protocol-faithful fixture for deterministic branches that require controlled failure or approval.
- A separate smoke branch must fail the Pi runtime during a pending request and verify that the client shows failed/interrupted state, finalized request state, replayable history, and equivalent fresh-client projection.
- A separate idempotency check must submit the same command ID twice and verify one visible message/turn and one durable receipt.

## Out of Scope

- Marketing pages, public product pages, or unrelated product navigation.
- Reproducing an Electron or native desktop shell, native menus, window behavior, auto-update, or platform-specific packaging UI.
- Full mobile or React Native parity, offline mobile outbox behavior, and mobile-specific lifecycle persistence.
- Cloud relay, hosted multi-tenant operations, Clerk/APNs integration, SSH, Tailscale, remote discovery, and cross-machine brokerage.
- Full Git/VCS workflows, pull requests, branches, worktrees, checkpoints, rollback, and full diff interaction beyond source acquisition and bounded canonical change summaries.
- Browser automation, terminal/PTTY rendering, port previews, file browsing, preview mini-players, and contextual Browser/Terminal/Files/full-Diff implementations.
- Pi settings, model-provider credential configuration, authentication consoles, raw authentication data, arbitrary provider controls, arbitrary tool lists, and raw Pi payloads.
- Pi plan mode or simulated plan behavior. The interaction-mode contract remains available for future capabilities, but Pi v1 is execute-only.
- Pi transactional rollback or checkpoint mutation. A change summary is review data, not a reversible transaction.
- Arbitrary file attachments. Only bounded image attachments are supported by this client contract.
- Automatic provider resume on reconnect, resume of an explicitly stopped session, or silent creation of a replacement provider session.
- Operator rebuild/retry/retention dashboards and protocol diagnostics tooling. The client may show sanitized outcomes resulting from those systems.
- Generated thread titles, branch names, commits, pull requests, or project labels.
- Additional providers beyond the Pi adapter in this delivery. The client contract remains provider-neutral for future adapters.
- Optimistic durable state that can become an alternate source of truth, even though local drafts and transient submission indicators are allowed.

## Further Notes

The repository now contains a completed Ticket 08 acceptance harness, a real embedded Pi smoke path, and an Electrobun host used to prove the runtime integration. Those artifacts establish the orchestration contract and provider seam; they do not constitute the product web client described here. The current acceptance report screen should be retained as evidence tooling while the user-facing shell is implemented as a separate client surface.

The UI specification is the source of truth for journeys, scene states, accessibility, responsive behavior, content hierarchy, and visual direction. The orchestration specifications and domain contracts remain the source of truth for commands, authorization, event ordering, projection semantics, source ownership, provider lifecycle, and recovery. Where the UI needs information not present in the canonical snapshot/event contract, the implementation must extend that contract at the highest shared seam rather than infer data from provider payloads or component-local state.

The first implementation should prioritize the end-to-end vertical slice: authenticated environment bootstrap, actionable local/Git source onboarding, project and thread creation, curated Pi configuration, prompt submission, streamed canonical turn, one approval or structured-input pause, completion/failure presentation, and reconnect convergence. Every slice must preserve the same server-authoritative semantics and accessible state treatment; a narrower visual prototype is not a substitute for the integrated transport proof.

The accepted visual language is deliberately strict. Do not introduce soft cards, gradients, glass effects, rainbow status colors, hover-only actions, or decorative motion that competes with the current turn. The interface should feel like a calm operational console: readable conversation first, consequential decision second, diagnostics progressively disclosed, and recovery visible without making users understand protocol internals.
