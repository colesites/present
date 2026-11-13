/**
 * Builds: objects on a slide arriving and leaving step by step, as
 * PowerPoint's animations and Keynote's builds do. The same rules as
 * `compositor/build.rs`, which draws them: here for the editor, the slide
 * grid's click-step dots, and telling the core how many clicks a slide takes.
 *
 * No imports but types, so the tests can load this file on its own.
 */
import type { SlideBuild, SlideElement } from "../../../shared/types";

export const BUILD_EFFECTS: Array<{ value: SlideBuild["effect"]; label: string; directed: boolean }> = [
  { value: "appear", label: "Appear", directed: false },
  { value: "fade", label: "Dissolve", directed: false },
  { value: "rise", label: "Rise", directed: false },
  { value: "drop", label: "Drop", directed: false },
  { value: "pop", label: "Pop", directed: false },
  { value: "grow", label: "Grow", directed: false },
  { value: "zoom", label: "Zoom", directed: false },
  { value: "wipe", label: "Wipe", directed: true },
  { value: "fly", label: "Fly", directed: true },
];

/**
 * When a build starts. The first on the slide has no build before it, so
 * "with previous" there is with the slide, and "after previous" once the
 * slide has come up — ProPresenter's names for them.
 */
export const BUILD_STARTS: Array<{ value: NonNullable<SlideBuild["start"]>; label: string; firstLabel: string }> = [
  { value: "on-click", label: "On click", firstLabel: "On click" },
  { value: "with-previous", label: "With previous", firstLabel: "With slide" },
  { value: "after-previous", label: "After previous", firstLabel: "After slide" },
];

export type PlacedBuild = {
  elementId: string;
  phase: "in" | "out";
  step: number;
  beginMs: number;
  durationMs: number;
  build: SlideBuild;
};

/** A slide's builds in order, each with its step: 0 runs with the slide. */
export function buildTimeline(elements: SlideElement[]): { placed: PlacedBuild[]; clickSteps: number } {
  const items: Array<{ order: number; seq: number; elementId: string; phase: "in" | "out"; build: SlideBuild }> = [];
  elements.forEach((element, index) => {
    if (element.isVisible === false || !element.builds) return;
    (["in", "out"] as const).forEach((phase, phaseIndex) => {
      const build = element.builds?.[phase];
      if (!build) return;
      items.push({ order: build.order ?? index * 2 + phaseIndex, seq: items.length, elementId: element.id, phase, build });
    });
  });
  items.sort((a, b) => a.order - b.order || a.seq - b.seq);

  const placed: PlacedBuild[] = [];
  let step = 0;
  let previousBase = 0;
  let previousEnd = 0;
  items.forEach((item, index) => {
    const start = item.build.start ?? "on-click";
    let base = 0;
    if (start === "with-previous") base = previousBase;
    else if (start === "after-previous") base = previousEnd;
    else if (index > 0 || step === 0) step += 1;
    const durationMs = item.build.effect === "appear" ? 0 : Math.max(0, item.build.durationMs ?? 500);
    const beginMs = base + Math.max(0, item.build.delayMs ?? 0);
    previousBase = base;
    previousEnd = beginMs + durationMs;
    placed.push({ elementId: item.elementId, phase: item.phase, step, beginMs, durationMs, build: item.build });
  });
  return { placed, clickSteps: step };
}

/** How many clicks a slide's builds take. */
export const clickStepsOf = (elements: SlideElement[] | undefined) =>
  elements ? buildTimeline(elements).clickSteps : 0;

/** Whether a slide has builds at all. */
export const hasBuilds = (elements: SlideElement[] | undefined) =>
  Boolean(elements?.some((element) => element.builds?.in || element.builds?.out));

/**
 * The slide's builds in order, renumbered 0, 1, 2… after one moved: what the
 * editor's build order list writes back.
 */
export function withBuildOrder(
  elements: SlideElement[],
  order: Array<{ elementId: string; phase: "in" | "out" }>,
): SlideElement[] {
  const rank = new Map(order.map((entry, index) => [`${entry.elementId}:${entry.phase}`, index]));
  return elements.map((element) => {
    if (!element.builds) return element;
    const builds = { ...element.builds };
    for (const phase of ["in", "out"] as const) {
      const build = builds[phase];
      const at = rank.get(`${element.id}:${phase}`);
      if (build && at !== undefined) builds[phase] = { ...build, order: at };
    }
    return { ...element, builds };
  });
}

