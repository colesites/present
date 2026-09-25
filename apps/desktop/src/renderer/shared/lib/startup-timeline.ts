/**
 * How long a launch takes to put the operator's library on screen, step by
 * step, written once to the app's log.
 *
 * "The data takes a while to show" can only be fixed with numbers from the
 * machine it happens on, and the steps in between — the page loading, the
 * session read from the keychain, this machine's library read from SQLite,
 * Convex answering over whatever network the hall has — each sit in a
 * different part of the app. Each marks itself here, and the whole launch is
 * one line in `~/Library/Logs/<identifier>/`, milliseconds since the page
 * started loading:
 *
 *     startup (ms since the page started): first-paint=1840 session-restored(cached)=1910 ...
 *
 * Only the operator window is timed; the others do not load the library.
 */

/** How long after the page starts the line is written, whatever has happened. */
const REPORT_BY_MS = 60_000;

const isOperatorWindow = (): boolean =>
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in window &&
  !new URLSearchParams(window.location.search).has("window");

const marks: string[] = [];
const seen = new Set<string>();
let reported = false;
let deadline: number | null = null;

const report = (): void => {
  if (reported) return;
  reported = true;
  if (deadline !== null) window.clearTimeout(deadline);
  const message = `startup (ms since the page started): ${marks.join(" ")}`;
  // Loaded when needed, as `window-ready.ts` does, so importing this costs
  // nothing outside the Tauri shell.
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("report_diagnostic", { message }))
    .catch((): undefined => undefined);
};

/**
 * Note that `step` has happened, the first time only. `detail` is a word or a
 * count that makes the step readable — never anything about the user.
 */
export const markStartup = (step: string, detail?: string | number): void => {
  if (reported || seen.has(step) || !isOperatorWindow()) return;
  seen.add(step);
  const name = detail === undefined ? step : `${step}(${detail})`;
  marks.push(`${name}=${Math.round(performance.now())}`);
  deadline ??= window.setTimeout(report, REPORT_BY_MS);
};

/** Write the line now: the library the operator came for is on screen. */
export const finishStartup = (step: string, detail?: string | number): void => {
  markStartup(step, detail);
  if (isOperatorWindow()) report();
};
