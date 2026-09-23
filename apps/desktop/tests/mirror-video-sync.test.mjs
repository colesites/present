import assert from "node:assert/strict";
import test from "node:test";

import {
  mirrorCorrection,
  mirrorTarget,
  positionForVideo,
  syncMirrorVideo,
} from "../src/shared/lib/mirror-video-sync.mjs";

const correct = (elementSeconds, targetSeconds, extra = {}) =>
  mirrorCorrection({ elementSeconds, targetSeconds, playing: true, durationSeconds: null, loop: false, ...extra });

test("a playing mirror aims where the operator's video is now, not where it was", () => {
  assert.equal(mirrorTarget({ positionSeconds: 10, sampledAtMs: 1_000, playing: true, nowMs: 1_250 }), 10.25);
  assert.equal(mirrorTarget({ positionSeconds: 10, sampledAtMs: 1_000, playing: false, nowMs: 1_250 }), 10, "paused does not move");
  assert.equal(mirrorTarget({ positionSeconds: 10, sampledAtMs: null, playing: true, nowMs: 1_250 }), 10, "no sample time, no guess");
  assert.equal(mirrorTarget({ positionSeconds: 10, sampledAtMs: 1_000, playing: true, nowMs: 9_000 }), 11.5, "a stale sample is extrapolated at most 1.5 s");
  assert.equal(mirrorTarget({ positionSeconds: 10, sampledAtMs: 2_000, playing: true, nowMs: 1_000 }), 10, "a sample from the future is not used backwards");
});

test("within a frame it plays at normal speed and does not seek", () => {
  assert.deepEqual(correct(10, 10.03), { seekTo: null, playbackRate: 1 });
  assert.deepEqual(correct(10.04, 10), { seekTo: null, playbackRate: 1 });
});

test("a small gap is closed by speeding up or slowing down, never by jumping", () => {
  const behind = correct(10, 10.3);
  assert.equal(behind.seekTo, null);
  assert.equal(behind.playbackRate, 1.1, "0.3 s over 1.5 s would be 1.2; capped at 1.1");
  const slightlyAhead = correct(10.15, 10);
  assert.equal(slightlyAhead.seekTo, null);
  assert.ok(Math.abs(slightlyAhead.playbackRate - 0.9) < 1e-9, "0.15 s ahead is 0.9");
  const tiny = correct(10, 10.06);
  assert.ok(Math.abs(tiny.playbackRate - 1.04) < 1e-9);
});

test("a large gap is a seek", () => {
  assert.deepEqual(correct(10, 11.5), { seekTo: 11.5, playbackRate: 1 });
  assert.deepEqual(correct(30, 2), { seekTo: 2, playbackRate: 1 });
  assert.deepEqual(correct(10, 11), { seekTo: null, playbackRate: 1.1 }, "exactly a second is still caught up");
});

test("a paused mirror shows the operator's frame exactly", () => {
  assert.deepEqual(correct(10, 10.2, { playing: false }), { seekTo: 10.2, playbackRate: 1 });
  assert.deepEqual(correct(10, 10.03, { playing: false }), { seekTo: null, playbackRate: 1 });
});

test("across a loop point the gap is the short way round", () => {
  const nearEnd = correct(9.9, 10.1, { durationSeconds: 10, loop: true });
  assert.equal(nearEnd.seekTo, null, "0.1 past the end is 0.2 ahead, not 9.8 behind");
  assert.equal(nearEnd.playbackRate, 1.1, "catching up, capped");
  const justPast = correct(9.98, 10.02, { durationSeconds: 10, loop: true });
  assert.deepEqual(justPast, { seekTo: null, playbackRate: 1 }, "0.04 s across the loop point is in step");
  assert.deepEqual(correct(0.05, 9.95, { durationSeconds: 10, loop: true }).playbackRate < 1, true);
  assert.deepEqual(correct(5, 12, { durationSeconds: 10, loop: false }), { seekTo: 10, playbackRate: 1 }, "without looping the end is the end");
});

test("an element or position that is not a number is left alone", () => {
  assert.deepEqual(correct(Number.NaN, 10), { seekTo: null, playbackRate: 1 });
  assert.deepEqual(correct(10, Number.POSITIVE_INFINITY), { seekTo: null, playbackRate: 1 });
});

test("syncing an element sets its rate and seeks only when told to", () => {
  const video = { currentTime: 10, duration: 60, loop: false, playbackRate: 1 };
  syncMirrorVideo(video, { positionSeconds: 10.2, sampledAtMs: 1_000, playing: true, nowMs: 1_100 });
  assert.equal(video.currentTime, 10, "0.3 s behind is caught up, not jumped");
  assert.equal(video.playbackRate, 1.1);
  syncMirrorVideo(video, { positionSeconds: 20, sampledAtMs: 1_000, playing: true, nowMs: 1_000 });
  assert.equal(video.currentTime, 20);
  assert.equal(video.playbackRate, 1);
  const unseekable = {
    get currentTime() { return 0; },
    set currentTime(_value) { throw new Error("not loaded"); },
    duration: Number.NaN,
    loop: false,
    playbackRate: 1,
  };
  assert.doesNotThrow(() => syncMirrorVideo(unseekable, { positionSeconds: 5, sampledAtMs: null, playing: false }));
});

// The owner's report: play video 1, switch to video 2 at five seconds, go back
// to video 1 and it starts five seconds in. Choosing an item is a round trip to
// Rust, and until it answers the transport is still holding the last item's
// place — so every follower was seeking the new video to where the old one had
// got to.

test("a position belonging to another video is not followed", () => {
  assert.deepEqual(
    positionForVideo({
      transportMediaId: "video-1",
      videoId: "video-2",
      positionSeconds: 5,
      sampledAtMs: 1_700_000_000_000,
    }),
    { positionSeconds: 0, sampledAtMs: null },
    "video 2 starts at its beginning, not where video 1 was",
  );
});

test("its own position is followed, sample time and all", () => {
  assert.deepEqual(
    positionForVideo({
      transportMediaId: "video-1",
      videoId: "video-1",
      positionSeconds: 5,
      sampledAtMs: 1_700_000_000_000,
    }),
    { positionSeconds: 5, sampledAtMs: 1_700_000_000_000 },
    "the same video keeps its place — a window reloading does not rewind it",
  );
});

test("nothing on screen follows whatever the transport says", () => {
  // An image, or nothing at all: there is no video to be wrong about.
  assert.deepEqual(
    positionForVideo({
      transportMediaId: "video-1",
      videoId: null,
      positionSeconds: 5,
      sampledAtMs: 1_700_000_000_000,
    }),
    { positionSeconds: 5, sampledAtMs: 1_700_000_000_000 },
  );
});

test("a mirror never extrapolates another video's position", () => {
  // The sample time goes with the position. Kept, a playing mirror would add
  // the time since it was taken and aim past the beginning of a video that has
  // not started.
  const { positionSeconds, sampledAtMs } = positionForVideo({
    transportMediaId: "video-1",
    videoId: "video-2",
    positionSeconds: 5,
    sampledAtMs: 1_700_000_000_000,
  });
  assert.equal(
    mirrorTarget({ positionSeconds, sampledAtMs, playing: true, nowMs: 1_700_000_002_000 }),
    0,
    "two seconds later it is still the beginning",
  );
});
