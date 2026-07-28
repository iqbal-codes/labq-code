# UI Spec: AI Orchestrator

**Status:** Proposed
**Source:** [Published orchestration specification](../../.scratch/ai-orchestrator/spec.md), [product specification](../../.scratch/specs/labq-code-spec.md), the prototype interaction model in [`.scratch/ai-orchestrator/prototype/`](../../.scratch/ai-orchestrator/prototype/), and implementation slices in [`.scratch/ai-orchestrator/issues/`](../../.scratch/ai-orchestrator/issues/).
**Scope:** The first web client for multiple durable projects and threads: source-aware onboarding, an embedded Pi provider, curated model selection, fixed runtime access profiles, execute-only interaction mode, streamed canonical turns, approval and structured-input pauses, interruption and provider failure, review summaries when supported, project/thread lifecycle, and snapshot/replay/reconnect recovery. The actor is an authenticated orchestrator user. Operator-only observability and future mobile delivery are referenced only where they affect web states.

## Experience spine

An orchestrator user enters the desktop-style workspace with an authenticated connection and wants to add a project by choosing a local folder or supported repository source, then create an isolated thread with an available Pi model and fixed runtime profile. The user sees source acquisition/setup state before the project becomes available, their prompt recorded before execution, and one server-authoritative turn move from queued to running. They follow one assembled assistant message and meaningful activity states, retain control when Pi requests approval or structured input, and recover from provider or connection failure. When work completes, the user reviews the final response and any canonical change summary, then can deliberately start another turn, inspect lifecycle state, or leave the workspace.

## Design principles

- **Durable truth is visible.** Distinguish locally composing, submitted, queued, running, paused, settled, and synchronizing states. Never present optimistic intent as completed server state.
- **One task, one readable workspace.** Conversation is primary; activity, pending requests, plans, and change summaries explain the work without exposing raw provider traffic.
- **Control at consequential moments.** Approval and stop actions state exactly what will happen, what is pending, and which turn/request they affect.
- **Canonical, provider-neutral language.** Show model capabilities and normalized activities rather than provider-specific payloads or controls.
- **Recovery is a product state.** Make connection health, synchronization health, replay, and snapshot fallback legible without interrupting a settled view unnecessarily.
- **Progressive disclosure over dashboard noise.** Keep the active turn and pending decision in the main reading path; put diagnostics and historical detail behind explicit disclosure.
- **Accessible by construction.** Every state has a meaningful text equivalent, a deterministic focus path, and an action that can be completed without a pointer.

## Information architecture

The first web client uses a desktop-style application shell with persistent project/thread navigation on the left, a centered thread workspace, and capability-gated review space on the right or in a lower dock. It is a web presentation contract, not Electron or native-window reproduction.

The web client has three owned surfaces:

1. **Environment / project home** — the authenticated user's multiple-project collection and **Add project** entry point. Add project opens a searchable source chooser before source-specific configuration or acquisition.
2. **Project workspace** — one project's lifecycle/status, source summary, thread list, project lifecycle actions, and create-thread entry point. Active, archived, settled, and deleted states remain server-authoritative; deleted aggregates leave normal navigation.
3. **Thread orchestration workspace** — one durable conversation and current orchestration state. The header owns project/thread identity, source context, fixed Pi provider/model summary, runtime profile, execute interaction mode, and lifecycle actions. The main column owns the timeline and composer. A secondary work panel owns activities, pending requests, canonical change summaries, and synchronization status.

Browser, Terminal, Files, and full Diff are reserved capability slots only. They are not implemented contextual surfaces in v1 and never become alternate orchestration sources of truth. The composer exposes only server-advertised Pi models, fixed runtime profiles, execute mode, source context, and bounded image attachments.

Settings and credential configuration are not a first-delivery surface. The client may show setup-required or unavailable capability states, but it does not render a Pi settings console, provider credentials, or raw authentication data.

Navigation is hierarchical: environment → project/source → thread. A browser refresh or reconnect returns to the last addressable project/thread only after bootstrap; a missing/deleted thread routes to its owning project with a clear explanation. The client has one shared connection/state module per environment and scoped subscription per environment/thread. Components consume derived state; they do not create transports, retry loops, or provider calls.

The screenshot references establish shell and source-chooser conventions, not permission to implement unrelated product surfaces. No existing frontend routes, components, tokens, or accessibility primitives were found in the repository; all listed UI work is new.

## UI story coverage

| Product stories | UI journey / treatment |
| --- | --- |
| 1 | Project source onboarding and durable project creation; source chooser, source configuration, acquisition/setup status |
| 2–5 | Thread setup and configuration scene |
| 6–13 | Prompt submission and live turn workspace |
| 14–20 | Approval and structured-input pause journeys |
| 21–25 | Interruption, stop, provider failure, and completion scenes |
| 26–29 | Read-only canonical change-summary scene; contextual Diff remains a reserved capability slot |
| 30–31 | Thread lifecycle journey |
| 32–38 | Bootstrap, replay, gap, snapshot fallback, duplicate and invalid-command feedback across every workspace |
| 40–43 | Provider-neutral activity, provider instance continuity, resumable session and honest provider-exit states |
| 45–48 | Transport validation, read/operation authorization, scoped subscriptions, and authoritative ordering expressed through access/error/sync scenes |
| 56–58 | Non-visual implementation constraints for the shared client state/connection modules and pure presentation derivations; no separate screen |
| 39, 44, 49–55, 61–64 | Operator/provider/integration contracts; non-UI in this delivery, except their resulting canonical errors, capabilities, and states |
| 59–60 | Mobile-only/offline out of scope for the first web vertical slice |

## Journeys

### First-use project and thread setup

| Entry | User action | System response | Exit |
| --- | --- | --- | --- |
| Authenticated environment has no projects | Select **Add project** | Open the searchable project source chooser over the project context | Source chooser, or remain on project home |
| Source chooser is open | Select a supported source kind | Open source-specific configuration or route to setup when the source is unavailable | Source configuration, connection setup, or chooser dismissed |
| Source configuration is open | Select a local folder or enter a supported repository locator and submit | Validate source access, persist the canonical source descriptor, and create the project only after authoritative confirmation | Project workspace, acquisition state, or actionable source error |
| Project workspace has no threads | Select **New thread** | Open configuration form with an available Pi model, fixed runtime access profile, and execute interaction mode | Thread configuration is submitted or cancelled |
| Thread configuration is open | Choose a supported Pi model/profile and create the thread | Validate against server-owned Pi capabilities; persist the thread before opening its workspace | Ready thread workspace, or field/server error without losing entered values |
| User returns to an existing project | Open an active, archived, or settled thread | Bootstrap a snapshot before enabling mutation controls | Thread workspace in the appropriate lifecycle state |

### Project source onboarding

| Entry | User action | System response | Exit |
| --- | --- | --- | --- |
| User selects **Add project** from project navigation or an empty project home | Open the source chooser and optionally search source types | Show a focused modal/sheet with **Local folder**, **Git URL**, **GitHub repository**, **Azure DevOps repository**, **Bitbucket repository**, and **GitLab repository** in that order. Local folder and Git URL are actionable; hosted rows show **Setup required** until their connection/capability is authoritative. | Source-specific configuration, connection setup, or chooser dismissed |
| Source chooser is open | Navigate with arrow keys, select with Enter, go back with Backspace, or close with Escape | Keep one highlighted source row, preserve search text when returning, and expose the same actions through visible controls | Source-specific configuration or project workspace |
| User selects **Local folder** | Browse and select a folder on disk where the host permits local access | Validate access and show the selected path before binding; do not claim success before the server confirms the user-owned path | Project source validation, project creation, or actionable error |
| User selects **Git URL** or a configured hosted repository source | Enter the required locator and submit | Validate the locator; acquire a generic Git URL into a managed workspace; hosted rows remain setup-required until configured | Project source validation, acquisition state, or actionable error |
| Source acquisition or setup fails | Read the source-specific error and retry or return to the chooser | Preserve safe entered values, clean only managed temporary artifacts, avoid creating a partial project, and distinguish invalid locator, unavailable connection, permission, and acquisition failure | Source form, chooser, or project home |

