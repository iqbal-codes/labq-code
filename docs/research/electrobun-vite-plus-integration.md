# Electrobun v1.18.1 and Vite Plus Integration Research

**Date:** 2026-07-29  
**Repository:** `labq-code` / `web-client`  
**Question:** How should the Vite Plus frontend and Electrobun desktop shell be integrated rather than treated as separate applications?

## Conclusion

The separation is intentional and should remain at the build boundary:

```text
vp dev / vp build                 Electrobun v1.18.1
------------------                -------------------
React + Vite frontend  --->       BrowserWindow shell
web-client/dist/       --->       Resources/app/views/mainview/
                                 Bun backend: src/bun/index.ts
                                 RPC: BrowserView <-> Electroview
```

Use Vite Plus as the **only frontend bundler**. Use Electrobun as the **native shell, Bun process host, static asset packager, and RPC transport**:

- Development: run `vp dev` in `web-client/`; have the Bun process load `http://localhost:5173` when it is reachable.
- Packaged/dev fallback: run `vp build`; configure Electrobun `build.copy` to copy `web-client/dist/index.html` and `web-client/dist/assets` to `views/mainview/`; load `views://mainview/index.html`.
- IPC: use Electrobun's public `BrowserView.defineRPC` in Bun and `Electroview` in the webview. Do not hand-roll the socket protocol.

The current repository has all three integration gaps: no root `electrobun.config.ts`, no `BrowserWindow` creation in `src/bun/index.ts`, and a raw WebSocket adapter that does not implement Electrobun's encrypted `/socket?webviewId=...` handshake.

## Sources

### Primary Electrobun sources

