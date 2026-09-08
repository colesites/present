/**
 * Which monitor a screen role lands on.
 *
 * Extracted verbatim from `src/main/services/display.service.ts` so the rule can
 * be tested without an Electron runtime, and so the Rust port in
 * `src-tauri/src/services/display.rs` can be checked against the same cases.
 * Behaviour is unchanged — see `tests/display-selection.test.mjs` for the
 * characterisation suite that pins it.
 */

/** @typedef {{ id: number, bounds: { width: number, height: number } }} DisplayLike */

const getDisplayArea = (display) => display.bounds.width * display.bounds.height;

/**
 * Pick the display for a role.
 *
 * 1. An explicitly chosen display wins, but only while it is still connected.
 * 2. Otherwise prefer the largest non-primary display — on a church setup the
 *    projector or TV is the big external one.
 * 3. With no external display, fall back to the primary.
 *
 * @param {{
 *   displays: DisplayLike[],
 *   primaryId: number,
 *   preferredDisplayId?: number | null,
 * }} params
 * @returns {DisplayLike | null} null only when no displays were supplied.
 */
export const selectPreferredDisplay = ({ displays, primaryId, preferredDisplayId = null }) => {
  if (!Array.isArray(displays) || displays.length === 0) {
    return null;
  }

  if (preferredDisplayId !== null && preferredDisplayId !== undefined) {
    const explicitDisplay = displays.find((display) => display.id === preferredDisplayId);
    if (explicitDisplay) {
      return explicitDisplay;
    }
  }

  const primary = displays.find((display) => display.id === primaryId) ?? displays[0];
  const externals = displays.filter((display) => display.id !== primaryId);

  if (externals.length === 0) {
    return primary;
  }

  // Largest first. `toSorted` would be cleaner but this file is loaded by the
  // Electron main process, which still targets the bundled Node version.
  const byAreaDescending = [...externals].sort(
    (a, b) => getDisplayArea(b) - getDisplayArea(a),
  );
  return byAreaDescending[0];
};
