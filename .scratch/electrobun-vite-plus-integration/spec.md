# Electrobun and Vite Plus Desktop Integration

**Status:** ready-for-agent
**Triage:** ready-for-agent
**Source:** repository audit, completed Electrobun v1.18.1 and Vite Plus integration research, existing orchestration transport contracts, and the current desktop handoff.

## Problem Statement

LabQ Code has two separately functioning pieces that are not yet an integrated desktop application. The web client is built with Vite Plus (`vp`) inside its own frontend package, while Electrobun builds a Bun backend process and native macOS shell. The current native bundle contains the Bun backend but no packaged Vite view, and the backend does not create a `BrowserWindow` that loads the frontend.

The current frontend adapter also hand-rolls an Electrobun WebSocket connection. That connection does not implement Electrobun v1.18.1's webview-scoped URL, encryption, or SDK transport registration, so the desktop client cannot reliably bootstrap snapshots, dispatch commands, or receive domain events through the native shell.

This leaves users and developers with a browser frontend and a native acceptance bundle that are effectively separate applications. A successful frontend build or Bun compilation does not prove that the desktop app can load the product workspace, connect to the orchestration engine, or render server-authoritative state.

## Solution

Integrate the existing Vite Plus frontend and Electrobun shell through explicit build, runtime, and transport seams without merging their bundlers.

Vite Plus remains the only frontend compiler and owns React, Tailwind, frontend aliases, tests, and development HMR. Electrobun owns the native `BrowserWindow`, the Bun backend process, packaged view assets, and the typed RPC bridge to the orchestration engine.

The integrated application will:

- use `vp dev` for the frontend development server and load it in the native window when available;
- use `vp build` to produce the frontend artifact before Electrobun packaging;
- copy the built HTML and assets into Electrobun's `views://` namespace for standalone operation;
- create the native window from the Bun entrypoint and select the development URL or packaged view URL;
- use Electrobun's public `BrowserView.defineRPC` and `Electroview` APIs rather than a private raw socket protocol;
- expose the existing orchestration transport contract for snapshots, synchronization, canonical commands, scoped subscriptions, receipts, and ordered domain events;
- preserve browser execution with the existing non-desktop transport fallback; and
- prove the complete desktop path with a deterministic smoke scenario.

## User Stories

1. As a LabQ Code developer, I want one reproducible dependency declaration for Electrobun, so that a clean checkout can build the desktop app without relying on an untracked local installation.
2. As a LabQ Code developer, I want the native shell configuration to use the installed Electrobun v1.18.1 configuration vocabulary, so that the build does not silently ignore unsupported options.
3. As a LabQ Code developer, I want Vite Plus to remain the only frontend bundler, so that React, Tailwind, aliases, and asset processing have one source of truth.
4. As a LabQ Code developer, I want the desktop build to consume the existing Vite production artifact, so that the native bundle renders the same frontend that `vp build` produces.
5. As a LabQ Code developer, I want the generated HTML and asset files placed in the Electrobun view namespace, so that packaged resources resolve independently of the checkout filesystem.
6. As a desktop user, I want the LabQ Code app to open the product web client rather than an old acceptance report, so that the native app is useful for orchestration work.
7. As a desktop user, I want the packaged web client to load its JavaScript, CSS, fonts, and other emitted assets, so that the app does not display a blank or partially styled window.
8. As a desktop user, I want the app identity and window title to identify LabQ Code, so that the native application is distinguishable from template or acceptance artifacts.
9. As a LabQ Code developer, I want the Bun entrypoint to create the native `BrowserWindow`, so that a successful backend build also has an explicit window-loading path.
10. As a LabQ Code developer, I want the Bun process to load the Vite Plus development server when it is reachable, so that native development can use frontend HMR.
11. As a LabQ Code developer, I want the native process to fall back to packaged view assets when the development server is unavailable, so that a desktop build remains launchable without a separately running frontend server.
12. As a LabQ Code developer, I want the development URL probe to be bounded and observable, so that a missing frontend server produces a deterministic fallback rather than an indefinite loading state.
13. As a frontend developer, I want React source changes to update inside the native window through Vite HMR, so that I can iterate without rebuilding the entire desktop bundle for every UI change.
14. As a frontend developer, I want the Electrobun watch process to ignore Vite's generated output, so that HMR and native rebuild watching do not trigger redundant rebuild loops.
15. As a LabQ Code developer, I want the desktop RPC schema to describe structured request parameters and responses, so that the Bun backend and webview share compile-time contracts.
16. As a desktop user, I want the web client to bootstrap an authorized scoped snapshot through the native shell, so that the first rendered state reflects the orchestration engine rather than fake or component-local data.
17. As a desktop user, I want synchronization results to use the canonical cursor and scope contract, so that reconnect and recovery semantics remain identical between browser and desktop clients.
18. As a desktop user, I want a typed command dispatched from the web client to reach the orchestration engine, so that project, thread, turn, lifecycle, approval, and input actions use the existing command contract.
19. As a desktop user, I want command results and receipts returned through the native bridge, so that a command is not shown as durable until the server confirms it.
20. As a desktop user, I want scoped domain events streamed into the client projection, so that assistant output, activity, pending requests, lifecycle transitions, and synchronization state update without polling.
21. As a desktop user, I want event subscriptions scoped to the active environment, project, or thread, so that unrelated private orchestration activity is not rendered.
22. As a desktop user, I want duplicate event delivery to be handled by the existing ordered projection contract, so that reconnect or transport retries do not duplicate messages or activities.
23. As a desktop user, I want the native bridge to report connection and request failures honestly, so that the interface can show disconnected, synchronizing, failed, and retryable states instead of false success.
24. As a LabQ Code developer, I want the public Electrobun RPC SDK to manage webview identity, encryption, request correlation, timeouts, and transport registration, so that the application does not depend on private native socket details.
25. As a LabQ Code developer, I want subscription cleanup when the webview or client store unsubscribes, so that closed desktop windows do not retain engine listeners or receive stale events.
26. As a browser developer, I want the web client to continue running outside Electrobun, so that ordinary `vp dev` browser work does not construct an unbound native RPC client.
27. As a browser developer, I want the non-desktop fallback transport to retain its existing semantics, so that frontend tests and browser development remain deterministic while desktop integration evolves.
28. As a LabQ Code developer, I want frontend and native build commands to make their ordering explicit, so that the desktop package never copies stale or missing Vite output.
29. As a LabQ Code developer, I want a single smoke command to prove frontend build, Electrobun packaging, app launch, snapshot bootstrap, command dispatch, and event delivery, so that desktop integration regressions are caught at the highest useful seam.
30. As a maintainer, I want the current acceptance report to remain separate from the product web client, so that evidence tooling does not become an alternate production UI or transport contract.
31. As a maintainer, I want the desktop integration to preserve the existing provider-neutral orchestration vocabulary, so that the native shell does not introduce Pi-specific presentation or transport paths.
32. As a future client developer, I want the same typed orchestration transport seam to support browser and native clients, so that desktop packaging does not fork domain state, commands, receipts, or recovery behavior.
33. As a maintainer, I want the final desktop verification to inspect the generated app's view and backend resources, so that a green TypeScript build cannot mask missing packaged assets.
34. As a maintainer, I want native development failure logs to identify whether the frontend server, packaged view, Bun process, or RPC bridge failed, so that integration failures can be diagnosed at the responsible seam.