### Project source selection and acquisition

| Entry | User action | System response | Exit |
| --- | --- | --- | --- |
| A source type is selected | Complete the source-specific path, URL, or repository identifier | Persist a canonical source descriptor with kind, non-secret locator, and setup/acquisition status. Local paths bind without copying; remote sources acquire into managed storage; credentials remain outside orchestration state. | Project workspace after authoritative creation, acquisition state, or recoverable error |
| A source requires configuration | Select **Set up connection** or return | Route to the owning connection surface without losing the intended source kind | Configured source chooser or cancelled project creation |
| A local or remote source is unavailable | Try to continue | Keep the source visible with a clear unavailable/setup-required state and prevent a false project success | Choose another source, configure access, or cancel |
### Prompt-to-completion turn

| Entry | User action | System response | Exit |
| --- | --- | --- | --- |
| Active thread is ready and session is available or explicitly resumable | Compose a prompt, optionally attach bounded images, submit once | Record the user message durably before provider execution; show the turn as queued, then running | Live turn workspace |
| Turn is running | Read streaming assistant text and activity summaries | Append ordered canonical events; assemble deltas into one stable assistant message; update activity lifecycle indicators | Completion, approval pause, input pause, interruption, or failure |
| Turn completes | Review final response and associated activity/change summaries | Mark the turn completed and session ready; retain turn association in the timeline | Start another turn, review artifacts, or leave the thread |

### Approval pause and response

| Entry | User action | System response | Exit |
| --- | --- | --- | --- |
| Running turn receives an approval request | Read the exact operation, scope, affected context, and request identity | Pause the turn and pin one pending approval card as the primary action; disable competing turn submissions | Approval pending scene |
| Approval is pending | Select **Approve** or **Decline** | Correlate the response to environment, thread, turn, session, and request; resolve it durably and show provider continuation or structured denial/final decline | Running turn, interrupted/failed state, or stale-request error |
| Request is already resolved or the thread changed | Attempt an old approval action | Reject safely, explain that the request is no longer active, and refresh from authoritative state | Current thread state |

### Structured-input pause and response

| Entry | User action | System response | Exit |
| --- | --- | --- | --- |
| Running turn requests structured input | Review the question and all required fields | Pause the turn and render one complete form; preserve the thread timeline above it | Input form |
| Input form is valid | Complete all required fields and submit once | Validate all fields together, correlate the response to the exact request, resolve durably, and show provider continuation | Running turn |
| Input is invalid, stale, or submission fails | Correct fields or retry the same intent | Keep entered values where safe, identify field errors or authoritative conflict, and never create a second response | Input form or current thread state |

### Interruption, stop, and provider failure

| Entry | User action | System response | Exit |
| --- | --- | --- | --- |
| Turn is queued/running/paused | Select **Interrupt turn** and provide/accept a reason | Confirm the intent when work is active, send an idempotent command, finalize pending requests, and show interrupted state | Settled interrupted turn; session remains ready when appropriate |
| Provider session is ready/running | Select **Stop session** and confirm | Terminate provider work through the server, finalize unresolved requests, and show session stopped plus any interrupted turn | Stopped session; user may start a supported new session/turn |
| Provider process exits unexpectedly | Observe the workspace | Convert the event to a structured failure or interruption, never success; expose safe error metadata and finalize pending requests | Honest failed/interrupted turn with retry or new-turn action as allowed |

### Recovery and reconnection

| Entry | User action | System response | Exit |
| --- | --- | --- | --- |
| Initial route or browser refresh | Wait for bootstrap | Show a loading shell, receive a snapshot/synchronization marker, then subscribe to ordered events | Snapshot-backed workspace |
| Connection drops during any thread state | Continue reading or retry an action after the indicator permits it | Resubscribe, replay strictly after the last exclusive sequence, detect gaps/no progress, and retain newer live state over stale cache | Live converged workspace or bounded snapshot fallback |
| Replay is unavailable or gap is too large | Wait or select **Refresh state** | Replace local projection with a fresh server snapshot, announce the synchronization result, and avoid duplicate timeline entries | Snapshot-backed workspace |
| Mutation is retried with the same command ID | Submit/retry the same intent | Return the original receipt/result and show one durable outcome, not a duplicate turn/message | Existing authoritative state |

### Plan and change review

| Entry | User action | System response | Exit |
| --- | --- | --- | --- |
| Provider emits a canonical plan or turn change summary where supported | Expand the review panel | Show provider-neutral status and summaries associated with the originating turn; Pi v1 does not imply plan mode | Review state |
| A plan or change summary is implemented or settled | Reopen the review | Show it as historical/non-actionable with its final status | Current thread workspace |
| User selects an unavailable rollback/checkpoint action | Read the capability explanation | Explain that Pi v1 has no transactional rollback/checkpoint action and retain review-only summaries | Review state |
| Provider does not support an operation | Select an unavailable plan/diff/checkpoint action | Explain capability absence and offer review-only alternatives | Review state |

### Thread lifecycle

| Entry | User action | System response | Exit |
| --- | --- | --- | --- |
| Active thread has no conflicting operation | Choose **Archive** or **Settle** | Confirm the lifecycle change, persist it, and update navigation/list status | Project workspace or read-only thread workspace |
| Archived/settled thread is selected | Choose **Delete** | Show a destructive confirmation naming the thread and explaining durable tombstone/removal from normal navigation | Project workspace after success, or unchanged thread after cancel/error |
| Active project has no conflicting operation | Choose project **Archive**, **Settle**, or **Delete** | Confirm the project lifecycle change; deletion does not remove a user-owned local folder and managed-source cleanup follows retention policy | Environment/project home or unchanged project after cancel/error |

## Scene specifications

### Environment project home

**Purpose:** Give the user an honest starting point for finding or creating durable project homes.

**Entry:** Authenticated environment route, before a project is selected, or after a selected project/thread is deleted or unavailable.

**Content hierarchy:**
1. Environment identity and connection/synchronization status.
2. Project list with name, lifecycle status, latest activity, and thread count where available.
3. One primary action: **Add project**.
4. Project source summary for each row: source kind, location label, and setup/acquisition status when available.
5. Secondary filters/navigation for active, archived, and settled projects only if those lifecycle states are exposed by the query contract.

**Layout and responsive behavior:** The desktop shell keeps persistent project navigation on the left. **Add project** opens a centered, compact source chooser over the project context; the background is visibly dimmed, not blurred or glass-like, so the user understands the chooser is modal. On narrow screens, the chooser becomes a full-width sheet or route. Source rows are full-width, keyboard reachable, and never depend on hover.

**Interactions:** Project rows are links/buttons with a clear name, source summary, and status. **Add project** opens the source chooser with focus in its search field. Loading or synchronization must not silently show an empty list. A project is not shown as ready until its canonical source binding and creation result are server-confirmed.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | Shell with labeled project-list placeholders and a connection status of “Loading projects” | Cancel navigation or wait | Snapshot populates the list; focus remains stable |
| Empty | “No projects yet” explanation and one **Add project** action | Add project | Successful source binding and project command open the project workspace |
| Validation | Source or project creation error such as invalid URL, inaccessible folder, or missing required locator | Correct and resubmit | Preserve safe entered values; do not dispatch malformed data |
| Recoverable error | Project query/source acquisition failed with a plain-language cause | **Retry** or return to last known project | Retry through the shared connection/source module; never create a partial project |
| Unauthorized | Read or operation access denied message appropriate to the environment | Return to an authorized environment or sign in through the host auth flow | Do not expose project names, source locators, or controls the user cannot use |
| Success | Project appears once with authoritative source and lifecycle status | Open project | Receipt/sequence-backed state becomes the new list state |
| Reconnecting | Existing cached list remains visible but is labeled “Reconnecting”; mutation actions are disabled unless the command contract permits safe retry | Retry connection / continue reading | Newer live state wins; stale cache cannot overwrite it |

