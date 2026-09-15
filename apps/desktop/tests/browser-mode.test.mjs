import assert from "node:assert/strict";
import test from "node:test";

import {
  HOME_URL,
  PREVIEW_MAX_WIDTH,
  SCROLL_SYNC_INTERVAL_MS,
  browserSuggestionsUrl,
  clampBrowserBounds,
  initialBrowserState,
  isLikelyUrl,
  isValidHttpUrl,
  normalizeNavigationInput,
  previewCrop,
  restoreUrl,
} from "../src/main/lib/browser-mode.mjs";

// Browser mode's rules, pinned exactly before the Rust port
// (`src-tauri/src/services/browser_mode` carries the same cases).

const search = (encoded) => `https://www.google.com/search?q=${encoded}`;

test("an empty address goes home", () => {
  assert.equal(normalizeNavigationInput(""), HOME_URL);
  assert.equal(normalizeNavigationInput("   "), HOME_URL);
  assert.equal(normalizeNavigationInput("\u00a0\ufeff"), HOME_URL, "trim removes a no-break space and a BOM");
});

test("a web address loads as typed, without being normalised", () => {
  assert.equal(normalizeNavigationInput("https://example.com"), "https://example.com");
  assert.equal(normalizeNavigationInput("HTTPS://EXAMPLE.COM"), "HTTPS://EXAMPLE.COM");
  assert.equal(normalizeNavigationInput("HTTP://Example.com"), "HTTP://Example.com");
  assert.equal(normalizeNavigationInput("https:example.com"), "https:example.com", "a URL parser accepts it");
  assert.equal(normalizeNavigationInput("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeNavigationInput("http://[::1]:8080/"), "http://[::1]:8080/");
});

test("a likely address gets https:// in front", () => {
  assert.equal(normalizeNavigationInput("example.com"), "https://example.com");
  assert.equal(normalizeNavigationInput("  example.com/path?q=1  "), "https://example.com/path?q=1");
  assert.equal(normalizeNavigationInput("localhost:3000"), "https://localhost:3000");
  assert.equal(normalizeNavigationInput("LOCALHOST:3000"), "https://LOCALHOST:3000", "matched lower-cased, kept as typed");
  assert.equal(normalizeNavigationInput("127.0.0.1:8080"), "https://127.0.0.1:8080");
  assert.equal(normalizeNavigationInput("m\u00fcnchen.de"), "https://m\u00fcnchen.de");
  assert.equal(normalizeNavigationInput("x."), "https://x.");
});

test("anything with a dot is a likely address, however odd the result", () => {
  assert.equal(normalizeNavigationInput("ftp://files.example.com"), "https://ftp://files.example.com");
  assert.equal(normalizeNavigationInput("mailto:a@b.co"), "https://mailto:a@b.co");
  assert.equal(normalizeNavigationInput("HTTP://[bad"), "https://HTTP://[bad", "the http:// prefix check is case-sensitive");
  assert.equal(normalizeNavigationInput("a\tb.com"), "https://a\tb.com", "only a space rules an address out");
});

test("everything else is a search, encoded as encodeURIComponent does", () => {
  assert.equal(normalizeNavigationInput("localhost"), search("localhost"));
  assert.equal(normalizeNavigationInput("grace"), search("grace"));
  assert.equal(normalizeNavigationInput("what is grace"), search("what%20is%20grace"));
  assert.equal(normalizeNavigationInput("a b.com"), search("a%20b.com"));
  assert.equal(normalizeNavigationInput("https://exa mple.com"), search("https%3A%2F%2Fexa%20mple.com"));
  assert.equal(normalizeNavigationInput("http://"), search("http%3A%2F%2F"));
  assert.equal(normalizeNavigationInput("file:///etc/passwd"), search("file%3A%2F%2F%2Fetc%2Fpasswd"));
  assert.equal(normalizeNavigationInput("javascript:alert(1)"), search("javascript%3Aalert(1)"));
  assert.equal(normalizeNavigationInput("about:blank"), search("about%3Ablank"));
  assert.equal(normalizeNavigationInput("data:text/html,hi"), search("data%3Atext%2Fhtml%2Chi"));
  assert.equal(normalizeNavigationInput("C#"), search("C%23"));
  assert.equal(normalizeNavigationInput("100% & more/?"), search("100%25%20%26%20more%2F%3F"));
  assert.equal(normalizeNavigationInput("emoji \u{1F64F} worship"), search("emoji%20%F0%9F%99%8F%20worship"));
  assert.equal(normalizeNavigationInput("\u65e5\u672c\u8a9e"), search("%E6%97%A5%E6%9C%AC%E8%AA%9E"));
  assert.equal(normalizeNavigationInput("\u2003John 3:16\u2003"), search("John%203%3A16"), "an em space is trimmed");
  assert.equal(normalizeNavigationInput("\u0085example.com"), search("%C2%85example.com"), "NEL is not trimmed");
});

test("only http and https are web addresses", () => {
  assert.equal(isValidHttpUrl("https://example.com"), true);
  assert.equal(isValidHttpUrl("http://localhost:3000"), true);
  assert.equal(isValidHttpUrl("ftp://example.com"), false);
  assert.equal(isValidHttpUrl("file:///tmp/a.html"), false);
  assert.equal(isValidHttpUrl("about:blank"), false);
  assert.equal(isValidHttpUrl("example.com"), false);
  assert.equal(isValidHttpUrl("http://"), false);
  assert.equal(isLikelyUrl(" 127.0.0.1:5 "), true, "trimmed first");
  assert.equal(isLikelyUrl("localhost"), false);
});

test("a view restores the page it is on, then the last one, then home", () => {
  assert.equal(restoreUrl("https://a.test/", "https://b.test/"), "https://a.test/");
  assert.equal(restoreUrl("about:blank", "https://b.test/"), "https://b.test/");
  assert.equal(restoreUrl("", "https://b.test/"), "https://b.test/");
  assert.equal(restoreUrl(null, "about:blank"), HOME_URL);
  assert.equal(restoreUrl(undefined, ""), HOME_URL);
});

test("the viewport is rounded half up and never negative", () => {
  assert.deepEqual(clampBrowserBounds({ x: -3.5, y: 2.5, width: 100.49, height: -0.5 }), {
    x: 0,
    y: 3,
    width: 100,
    height: 0,
  });
  assert.deepEqual(clampBrowserBounds({ x: -0.4, y: 0.5, width: 1.5, height: 1e9 + 0.5 }), {
    x: 0,
    y: 1,
    width: 2,
    height: 1000000001,
  });
});

test("the preview is the capture's centred crop in the viewport's shape, at most 360 wide", () => {
  assert.equal(PREVIEW_MAX_WIDTH, 360);
  assert.deepEqual(previewCrop({ width: 2400, height: 1600 }, { width: 1200, height: 600 }), {
    crop: { x: 0, y: 200, width: 2400, height: 1200 },
    previewWidth: 360,
  });
  assert.deepEqual(previewCrop({ width: 1000, height: 1000 }, { width: 640, height: 960 }), {
    crop: { x: 167, y: 0, width: 667, height: 1000 },
    previewWidth: 360,
  });
  assert.deepEqual(
    previewCrop({ width: 301, height: 100 }, { width: 300, height: 100 }),
    { crop: { x: 1, y: 0, width: 300, height: 100 }, previewWidth: 300 },
    "an odd margin rounds its half up, to the left edge",
  );
  assert.deepEqual(previewCrop({ width: 1001, height: 333 }, { width: 3, height: 1 }), {
    crop: { x: 1, y: 0, width: 999, height: 333 },
    previewWidth: 360,
  });
  assert.deepEqual(
    previewCrop({ width: 200, height: 150 }, { width: 0, height: 0 }),
    { crop: { x: 0, y: 0, width: 200, height: 150 }, previewWidth: 200 },
    "an empty viewport keeps the capture's own shape",
  );
  assert.deepEqual(
    previewCrop({ width: 200, height: 150 }, { width: 100, height: 0 }),
    { crop: { x: 0, y: 0, width: 200, height: 150 }, previewWidth: 200 },
    "so does one with no height",
  );
  assert.deepEqual(
    previewCrop({ width: 3, height: 1000 }, { width: 1000, height: 1 }),
    { crop: null, previewWidth: 3 },
    "a crop rounding to nothing uses the whole capture",
  );
  assert.deepEqual(previewCrop({ width: 5, height: 2 }, { width: 1, height: 1000 }), {
    crop: null,
    previewWidth: 5,
  });
});

test("suggestions come from the web app, for a query with something in it", () => {
  assert.equal(
    browserSuggestionsUrl("https://present.multivrs.space", "  amazing grace  "),
    "https://present.multivrs.space/api/browser/suggestions?q=amazing%20grace",
  );
  assert.equal(
    browserSuggestionsUrl("http://localhost:3001/app/", "a&b=c/?#\u00e9"),
    "http://localhost:3001/api/browser/suggestions?q=a%26b%3Dc%2F%3F%23%C3%A9",
    "the path replaces the base's",
  );
  assert.equal(browserSuggestionsUrl("https://x.test", "   "), null);
  assert.equal(browserSuggestionsUrl("https://x.test", 42), null);
  assert.throws(() => browserSuggestionsUrl("not a url", "q"), { code: "ERR_INVALID_URL" });
});

test("a new browser starts blank, projecting to the preview, polling every 180 ms", () => {
  assert.equal(SCROLL_SYNC_INTERVAL_MS, 180);
  assert.deepEqual(initialBrowserState(), {
    url: "about:blank",
    title: "",
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    projectionTarget: "preview",
    scrollX: 0,
    scrollY: 0,
    previewDataUrl: null,
  });
  assert.notEqual(initialBrowserState(), initialBrowserState(), "a fresh object each time");
});
