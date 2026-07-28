# Electrobun Desktop Framework Assessment for Labq Code AI Orchestrator

**Date:** July 28, 2026  
**Target:** Electrobun 1.x, current upstream package/docs  
**Compared with:** `.scratch/specs/labq-code-spec.md`, `.scratch/ai-orchestrator/spec.md`, `docs/ui-specs/ai-orchestrator.md`, and the current TypeScript core under `src/`

## Executive recommendation

**Electrobun is a materially better desktop-framework candidate than Tauri for this project, but it is not yet a safe drop-in choice.** Its main-process model is TypeScript-oriented and can host filesystem, SQLite, Git, and process orchestration outside the browser view. That aligns better with the existing `src/engine/` and `src/source/source-manager.ts` code than Tauri's Rust-command model.

The blocking uncertainty is runtime compatibility with the required embedded Pi SDK. Electrobun's current upstream package and README describe a Cottontail/JSC-based main runtime, while the public Bun API documentation describes a Bun-compatible main process and the build configuration exposes multiple main-process backends. Pi's published package declares `node >=22.19.0` and has Node-oriented dependencies. The project must run a small, real Electrobun compatibility spike before adopting it. This is a source-grounded risk, not proof that Pi cannot run under Electrobun.

**Recommendation:**

- **v1:** Continue with the web-first TypeScript architecture required by the specs. Do not replace the current Tauri scaffold with Electrobun merely to gain native packaging before the orchestration vertical slice exists.
- **Future desktop:** Prefer an Electrobun desktop shell over Tauri **if and only if** the Pi SDK, SQLite driver, Git acquisition, and session lifecycle pass a real packaged-build spike in the Electrobun main process.
- **Do not rewrite the orchestrator in Rust.** Electrobun preserves a TypeScript main-process seam, so it can potentially reuse the existing engine directly or with a thin desktop host adapter.

## What Electrobun provides

### TypeScript main process

Electrobun's architecture starts a TypeScript main process through its native launcher/runtime. The architecture guide describes application code running in a worker and calling native GUI APIs through the runtime's FFI layer. The Bun API guide states that the bundled app ships with its runtime and that Bun-compatible TypeScript can be used in the main process.

