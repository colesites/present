import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * On a Mac the preview and a video in the show grid are drawn by the app
 * *under* the operator window's page (`services/surface/panel.rs`), and seen
 * through boxes the page leaves clear. That only works when the webview does
 * not paint its own solid background — and for a packaged page that has to be
 * switched off on the webview's configuration, before the page exists. wry
 * only does that with its `transparent` feature, which Tauri turns on with
 * `macos-private-api`.
 *
 * Like the CSP, this regression appears only in a packaged build: the
 * development page loads late enough that switching the background off
 * afterwards still works. In a bundle the preview and grid videos play,
 * blank, while the audience screens show them.
 *
 * It shipped once: the feature was added to Cargo.toml but not to
 * `tauri.conf.json`, and the Tauri CLI rewrites the `tauri` dependency's
 * features from the config on every `tauri dev` and `tauri build` — so it
 * deleted the feature before compiling, and the build was blank again.
 * Both halves must be present.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const tauriDir = path.resolve(here, "../src-tauri");

test("tauri.conf.json turns the macOS private API on", () => {
  const config = JSON.parse(fs.readFileSync(path.join(tauriDir, "tauri.conf.json"), "utf8"));
  assert.equal(
    config.app?.macOSPrivateApi,
    true,
    'tauri.conf.json must set "app.macOSPrivateApi": true, or the Tauri CLI strips the feature from Cargo.toml',
  );
});

test("Cargo.toml builds tauri with macos-private-api", () => {
  const manifest = fs.readFileSync(path.join(tauriDir, "Cargo.toml"), "utf8");
  const line = manifest.split(/\r?\n/).find((entry) => /^tauri\s*=/.test(entry));
  assert.ok(line, "Cargo.toml has a tauri dependency");
  assert.match(line, /"macos-private-api"/, "the tauri dependency must enable macos-private-api");
});
