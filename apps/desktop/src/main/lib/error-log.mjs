// @ts-check

import { redactDiagnosticText } from "./diagnostic-redaction.mjs";

/**
 * The local error log's rules: where an entry goes, what it holds, and when the
 * file rotates. Moved verbatim out of `error-reporting.service.ts` so
 * `tests/error-log.test.mjs` can pin them before
 * `src-tauri/src/services/error_log.rs` ports them.
 */

export const ERROR_LOG_DIRECTORY = "logs";
export const ERROR_LOG_FILE_NAME = "present-errors.ndjson";
export const ERROR_LOG_MAX_BYTES = 2 * 1024 * 1024;

/**
 * @typedef {{
 *   category: "main" | "renderer" | "child-process",
 *   message: string,
 *   name?: string,
 *   stack?: string,
 *   context?: Record<string, unknown>,
 * }} PresentErrorEvent
 */

/**
 * The line appended for `event`, without its newline.
 *
 * @param {PresentErrorEvent} event
 * @param {{ appVersion: string, platform: string, occurredAt: Date }} at
 */
export function errorLogLine(event, at) {
  return JSON.stringify({
    appVersion: at.appVersion,
    category: event.category,
    context: event.context ?? {},
    message: redactDiagnosticText(event.message),
    name: event.name ? redactDiagnosticText(event.name) : undefined,
    occurredAt: at.occurredAt.toISOString(),
    platform: at.platform,
    stack: event.stack ? redactDiagnosticText(event.stack) : undefined,
  });
}

/** @param {number} sizeBytes the log's size before the append */
export const shouldRotateErrorLog = (sizeBytes) => sizeBytes >= ERROR_LOG_MAX_BYTES;

/**
 * `recordRendererError`: what a renderer's report becomes, or `null` for a
 * report that is not an object.
 *
 * @param {unknown} payload
 * @returns {PresentErrorEvent | null}
 */
export function rendererErrorEvent(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate = /** @type {Record<string, unknown>} */ (payload);
  return {
    category: "renderer",
    message: typeof candidate.message === "string" ? candidate.message : "Renderer error",
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    stack: typeof candidate.stack === "string" ? candidate.stack : undefined,
    context: {
      source: typeof candidate.source === "string" ? candidate.source : "renderer",
    },
  };
}