States not applicable: a pending approval, assistant turn, and provider activity belong to a thread and cannot arise here.

**Accessibility:** Use a page heading, a named environment landmark, list semantics for projects, and descriptive source/status text. Announce snapshot completion and errors in a polite live region. Dialog focus is trapped only while open; Escape cancels without submitting. All list and chooser actions have visible labels and a logical heading-first tab order. Status uses text and color, never color alone.

**Data:** Project identity, canonical source descriptor, lifecycle status, latest activity, and counts come from the environment/project query snapshot and ordered events. Source setup/acquisition status comes from the source capability/acquisition contract. Connection and synchronization health come from the shared connection module. Freshness is server-authoritative; cached rows are labeled while disconnected.

### Project source chooser

**Purpose:** Let the user choose how a project gets its code context before any source-specific configuration or acquisition begins.

**Entry:** **Add project** from the persistent project navigation or an empty project home; the user has project operation access.

**Content hierarchy:**
1. Search field with a clear label and current chooser context.
2. Source list: **Local folder**, **Git URL**, **GitHub repository**, **Azure DevOps repository**, **Bitbucket repository**, and **GitLab repository**, filtered by search and host capabilities.
3. Source description and status per row, including **Setup required** for hosted connections that are not configured; local folder and Git URL expose actionable availability only when the host reports support.
4. Keyboard hint/action row: arrow keys navigate, Enter selects, Backspace goes back, Escape closes.

**Layout and responsive behavior:** On desktop, render a compact centered modal/sheet over the dimmed project workspace, with a narrow reading width and clearly separated source rows. On narrow screens, use a full-height sheet with the search field fixed at the top and source rows stacked below. The list must remain usable with keyboard navigation, screen readers, and 200% zoom.

**Interactions:** Open with focus in the search field. Arrow keys move one active descendant at a time; Enter selects the highlighted source; Backspace returns to the previous project surface when the search field is empty; Escape closes without creating a project. Selecting a source opens its source-specific configuration. Search filters labels and descriptions without changing source availability. Rows marked **Setup required** remain visible for discoverability but are disabled for direct selection and expose **Set up connection** when the host supports that route.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | Modal shell with search field and source-row placeholders | Wait or close | Server/host capabilities populate the list |
| Empty | “No supported project sources” or “No sources match your search” | Clear search, close, or configure a connection | Do not present an unavailable source as selectable |
| Validation or error | Source capability fetch failed or search input is invalid | Retry, clear search, or close | Keep the project home intact and retry through shared state |
| Setup required | Hosted source row shows a concise setup explanation and **Setup required** badge | Set up connection or choose another source | Return to the chooser with the source selection context preserved |
| Disabled | Source row unavailable because host capability, authorization, or connection is missing | Read explanation, configure access, or choose another source | Enable only after authoritative capability/setup state changes |
| Success | Selected source row is acknowledged before the chooser closes | Continue to source configuration | No project is created until source-specific validation succeeds |

**Accessibility:** Use a modal dialog with a descriptive heading, a labeled search input, and a listbox/list semantics with one programmatically identified active row. Announce result-count changes and setup-required status politely. Support Arrow Up/Down, Home/End where the host convention permits, Enter, Backspace, and Escape without trapping the user in an unusable loop. Return focus to **Add project** on cancel.

**Data:** Source kinds, labels, descriptions, availability, setup status, and capability metadata come from the server/host source catalog. The screenshot establishes the initial presentation order and labels; it does not authorize unsupported hosted integrations. Search text and highlighted row are local transient state.

### Project source configuration and acquisition

**Purpose:** Collect and validate the locator required to bind a selected source to a durable project.

**Entry:** A source kind was selected from the project source chooser.

**Content hierarchy:**
1. Selected source kind and concise explanation of what will happen.
2. Source-specific locator: folder path/browser for **Local folder**, URL for **Git URL**, or repository/account fields for hosted sources.
3. Setup, permission, and acquisition status with no hidden credential fields.
4. Primary **Add project** or **Connect source** action; secondary **Back** to chooser and **Cancel**.

**Layout and responsive behavior:** Desktop uses a focused form sheet or centered panel over the project context; narrow screens use a full-width route/sheet. The selected source type remains visible while navigating back. Long paths and URLs wrap or scroll accessibly without forcing page-wide horizontal scrolling.

**Interactions:** Local folder selection invokes the host folder picker where available and displays the chosen path for confirmation. Generic Git URLs validate before acquisition into managed storage. Hosted sources route to the relevant connection setup when credentials are absent. Submission creates one idempotent project command only after source validation; acquisition progress remains visible until the server reports ready, failed, or setup-required. Cancel cleans only managed temporary artifacts and never leaves a partial project.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | Source-specific prerequisites or host picker loading | Wait or cancel | Render the validated source form |
| Empty | No usable locator or no configured account for the selected source | Back, set up connection, or choose another source | Do not enable a false project-creation action |
| Validation | Invalid URL, missing repository fields, inaccessible folder, or unsupported source | Correct fields or choose another source | Focus the first invalid field and preserve safe values |
| Setup required | Connection/authentication is required before acquisition | **Set up connection** or Back | Return with source kind preserved after setup |
| Acquiring | Selected source and project are being created; progress is explicit and actions prevent duplicate submission | Wait or cancel only if the contract supports cancellation | Server confirms project ready or reports failure |
| Recoverable error | Permission, network, locator, or acquisition failure | Retry with the same command ID or return to chooser | No partial project appears; show a cause-specific message |
| Success | Project is ready with source summary and authoritative status | Open project | Project workspace becomes the next scene |

**Accessibility:** Use a labeled form with source-specific fieldsets, associated descriptions/errors, and a visible progress/status region. Focus the first invalid field on validation failure and announce acquisition transitions without repeatedly interrupting the user. Folder picker and setup links have descriptive labels; secrets are not echoed in the UI.

**Data:** The source descriptor (kind, non-secret locator, setup/acquisition status) is server-authoritative after submission. Host picker results and form drafts are local until accepted. Credentials are owned by the connection/authentication subsystem and are never rendered as project data.

### Project thread workspace

**Purpose:** Help the user select an isolated task thread or create one with explicit execution settings.

**Entry:** A project is selected from environment home and the project snapshot is available.

**Content hierarchy:**
1. Project name/status and environment connection status.
2. One primary action: **New thread**.
3. Active thread list; archived/settled threads in an explicit secondary section/filter.
4. Thread configuration summary: fixed Pi provider, selected catalog model, runtime access profile, execute interaction mode, latest turn status.

**Layout and responsive behavior:** Wide screens use a two-region layout: project/thread navigation on the left and the selected thread or empty project state on the right. Narrow screens use a single list route; selecting a thread replaces the list with a back affordance. Configuration opens as a full-width sheet or page on narrow screens, never as a cramped side panel.

