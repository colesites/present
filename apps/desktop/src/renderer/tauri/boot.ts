/**
 * The first thing a Tauri window runs.
 *
 * Loaded by `index.html` and `output.html` ahead of the React entry, so the
 * bridge exists before any component mounts and asks for `window.electronAPI`.
 * Module scripts execute in document order, and this one installs
 * synchronously, so ordering in the HTML is the whole mechanism.
 *
 * Keep it to installation. Diagnostics live in `boot-probe.ts`, which runs in
 * the operator window only.
 */

import { installElectronBridge } from "./electron-bridge";

installElectronBridge();