## Implementation Decisions

- Vite Plus remains the sole frontend build system. Electrobun must consume its output rather than compile the frontend source through a second browser bundler.
- Electrobun v1.18.1 uses its Bun process entrypoint configuration for the backend, its copy mapping for already-built static assets, and its watch-ignore configuration for generated frontend output. Newer or drifted configuration names that are not present in v1.18.1 are not part of this contract.
- The packaged view has one stable logical name, `mainview`, and is loaded through Electrobun's `views://` protocol. The HTML and all emitted assets must live under that view namespace.
- The Vite production public base is configured for embedded relative asset resolution. The generated HTML must reference assets relative to the packaged view rather than assume an HTTP server root.
- The desktop build is ordered: frontend production build first, Electrobun package second. Electrobun does not implicitly run the Vite Plus build.
- The native Bun entrypoint owns the `BrowserWindow` lifecycle. It chooses the Vite development URL only when the development channel and a bounded server probe both succeed; otherwise it chooses the packaged view URL.
- The native window uses one attached Electrobun RPC instance for the default webview. The orchestration engine and transport remain in the Bun process; React components never call the engine or provider adapter directly.
- The desktop bridge uses Electrobun's public `BrowserView.defineRPC` API in Bun and `Electroview` in the webview. The application does not access the raw RPC socket URL, webview secret, encryption helpers, or private transport framing directly.
- The shared RPC schema uses Electrobun's structured request and response model. Snapshot, synchronization, and command operations are requests from the webview to Bun. Canonical domain events are messages from Bun to the webview.
- Subscription intent is represented as a typed RPC message carrying the current subscription scope. The Bun process registers the active webview listener and sends canonical events through the attached RPC message channel. Subscription cleanup removes the listener when the client unsubscribes or the webview closes.
- The transport adapter remains the single client-facing seam. It may expose asynchronous implementations for native RPC while retaining compatibility with the existing synchronous fake transport used by browser tests.
- The client store remains responsible for bootstrap, projection, ordered event application, cursor tracking, synchronization health, and recovery. The desktop adapter only translates between the transport port and Electrobun RPC.
- Browser fallback detection occurs before native RPC construction. Running the frontend in a normal browser continues to use the existing fallback transport without requiring Electrobun globals.
- Native build scripts may coordinate the frontend dev server and Electrobun process, but they must not hide the distinction between Vite HMR and Electrobun's full native rebuild watcher.
- The desktop app identity, window title, and generated artifact name use LabQ Code product identity rather than the old template or acceptance-report identity.
- The current acceptance report remains evidence tooling. This integration does not replace its report contract with product workspace behavior.
- No new orchestration domain concepts are introduced. The integration reuses environment, project, thread, session, turn, activity, pending request, receipt, snapshot, scope, cursor, synchronization, and domain-event vocabulary already established by the canonical contracts.

