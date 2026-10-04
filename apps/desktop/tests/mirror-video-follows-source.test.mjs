import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

/**
 * The stage and the audience window used to play the operator's video in
 * their own `<video>` and chase the operator with it: a source just loaded
 * started paused, and switching from one video to another, or showing media
 * again, left the stage on a still frame. Since 0.4.11 both show the video
 * as Rust decodes it (`RustVideo`), on the scene's clock — the clock every
 * screen keeps, which a newly shown video joins where it is.
 */
for (const [name, path] of [
  ["stage slide", "features/stage/StageSlideView.tsx"],
  ["audience window", "renderer/output/OutputWindow.tsx"],
]) {
  test(`the ${name} shows its video on the scene's clock`, () => {
    const text = source(path);
    assert.match(text, /<RustVideo[^>]*?\n?[^>]*?url=\{state\.mediaUrl\}/s, `${name} decodes the scene's video in Rust`);
    assert.ok(text.includes('clock={{ mode: "scene" }}'), `${name} keeps the scene's time`);
    assert.ok(!text.includes("followOperator"), `${name} chases the operator with a player of its own again`);
  });
}
