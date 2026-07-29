# Native Electrobun End-to-End Testing

**Status:** ready-for-agent
**Triage:** ready-for-agent
**Source:** the current Electrobun v1.18.1 desktop integration, the packaged-view Playwright suite, the typed orchestration RPC contract, and the native-shell E2E architecture discussion.

## Problem Statement

LabQ Code now has a Playwright suite that builds the Vite Plus frontend, packages the Electrobun view, serves the packaged view over HTTP, and verifies the browser-visible orchestration flow. That suite proves the generated HTML, CSS, JavaScript, fonts, routing, React rendering, and browser fallback transport, but it does not drive the actual Electrobun `BrowserWindow`, `views://` protocol, WebKit view, preload bridge, encrypted RPC transport, or Bun-side orchestration handlers.

The native launcher can currently be started and observed through process logs, and Bun tests cover parts of the backend and RPC seams. There is no deterministic test that launches the packaged macOS application, waits for the real native webview to become usable, exercises the product UI inside that webview, verifies that commands cross the Electrobun bridge, observes canonical state changes, and closes the application cleanly.

Using Playwright as if the Electrobun WebKit view were a Chromium or standalone Playwright WebKit page is not a reliable solution. Electrobun v1.18.1 does not expose a Playwright/CDP endpoint for its native webview, and the `views://` page is owned by the native shell. A browser-only test can therefore pass while the native preload, custom protocol, RPC registration, or native window lifecycle is broken.

## Solution

Add a hybrid E2E strategy with one native application-visible test seam and retain Playwright for the packaged frontend artifact.

The existing Playwright suite will remain responsible for browser-level E2E against the exact packaged view artifact served over HTTP. It will continue to verify frontend behavior, accessible interactions, routing, browser fallback behavior, asset loading, and console/page errors.

A new macOS native E2E harness will launch the packaged LabQ Code application, control the actual Electrobun webview through a test-only loopback control channel, and use Electrobun's public JavaScript evaluation RPC to inspect and interact with the loaded page. The harness will use semantic, user-visible DOM operations rather than reading Zustand state, calling the engine directly, or inspecting private RPC packets.

The native scenario will prove the complete desktop path: packaged resources load through `views://mainview/`, the native webview renders the orchestration shell, the webview establishes the Electroview transport, snapshot bootstrap succeeds, a typed command reaches the Bun process, the resulting canonical event updates the client projection, and the application shuts down without retaining listeners or child processes.

## User Stories

