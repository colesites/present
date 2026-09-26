import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Every custom scheme the app registers must be allowed by the CSP.
 *
 * This is a regression that only ever appears in a packaged build, which is
 * why it needs a test rather than an eye. In development the window is served
 * by the Vite dev server over http, so Tauri never gets to inject the policy
 * and every scheme resolves; in a bundle the HTML comes from Tauri, the policy
 * is injected, and anything the policy does not name is silently refused. The
 * app looks correct for the whole of development and arrives at the church
 * with holes in it.
 *
 * It shipped exactly once: `output-frame:` and `transition-sample:` were
 * registered and used but never added to the policy, so in production the
 * audience preview showed nothing and every transition tile was blank — the
 * transitions looked absent from the build rather than blocked.
 *
 * Both spellings are required. WebView2 does not resolve custom schemes, so
 * Windows asks for `http://<scheme>.localhost` instead and the renderer picks
 * the form per platform (`renderer/tauri/preview-frames.ts`). A policy that
 * names only one of the two is broken on one operating system.
 */

const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (relative) =>
  fs.readFileSync(path.join(DESKTOP_DIR, relative), "utf8");

/** The schemes Rust actually hands the webview, read from the registrations. */
const registeredSchemes = () => {
  const source = read("src-tauri/src/lib.rs");
  const calls = source.matchAll(
    /register_(?:asynchronous_)?uri_scheme_protocol\(\s*"([a-z0-9-]+)"/g,
  );
  return [...calls].map((match) => match[1]);
};

const policy = () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  const csp = config.app?.security?.csp;
  assert.equal(typeof csp, "string", "the bundle is served with a CSP");
  return csp;
};

test("the CSP names every scheme the app registers", () => {
  const schemes = registeredSchemes();
  assert.ok(
    schemes.length >= 4,
    `expected the four frame and media schemes, found ${schemes.join(", ") || "none"}`,
  );

  const csp = policy();
  for (const scheme of schemes) {
    assert.ok(
      csp.includes(`${scheme}:`),
      `\`${scheme}://\` is registered but the CSP refuses it — it will work in development and be blank in the bundle`,
    );
    assert.ok(
      csp.includes(`http://${scheme}.localhost`),
      `\`${scheme}\` has no \`http://${scheme}.localhost\` form in the CSP, so it is refused on Windows`,
    );
  }
});

test("the two preview schemes may be drawn as images", () => {
  // They exist to feed `<img>`: the audience preview and the transition
  // picker's tiles. `img-src` is the directive that decides whether the
  // operator sees a picture or an empty rectangle.
  const images = policy()
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("img-src"));
  assert.ok(images, "the CSP says where images may come from");

  for (const scheme of ["output-frame", "transition-sample", "ndi-frame", "local-media"]) {
    assert.ok(
      images.includes(`${scheme}:`) && images.includes(`http://${scheme}.localhost`),
      `img-src must allow \`${scheme}\`, in both spellings`,
    );
  }
});

test("the website's YouTube page may be framed", () => {
  // A packaged build embeds YouTube props through it, because YouTube refuses
  // an embed from `tauri://localhost`, which sends no referrer
  // (`shared/lib/youtube-embed.mjs`). Refused here, a YouTube prop is as
  // blank as it was before the wrapper existed — and, again, only once
  // installed.
  const frames = policy()
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("frame-src"));
  assert.ok(frames, "the CSP says what may be framed");
  assert.ok(
    frames.split(/\s+/).includes("https://present.multivrs.space"),
    "frame-src must allow the website the YouTube wrapper is served from",
  );
});