**Interactions:** **New thread** presents the server-advertised Pi model catalog and fixed access profiles. The interaction-mode field shows `execute`; `plan` is visible only as an explicit unsupported capability when useful. Selecting a thread navigates to its workspace. Archived/settled/deleted threads are visibly non-active and do not expose an enabled composer.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | Project header and thread-list skeleton with “Loading threads” | Wait or navigate back | Snapshot renders the authoritative list |
| Empty | Project context plus “No threads yet” and **New thread** | Create thread | Configuration success opens the new thread |
| Validation | Inline errors for missing/unsupported model or access profile, or an explicit explanation that Pi plan mode is unsupported | Correct selection and resubmit | Server capability response identifies the valid choice |
| Recoverable error | Thread list/configuration request failed | Retry or return to project home | No phantom thread is added |
| Disabled | **New thread** unavailable while read-only, disconnected, or project lifecycle forbids mutation | Continue reading or reconnect | Controls re-enable only after authorization/synchronization permits |
| Success | New thread row appears once with its chosen configuration | Open thread | Server event sequence updates list |
| Archived/settled | Thread is labeled with lifecycle state; configuration is readable but mutation affordances are absent | Open read-only view or return | Lifecycle actions follow the thread contract |

States not applicable: assistant streaming and pending requests cannot be rendered as active project-list states; they belong to the thread snapshot.

**Accessibility:** Use `nav` for project/thread navigation and `main` for the selected content. Each thread row exposes name/ID, lifecycle, and latest turn status in accessible text. Configuration uses fieldsets/legends for mode groups, and unsupported options are disabled with an explanation rather than hidden.

**Data:** Project and thread summaries come from query snapshots and canonical lifecycle/turn events. Provider model options and capabilities come from the provider service capability query; never infer support from a provider name in the client.

### Thread configuration

**Purpose:** Create a thread with a provider-neutral, durable execution configuration.

**Entry:** **New thread** from a project workspace; project is active and the user has operation access.

**Content hierarchy:**
1. Thread name/identity: an optional user label or deterministic server fallback; never a generated title.
2. Fixed provider identity **Pi** and the server-advertised available model catalog.
3. Runtime access profile: read-only, workspace-write, or full-execution, with risk explanation.
4. Interaction mode: `execute`; `plan` is explicitly unsupported for Pi v1.
5. One primary action: **Create thread**; secondary **Cancel**.

**Layout and responsive behavior:** Wide screens use a readable form column with a capability summary beside it. Narrow screens stack fields and place the primary action after the last field; the summary becomes expandable content below each relevant choice. The form must remain usable at 200% text zoom without horizontal scrolling.

**Interactions:** The Pi provider identity is fixed for v1. Changing the selected model refreshes capability-dependent choices while preserving unrelated selections. Submission is disabled while invalid or awaiting the create receipt. A server rejection maps to the affected field or a form-level explanation and retains user input. Cancel returns to the project without creating a thread.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | Capability and project prerequisites loading | Wait or cancel | Form enables after authoritative Pi options arrive |
| Empty | No supported Pi model configuration available | Return to project; no false create action | Operator must configure an available Pi model; this is not a client fallback |
| Validation | Required/unsupported model or access-profile selection | Correct fields | Submit only a complete valid configuration |
| Recoverable error | Capability or create command failed | Retry | Preserve selections and reconcile with a fresh project snapshot |
| Disabled | Read-only, project not active, or connection not synchronized | Cancel/back | Mutation controls re-enable after state/authorization recovery |
| Success | Creation receipt acknowledged | Open new thread | Thread snapshot bootstraps before composer enables |

States not applicable: plan interaction mode is unsupported for Pi v1; completed/failed turns and pending requests cannot exist before a thread is created.

**Accessibility:** Use a single form with explicit labels, grouped radio/select controls, visible descriptions, and errors associated via equivalent semantics. On submit failure, move focus to the first invalid field; on success, announce creation before route change. Ensure risky access profiles are not indicated by color only.

**Data:** Options and capability flags are server-owned. The selected Pi provider instance identity, model, runtime access profile, and execute interaction mode are persisted as thread configuration and shown in the resulting workspace header.

### Ready thread workspace and composer

**Purpose:** Let the user understand the thread context and submit a prompt that becomes durable before provider work starts.

**Entry:** A newly created or existing active thread has a snapshot with no conflicting active turn.

**Content hierarchy:**
1. Thread header: project/thread identity, configuration summary, lifecycle, connection/sync status.
2. Conversation timeline: prior user/assistant messages and turn boundaries.
3. Composer with prompt field, bounded image attachment affordance, and one primary **Send** action.
4. Secondary work panel for historical activity, canonical change summaries, and session controls.

**Layout and responsive behavior:** Wide screens use a three-landmark composition: compact thread header, scrollable conversation column, and a secondary work panel that stays visually subordinate. The composer is anchored to the conversation column. Narrow screens stack the work panel below the timeline or expose it through labeled tabs/sections; the composer remains reachable without covering the latest message. Image attachment affordances remain explicit, and long prompts wrap rather than forcing horizontal scroll.

**Interactions:** Draft text is local until send. Sending creates a command ID and disables duplicate submission while awaiting the receipt; the user message becomes visible only as server-confirmed state, with a brief “Submitting” status if local intent is shown. Image attachments show filename/type/size and removable chips; unsupported or over-limit images fail before dispatch. A resumable Pi session is never resumed automatically by reconnect; the server may expose an explicit **Resume session** action only for a matching persisted session. Starting a new turn is unavailable while another turn is queued, running, or paused.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | Timeline skeleton and disabled composer while thread snapshot bootstraps | Wait or navigate back | Snapshot enables the correct controls |
| Empty | “No messages yet” guidance explaining the task context, with focused composer | Write and send first prompt | Server-confirmed user message starts a turn |
| Validation | Required prompt error; attachment type/size errors beside the affected item | Correct prompt or remove attachment | No command is sent until valid |
| Disabled | Composer disabled for archived/settled/deleted thread, no operation scope, active conflicting turn, or unavailable connection | Read, return, or use the active turn action | State-specific explanation names the reason |
| Recoverable error | Submit failed or server rejected an invalid transition | Retry the same intent with the same command ID where safe, or edit and submit a new intent | Original draft remains; no duplicate turn is created |
| Queued | Confirmed user message and turn badge “Queued” | Interrupt queued turn if supported | Provider begins work or interruption settles it |
| Success | User message is durable and the turn is accepted | Follow the live turn | Timeline remains one message/one turn |

States not applicable: approval/input/completion states are specified in their dedicated scenes, though their read-only summary can appear in this workspace.

**Accessibility:** Use a labeled `main` conversation region, a live region for submission/turn status, and a labeled form. Do not move focus on every streamed delta. On successful send, retain focus in the composer unless an approval/input pause requires an announced focus transition. Attachments are keyboard removable and expose errors in text. Message roles and turn status are conveyed semantically, not by alignment alone.

**Data:** Timeline and turn state come from the thread snapshot/event reducer. Composer draft is local and disposable until the server accepts the command. Attachment metadata is user input; provider acceptance and resulting activity are server-authoritative.

### Live running turn

**Purpose:** Make incremental agent work understandable while preserving one stable canonical turn.

**Entry:** Thread snapshot/event stream reports a queued or running turn with the current sequence cursor.

**Content hierarchy:**
1. Current turn status and elapsed/progress wording that does not imply a false percentage.
2. One assembled assistant response that grows from deltas without duplicate fragments.
3. Activity/work log with canonical kind, summary, and lifecycle state.
4. Interrupt action and synchronization status.

**Layout and responsive behavior:** Wide screens keep assistant content in the reading column and activity in a collapsible side panel with the active item visually emphasized. Narrow screens place the current activity summary immediately below the assistant response and allow the full work log to expand. The interrupt control remains visible near the current turn but is not sticky over text.

