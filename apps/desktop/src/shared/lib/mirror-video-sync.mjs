// @ts-check

/**
 * Whose position the transport is holding.
 *
 * The mirrors that chased the operator's video in WebKit — the preview, the
 * audience window, the worship stage — are gone: since 0.4.11 every video is
 * decoded by Rust and every screen keeps the transport's time there
 * (`services/media_frames.rs`, `services/sound`). What is left is the one
 * question the operator window still asks of a position: is it this video's?
 */

/**
 * The position to follow for `videoId`, given what the transport is holding.
 *
 * A position is only ever about one video. Choosing another item is a round
 * trip to Rust, and until it answers the transport still holds the previous
 * item's place — so a video chosen again would be seeked to where the last one
 * had got to, which reads on screen as the video resuming instead of starting.
 * Until the two agree, the answer is the beginning.
 *
 * @param {{
 *   transportMediaId: string | null,
 *   videoId: string | null,
 *   positionSeconds: number,
 *   sampledAtMs: number | null,
 * }} state
 */
export function positionForVideo({ transportMediaId, videoId, positionSeconds, sampledAtMs }) {
  if (videoId === null || transportMediaId === videoId) {
    return { positionSeconds, sampledAtMs };
  }
  // `null`, not "now": a mirror extrapolates from the sample time, and
  // extrapolating a position that belongs to another video is the same
  // mistake one frame later.
  return { positionSeconds: 0, sampledAtMs: null };
}
