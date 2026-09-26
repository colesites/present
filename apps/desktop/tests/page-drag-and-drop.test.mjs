import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The page's own drag and drop has to reach the page.
 *
 * Services, templates, the slide grid and the editor's slides are reordered
 * by dragging, with the browser's drag events. Tauri puts a file-drop handler
 * on every webview unless it is told not to, and on macOS that handler answers
 * "handled" to every drag over the window, so WebKit never sends the page
 * `dragover` or `drop`. A drag starts, and lands nowhere. It looks like the
 * reordering code is broken, and nothing in that code is.
 */

const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(DESKTOP_DIR, relative), "utf8");

const sourceFiles = (directory) =>
  fs.readdirSync(path.join(DESKTOP_DIR, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(tsx?|mjs)$/.test(entry.name) ? [relative] : [];
  });

test("every app window is built without Tauri's file-drop handler", () => {
  const source = read("src-tauri/src/services/window.rs");
  const builders = source.match(/WebviewWindowBuilder::new\(/g) ?? [];
  const disabled = source.match(/\.disable_drag_drop_handler\(\)/g) ?? [];
  assert.ok(builders.length > 0, "no window builder found; the scan is broken");
  assert.equal(
    disabled.length,
    builders.length,
    "a window built with Tauri's drag-drop handler on cannot be reordered by dragging",
  );
});

test("the app drags with the page's own events, and listens for no native file drops", () => {
  const files = sourceFiles("src");
  const pageDrops = files.filter((file) => /onDrop=|addEventListener\("drop"/.test(read(file)));
  assert.ok(pageDrops.length > 0, "no page drop handlers found; the scan is broken");

  // With the handler off these never fire. Something that needs files
  // dropped from Finder has to be built another way, or this decision revisited.
  const nativeDrops = files.filter((file) =>
    /onDragDropEvent|tauri:\/\/drag-drop|tauri:\/\/drag-enter/.test(read(file)),
  );
  assert.deepEqual(nativeDrops, []);
});
