// @ts-check

/**
 * Whose pause it was, on the operator's Show View player.
 *
 * Every screen follows that player's play and pause, so a pause it reports is
 * a pause for the whole service. The operator pauses it with a click or a key
 * on the player, or a media key. WebKit also pauses it on its own: when the
 * window is hidden, and when the computer sleeps, with the window still
 * showing. Taken as the operator's, a sleep stopped the video on every screen,
 * and it stayed stopped after waking.
 */

/** How soon after touching the player a pause is taken as the operator's. */
export const OPERATOR_PAUSE_WITHIN_MS = 1500;

/**
 * Whether a pause the player reported is the operator stopping the video.
 *
 * @param {{
 *   nowMs: number;
 *   touchedAtMs: number;
 *   programmatic: boolean;
 *   ended: boolean;
 *   hidden: boolean;
 * }} pause
 * @returns {boolean}
 */
export function isOperatorPause({ nowMs, touchedAtMs, programmatic, ended, hidden }) {
  // This hook's own pause, made to match the transport.
  if (programmatic) return false;
  // The end of a video that does not loop, which the transport hears as such.
  if (ended) return false;
  // Nobody can press pause on a hidden window.
  if (hidden) return false;
  return nowMs - touchedAtMs <= OPERATOR_PAUSE_WITHIN_MS;
}

/**
 * Whether a player found paused should be started again: the video is meant
 * to be playing, and the operator did not just pause it.
 *
 * @param {{
 *   nowMs: number;
 *   transportPlaying: boolean;
 *   paused: boolean;
 *   ended: boolean;
 *   seeking: boolean;
 *   hidden: boolean;
 *   operatorPausedAtMs: number;
 * }} player
 * @returns {boolean}
 */
export function shouldResume({ nowMs, transportPlaying, paused, ended, seeking, hidden, operatorPausedAtMs }) {
  if (!transportPlaying || !paused || ended || seeking) return false;
  // WebKit starts it again itself when the window is seen again.
  if (hidden) return false;
  // Until the transport hears the operator's pause, it still says playing.
  return nowMs - operatorPausedAtMs > OPERATOR_PAUSE_WITHIN_MS;
}
