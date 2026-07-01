import assert from "node:assert/strict";
import test from "node:test";
import { redactDiagnosticText } from "../src/main/lib/diagnostic-redaction.mjs";

test("redacts credentials and email addresses from diagnostics", () => {
  const longCredential = "a".repeat(100);
  const result = redactDiagnosticText(
    `user@example.com Bearer abc.def token=secret sessionToken=other ${longCredential}`,
  );

  assert.equal(result.includes("user@example.com"), false);
  assert.equal(result.includes("abc.def"), false);
  assert.equal(result.includes("token=secret"), false);
  assert.equal(result.includes("sessionToken=other"), false);
  assert.equal(result.includes(longCredential), false);
  assert.match(result, /\[REDACTED/);
});

test("bounds diagnostic size", () => {
  assert.equal(redactDiagnosticText("word ".repeat(6_000)).length, 20_000);
});