**Interactions:** Each ordered event updates the current projection. Repeated runtime event IDs or command IDs produce no duplicate visual item. Activity status uses labels such as running, succeeded, failed, declined, and interrupted, with a concise summary. The **Interrupt turn** action is available for queued/running/paused states and requires a confirmation treatment appropriate to the risk of losing in-progress work.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | “Waiting for live turn” with current known snapshot | Wait or refresh state | Subscription begins from snapshot/marker then ordered events |
| Queued | User message, queued badge, no fabricated assistant output | Interrupt if supported | Transition to running or interrupted |
| Running | Streaming assistant text, active activity, and “Live”/sequence health indicator | Interrupt; inspect activity details | Continue until completion, pause, failure, or interruption |
| Recoverable stream error | Clear connection/replay warning while preserving known content | Reconnect or refresh state | Replay or snapshot convergence; no duplicate text |
| Disabled | New prompt disabled while active turn is unresolved | Interrupt or read | Composer returns after settled state |
| Success | Turn reaches completed state with final assistant message and completed activities | Review, start next turn | Completion scene becomes the durable record |
| Interrupted | Turn badge and reason explain explicit/user/session interruption | Review partial result or start a new turn when allowed | Pending requests are visibly finalized |
| Failed | Structured provider/application failure with safe metadata | Retry/new turn if valid; inspect diagnostics only if authorized | Never display success styling or completion wording |

States not applicable: Empty is not a reachable state once a running turn exists; it is covered by the ready workspace.

**Accessibility:** Mark the timeline as a live region only for concise status announcements; stream content itself is not announced character-by-character. Provide a **Show activity details** disclosure with a descriptive label. Interrupt confirmation moves focus into the confirmation and returns focus to the trigger on cancel. Status badges include text and icon/shape alternatives.

**Data:** Assistant content is the projection of ordered canonical assistant deltas keyed to the turn/message identity. Activities are canonical normalized events, never raw provider payloads. Sequence and connection health come from the shared recovery module; provider metadata is shown only when it is safe and part of the canonical error/capability contract.

### Pending approval request

**Purpose:** Give the user enough information to approve or decline one consequential provider operation without guessing.

**Entry:** A running turn receives a canonical approval request scoped to the current environment, thread, turn, provider session, and request ID.

**Content hierarchy:**
1. Prominent “Approval required” heading and paused turn status.
2. Exact normalized operation, target/scope, and meaningful impact summary.
3. Request/turn correlation context and any capability/risk label available from canonical state.
4. Primary **Approve** and secondary **Decline** actions; no competing prompt send.

**Layout and responsive behavior:** Wide screens pin the approval card at the top of the work panel while retaining the conversation context. Narrow screens move it directly beneath the thread header and before the composer/timeline continuation. The operation summary is readable without horizontal scrolling; long details use disclosure, not clipped text.

**Interactions:** Every mutating Pi operation reaches this scene before execution. Selecting **Approve** or **Decline** resolves the exact request once. Repeat the operation and consequence in a confirmation step when the canonical risk policy requires it. While submission is pending, both actions are disabled and the request is labeled “Responding.” After resolution, the card changes to resolved history and the turn returns to running or settles according to the authoritative denial/continuation event. A stale response never affects a new request.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | Approval card placeholder with “Loading request details” | Wait | Snapshot/event provides the complete request |
| Pending | Exact operation and clear approve/decline controls | Approve or decline | Provider continuation or final decline is rendered from events |
| Validation | Missing/invalid response state, if confirmation is incomplete | Complete confirmation or cancel | Keep request pending; do not dispatch a partial response |
| Disabled | Actions disabled while responding, disconnected, read-only, or request not fully synchronized | Reconnect/refresh or continue reading | Re-enable only for the still-pending exact request |
| Recoverable error | Response was not accepted or transport failed | Retry same command ID or refresh request | Original pending state remains unless server resolved it |
| Stale/resolved | “This approval is no longer active” with the current turn state | Refresh state; no approval action | Prevent late response from mutating another turn |
| Success | Resolved decision and provider continuation/settled outcome | Review timeline | Pending card leaves the actionable region |

States not applicable: Empty has no meaning for a request-specific scene; no request card is rendered when there is no pending request.

**Accessibility:** Use `role="alertdialog"` only for an immediate consequential confirmation; otherwise use a semantic section with a heading and live status. Focus the first actionable control when the pending request first appears, but do not steal focus from unrelated typing. Confirm/cancel labels include the operation, and keyboard activation works with Enter/Space. Announce resolution and stale rejection politely.

**Data:** Operation, fields, request ID, turn ID, session identity, and status come from canonical pending-request state. The authority for whether it is still actionable is the latest server sequence, not local card state.

### Pending structured-input request

**Purpose:** Collect all required choices in one correlated response so the agent can resume without guessing.

**Entry:** A running turn receives a canonical structured-input request with an operation/question and fields.

**Content hierarchy:**
1. Question/operation and paused turn context.
2. All required fields with their labels, descriptions, types, choices, and required markers.
3. One primary **Submit answers** action and secondary **Cancel/leave** behavior that does not imply a response.
4. Request identity and synchronization status when useful for troubleshooting.

**Layout and responsive behavior:** Wide screens use a readable form card in the work panel with the conversation still visible. Narrow screens promote the form directly into the main flow and stack fields. Multi-field answers remain in one form submission; do not make each field a separate command.

**Interactions:** Validate all fields before dispatch. Preserve values through recoverable transport errors. A user may leave the scene without answering; leaving does not auto-decline unless the product contract explicitly defines that command. On successful response, mark the request resolved and return to the live turn.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | Form skeleton and “Loading required answers” | Wait | Full field schema arrives from authoritative state |
| Pending | Complete labeled form and paused status | Enter all required answers and submit | Provider resumes after one durable response |
| Validation | Field-level missing/invalid answers plus summary | Correct fields | Focus first invalid field; keep other values |
| Disabled | Submit disabled while responding, disconnected, read-only, or stale | Reconnect/refresh or leave | No partial response is sent |
| Recoverable error | Submission failure with values retained | Retry same command ID or refresh | Request remains pending unless server says otherwise |
| Stale/resolved | Form replaced by “This question is no longer active” | Refresh/read current turn | Late answer is rejected safely |
| Success | Answers acknowledged; turn returns to running | Follow live turn | Resolved form becomes non-actionable history |

States not applicable: Empty cannot occur for a schema-backed request; a missing schema is an error, not an empty form.

**Accessibility:** Use a form, fieldset/legend for grouped options, explicit labels, descriptions, required semantics, and error associations. On validation, announce the summary and focus the first invalid field. Do not announce every keystroke. The request heading identifies the form context for screen-reader navigation.

**Data:** Field schema, question, request ID, and current status are server-authoritative canonical input state. Draft values are local until the single response command is accepted.

### Completed turn and result review

**Purpose:** Let the user understand the settled outcome and inspect the result in context.

**Entry:** Turn completion event or a fresh snapshot containing a completed turn.

**Content hierarchy:**
1. Final assistant response and explicit completed status.
2. User prompt and turn boundary for context.
3. Activity outcome summary, including failures/declines/interruption where applicable.
4. Canonical change summaries associated with this turn when supported.
5. One primary next action: **Start a new turn** when thread lifecycle and session state allow it.

**Layout and responsive behavior:** Wide screens present the final response in the main column and a review panel for activity/change summaries. Narrow screens preserve this order, converting panels to disclosures. Long output remains readable with copy/selectable text and no forced fixed-height viewport.

