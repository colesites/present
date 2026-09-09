# Stage 1 — Tauri skeleton

**Status:** complete · **Date:** 2026-09-08

Electron is untouched and still builds and runs. The Tauri shell sits beside it,
sharing the same `src/` React tree through a second bundler.

## What exists

```
apps/desktop/
  index.html                     ← Tauri main-window entry (Vite)
  output.html                    ← Tauri output-window entry (Vite)
  vite.config.ts                 ← mirrors webpack.renderer.config.ts
  scripts/check-tauri-version.mjs
  src/renderer/tauri/            ← Tauri-only; Electron never imports it
    runtime.ts                   ← isTauri(), getAppInfo(), AppError type
    boot-probe.ts                ← startup IPC smoke test
  src-tauri/
    Cargo.toml  build.rs  tauri.conf.json
    capabilities/main.json
    icons/
    src/
      main.rs                    ← thin passthrough
      lib.rs                     ← tracing, state, command registration
      errors.rs                  ← AppError → { kind, message }
      state/app_state.rs         ← uptime for the perf baseline
      commands/app.rs            ← get_app_info
.github/workflows/tauri.yml      ← Rust quality + macOS/Windows/Linux bundles
```

## Commands

```bash
bun run desktop:electron                        # Electron, unchanged
bun run desktop:tauri                           # Tauri + Vite
bun run desktop:tauri:build                     # production bundle
bun run --filter @present/desktop tauri:check   # fmt + clippy -D warnings + tests
node apps/desktop/scripts/check-tauri-version.mjs [--fix]
```

## Verified

| Check | Result |
|---|---|
| `cargo build` | clean |
| `cargo fmt --check` | clean |
| `cargo clippy --all-targets -- -D warnings` | clean |
| `cargo test` | 3 passed |
| Vite production build | 2 112 modules, ~7 s, both entries |
| React app renders under Vite | full operator UI mounts |
| React → `invoke` → Rust → serde round trip | `get_app_info uptime_ms=1029` in the Rust log |
| Rust hot rebuild in `tauri dev` | ~6 s |
| `tauri build` (macOS x64) | `Present.app` + `Present_0.3.8_x64.dmg` |
| Packaged release `.app` launches and completes the IPC round trip from `dist-tauri` | `get_app_info uptime_ms=1186` |
| Electron `typecheck` | clean |
| Electron `test` | 36 passed |

### First performance data point

| | Electron | Tauri | |
|---|---:|---:|---|
| `Present.app` (macOS x64) | 389 MB | **5.0 MB** | 78× smaller |
| Installer | — | 3.1 MB (dmg) | |

Not comparable on features yet — the Tauri bundle carries no Bible XML, no NDI
modules and no `parse_pptx.py`, and Electron's 389 MB includes Chromium, which
Tauri gets from the OS webview. Recorded as the starting point for the
Electron-vs-Tauri comparison the migration plan requires, not as a claim.

`bun run --filter @present/desktop lint` reports 56 problems (11 errors). That
is pre-existing — the identical count appears with all Stage 1 changes stashed.
None of the new files contribute a warning.

## Decisions taken here

**Vite for Tauri, Webpack stays for Electron.** Forge's Webpack plugin is bound
to Forge and cannot serve Tauri. Rather than fight it, the Tauri shell gets its
own bundler. `vite.config.ts` mirrors the three things `webpack.renderer.config.ts`
does that the app actually depends on: the `@` and `@present/backend` aliases,
the single-React-instance guard, and the `CONVEX_URL` / `WEB_APP_URL` /
`NODE_ENV` defines. Output goes to `dist-tauri/` so the two builds never collide.

**Two HTML entries at the package root**, not seven. The Electron app serves six
of its eight windows from one bundle with a `?window=` query parameter
(audit §3). The same trick works under Tauri, so only `index.html` and
`output.html` exist; the rest is Stage 2 window-creation work.

**Tauri-only frontend code lives in `src/renderer/tauri/`.** Nothing in
`src/renderer/main/` or `src/renderer/output/` was modified, so there is no way
for this stage to affect the Electron build.

**Bundle identifier is `space.multivrs.present`**, distinct from Electron's
default. Both apps can be installed side by side during the migration. Whichever
registered `present://` most recently wins the deep link — expected, and
resolved when Electron is removed.

**CSP moved into `tauri.conf.json`.** The Tauri HTML entries carry no `<meta>`
CSP so Tauri can inject its own nonces. The policy mirrors `csp.ts` with the
Electron-only schemes (`local-media:`, `app:`, `ndi-frame:`) swapped for Tauri's
(`asset:`, `ipc:`) and the corresponding `http://*.localhost` forms Windows needs.

## Deliberately absent

No stubs were created for subsystems that have not been migrated. `state/`
contains only `AppState`; there is no empty `presentation.rs`, `media.rs` or
`output.rs` waiting to rot. Bible XML, `parse_pptx.py` and the NDI modules are
not yet in `bundle.resources` because nothing in Rust reads them yet — they
arrive with the stages that need them.

## Next — Stage 2, windows and display

1. Enumerate monitors in Rust; persist the role→display map (`audience`,
   `media`, `worship`) that `display.service.ts` currently keeps in memory and
   loses on restart (audit §6).
2. Recreate all eight windows, preserving the output window's hardening:
   `#000000` background, no background throttling, show only after first paint,
   reload once on renderer crash (audit §3).
3. Wire monitor hot-plug to a reconcile pass, matching the three `screen` events
   in `src/main/index.ts:69-79`.
4. Characterisation tests for display selection before any behaviour moves, per
   audit §10.8.

Per [ADR-001](adr-001-output-compositor.md), output state must be fully
describable as serialisable Rust structs from Stage 2 onward — the compositor in
Stage 5 consumes that scene description.
