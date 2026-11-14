import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import ts from "typescript";

const load = (path) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Script(transpiled.outputText).runInContext(createContext({ module, exports: module.exports, Math }));
  return module.exports;
};

const builds = load("../src/features/editor/lib/builds.ts");

// The same slide as `compositor/build.rs`'s tests: the two must agree.
const deck = () => [
  { id: "title", type: "text", builds: { in: { effect: "fade", durationMs: 400, start: "with-previous" } } },
  { id: "a", type: "text", builds: { in: { effect: "fly", direction: "left", durationMs: 500, start: "on-click" } } },
  {
    id: "b",
    type: "text",
    builds: {
      in: { effect: "wipe", durationMs: 300, delayMs: 200, start: "after-previous" },
      out: { effect: "fade", durationMs: 300, start: "on-click" },
    },
  },
  { id: "plain", type: "shape" },
];

test("steps come from how each build starts, as the compositor works them out", () => {
  const { placed, clickSteps } = builds.buildTimeline(deck());
  assert.deepEqual(
    JSON.parse(JSON.stringify(placed.map((p) => [`${p.elementId}:${p.phase}`, p.step, p.beginMs]))),
    [
      ["title:in", 0, 0],
      ["a:in", 1, 0],
      ["b:in", 1, 700],
      ["b:out", 2, 0],
    ],
  );
  assert.equal(clickSteps, 2);
});

test("what shows at each step", () => {
  const timeline = builds.buildTimeline(deck());
  const now = builds.posesAt(timeline, 0, 100);
  assert.ok(now.moving);
  const title = now.poses.get("title");
  assert.ok(!title.hidden && title.opacity > 0 && title.opacity < 1);
  assert.ok(now.poses.get("a").hidden);
  assert.ok(!now.poses.has("plain"), "no builds: drawn as made");

  const settled = builds.posesAt(timeline, 0, 1000);
  assert.ok(!settled.moving);
  assert.ok(!settled.poses.has("title"));

  const flying = builds.posesAt(timeline, 1, 250).poses.get("a");
  assert.ok(!flying.hidden && flying.dx < 0);
  assert.ok(builds.posesAt(timeline, 1, 250).poses.get("b").hidden, "after the fly and its delay");
  assert.ok(builds.posesAt(timeline, 2, 1000).poses.get("b").hidden, "built out");
  assert.equal(builds.stepLengthMs(timeline, 1), 1000);
});

test("every effect starts hidden and ends as made", () => {
  for (const { value } of builds.BUILD_EFFECTS) {
    assert.ok(builds.poseOf(value, undefined, 0).hidden, `${value} starts hidden`);
    const end = builds.poseOf(value, undefined, 1);
    assert.ok(!end.hidden);
    assert.ok(Math.abs(end.opacity - 1) < 1e-6, `${value} ends opaque`);
    assert.ok(Math.abs(end.dx) < 1e-6 && Math.abs(end.dy) < 1e-6, `${value} ends in place`);
    assert.ok(Math.abs(end.scale - 1) < 1e-6, `${value} ends its own size`);
  }
  assert.ok(builds.poseOf("pop", undefined, 0.8).scale > 1, "pop goes past its size");
  assert.ok(builds.poseOf("rise", undefined, 0.5).dy > 0, "rise comes from below");
});

test("one text box builds word by word, as the compositor counts its words", () => {
  const slide = [
    {
      id: "lyric",
      type: "text",
      content: "Let the  army\nroar",
      builds: { in: { effect: "pop", durationMs: 400, start: "with-previous", delivery: "word", gapMs: 200 } },
    },
    { id: "next", type: "text", content: "", builds: { in: { effect: "fade", durationMs: 100, start: "after-previous" } } },
  ];
  const timeline = builds.buildTimeline(slide);
  assert.equal(timeline.placed[0].units, 4);
  assert.equal(timeline.placed[1].beginMs, 1000, "after the last word");
  const look = builds.posesAt(timeline, 0, 300).poses.get("lyric");
  assert.equal(look.units.length, 4);
  assert.ok(!look.units[0].hidden && !look.units[1].hidden);
  assert.ok(look.units[2].hidden && look.units[3].hidden);
  assert.ok(!builds.posesAt(timeline, 0, 2000).poses.has("lyric"), "all in: as made");
});

test("letters and lines are counted as the compositor counts them", () => {
  const box = (delivery) => ({ id: delivery, type: "text", content: "Hi you\n\nthere", builds: { in: { effect: "fade", delivery } } });
  const timeline = builds.buildTimeline([box("letter"), box("line"), { id: "s", type: "shape", content: "", builds: { in: { effect: "fade", delivery: "word" } } }]);
  assert.equal(timeline.placed[0].units, 10);
  assert.equal(timeline.placed[0].gapMs, 50);
  assert.equal(timeline.placed[1].units, 2);
  assert.equal(timeline.placed[2].units, 1, "a shape builds all at once");
});

test("the new effects end upright, sharp and their own width", () => {
  for (const effect of ["slide", "bounce", "elastic", "spin", "flip", "stretch", "blur"]) {
    const end = builds.poseOf(effect, undefined, 1);
    assert.ok(Math.abs(end.scaleX - 1) < 1e-6 && Math.abs(end.rotate) < 1e-6 && Math.abs(end.blur) < 1e-6, effect);
  }
  assert.ok(builds.poseOf("spin", undefined, 0.3).rotate < 0, "spin turns in");
  assert.ok(builds.poseOf("blur", undefined, 0.3).blur > 0, "blur starts soft");
});