- [Architecture overview](https://framework.blackboard.sh/electrobun/guides/architecture/overview/)
- [Bun API / main process](https://framework.blackboard.sh/electrobun/apis/bun/)
- [Build configuration](https://framework.blackboard.sh/electrobun/apis/cli/build-configuration)
- [Current package metadata](https://raw.githubusercontent.com/blackboardsh/electrobun/main/package/package.json)
- [Current upstream README](https://raw.githubusercontent.com/blackboardsh/electrobun/main/README.md)

This is the key advantage over Tauri: the desktop host can remain TypeScript rather than requiring a Rust rewrite or a separate Node/Bun sidecar solely to execute the application engine.

### Native windows and webviews

The UI runs in native webviews, with optional bundled CEF for renderer consistency. The official compatibility guide lists WebKit/WKWebView on macOS, WebView2 on Windows, and WebKitGTK or optional CEF on Linux.

- [BrowserView API](https://framework.blackboard.sh/electrobun/apis/browser-view/)
- [Compatibility](https://framework.blackboard.sh/electrobun/guides/compatability/)
- [Cross-platform development](https://framework.blackboard.sh/electrobun/guides/cross-platform-development/)

The browser view remains a browser context. Filesystem, Pi SDK, SQLite, and process work should stay in the main process and be exposed through a narrow RPC interface.

### Typed asynchronous RPC

Electrobun provides typed RPC between the main process and browser views. The BrowserView API defines request handlers, message handlers, response types, and a request timeout. Browser-to-main and main-to-browser calls are asynchronous.

- [BrowserView RPC API](https://framework.blackboard.sh/electrobun/apis/browser-view/)
- [Official RPC source example](https://github.com/blackboardsh/electrobun/blob/main/docs/src/content/docs/electrobun/apis/browser-view.mdx)

This is a good transport seam for a desktop client, but RPC is not the same as the orchestrator protocol. The application still needs its own command IDs, authorization checks, immutable event history, global sequence numbers, snapshot projection, exclusive replay, and reconnect behavior.

### Native dialogs and local paths

The main-process utility API includes an asynchronous file dialog with file/directory selection and multiple-selection options. It also exposes native message boxes, opening paths, moving items to Trash, and external URL opening.

- [Electrobun Utils API](https://framework.blackboard.sh/electrobun/apis/utils/)
- [Electrobun Paths API](https://framework.blackboard.sh/electrobun/apis/paths/)

This maps well to the source onboarding requirement. A folder picker can return a path to the TypeScript source manager, which can then validate and bind the user-owned folder without copying or deleting it.

### Process and filesystem capability through the main runtime

Electrobun's main-process model is intended for TypeScript that runs with its packaged runtime. The existing source manager already uses Node-style filesystem and child-process APIs. Bun itself provides `spawn`, stdout/stderr streams, exit callbacks, kill signals, AbortSignal support, and Bun-to-Bun IPC.

- [Bun child-process API](https://bun.sh/docs/runtime/child-process)
- [Electrobun main-process API](https://framework.blackboard.sh/electrobun/apis/bun/)
- [Electrobun architecture](https://framework.blackboard.sh/electrobun/guides/architecture/overview/)

This means generic Git acquisition and process-backed provider lifecycle are architecturally plausible without Tauri's Rust sidecar arrangement. The exact APIs available in the packaged Electrobun runtime still need to be verified; the project must not assume that every Bun or Node API works under Cottontail/JSC.

### Packaging, signing, and updates

Electrobun provides macOS, Windows, and Linux build artifacts. Its docs describe self-extracting ZSTD bundles, platform-specific distribution, optional CEF bundling, macOS code signing/notarization, and a built-in update mechanism using static hosting and BSDIFF patches.

- [Bundling and distribution](https://framework.blackboard.sh/electrobun/guides/bundling-and-distribution/)
- [Updates](https://framework.blackboard.sh/electrobun/guides/updates/)
- [Updater API](https://github.com/blackboardsh/electrobun/blob/main/docs/src/content/docs/electrobun/apis/updater.mdx)
- [Code signing](https://framework.blackboard.sh/electrobun/guides/code-signing/)
- [Release workflow](https://raw.githubusercontent.com/blackboardsh/electrobun/main/.github/workflows/release.yml)

The updater is attractive for a desktop coding tool, but it is unrelated to event durability and must not be confused with project/session persistence.

## Fit against Labq requirements

| Requirement | Electrobun fit | Assessment |
|---|---|---|
| Embedded TypeScript Pi SDK | Main process is TypeScript-oriented, but current upstream runtime is Cottontail/JSC/Bun-compatible rather than Node | **Promising but unproven.** Run a real SDK smoke test in the packaged main process. |
| Existing TypeScript engine | Can potentially reuse `src/engine/` without a Rust rewrite | **Strong.** Keep engine independent from Electrobun APIs. |
| Local-folder binding | Native directory picker and main-process path access | **Good.** Route the selected path into `SourceManager`; never let UI mutate source directly. |
| Generic Git URL acquisition | Main process can run Git if the packaged runtime exposes the required process APIs, or use a deliberately bundled helper | **Good in principle; verify packaging and PATH behavior.** |
| Durable sequenced event history | Not supplied by Electrobun | **Application-owned.** Keep SQLite/event-store and replay semantics in the orchestration layer. |
| Streamed assistant/tool activity | Typed RPC can carry updates; event protocol remains application-owned | **Good transport substrate.** Add sequence numbers and recovery above RPC. |
| Approvals and structured input | UI/RPC can display and answer requests | **Good.** Correlation and pre-execution gating remain engine responsibilities. |
| Interrupt/stop and provider failure | Main process can own SDK abort/dispose and process lifecycle | **Good if Pi SDK runtime compatibility passes.** |
| Fresh-client/reconnect convergence | Native webview reloads can lose in-memory view state | **Good only with snapshot bootstrap and replay implemented by the engine.** |
| Web-first v1 | Desktop framework is outside the first delivery scope | **Scope conflict for v1.** |
| Native distribution and updates | Strong built-in story | **Good for a future desktop release.** |

## The critical runtime question: Pi compatibility

Pi's official SDK documentation says it is intended to embed the agent programmatically and demonstrates `createAgentSession`, `ModelRuntime`, `SessionManager`, subscriptions, and `session.prompt()`. The published package currently declares `node >=22.19.0`, exports the SDK from `dist/index.js`, and depends on Node-oriented packages such as `cross-spawn`, `glob`, `proper-lockfile`, `undici`, and Photon Node.

- [Pi SDK documentation](https://pi.dev/docs/latest/sdk)
- [Pi coding-agent package metadata](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/package.json)

Electrobun's source and docs are not perfectly uniform about the runtime naming: the current README describes Cottontail as the JSC-based main runtime, while the public Bun API docs describe a Bun-compatible runtime and the build configuration supports `cottontail`, `zig`, `rust`, and `go` main-process options. That inconsistency increases the need for an executable spike.

The spike must prove all of the following in a real Electrobun main process, not just in a normal Bun shell:

1. Import `@earendil-works/pi-coding-agent` and create a session.
2. Resolve a model through `ModelRuntime`.
3. Bind the session to a selected project workspace.
4. Subscribe to assistant deltas and tool events.
5. Submit a prompt with an image.
6. Abort and dispose the session.
7. Persist/reload session state if the selected Pi path supports it.
8. Use SQLite and Git acquisition from the packaged desktop build.
9. Detect a failed child/provider process and finalize canonical state.

Until this passes, the correct status is **candidate framework**, not **adopted framework**.

## Architectural recommendation if the spike passes

Use Electrobun only as a host adapter around the existing deep orchestration module:

```text
Electrobun Cottontail/Bun main process
  ├── OrchestratorEngine
  ├── SourceManager
  ├── PiAdapter
  ├── SQLite persistence
  ├── provider/session lifecycle
  ├── Electrobun native dialogs
  └── typed RPC boundary
          │
          ▼
      React browser view
```

The engine must not import Electrobun. Define a desktop host boundary for:

- folder selection;
- app lifecycle and shutdown;
- native notifications/dialogs;
- optional process spawning;
- RPC subscription and command dispatch.

The canonical orchestration event model remains the source of truth. Electrobun messages are delivery mechanics only. Every client bootstrap must begin from a snapshot, then apply ordered events after an exclusive sequence cursor.

## Risks

1. **Pi runtime mismatch:** The biggest risk. Pi is published for Node, while Electrobun's packaged main runtime is not simply Node.
2. **Runtime documentation drift:** README and public docs describe Cottontail/Bun terminology differently; pin a tested Electrobun release and document the exact runtime.
3. **Security boundary:** Electrobun's RPC is powerful. Do not expose arbitrary filesystem, shell, or provider operations to browser code. Keep commands narrow, validate project/thread/request identity in the engine, and use sandboxed BrowserViews for untrusted remote content. [BrowserView sandbox documentation](https://github.com/blackboardsh/electrobun/blob/main/docs/src/content/docs/electrobun/apis/browser-view.mdx)
4. **Linux WebKitGTK differences:** The official guide notes distro dependency requirements and recommends bundling CEF for advanced layering. Decide whether Linux ships with WebKitGTK dependencies or pays the size cost of CEF. [Cross-platform guide](https://framework.blackboard.sh/electrobun/guides/cross-platform-development/)
5. **Platform build matrix:** The upstream release workflow builds natively per OS/architecture. Plan CI runners for macOS ARM64, Windows x64, Linux x64, and Linux ARM64 if those targets remain in scope. [Upstream release workflow](https://raw.githubusercontent.com/blackboardsh/electrobun/main/.github/workflows/release.yml)
6. **Updater scope:** Electrobun's updater is a binary distribution mechanism. It does not provide orchestration event replay, session recovery, or durable project state.
7. **Desktop scope creep:** The current product spec explicitly makes native desktop packaging and shell behavior out of scope for the first delivery. A framework switch now would spend effort before proving Pi and transport acceptance.

## Final decision

Electrobun is **better aligned than Tauri for a future native desktop version** because it keeps the main process in the TypeScript ecosystem and offers native dialogs, typed RPC, process lifecycle hooks, packaging, and updates. It is **not enough evidence to change the current v1 direction**.

Proceed with the web-first orchestration implementation. In parallel or immediately after the first vertical slice, run the focused Electrobun/Pi compatibility spike. Adopt Electrobun for desktop only if that spike proves the real Pi SDK and persistence/process requirements in a packaged build.
