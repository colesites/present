import assert from "node:assert/strict";
import test from "node:test";

import { redactDiagnosticText as redact } from "../src/main/lib/diagnostic-redaction.mjs";
import {
  ERROR_LOG_DIRECTORY,
  ERROR_LOG_FILE_NAME,
  ERROR_LOG_MAX_BYTES,
  errorLogLine,
  rendererErrorEvent,
  shouldRotateErrorLog,
} from "../src/main/lib/error-log.mjs";

// The local error log, pinned exactly before the Rust port
// (`src-tauri/src/services/error_log.rs` carries the same cases).
// tests/diagnostic-redaction.test.mjs checks that secrets go; this checks what
// is left in their place.

test("a bearer token goes, whatever case 'bearer' was in and whatever precedes it", () => {
  assert.equal(redact("Authorization: bearer abc.DEF_~-123 rest"), "Authorization: Bearer [REDACTED] rest");
  assert.equal(redact("xBearer\u00a0tok more"), "xBearer [REDACTED] more", "a no-break space counts as a space");
  assert.equal(redact(`Bearer ${"x".repeat(90)}`), "Bearer [REDACTED]", "the bearer rule runs before the long-credential one");
});

test("an email address goes; one without a two-letter top-level domain stays", () => {
  assert.equal(redact("mail Jane.Doe+tag@Sub.Example.co.uk, next"), "mail [REDACTED_EMAIL], next");
  assert.equal(redact("a@b.c short tld"), "a@b.c short tld");
});

test("a token parameter's value goes up to whitespace or an ampersand, and its name keeps its case", () => {
  assert.equal(
    redact("url?sessionToken=abc&accessToken=def;x TOKEN=zz refreshToken=q\u00a0tail mytoken=keep"),
    "url?sessionToken=[REDACTED]&accessToken=[REDACTED] TOKEN=[REDACTED] refreshToken=[REDACTED]\u00a0tail mytoken=keep",
  );
});

test("a run of 80 or more credential characters goes, between ASCII word boundaries", () => {
  assert.equal(redact(`id ${"a".repeat(79)} end`), `id ${"a".repeat(79)} end`);
  assert.equal(redact(`id ${"a".repeat(80)} end`), "id [REDACTED_CREDENTIAL] end");
  assert.equal(redact(`id ${"a".repeat(100)}- end`), "id [REDACTED_CREDENTIAL]- end", "the trailing hyphen is not inside a boundary");
  assert.equal(redact(`id -${"b".repeat(90)} end`), "id -[REDACTED_CREDENTIAL] end");
  assert.equal(redact(`é${"c".repeat(85)}`), "é[REDACTED_CREDENTIAL]", "é is not a word character, so a boundary follows it");
});

test("the result is cut to 20 000 UTF-16 code units, and anything is turned into text first", () => {
  assert.equal(redact("😀".repeat(10_001)).length, 20_000);
  assert.equal(redact(null), "null");
  assert.equal(redact(42), "42");
});

test("an entry is one JSON line, in this field order, with name and stack left out when absent", () => {
  const at = { appVersion: "0.3.8", platform: "darwin", occurredAt: new Date(Date.UTC(2026, 8, 14, 9, 5, 3, 7)) };
  assert.equal(
    errorLogLine({ category: "renderer", message: "Failed for me@example.com" }, at),
    '{"appVersion":"0.3.8","category":"renderer","context":{},"message":"Failed for [REDACTED_EMAIL]","occurredAt":"2026-09-14T09:05:03.007Z","platform":"darwin"}',
  );
  assert.equal(
    errorLogLine(
      { category: "main", message: "m", name: "TypeError", stack: "at x token=abc", context: { source: "window.error" } },
      at,
    ),
    '{"appVersion":"0.3.8","category":"main","context":{"source":"window.error"},"message":"m","name":"TypeError","occurredAt":"2026-09-14T09:05:03.007Z","platform":"darwin","stack":"at x token=[REDACTED]"}',
  );
  assert.equal(
    errorLogLine({ category: "renderer", message: "m", name: "", stack: "" }, at),
    '{"appVersion":"0.3.8","category":"renderer","context":{},"message":"m","occurredAt":"2026-09-14T09:05:03.007Z","platform":"darwin"}',
    "an empty name or stack is left out too",
  );
});

test("the log lives in logs/present-errors.ndjson and rotates once it reaches 2 MiB", () => {
  assert.equal(`${ERROR_LOG_DIRECTORY}/${ERROR_LOG_FILE_NAME}`, "logs/present-errors.ndjson");
  assert.equal(ERROR_LOG_MAX_BYTES, 2_097_152);
  assert.equal(shouldRotateErrorLog(2_097_151), false);
  assert.equal(shouldRotateErrorLog(2_097_152), true);
});

test("a renderer's report becomes a renderer event, filling in what it left out", () => {
  assert.equal(rendererErrorEvent(null), null);
  assert.equal(rendererErrorEvent("boom"), null);
  assert.deepEqual(rendererErrorEvent({ message: "x", name: "E", stack: "s", source: "unhandledrejection" }), {
    category: "renderer",
    message: "x",
    name: "E",
    stack: "s",
    context: { source: "unhandledrejection" },
  });
  assert.deepEqual(rendererErrorEvent({ message: 3, name: 4 }), {
    category: "renderer",
    message: "Renderer error",
    name: undefined,
    stack: undefined,
    context: { source: "renderer" },
  });
});
