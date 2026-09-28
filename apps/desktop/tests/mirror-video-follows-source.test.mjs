import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

/**
 * A video element that loads a new source, or is mounted again, starts
 * paused. The worship stage followed the operator's play state only when
 * that state changed, so switching from one video to another, or showing
 * media again, left it on a still frame.
 */
for (const [name, path] of [
  ["stage slide", "features/stage/StageSlideView.tsx"],
  ["audience window", "renderer/output/OutputWindow.tsx"],
]) {
  test(`the ${name} plays a video it has just loaded`, () => {
    const text = source(path);
    assert.match(text, /onLoadedData=\{\(event\) => followOperator\(event\.currentTarget\)\}/);
    const effect = text.slice(text.indexOf("followOperator(video);"));
    const deps = effect.slice(effect.indexOf("}, ["), effect.indexOf("]);") + 1);
    for (const field of ["state.mediaUrl", "state.showMedia", "state.hideBackground", "state.isVideoPlaying"]) {
      assert.ok(deps.includes(field), `${name} follows ${field}`);
    }
  });
}