**Interactions:** Expand activities and summaries without changing the conversation record. Any canonical change summary is read-only. Start-next-turn returns to the composer. Pi v1 does not expose rollback or checkpoint mutation from this scene.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | Settled-turn skeleton while snapshot/replay applies | Wait | Render from snapshot or ordered completion event |
| Empty | Not applicable: a completed-turn scene requires a turn | Return to thread timeline | No empty result card is shown |
| Recoverable error | Review panel or summary failed to load while the final message remains | Retry the affected query/section | Preserve the settled message and avoid false omission claims |
| Disabled | New turn disabled for archived, settled, read-only, disconnected, unsupported, or deleted thread | Read/copy safe details | Explain the precise reason |
| Success | Completed badge, final response, activity summaries, and associated changes | Start next turn or review | New command begins a distinct turn |
| Provider failure outcome | Failed status, safe structured error, and any partial result clearly marked | Retry/new turn when valid | Never style partial output as completed |
| Interrupted outcome | Interrupted status and reason, with pending requests finalized | Review partial output or start new turn | Durable state is replayable and consistent |

**Accessibility:** Use a heading for the final result and a status landmark for completion outcome. Make disclosures keyboard-operable and preserve focus when opening/closing them. Clearly distinguish final, partial, failed, and interrupted text in accessible labels. Avoid announcing the full response as one interruptive alert.

**Data:** Final response, turn status/final reason, activities, canonical change summaries, and error metadata are from the thread snapshot/reducer. Association uses turn identity, not arrival order or UI position.

### Change summary review

**Purpose:** Show provider-neutral, turn-associated change summaries without requiring full VCS integration or exposing raw Pi traffic.

**Entry:** A canonical change summary or capability response exists in the thread snapshot.

**Content hierarchy:**
1. Turn association and summary status.
2. Affected files, bounded counts, or concise activity result only when provided canonically.
3. A clear capability explanation when no summary, checkpoint, or rollback operation exists.
4. No mutation action in the Pi v1 review surface.

**Layout and responsive behavior:** Wide screens use a collapsible review compartment adjacent to the conversation. Narrow screens use a full-width disclosure ordered turn status → changes → capability explanation. File/path summaries wrap and are never shown as raw unbounded logs.

**Interactions:** Opening the summary does not pause or mutate a turn. Pi v1 summaries are read-only. Unsupported plan mode, checkpoint, and rollback are explained as unavailable rather than rendered as disabled mutation controls unless a future provider capability explicitly advertises them.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | Review-section skeleton | Wait | Snapshot/replay populates canonical summaries |
| Empty | “No change summary for this turn” when the section is explicitly opened | Return to conversation | Do not infer a plan or fabricate file changes |
| Unsupported | “Pi does not provide this review capability in the first delivery” | Read supported summaries | No provider-specific fallback control |
| Disabled | Summary unavailable for read-only, disconnected, stale, or deleted state | Read current thread | Re-enable only after authoritative state permits review |
| Recoverable error | Summary query/replay failed | Retry or refresh state | Conversation remains usable; no raw payload fallback |
| Success | Turn-associated summary rendered | Continue review or start next turn | Conversation and history remain intact |

**Accessibility:** Use headings and disclosure buttons with expanded state. Summaries use semantic lists/tables only when the data has true tabular relationships. Capability absence is textual and not color-only. Focus returns to the disclosure trigger after closing.

**Data:** Turn association, change summaries, capability flags, and safe diagnostics come from canonical snapshot/events and provider capability responses. Full VCS details are not assumed present.

### Interruption, stopped session, and provider-exit outcome

**Purpose:** Make non-successful endings honest and actionable without hiding the conversation record.

**Entry:** Explicit interrupt/stop command, provider process exit, or fresh snapshot containing an interrupted/failed turn.

**Content hierarchy:**
1. Outcome banner with exact state: interrupted, session stopped, or failed.
2. Safe reason/error summary and affected turn/session identity.
3. Finalized pending-request status, if any.
4. Preserved partial assistant/activity content.
5. One primary valid next action: **Start a new turn**, **Reconnect**, or **Return to project**, never a generic retry that could duplicate work.

**Layout and responsive behavior:** Wide screens use a full-width outcome banner above the affected turn and keep details in the work panel. Narrow screens stack the banner and actions before the preserved timeline. The failure reason remains readable at zoom and does not rely on a toast that disappears.

**Interactions:** Interrupt/stop commands are idempotent; retrying the same command returns its original receipt. A provider-exit outcome can expose correlation-safe metadata to authorized users but never raw provider payloads. Pending approval/input cards become resolved/finalized and cannot be answered after the session ends.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | Outcome skeleton while finalization/replay completes | Wait | Render finalized canonical state |
| Empty | Not applicable: an outcome requires an affected turn/session | Return to project | No fabricated error card |
| Recoverable error | Finalization or recovery still pending, with connection status | Reconnect/refresh state | Do not claim finality until the server event arrives |
| Disabled | Mutations disabled while disconnected, unauthorized, deleted, or lifecycle-forbidden | Read/copy safe details or return | Re-enable only for a valid current state |
| Interrupted | Explicit reason and preserved partial work | Start new turn when allowed | Pending requests are visibly finalized |
| Session stopped | Provider session stopped and any active turn outcome shown | Start/resume supported session or return | Session state comes from server, not button animation |
| Provider failed | Structured failure, no success affordance, pending requests finalized | Retry/new turn if contract allows | Fresh snapshot/replay renders same failure |
| Success of stop/interrupt | Command receipt and durable settled outcome | Continue reading | No duplicate lifecycle events on retry |

States not applicable: an ordinary completed success belongs to the completed-turn scene, not this outcome scene.

**Accessibility:** Use a persistent status region with a specific heading, not an auto-dismissed toast. Announce transition once, then expose details in normal document flow. Ensure the primary recovery action is first in the outcome region and keyboard reachable. Error text must have sufficient contrast and identify the affected turn without exposing secrets.

**Data:** Outcome status, reason, provider/session metadata, finalized requests, and partial content are server-authoritative canonical state. The client may display a connection diagnostic but cannot turn an unresolved state into success.

### Thread lifecycle confirmation

**Purpose:** Let a user archive, settle, or delete a thread without accidental loss or invalid transitions.

**Entry:** Thread header action from an active/archived/settled thread, subject to authorization and current turn state.

**Content hierarchy:**
1. Thread identity and current lifecycle status.
2. Consequence of the selected action: archive/settle removes it from active work; delete removes it from navigation and is destructive.
3. One clearly labeled confirm action and cancel.

**Layout and responsive behavior:** Wide screens use a modal with the thread identity and consequence text. Narrow screens use a full-screen confirmation sheet when necessary, preserving a visible close/cancel control. Delete confirmation must not be a browser-only prompt because it needs accessible, specific copy.

**Interactions:** Archive/settle may be disabled while a conflicting active turn exists or may require interruption first, according to the server contract. Delete is enabled only for a valid lifecycle state and requires explicit confirmation with the thread name. On success, navigate to the project workspace and announce the new list state. Cancel leaves the thread unchanged.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | Current lifecycle/action availability loading | Wait or cancel | Snapshot resolves allowed transitions |
| Validation | Confirmation requires an explicit selected action; invalid current transition explained | Choose valid action or cancel | No command on incomplete confirmation |
| Disabled | Action unavailable because of active turn, read-only scope, disconnected state, or already-deleted thread | Cancel/back/read | Current server state controls availability |
| Recoverable error | Lifecycle command failed or became stale | Retry same command ID or refresh | No navigation away from a still-existing thread |
| Success | Confirmation of archived/settled/deleted status | Return/open project | Navigation and list derive from the event |
| Unauthorized | Operation access denied while read access may remain | Cancel/read-only return | Do not imply the action occurred |

States not applicable: Empty and streaming are not states of the confirmation dialog itself; the underlying thread may contain messages/turns, but the dialog only confirms lifecycle intent.

**Accessibility:** Use a modal dialog with a descriptive title, consequence text, and labeled confirm/cancel buttons. Trap focus while open, support Escape to cancel, and return focus to the triggering control. Destructive action is textually labeled **Delete thread**, never just an icon or “OK.”