1. As a LabQ Code maintainer, I want a native E2E command that launches the packaged macOS application, so that desktop regressions are tested at the same boundary users experience.
2. As a desktop user, I want the packaged application to load the product web client through the `views://` protocol, so that the app does not silently fall back to a browser-only or acceptance-report surface.
3. As a desktop user, I want the native window to render the orchestration shell, so that a successful Bun process also means the product UI is usable.
4. As a desktop user, I want the shell to show live connection and synchronization status, so that the first rendered state communicates whether the orchestration snapshot is authoritative.
5. As a desktop user, I want the webview to bootstrap an authoritative snapshot through the Electrobun RPC bridge, so that the UI does not display fake native data.
6. As a desktop user, I want project creation from the native UI to reach the Bun orchestration transport, so that a project is durable only after the native command path succeeds.
7. As a desktop user, I want the created project to appear in the native webview after its canonical event arrives, so that the UI proves event-driven projection rather than optimistic local rendering.
8. As a desktop user, I want thread creation from the native project workspace to work through the same typed bridge, so that the native shell preserves the browser client's orchestration behavior.
9. As a desktop user, I want the thread workspace and prompt composer to render inside the native window, so that the application provides an end-to-end path beyond the project list.
10. As a desktop user, I want a submitted prompt to produce an authoritative turn state, so that command receipts, ordered events, and visible conversation state remain aligned.
11. As a desktop user, I want native transport failures to produce an honest error or recoverable state, so that a broken bridge is not presented as a connected application.
12. As a desktop user, I want synchronization and cursor recovery to remain visible and deterministic, so that reconnect behavior is not hidden by the native shell.
13. As a desktop user, I want scoped subscriptions to update only the active environment, project, or thread, so that unrelated orchestration activity does not alter the current workspace.
14. As a desktop user, I want the application to stop receiving events after the native window closes, so that closed sessions do not retain stale listeners or mutate discarded UI state.
15. As a desktop user, I want the native application to close cleanly, so that the launcher, Bun child process, RPC server, and window resources do not remain running after a test or normal shutdown.
16. As a frontend developer, I want the existing Playwright suite to continue testing the packaged frontend over HTTP, so that accessible UI behavior remains fast to develop and easy to diagnose.
17. As a frontend developer, I want browser fallback tests to remain separate from native RPC tests, so that a browser-only failure is not confused with a WebKit preload or Electrobun bridge failure.
18. As a desktop developer, I want native readiness to be explicit, so that tests do not rely on arbitrary sleeps or assume that a launched process has already rendered React.
19. As a desktop developer, I want the harness to distinguish process startup, window creation, webview DOM readiness, RPC readiness, and application bootstrap, so that failures identify the responsible seam.
20. As a desktop developer, I want native page errors, unhandled rejections, and React runtime failures captured by the test harness, so that a visually blank or partially rendered window fails with useful evidence.
21. As a desktop developer, I want native test diagnostics to include launcher logs, Bun logs, the last evaluated state, and failure screenshots where available, so that failures can be reproduced without manually opening DevTools.
22. As a desktop developer, I want the test control channel to be available only in an explicitly enabled test mode, so that production builds do not expose arbitrary JavaScript evaluation or local control endpoints.
23. As a desktop developer, I want the native control channel bound only to loopback and protected by a per-process token, so that test instrumentation cannot be used as an unintended remote application API.
24. As a desktop developer, I want the native E2E runner to use a deterministic provider fixture or embedded provider adapter, so that tests do not depend on network access, credentials, model availability, or provider timing.
25. As a desktop developer, I want each native E2E run to use isolated temporary state, so that projects, threads, turns, receipts, and cursors from one run cannot contaminate another.
26. As a CI maintainer, I want native E2E to declare its macOS requirement clearly, so that unsupported runners fail honestly or are excluded rather than reporting a false pass.
27. As a CI maintainer, I want the native E2E command to build the frontend before packaging, so that the test cannot accidentally run against stale or missing view assets.
28. As a CI maintainer, I want native E2E to return a non-zero exit status for launcher failure, webview failure, RPC failure, UI assertion failure, timeout, or leaked process, so that CI protects the desktop release boundary.
29. As a maintainer, I want packaging assertions to remain separate from UI assertions, so that missing assets, broken native startup, and product-flow failures are independently diagnosable.
30. As a maintainer, I want backend transport tests to remain authoritative for snapshot, synchronization, command, receipt, event-ordering, authorization, and cleanup invariants, so that native E2E does not duplicate low-level domain coverage through fragile UI steps.
31. As a future client developer, I want one stable native test driver contract, so that additional desktop workspaces can reuse the same launch, readiness, evaluation, diagnostics, and shutdown behavior.
32. As a future platform maintainer, I want the test design to leave room for non-macOS native runners, so that the logical E2E scenario is not coupled unnecessarily to macOS-specific assertions.

## Implementation Decisions

