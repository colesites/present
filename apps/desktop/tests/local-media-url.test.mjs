import assert from "node:assert/strict";
import test from "node:test";

import { createLocalMediaUrl } from "../src/shared/lib/local-media-url.mjs";

/**
 * Two shells build these URLs and one Rust handler serves them, so the rule has
 * to be pinned on both sides. The Rust twin is `url_for` in
 * `src-tauri/src/services/media_protocol.rs`, tested there.
 *
 * The Electron cases are characterisation: they pin what ships today, including
 * the `#` bug, which migration rule 4 keeps out of the Electron build.
 */

const withShell = (globals, run) => {
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;

  globalThis.window = globals.window;
  if (globals.navigator !== undefined) {
    Object.defineProperty(globalThis, "navigator", {
      value: globals.navigator,
      configurable: true,
      writable: true,
    });
  }

  try {
    run();
  } finally {
    globalThis.window = previousWindow;
    Object.defineProperty(globalThis, "navigator", {
      value: previousNavigator,
      configurable: true,
      writable: true,
    });
  }
};

const electron = (run) => withShell({ window: {} }, run);

const tauri = (userAgent, run) =>
  withShell({ window: { __TAURI_INTERNALS__: {} }, navigator: { userAgent } }, run);

const MAC_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const WINDOWS_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

test("under Electron the URL is unchanged from what ships today", () => {
  electron(() => {
    assert.equal(
      createLocalMediaUrl("/Users/cole/Media/clip.mp4"),
      "local-media://media/Users/cole/Media/clip.mp4",
    );
    assert.equal(
      createLocalMediaUrl("/Users/cole/My Media/opening clip.mp4"),
      "local-media://media/Users/cole/My%20Media/opening%20clip.mp4",
    );
  });
});

test("under Electron a hash in the name is still left raw", () => {
  // Characterisation, not approval: `encodeURI` does not escape `#`, so this
  // URL truncates and the file will not play. Fixed on the Tauri path only.
  electron(() => {
    assert.equal(
      createLocalMediaUrl("/Media/Set #2.mp4"),
      "local-media://media/Media/Set%20#2.mp4",
    );
  });
});

test("under Tauri on macOS the URL matches the Electron spelling", () => {
  tauri(MAC_AGENT, () => {
    assert.equal(
      createLocalMediaUrl("/Users/cole/Media/clip.mp4"),
      "local-media://media/Users/cole/Media/clip.mp4",
    );
  });
});

test("under Tauri a hash or question mark is escaped", () => {
  tauri(MAC_AGENT, () => {
    assert.equal(
      createLocalMediaUrl("/Media/Set #2?.mp4"),
      "local-media://media/Media/Set%20%232%3F.mp4",
    );
  });
});

test("under Tauri on Windows the scheme is rewritten to the localhost host", () => {
  tauri(WINDOWS_AGENT, () => {
    assert.equal(
      createLocalMediaUrl("C:/Media/clip.mp4"),
      "http://local-media.localhost/media/C:/Media/clip.mp4",
    );
  });
});

test("a path that is already a URL is passed through", () => {
  tauri(MAC_AGENT, () => {
    assert.equal(
      createLocalMediaUrl("local-media://media/Media/clip.mp4"),
      "local-media://media/Media/clip.mp4",
    );
    assert.equal(
      createLocalMediaUrl("http://local-media.localhost/media/C:/clip.mp4"),
      "http://local-media.localhost/media/C:/clip.mp4",
    );
  });
});

test("non-ASCII names are percent-encoded as UTF-8", () => {
  tauri(MAC_AGENT, () => {
    assert.equal(
      createLocalMediaUrl("/Media/Lobgesänge.mp4"),
      "local-media://media/Media/Lobges%C3%A4nge.mp4",
    );
  });
});