## Testing Decisions

- Tests assert externally observable behavior at the highest available seam. They verify generated resources, launched-window behavior, RPC results, canonical projection changes, and fallback states rather than private socket fields, internal encryption calls, or implementation-specific object layouts.
- The primary integration seam is a native-window or equivalent desktop harness connected to the real orchestration transport, with a deterministic provider fixture behind the existing provider adapter boundary where controlled events are needed.
- Packaging tests prove that the frontend artifact is built before Electrobun packaging, the expected view HTML and assets exist in the generated application, and the packaged HTML resolves its emitted resources through the `views://` boundary.
- Desktop launch tests prove that the Bun entrypoint creates a window, loads the product web client, and does not regress to the acceptance report or a blank loading page.
- Development-mode tests prove that a reachable Vite Plus server is selected, a missing server falls back to packaged assets, and frontend changes are handled by Vite HMR without relying on Electrobun's rebuild watcher.
- RPC tests prove snapshot bootstrap, synchronization, command dispatch, receipt propagation, scoped subscription, domain-event delivery, request failure, and subscription cleanup through the public Electrobun SDK seam.
- Projection tests reuse existing client-store and projector prior art. They verify that duplicate or out-of-order delivery follows the canonical cursor and event-ordering rules rather than testing the RPC packet format directly.
- Browser fallback tests run the same frontend outside Electrobun and verify that the fallback transport is selected without native globals, native socket construction, or desktop-only failures.
- Existing engine, transport, recovery, and acceptance tests remain authoritative for domain invariants, command idempotency, sequence ordering, snapshot fallback, provider lifecycle, and canonical event semantics. Desktop tests must not duplicate those lower-level assertions.
- The final smoke path exercises: build frontend, package app, launch native window, bootstrap a scoped snapshot, dispatch a typed command, receive a receipt, stream at least one canonical event, and confirm the client projection updates.
- Failure tests cover missing frontend output, missing development server, malformed or failed RPC responses, closed-window subscription cleanup, and browser execution outside Electrobun. Assertions must require honest failure or fallback state rather than suppressed errors.
- Tests must be deterministic and must not depend on arbitrary sleeps. They should use explicit readiness, semantic event drains, bounded timeouts, and existing receipt or synchronization markers.

## Out of Scope

- Redesigning the product web client, its route hierarchy, visual system, or accessibility contract beyond changes required to render the existing frontend inside Electrobun.
- Replacing Vite Plus with another frontend bundler or making Electrobun compile the React source as a second frontend pipeline.
- Implementing native menus, application update behavior, notarization, code signing, platform-specific window reproduction, custom title bars, or cross-platform packaging polish.
- Rebuilding the acceptance report or deleting acceptance evidence tooling.
- Introducing a direct Pi SDK call from the web client or a second provider-specific transport.
- Adding cloud relay, authentication infrastructure, remote discovery, or cross-machine communication.
- Implementing Browser, Terminal, Files, previews, full Diff, full VCS, rollback, checkpoints, or other reserved product capabilities.
- Changing orchestration commands, provider lifecycle semantics, authorization policy, source ownership rules, event ordering, snapshot shape, or recovery policy except where a transport schema must be adapted to the public Electrobun RPC representation without changing its meaning.
- Supporting arbitrary external or untrusted URLs through the trusted orchestration webview.
- Preserving the raw WebSocket adapter as a compatibility path after the official Electrobun RPC migration. The native transport should have one canonical implementation.
- Treating a running Vite development server as a production dependency. Packaged operation must work through the bundled `views://` assets.

## Further Notes

The installed Electrobun v1.18.1 source and tagged React/Vite template establish that the tools are complementary rather than competing. The important seam is not shared source ownership; it is the handoff from `vp build` output to Electrobun's packaged view namespace and the handoff from the webview to the Bun process through the public typed RPC API.

The current raw adapter is especially risky because it appears superficially close to Electrobun's packet shape while omitting webview identity and encryption. A successful TypeScript compilation of that adapter is not evidence of a working desktop bridge.

The first implementation should make the static desktop shell load before migrating the RPC transport, then prove snapshot bootstrap and commands, then prove event streaming and cleanup, and finally add the coordinated HMR workflow and full smoke coverage. Each stage should leave a demoable desktop behavior rather than a layer-only scaffold.

The integration research identified one packaging detail that must be verified empirically: the current Vite output uses root-relative asset URLs, while the packaged view is nested under `views://mainview/`. Relative embedded output is the intended solution, but the generated HTML and a launched app must confirm that every emitted script, stylesheet, font, and image resolves correctly.

The implementation must keep a clean cutover. Once the official RPC path is active and all callers are migrated, private socket access, obsolete schema shapes, and unused fallback aliases should be removed rather than retained as parallel conventions.
