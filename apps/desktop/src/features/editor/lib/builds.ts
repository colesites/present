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
  { value: "fade", label: "Fade", directed: false },
  { value: "wipe", label: "Wipe", directed: true },
  { value: "fly", label: "Fly", directed: true },
  { value: "zoom", label: "Zoom", directed: false },
];

export const BUILD_STARTS: Array<{ value: SlideBuild["start"]; label: string }> = [
  { value: "on-click", label: "On click" },
  { value: "with-previous", label: "With previous" },
  { value: "after-previous", label: "After previous" },
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
