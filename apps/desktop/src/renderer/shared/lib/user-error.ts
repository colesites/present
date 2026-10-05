/**
 * What the person using Present is told when something goes wrong.
 *
 * Only words written for them ever reach the screen:
 * - an error thrown as a `UserFacingError`;
 * - an error from the Rust core of kind `user` (`src-tauri/src/errors.rs`);
 * - a refusal the backend wrote for people: a `ConvexError` carrying a
 *   string ("You've reached your plan's limit…").
 *
 * Anything else — an exception, a library's or a service's validation text,
 * a status code, a stack — is a fault in Present, not something to read. It
 * goes to the app's log with where it happened, and the person sees the plain
 * sentence the caller gives instead. "User Input Validation Error: Invalid
 * 'keyterms_prompt'" was once put in front of an operator like that.
 */

import { ConvexError } from "convex/values";

/** An error whose message is written for the person using Present. */
export class UserFacingError extends Error {
  readonly userFacing = true;

  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/**
 * The text inside `error`, whatever made it — for recognising a case
 * ("quota exhausted"), never for showing.
 */
export function rawText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "";
}

/** The words `error` carries for people, or `null` when it carries none. */
export function userFacingText(error: unknown): string | null {
  if (error instanceof UserFacingError) {
    return error.message.trim() || null;
  }
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data.trim() || null;
  }
  if (error && typeof error === "object") {
    const fromRust = error as { kind?: unknown; message?: unknown };
    if (fromRust.kind === "user" && typeof fromRust.message === "string") {
      return fromRust.message.trim() || null;
    }
  }
  return null;
}

/** Put a fault in the app's log, with where it happened. */
export function logFault(error: unknown, where: string): void {
  console.error(`[${where}]`, error);
  try {
    const detail =
      error instanceof Error
        ? { message: error.message, name: error.name, stack: error.stack }
        : {
            message:
              typeof error === "string"
                ? error
                : (() => {
                    try {
                      return JSON.stringify(error);
                    } catch {
                      return String(error);
                    }
                  })(),
          };
    void window.electronAPI?.reportRendererError?.({ ...detail, source: where });
  } catch {
    // The log is best effort; the person is still told something plain.
  }
}

/**
 * What to tell the person about `error`: its own words if they were written
 * for people, else `fallback` — and then the error itself goes to the log,
 * marked `where`, and never to the screen.
 */
export function userMessage(error: unknown, fallback: string, where: string): string {
  const text = userFacingText(error);
  if (text) return text;
  logFault(error, where);
  return fallback;
}