- The test portfolio is hybrid. Playwright remains the browser E2E tool for the packaged Vite Plus artifact, while a Bun-driven native runner controls the real Electrobun application. The native runner is not a second browser automation framework and does not pretend that the WebKit view is a CDP target.
- The highest native test seam is the user-visible application loaded in the real `BrowserWindow` and its default `BrowserView`. The native harness must interact through visible DOM behavior and the public Electrobun JavaScript-evaluation RPC rather than through React internals, Zustand stores, engine objects, private socket framing, or provider SDK objects.
- The Bun entrypoint will expose a test-only loopback control channel when an explicit native E2E mode is enabled. The channel will provide only the operations required by the harness: readiness inspection, bounded JavaScript evaluation against the current webview, diagnostic retrieval, and application shutdown.
- The control channel will bind to `127.0.0.1`, use an ephemeral port, require a per-process capability token, and publish its connection information only to the parent test runner through a controlled readiness mechanism. It will not be enabled by normal desktop startup or release packaging.
- Native JavaScript evaluation will use Electrobun's public `evaluateJavascriptWithResponse` capability so that the test observes the actual document inside the actual native webview. Fire-and-forget JavaScript may be used only for narrowly defined setup or cleanup operations that do not require an assertion result.
- The native driver will provide a small semantic helper surface for waiting on visible text, reading roles and labels, clicking controls, filling fields, asserting URL/hash navigation, and reading diagnostic state. It will not grow into a general-purpose Playwright replacement or expose arbitrary application internals.
- The native test driver will install test-only page error collection before application assertions begin. It will collect uncaught errors, unhandled promise rejections, and relevant console error messages, and will fail the scenario if the page reports a React runtime error or an unexpected bridge failure.
- Native readiness is staged. The launcher process must start; the Bun process must report the app identity; the native window and webview must be created; the document must reach DOM readiness; the test control channel must respond; and the application must reach the expected connected/synchronized UI state. Each stage has a bounded timeout and a diagnostic failure message.
- The native launcher is started from the packaged application produced by the ordered frontend-build-then-Electrobun-build command. The native test does not run an unbundled source entrypoint as a substitute for the packaged application.
- The native E2E fixture will use an isolated temporary storage location and deterministic provider behavior behind the existing provider adapter boundary. It will not call external provider services or require user credentials.
- The native scenario will create a project, verify the project projection after the canonical event, create a thread, verify thread workspace rendering, submit a deterministic turn where supported by the fixture, and assert receipt/event-driven state transitions. It will also cover at least one recoverable native transport or bootstrap failure and assert the honest UI state.
- Native subscription cleanup will be verified by closing the webview or application and confirming that the Bun process exits cleanly without pending listeners or an open test control server.
- The existing Playwright suite will continue to serve the generated packaged view over HTTP and verify the browser-compatible frontend flow. Its assertions will continue to include console and page error capture, asset loading, route changes, project creation, thread creation, and composer behavior.
- Packaging tests will continue to inspect that the packaged view contains the generated HTML, emitted assets, relative asset references, and the Bun application entrypoint. These tests will not be merged into the native UI driver.
- Existing Bun transport, engine, recovery, storage, approval, input, lifecycle, and turn tests remain the source of truth for domain invariants. Native E2E will assert cross-layer behavior only where a user-visible result depends on the native shell and typed RPC bridge working together.
- The native E2E command will be explicit and separate from the ordinary unit/integration test command. It will report the platform prerequisite, build/package command, application launch command, readiness stages, scenario result, and cleanup result.
- Native DevTools opening will be disabled or redirected during automated E2E so that diagnostics do not interfere with window focus or process lifecycle. Human debugging may retain the existing DevTools behavior outside the automated mode.
- Stable accessibility roles, labels, names, and visible status text are the preferred selectors. New test identifiers may be introduced only where an observable control cannot be selected reliably through the existing accessibility contract.
- The initial implementation targets the macOS native renderer used by the packaged application. A future renderer or platform may reuse the control-channel contract while supplying platform-specific launch and window assertions.

## Testing Decisions

- A good native E2E test starts from the packaged application, drives the real native window, crosses the real Electroview/Bun RPC bridge, and asserts an externally visible result. It must fail if any of packaging, preload setup, custom protocol loading, RPC registration, bootstrap, command dispatch, event projection, or shutdown is broken.
- Tests must not assert private RPC packet shapes, encryption helpers, WebSocket URLs, webview secrets, Zustand implementation details, React component instances, engine maps, or provider SDK calls. Those are implementation details covered by lower-level contract tests where necessary.
- Tests must use explicit readiness markers, semantic polling, bounded timeouts, receipt state, cursor/synchronization markers, and process exit events. Arbitrary sleeps and fixed timing assumptions are prohibited.
- The native suite will test the following observable scenarios:
  - packaged launch selects and loads the product view rather than the acceptance report;
  - the native shell renders the environment/project home without a blank page or React runtime error;
  - connection and synchronization reach the expected healthy state;
  - project creation crosses the native bridge and renders the resulting project;
  - thread creation crosses the native bridge and renders the thread workspace;
  - deterministic turn submission produces the expected canonical visible state;
  - a scoped event reaches the active workspace while an unrelated scoped event does not alter it;
  - a bootstrap or RPC failure produces an honest recoverable state;
  - a closed window removes the subscription and the native process exits cleanly;
  - missing or stale packaged resources fail before UI assertions with an actionable packaging error.
