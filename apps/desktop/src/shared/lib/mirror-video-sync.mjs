// @ts-check

/**
 * Keeping a muted mirror of the operator's video — the preview, the audience
 * window, the worship stage — on the operator's frame without jumping.
 *
 * The mirrors used to seek whenever they drifted more than 0.12 s. Under Tauri
 * the operator's position reaches them after a trip through Rust, so it was
 * already more than 0.12 s old on arrival: a playing mirror seeked backwards
 * several times a second, which reads on screen as dropped frames. Measured in
 * the running app, the preview seeked 9 times in 4 s and showed about 20 frames
 * a second against the operator's 27.
 *
 * Now the mirror aims where the operator's video is *now* — the reported
 * position plus the time since it was sampled — plays at normal speed when it
 * is within a frame of that, nudges its playback rate to close a small gap, and
 * seeks only for a large one or while paused, when the exact frame is what is
 * on screen. The mirrors are muted, so a rate change is inaudible.
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

/** Within this, a playing mirror is in step. About a frame at 25 fps. */
export const IN_STEP_SECONDS = 0.04;
/** Beyond this, a playing mirror jumps rather than catching up. */
export const SEEK_SECONDS = 1;
/** A paused mirror shows the operator's frame to within this. */
export const PAUSED_TOLERANCE_SECONDS = 0.04;
/** How far the rate may move from 1 to close a gap. */
export const MAX_RATE_ADJUSTMENT = 0.1;
/** A gap is closed over about this long. */
export const CATCH_UP_SECONDS = 1.5;
/** A sample older than this is not extrapolated further — updates stopped. */
export const MAX_EXTRAPOLATION_SECONDS = 1.5;

/**
 * Where the operator's video is now.
 *
 * @param {{ positionSeconds: number, sampledAtMs: number | null | undefined, playing: boolean, nowMs: number }} input
 */
export function mirrorTarget({ positionSeconds, sampledAtMs, playing, nowMs }) {
  if (!playing || typeof sampledAtMs !== "number" || !Number.isFinite(sampledAtMs)) {
    return positionSeconds;
  }
  const elapsed = Math.min(Math.max((nowMs - sampledAtMs) / 1000, 0), MAX_EXTRAPOLATION_SECONDS);
  return positionSeconds + elapsed;
}

/**
 * What a mirror at `elementSeconds` should do to be at `targetSeconds`.
 *
 * @param {{ elementSeconds: number, targetSeconds: number, playing: boolean, durationSeconds: number | null, loop: boolean }} input
 * @returns {{ seekTo: number | null, playbackRate: number }}
 */
export function mirrorCorrection({ elementSeconds, targetSeconds, playing, durationSeconds, loop }) {
  if (!Number.isFinite(elementSeconds) || !Number.isFinite(targetSeconds)) {
    return { seekTo: null, playbackRate: 1 };
  }
  const hasDuration = typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0;
  let target = targetSeconds;
  if (hasDuration) {
    target = loop ? ((target % durationSeconds) + durationSeconds) % durationSeconds : Math.min(target, durationSeconds);
  }
  let drift = target - elementSeconds;
  if (hasDuration && loop) {
    // Across the loop point the short way round is the real gap.
    if (drift > durationSeconds / 2) drift -= durationSeconds;
    if (drift <= -durationSeconds / 2) drift += durationSeconds;
  }

  if (!playing) {
    return {
      seekTo: Math.abs(drift) > PAUSED_TOLERANCE_SECONDS ? target : null,
      playbackRate: 1,
    };
  }
  if (Math.abs(drift) > SEEK_SECONDS) {
    return { seekTo: target, playbackRate: 1 };
  }
  if (Math.abs(drift) <= IN_STEP_SECONDS) {
    return { seekTo: null, playbackRate: 1 };
  }
  const adjustment = Math.min(Math.max(drift / CATCH_UP_SECONDS, -MAX_RATE_ADJUSTMENT), MAX_RATE_ADJUSTMENT);
  return { seekTo: null, playbackRate: 1 + adjustment };
}

/**
 * Apply the correction to a mirror element.
 *
 * @param {HTMLVideoElement} video
 * @param {{ positionSeconds: number, sampledAtMs: number | null | undefined, playing: boolean, nowMs?: number }} operator
 */
export function syncMirrorVideo(video, operator) {
  const targetSeconds = mirrorTarget({ ...operator, nowMs: operator.nowMs ?? Date.now() });
  const { seekTo, playbackRate } = mirrorCorrection({
    elementSeconds: video.currentTime,
    targetSeconds,
    playing: operator.playing,
    durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
    loop: video.loop,
  });
  if (video.playbackRate !== playbackRate) {
    video.playbackRate = playbackRate;
  }
  if (seekTo !== null) {
    try {
      video.currentTime = seekTo;
    } catch {
      // Not loaded far enough to seek; the next update tries again.
    }
  }
}