**Data:** Current lifecycle and allowed transitions come from the latest thread snapshot; command receipt and resulting status come from the server. Navigation follows the owning project relationship.

### Synchronization and recovery status

**Purpose:** Explain whether the displayed thread is live, replaying, snapshot-backed, or waiting for a bounded recovery without making the user reason about protocol details.

**Entry:** Every environment/project/thread route during bootstrap, subscription, disconnect, replay, gap detection, failed replay, or snapshot fallback.

**Content hierarchy:**
1. Concise connection health: connected, reconnecting, or disconnected.
2. Data health: synchronized, replaying missed updates, detecting a gap, or applying a fresh snapshot.
3. Affected action guidance: what remains safe to read and which mutations are paused.
4. Optional **Refresh state** action when bounded recovery needs user initiation.

**Layout and responsive behavior:** Wide screens show a compact status indicator in the environment/thread header with an expandable detail region. Narrow screens show a full-width status row above the current content when it changes; it must not permanently consume the composer area. Persistent problems stay in document flow, not transient toasts.

**Interactions:** Initial bootstrap renders loading until a snapshot/marker arrives. Replay begins strictly after the last exclusive sequence. A sequence gap or no-progress limit triggers bounded fallback to a fresh snapshot. Applying a snapshot never allows older cached state to overwrite newer live state. Mutation controls reflect authorization and synchronization separately; a connected read-only state is not confused with a disconnected state.

**State matrix:**

| State | What the user sees | Available action | Recovery or next step |
| --- | --- | --- | --- |
| Loading | “Connecting and loading current state” | Wait/back | Snapshot or synchronization marker establishes the baseline |
| Synchronized | Compact “Up to date” status | Normal actions allowed by authorization/lifecycle | Ordered live events continue |
| Replaying | “Catching up from sequence …” and known content remains visible | Read; safe actions only if contract permits | Replay applies each sequence at most once |
| Gap detected | “Some updates were missed; recovering” | Wait or refresh state | Bounded resubscribe/replay, then snapshot fallback |
| Snapshot fallback | “Refreshing complete state” | Wait | Fresh snapshot replaces local projection and announces completion |
| Recoverable failure | “Unable to recover yet” with retry count bounded in user terms | **Retry connection** or **Refresh state** | On repeated no-progress, route to a stable error with return option |
| Disconnected | Last known state labeled stale; mutation controls disabled | Retry connection/read cached state | No stale state is presented as current |
| Success | “State synchronized” announcement after recovery | Resume normal action | Focus stays where possible; no duplicate entries |

States not applicable: Empty is owned by the relevant project/thread scene; synchronization status can accompany an empty scene but does not replace its empty guidance.

**Accessibility:** Status text is available in a polite live region and remains visible for persistent states. Never rely on animation/spinners alone. Do not move focus for ordinary reconnects; move focus only when the current scene is replaced or an action becomes unsafe, and explain why. Sequence numbers are supplementary, not the only explanation.

**Data:** Connection health comes from the shared connection supervisor; synchronization mode, last applied sequence, replay/gap/fallback result, and server snapshot come from the shared recovery module. Local cache is explicitly lower authority than newer live/snapshot state.

## Component inventory

| Component or pattern | Scenes | Responsibility and variants | Existing primitive or new work |
| --- | --- | --- | --- |
| Project source chooser | Project home, source onboarding | Searchable modal/sheet listing local folder and supported repository sources, with setup-required/disabled variants and keyboard navigation | New web component backed by source capability catalog |
| Project source configuration | Source configuration/acquisition | Source-specific locator form, host folder picker handoff, setup link, validation, acquisition progress, and safe failure | New web component backed by canonical source descriptor |
| Contextual surface launcher | Thread workspace, review | Reference-only Browser/Terminal/Files/full-Diff slots; no v1 surface implementation or alternate orchestration state | New responsive pattern only where the shell needs a capability explanation |
| Settings section navigation | Source setup references | Link/placeholder to the owning connection surface; no Pi settings or credential controls | New shell pattern only if host auth supplies a destination |
| Environment/project navigation | Project home, project workspace, lifecycle outcome | Hierarchical navigation, active/archived/settled/deleted status, current-location semantics | New web component; no existing UI primitive found |
| Project/thread list row | Project home, project workspace | Link-like row with identity, lifecycle, latest turn state, source summary, optional counts | New web component |
| Connection and synchronization status | Every route | Separate connection and data-health states; compact and expanded variants | New shared client/state-backed component |
| Configuration form | Thread configuration | Fixed Pi provider, curated model, runtime access profile, execute interaction mode, and capability errors | New web form built on the eventual web form primitives |
| Thread header | Thread workspace, outcomes, lifecycle | Identity, Pi configuration summary, lifecycle actions, session state | New web component |
| Conversation timeline | Ready, live, completed, failure scenes | User/assistant messages, turn boundaries, stable streamed assembly, partial/final labels | New web component driven by canonical reducer |
| Composer and image attachment list | Ready/live thread workspace | Prompt entry, bounded image metadata, submit/disabled/recoverable states | New web component with image-only validation |
| Activity/work log | Live, completed, failure, review | Canonical activity kind, summary, lifecycle variants: running/succeeded/failed/declined/interrupted | New web component using pure derived presentation state |
| Pending request card | Approval and structured-input scenes | Approval variant and flat typed form variant; pending/responding/resolved/stale/error | New web component |
| Confirmation dialog | Approval, lifecycle, interrupt/stop | Consequence-specific confirmation, focus management, destructive variant | New shared pattern |
| Change summary review | Completed, live, review | Read-only turn-associated summaries and capability explanations; no Pi rollback/checkpoint mutation | New web component |
| Outcome banner | Completed, interrupted, stopped, failed | Honest durable result with reason and next action | New web component |
| Disclosure/secondary work panel | Thread workspace and narrow layout | Progressive detail without hiding primary state or keyboard access | New responsive pattern |
| Live status announcer | Timeline, request, recovery | Concise polite announcements for state transitions; no per-delta spam | New shared accessibility utility |

## Visual direction

**Character:** **Tactical Telemetry & CRT Terminal** — a dark, rigid operational interface for inspecting agent state and controlling consequential work. It is the sole visual archetype for this delivery; do not mix it with soft desktop-app styling.

- **Substrate:** Dark-only surfaces around `#0A0A0A` and `#121212`, foreground around `#EAEAEA`, visible compartment dividers, and hazard red around `#FF2A2A`. Use green only for one explicit “State synchronized” readout. Ordinary queued, running, archived, and disabled states use labeled neutral treatments rather than a rainbow status palette.
- **Hierarchy:** The conversation and current pending request occupy the primary reading path. Project/thread navigation and review summaries are rigid secondary compartments. Diagnostics are progressive disclosure, never a dashboard of raw provider traffic.
- **Grid and surfaces:** Use a strict column/row grid, square edges, visible borders, and hard separators. No gradients, glassmorphism, translucency, soft shadows, or rounded corners. Panels are compartments, not floating cards.
- **Telemetry:** Use a legible monospaced face for statuses, identifiers, paths, timestamps, activity labels, and compact controls. Long assistant responses may use a readable companion face, but telemetry never becomes tiny decorative text. Use `data`, `samp`, `kbd`, `output`, `dl`, and status landmarks where their semantics fit.
- **Technical markers:** ASCII framing, crosshair markers, section indices, and scanline/noise texture are optional detail layers only when they reinforce hierarchy. Texture is never required to decode state, never reduces contrast, and is disabled or simplified for reduced-motion/high-contrast preferences.
- **Semantic state:** Every status has visible text. Hazard red reinforces approval-required, failed, interrupted, destructive, and setup-required states; synchronized may use the single green readout; all other states use foreground/dim text and border changes. Never communicate meaning through color alone.
- **Typography and spacing:** Use a measured monospace scale, tight but readable line-height, and a consistent 4/8-unit rhythm. Keep labels short, align telemetry columns, and preserve generous reading width for streamed assistant text.
- **Iconography:** Icons are secondary technical markers, not the only affordance. Consequential actions always include visible labels such as **Approve**, **Decline**, **Interrupt turn**, **Stop session**, and **Delete project**.
- **Motion:** Motion communicates only loading, synchronization, and state transition. Streaming text appears on event arrival; it does not animate independently. Respect `prefers-reduced-motion`; no critical state depends on motion.
- **Responsive contract:** Wide layouts use rigid navigation/workspace/review compartments. Narrow layouts collapse them into a labeled sequence: project/thread context, current turn or pending request, conversation, then review detail. Preserve keyboard order, 200% zoom, readable wrapping, and no horizontal scrolling.