- The browser Playwright suite remains responsible for fast UI coverage against the packaged artifact over HTTP. It will cover the same primary project/thread workflows from the browser fallback boundary, but it will not be described as proof of native WebKit or native RPC behavior.
- The existing native integration test prior art covers URL selection, safe module import without native FFI, window creation behavior in a non-native test process, and transport fallback detection. The new native harness will extend this seam rather than replace it.
- The existing web-client Vitest prior art covers route states, client-store bootstrap, projection updates, ordered event behavior, and browser fallback semantics. Native E2E will not duplicate those tests except at the application-visible boundary.
- Failure evidence must include the last readiness stage, launcher/Bun output, native control request and response summaries without secrets, current document title and visible status text, captured page errors, and the application exit status. Screenshots may be captured as supplementary diagnostics but are not the sole assertion mechanism.
- The native suite must clean up its child process, temporary state, loopback control server, and test fixture even when an assertion fails. A leaked launcher or Bun process is a test failure.
- Native E2E is required on a supported macOS CI runner before accepting changes to the desktop shell, packaged view loading, or native RPC adapter. Browser Playwright and Bun tests remain required on every supported development runner.
- The acceptance signal is a single deterministic native scenario that proves launch, render, bootstrap, typed command, canonical event projection, and shutdown. Additional scenarios may be added after this seam is stable.

## Out of Scope

- Attaching Playwright directly to Electrobun's WKWebView through an unsupported or private CDP protocol.
- Replacing the Electrobun native renderer with CEF solely to make browser automation easier.
- Treating a normal HTTP preview, browser Playwright run, or Vite dev server as proof that the native `views://` page and Electroview RPC bridge work.
- Building a general-purpose browser automation framework or reproducing all Playwright locator APIs inside the native test driver.
- Exposing a test control endpoint in production, release packages, or normal developer launches.
- Adding remote desktop control, cloud browser execution, or network-accessible test APIs.
- Testing real external Pi/provider services, credentials, model availability, network retries, or provider latency in native E2E.
- Replacing existing engine, transport, recovery, storage, approval, input, lifecycle, turn, or projection tests with UI scenarios.
- Pixel-perfect visual regression testing, cross-platform window styling, notarization, code signing, native menu testing, or accessibility conformance certification beyond the user-visible selectors needed by the scenarios.
- Introducing new orchestration domain concepts, changing command semantics, changing snapshot/event shapes, or changing provider lifecycle behavior.
- Testing reserved capabilities such as Browser, Terminal, Files, previews, full Diff, VCS, rollback, and checkpoints.

## Further Notes

The current Playwright suite is already the correct solution for the packaged frontend artifact. Its limitation is not a defect in Playwright; it is that the actual Electrobun WebKit view is not a Playwright/CDP target. The native control channel is therefore the narrowest new seam that can prove the missing behavior without coupling tests to private native internals.

The native test driver should be treated as a test-only application interface with the same care as any local control API: explicit opt-in, loopback-only binding, capability-token protection, bounded requests, redacted diagnostics, and guaranteed shutdown. The driver should expose the minimum necessary surface and keep user-visible DOM behavior as the assertion boundary.

The intended proof model is:

- Playwright proves the packaged web client and browser fallback.
- Bun contract tests prove orchestration and typed RPC semantics.
- Native E2E proves that packaging, the real native webview, the preload bridge, Electroview, Bun RPC, canonical projection, and shutdown work together.

This keeps each test layer honest while giving desktop changes one end-to-end acceptance path at the highest useful seam.