/**
 * How an object is drawn at a moment of its build, as `compositor/build.rs`
 * draws it: hidden, or faded, moved (fractions of the slide), scaled about
 * its middle and cut back from one side.
 */
export type BuildPose =
  | { hidden: true }
  | {
      hidden: false;
      opacity: number;
      dx: number;
      dy: number;
      scale: number;
      wipe: { from: "left" | "right" | "top" | "bottom"; shown: number } | null;
    };

/** How far a rise or a drop travels, as a fraction of the slide. */
const RISE_DISTANCE = 0.06;

const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeIn = (p: number) => p ** 3;
/** From 0 to 1, going a little past 1 and back on the way. */
const backOut = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;

/** An effect `shown` of the way in (0 nothing, 1 all of it) as a pose. */
export function poseOf(effect: string, direction: string | undefined, shown: number): BuildPose {
  if (shown <= 0) return { hidden: true };
  const s = Math.min(1, shown);
  const away = 1 - s;
  const still: Extract<BuildPose, { hidden: false }> = { hidden: false, opacity: 1, dx: 0, dy: 0, scale: 1, wipe: null };
  switch (effect) {
    case "appear":
      return still;
    case "fly": {
      const d = direction ?? "bottom";
      return {
        ...still,
        dx: d === "left" ? -away : d === "right" ? away : 0,
        dy: d === "top" ? -away : d === "left" || d === "right" ? 0 : away,
      };
    }
    case "wipe": {
      const d = direction ?? "left";
      const from = d === "right" || d === "top" || d === "bottom" ? d : "left";
      return { ...still, wipe: { from, shown: s } };
    }
    case "zoom":
      return { ...still, opacity: s, scale: 0.3 + 0.7 * s };
    case "rise":
      return { ...still, opacity: s, dy: RISE_DISTANCE * away };
    case "drop":
      return { ...still, opacity: s, dy: -RISE_DISTANCE * away };
    case "pop":
      return { ...still, opacity: Math.min(1, s * 2), scale: 0.5 + 0.5 * backOut(s) };
    case "grow":
      return { ...still, scale: 0.02 + 0.98 * s };
    default:
      return { ...still, opacity: s };
  }
}

/**
 * The poses at `step`, `elapsedMs` into it — `poses` in `compositor/build.rs`.
 * An object missing from the map is drawn as it was made. `moving` says a
 * later moment will look different.
 */
export function posesAt(
  timeline: { placed: PlacedBuild[] },
  step: number,
  elapsedMs: number,
): { poses: Map<string, BuildPose>; moving: boolean } {
  let moving = false;
  const progress = (placed: PlacedBuild) => {
    if (placed.step < step) return 1;
    if (placed.step > step) return 0;
    if (placed.durationMs <= 0) return elapsedMs >= placed.beginMs ? 1 : 0;
    return Math.min(1, Math.max(0, (elapsedMs - placed.beginMs) / placed.durationMs));
  };
  const ins = new Map<string, [PlacedBuild, number]>();
  const outs = new Map<string, [PlacedBuild, number]>();
  for (const placed of timeline.placed) {
    const p = progress(placed);
    if (placed.step === step && (p < 1 || elapsedMs < placed.beginMs)) moving = true;
    (placed.phase === "in" ? ins : outs).set(placed.elementId, [placed, p]);
  }
  const poses = new Map<string, BuildPose>();
  for (const id of new Set([...ins.keys(), ...outs.keys()])) {
    const entering = ins.get(id);
    const leaving = outs.get(id);
    if (leaving && leaving[1] >= 1) poses.set(id, { hidden: true });
    else if (leaving && leaving[1] > 0) {
      poses.set(id, poseOf(leaving[0].build.effect, leaving[0].build.direction, 1 - easeIn(leaving[1])));
    } else if (entering && entering[1] < 1) {
      poses.set(id, poseOf(entering[0].build.effect, entering[0].build.direction, easeOut(entering[1])));
    }
  }
  return { poses, moving };
}

/** How long a step takes to settle: its last build's end. */
export const stepLengthMs = (timeline: { placed: PlacedBuild[] }, step: number) =>
  timeline.placed
    .filter((placed) => placed.step === step)
    .reduce((longest, placed) => Math.max(longest, placed.beginMs + placed.durationMs), 0);