- [Electrobun v1.18.1 package metadata](https://github.com/blackboardsh/electrobun/blob/v1.18.1/package.json) — package exports include `electrobun/bun` and `electrobun/view`.
- [v1.18.1 React/Tailwind/Vite template config](https://github.com/blackboardsh/electrobun/blob/v1.18.1/templates/react-tailwind-vite/electrobun.config.ts) — authoritative version-matched Vite output copy pattern.
- [v1.18.1 React/Tailwind/Vite template Bun entrypoint](https://github.com/blackboardsh/electrobun/blob/v1.18.1/templates/react-tailwind-vite/src/bun/index.ts) — authoritative dev-server URL/fallback pattern.
- [v1.18.1 Vite config template](https://github.com/blackboardsh/electrobun/blob/v1.18.1/templates/react-tailwind-vite/vite.config.ts) — Vite root, output, and port setup.
- [v1.18.1 build configuration docs](https://github.com/blackboardsh/electrobun/blob/v1.18.1/docs/src/content/docs/electrobun/apis/cli/build-configuration.mdx) — `electrobun.config.ts`, `build.bun`, and Bun build options.
- [v1.18.1 BrowserView docs](https://github.com/blackboardsh/electrobun/blob/v1.18.1/docs/src/content/docs/electrobun/apis/browser-view.mdx) — `BrowserView.defineRPC`, window/view RPC, and `views://` URLs.
- [v1.18.1 Electroview docs](https://github.com/blackboardsh/electrobun/blob/v1.18.1/docs/src/content/docs/electrobun/apis/browser/electroview-class.mdx) — browser-side RPC setup.
- [Bundled assets / `views://` docs](https://github.com/blackboardsh/electrobun/blob/v1.18.1/docs/src/content/docs/electrobun/apis/bundled-assets.mdx) — copy destinations and local asset URLs.

### Primary Vite Plus/Vite sources

- [Vite Plus getting started](https://viteplus.dev/guide/) — `vp dev`, `vp build`, `vp test`, and standard Vite configuration.
- [Vite Plus build guide](https://viteplus.dev/guide/build.md) — `vp build` uses the Vite production build/configuration model.
- [Vite `base` option](https://vite.dev/config/shared-options.html#base) — `base: "./"` is supported for embedded deployments.

### Local sources inspected

- `node_modules/electrobun/package.json` — installed version is `1.18.1`; export map exposes `./bun` and `./view`.
- `node_modules/electrobun/dist/api/bun/ElectrobunConfig.ts:114-148` — v1.18.1 config exposes `build.bun`, `build.views`, `build.copy`; it does not expose `build.mainProcess` or `build.cottontail`.
- `node_modules/electrobun/src/cli/index.ts:66-69,1472-1552,2390-2405,3225-3308,4439-4699` — config discovery, defaults, Bun build, view build, copy behavior, and dev watch behavior.
- `node_modules/electrobun/dist/api/bun/core/Socket.ts:58-169` — RPC server URL, webview ID routing, and encrypted packet handling.
- `node_modules/electrobun/dist/api/browser/index.ts:17-131` — official browser transport uses `/socket?webviewId=...` and AES-GCM helpers.
- `node_modules/electrobun/dist/api/shared/rpc.ts:453-541` — schema, request/message packets, and `defineElectrobunRPC` implementation.
- `web-client/package.json:6-10` — frontend scripts are `vp dev`, `vp build`, and `vp test`.
- `web-client/vite.config.ts:21-43` — current React/Tailwind/Vite configuration.
- `web-client/dist/index.html:7-8` — current build emits root-relative `/assets/...` URLs.
- `src/bun/index.ts:1-78` — current Bun backend defines RPC handlers but does not create a `BrowserWindow`.
- `web-client/src/orchestrator/electrobun-transport-adapter.ts:13-90` — current raw WebSocket adapter.
- `build/dev-macos-arm64/MyApp-dev.app/Contents/Resources/` — current generated app contains `app/bun/index.js` but no `app/views/` directory.

## Correct architecture

### 1. Vite Plus owns frontend compilation

`vp` is Vite Plus's command-line entrypoint. Its `vp dev` and `vp build` commands use the standard Vite configuration and build model. The existing `web-client/vite.config.ts` already owns React, Tailwind, aliases, tests, and frontend checks; Electrobun should not duplicate those concerns with a second `build.views` JavaScript bundle.

The v1.18.1 Electrobun React/Vite template confirms this division: Vite is configured separately, while Electrobun's config copies the Vite output. Electrobun's CLI implementation independently invokes `Bun.build()` for any configured `build.views` entries, so registering `web-client/src/main.tsx` there would create a second frontend bundling pipeline.

### 2. Electrobun owns the shell and packaged asset boundary

The v1.18.1 template uses:

```typescript
build: {
  copy: {
    "dist/index.html": "views/mainview/index.html",
    "dist/assets": "views/mainview/assets",
  },
  watchIgnore: ["dist/**"],
}
```

For this repository, use:

```typescript
build: {
  bun: {
    entrypoint: "src/bun/index.ts",
  },
  copy: {
    "web-client/dist/index.html": "views/mainview/index.html",
    "web-client/dist/assets": "views/mainview/assets",
  },
  watchIgnore: ["web-client/dist/**"],
}
```

`build.copy` is a source-to-destination mapping. The destination is relative to the app's `Resources/app` directory, so the packaged file is `Resources/app/views/mainview/index.html`. The corresponding `BrowserWindow` URL is `views://mainview/index.html`.

`electrobun build` does not invoke `vp build`. The production workflow must therefore be ordered:

```text
cd web-client && vp build
cd .. && electrobun build
```

### 3. Configure embedded asset URLs

The checked-in Vite output currently contains:

```html
<script type="module" crossorigin src="/assets/index-BCFvD870.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-Dh7V0l7A.css">
```

Those root-relative URLs are suitable for a server root, but the files will be served from `views://mainview/`. Set Vite's `base` to `"./"` for the packaged build, or establish and verify another mapping that makes the generated URLs resolve to `views://mainview/assets/*`. This is a required packaging check, not an Electrobun RPC issue. The Vite documentation explicitly supports `"./"` for embedded deployments.

### 4. Development uses a reachable Vite URL

The v1.18.1 template checks the dev channel, probes `http://localhost:5173`, and returns that URL when the server is available; otherwise it falls back to `views://mainview/index.html`. Apply the same logic to LabQ:

```typescript
const DEV_SERVER_URL = "http://localhost:5173";

async function getMainViewUrl(): Promise<string> {
  if ((await Updater.localInfo.channel()) === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      return DEV_SERVER_URL;
    } catch {
      // Use the packaged Vite build.
    }
  }
  return "views://mainview/index.html";
}
```

This makes the two tools cooperate without merging them: `vp dev` provides HMR, and Electrobun provides the native window and Bun backend. `electrobun dev --watch` is a separate full app rebuild/relaunch watcher; it is not Vite HMR and should ignore `web-client/dist/**`.

### 5. Bun entrypoint must create and own the window

In v1.18.1 the main-process default is `build.bun.entrypoint: "src/bun/index.ts"`. The installed config type does not contain the `build.mainProcess` / `build.cottontail` fields used by some newer or drifted examples. Use `build.bun` only for this installed version.

`src/bun/index.ts` currently instantiates the engine and defines RPC, but it never constructs a `BrowserWindow`. Therefore successful `bun build` only proves that the backend bundle compiles; it does not prove a desktop window can load the frontend.

The main process needs the equivalent of:

```typescript
import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";

const rpc = BrowserView.defineRPC<OrchestratorRPCSchema>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      // getScopedSnapshot, sync, dispatchCommand
    },
    messages: {
      // subscribe / scope handling
    },
  },
});

const mainWindow = new BrowserWindow({
  title: "LabQ Code",
  url: await getMainViewUrl(),
  frame: { width: 1280, height: 800, x: 100, y: 100 },
  rpc,
});
```

### 6. Use official RPC, not the current raw WebSocket

The current adapter connects to `ws://127.0.0.1:<port>` and sends plaintext JSON. That is not the Electrobun v1.18.1 transport:

- The Bun socket server upgrades only `/socket?webviewId=<id>`.
- The webview ID routes the socket to the correct `BrowserView`.
- The browser SDK encrypts packets with the per-webview AES-GCM key before sending them.
- The browser SDK registers the RPC handler with `Electroview` and the Bun SDK registers it with `BrowserView`.

These details are implemented in the installed `Socket.ts` and browser `Electroview` source. The current adapter omits the URL path, webview ID, encryption, and SDK transport registration; it cannot complete the native handshake as written.

The supported shape is:

```typescript
// Bun
const rpc = BrowserView.defineRPC<OrchestratorRPCSchema>({
  handlers: {
    requests: { /* Bun request handlers */ },
    messages: { /* webview message handlers */ },
  },
});
new BrowserWindow({ url, rpc });
```

```typescript
// Webview
import { Electroview } from "electrobun/view";

const rpc = Electroview.defineRPC<OrchestratorRPCSchema>({
  handlers: {
    requests: {},
    messages: {
      event: (event) => { /* forward to the client store */ },
    },
  },
});
const electroview = new Electroview({ rpc });

electroview.rpc.request.getScopedSnapshot({ scope });
electroview.rpc.request.sync({ cursor, scope });
electroview.rpc.request.dispatchCommand({ command });
electroview.rpc.send.subscribe({ scope });
```

The shared schema must use Electrobun's request/message shape (`params` and `response` objects), not the current function-valued request declarations. Keep `subscribe` as a message in both directions; it is not an `extraRequestHandler` request. The Bun handler can retain the active window/webview subscriber and send `event` messages through that attached RPC instance.

The web client must instantiate `Electroview` only in the Electrobun environment. In an ordinary browser launched by `vp dev`, return `undefined` from the factory and preserve the existing `FakeTransport` fallback.

## Repository audit

| Area | Observed state | Required state |
| --- | --- | --- |
| Electrobun package | `node_modules/electrobun` is present at `1.18.1`; root `package.json` does not declare it | Declare the dependency in the root manifest and lockfile for reproducible installs |
| Electrobun config | No `electrobun.config.ts` found | Add root config using `build.bun`, `build.copy`, `watchIgnore`, app metadata, and platform renderer options |
| Bun process | `src/bun/index.ts` defines handlers only | Create `BrowserWindow`, choose dev/static URL, attach `BrowserView.defineRPC` |
| Frontend build | `web-client` exposes `vp dev` / `vp build`; current output is `dist/` | Keep Vite Plus as the only frontend build; set `base: "./"` for packaged output |
| Frontend IPC | Raw WebSocket adapter uses port-only plaintext socket | Replace with `Electroview` public SDK |
| Current app bundle | `Resources/app/bun/index.js` exists; `Resources/app/views/` is absent | Build and copy Vite output before Electrobun packaging |
| App identity | Current observed bundle is `MyApp-dev.app` with `com.example.myapp` | Set LabQ app name, identifier, and version in the new config |

## Recommended implementation sequence

1. Add/declare Electrobun `1.18.1` in the root package manifest; do not add a second frontend package dependency.
2. Create `electrobun.config.ts` with `build.bun.entrypoint`, Vite output `build.copy`, `watchIgnore`, and app metadata. Do not use `build.mainProcess` or `build.cottontail` with the installed v1.18.1 CLI.
3. Set the Vite production `base` to `"./"` and rebuild `web-client/dist`.
4. Refactor the Bun schema and handlers to `BrowserView.defineRPC`; create the `BrowserWindow` and pass `rpc` to it.
5. Refactor the frontend adapter to `Electroview.defineRPC` / `new Electroview`; retain browser fallback detection.
6. Add an explicit ordered desktop build command: `cd web-client && vp build && cd .. && electrobun build`.
7. Add a desktop development command that starts `vp dev` on port 5173 before launching Electrobun, or document the two-process workflow. Do not make Electrobun silently depend on a server that is not running.

## Verification plan

### Static packaging

```bash
cd web-client
vp build
cd ..
electrobun build
```

Then verify all of the following in the generated app:

- `Contents/Resources/app/views/mainview/index.html` exists.
- `Contents/Resources/app/views/mainview/assets/` contains the emitted JS/CSS.
- `Contents/Resources/app/bun/index.js` exists.
- The HTML's script and stylesheet URLs resolve under `views://mainview/`.
- Launching the app shows the Vite frontend rather than the old acceptance report.

### Development/HMR

1. Start `vp dev` in `web-client/` and confirm it is listening on port 5173.
2. Start the Electrobun dev app.
3. Confirm the Bun process logs the dev URL selection and the window renders the frontend.
4. Change a React source file and confirm Vite HMR updates the native window without an Electrobun rebuild.
5. Stop the Vite server and confirm a standalone Electrobun build can fall back to `views://mainview/index.html`.

### RPC

- In the desktop window, bootstrap a snapshot through `getScopedSnapshot`.
- Dispatch one typed command and observe its result.
- Subscribe to events and confirm an engine event reaches the store.
- Run the same frontend in an ordinary browser and confirm it uses `FakeTransport` without importing/constructing an unbound native RPC client.

## Known blockers and risks

- **No config/window wiring yet:** Until both exist, Electrobun can build a Bun bundle but has no configured view to package or window to display.
- **Asset base path:** `base: "./"` is the leading candidate because the current Vite output is root-relative; this must be confirmed by launching the packaged app.
- **RPC schema migration:** The current schema uses function-valued declarations and an extra request handler, while the installed RPC type expects structured request/message schemas. This is a source-level migration, not just an import rename.
- **Two-process development startup:** `vp dev` is not started by Electrobun's CLI. A wrapper script or documented parallel startup is required for HMR.
- **Dependency reproducibility:** The installed package is present locally but absent from the root manifest observed in this checkout. A clean install will not reliably reproduce the current environment until the manifest/lockfile are updated.

## Bottom line

Electrobun and Vite Plus should not be merged into one bundler. Integrate them through two explicit seams: **Vite output copied into Electrobun's `views://` asset namespace**, and **Electrobun's official typed RPC SDK connecting the webview to `src/bun/index.ts`**. The current raw socket adapter is not a viable shortcut because it omits Electrobun's encrypted, webview-scoped transport protocol.
