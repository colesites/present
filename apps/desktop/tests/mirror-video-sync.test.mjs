import assert from "node:assert/strict";
import test from "node:test";

import { positionForVideo } from "../src/shared/lib/mirror-video-sync.mjs";

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

test("another video's position comes with no sample time to extrapolate from", () => {
  // The sample time goes with the position. Kept, a screen would add the
  // time since it was taken and aim past the beginning of a video that has
  // not started.
  const { sampledAtMs } = positionForVideo({
    transportMediaId: "video-1",
    videoId: "video-2",
    positionSeconds: 5,
    sampledAtMs: 1_700_000_000_000,
  });
  assert.equal(sampledAtMs, null);
});