**Content and feedback:** Empty guidance is task-oriented: “No projects yet. Add a project to create a durable code context.” / “No threads yet. Create a thread to isolate this task and choose how Pi may work.” Use **Add project**, **New thread**, **Create thread**, **Send**, **Submit answers**, **Approve**, **Decline**, **Interrupt turn**, **Stop session**, **Resume session**, **Start a new turn**, **Refresh state**, and **Retry connection**. Durable labels include **Setup required**, **Submitting**, **Queued**, **Running**, **Waiting for approval**, **Waiting for input**, **Completed**, **Interrupted**, **Failed**, **Session stopped**, **Archived**, **Settled**, **Deleted**, **Reconnecting**, **Replaying**, and **State synchronized**. Delete copy names the aggregate and explains tombstone/removal from normal navigation without claiming physical erasure. Avoid raw Pi errors, stack traces, internal queue names, credentials, and local-button success claims.
## Validation

- [ ] Submit a prompt with and without bounded image attachments; observe the message recorded before execution, queued → running state, one assembled streamed assistant message, and canonical activity lifecycle states.
- [ ] Trigger a Pi approval bridge request; verify the mutating operation is gated before execution, the exact normalized scope is visible, approve/decline is correlated, and a stale response cannot change current state.
- [ ] Trigger a structured-input bridge request; verify the flat typed fields submit together, validation is field-specific, and Pi resumes only after authoritative resolution.
- [ ] Interrupt a running/paused turn and stop a Pi session; verify interrupt preserves a valid session when possible, stop disposes it, pending requests finalize, and no success presentation appears after failure.
- [ ] From an empty environment, open **Add project**, bind a local folder or acquire a generic Git URL, verify hosted rows are setup-required, then create a thread with an available Pi model, fixed access profile, and execute mode; the server-confirmed project/thread appears once.
- [ ] Archive, settle, and delete projects and threads; verify tombstones leave normal navigation, local folders remain untouched, and managed-source cleanup follows the canonical retention outcome.
- [ ] Verify Pi v1 exposes no plan mode, checkpoint transaction, rollback action, settings page, or contextual Browser/Terminal/Files/full-Diff implementation.
- [ ] Disconnect during streaming, reconnect from an exclusive sequence, force a sequence gap/replay failure, and verify bounded recovery, snapshot fallback, no duplicate messages/activities, and newer live state preserved over stale cache.
- [ ] Offer **Resume session** only for a matching persisted Pi session; verify reconnect alone never resumes provider work and explicit Stop makes the session non-resumable.
- [ ] Submit the same command ID twice and verify one durable outcome/receipt and one visible message/turn.
- [ ] Attempt invalid transitions, unsupported options, unauthorized reads/mutations, stale request responses, malformed input, and over-limit images; verify safe rejection with no state mutation and actionable feedback.
- [ ] Exercise the primary flow at narrow viewport, 200% zoom, keyboard-only navigation, screen-reader semantics, reduced motion, and high-contrast/contrast-check conditions.
- [ ] Confirm focus management for source chooser, project/thread lifecycle dialogs, pending requests, validation errors, route replacement, and recovery without announcing every streamed delta.
## Assumptions and settled decisions

- **Pi provider boundary:** Pi is embedded through `@earendil-works/pi-coding-agent`; the adapter owns SDK lifecycle and normalization. Process-backed ACP/Codex seams remain future-provider infrastructure.
- **Pi catalog:** The first client shows a server-curated catalog of authenticated/available Pi runtime models. There is no Pi settings or credential-management page.
- **Pi modes:** Runtime access profiles are read-only, workspace-write, and full-execution. The canonical interaction-mode field remains, but Pi v1 advertises only `execute`; plan mode is unsupported.
- **Pi pause bridge:** Adapter-owned custom tools create canonical approval and structured-input requests. Mutating operations are gated before execution; decline returns a structured denial and does not fabricate success.
- **Pi lifecycle:** Interrupt aborts active work while preserving a valid session when possible. Stop aborts, finalizes requests, disposes the session, and requires a new session. Reconnect does not auto-resume; explicit resume requires matching persisted session/workspace/model/profile.
- **Turn concurrency:** One queued/running/paused orchestration turn exists per thread. Pi steer/follow-up queueing is not exposed as extra client turns.
- **Source catalog:** Local folder and Git URL are actionable in the first host/runtime. GitHub, Azure DevOps, Bitbucket, and GitLab remain visible as setup-required until configured.
- **Source acquisition:** Local folders bind user-owned paths without copying. Generic Git URLs acquire into managed workspaces. Validation/acquisition is transactional and never leaves a partial project.
- **Cardinality and lifecycle:** Multiple projects and threads are first-class. Projects and threads support archive, settle, and delete; delete is a durable tombstone with bounded retained history and no restore UI in v1.
- **Naming and attachments:** Thread names are optional user labels with deterministic server fallback. Pi v1 supports bounded images only, not arbitrary files.
- **Review capabilities:** Pi v1 may expose bounded canonical change summaries where provable, but no plan mode, transactional checkpoint, rollback, or full VCS workflow.
- **Contextual surfaces:** Browser, Terminal, Files, and full Diff are reserved shell slots only; no implementation is implied.
- **Authorization and diagnostics:** Transport receives an authenticated principal and separates read/operation scopes. Client diagnostics are sanitized canonical metadata; raw Pi payloads and secrets never reach clients.
- **Visual system:** Tactical Telemetry & CRT Terminal is the sole archetype: dark substrate, rigid grid compartments, visible dividers, monospaced telemetry, hazard red, square surfaces, and accessible text-first status.

## Out of scope

- Marketing/public pages, Electron/native shell behavior, native menus, auto-update, and platform window behavior.
- Full mobile/React Native UI parity and offline outbox delivery in this first web vertical slice.
- Cloud relay, hosted multi-tenant operations, APNs, SSH/Tailscale, remote discovery, and cross-machine brokerage.
- Full Git/VCS, pull request, worktree, transactional checkpoint, rollback, and diff workflow beyond canonical source acquisition and bounded review summaries.
- Browser automation, terminal/PTTY rendering, port previews, file-browser implementations, and preview mini-player surfaces.
- Pi settings/authentication console, provider-specific raw controls, arbitrary tool lists, raw provider payloads, and credential display.
- Pi plan mode and rollback in the first delivery; unsupported capabilities are explained rather than simulated.
- Arbitrary file attachments; only bounded image attachments are part of the first Pi contract.
- Operator rebuild/retry/retention dashboards and protocol diagnostics tooling; their outcomes appear only as user-safe loading, recovery, or failure states.
- Text generation for thread titles, branch names, commits, pull requests, or project labels.
- Optimistic UI as an alternate source of truth; local drafts are allowed, durable displayed state is server-authoritative.
