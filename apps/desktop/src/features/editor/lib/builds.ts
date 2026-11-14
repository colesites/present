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
  { value: "slide", label: "Slide In", directed: true },
  { value: "wipe", label: "Wipe", directed: true },
  { value: "fly", label: "Fly", directed: true },
  { value: "bounce", label: "Bounce", directed: false },
  { value: "elastic", label: "Spring", directed: false },
  { value: "spin", label: "Spin", directed: false },
  { value: "flip", label: "Flip", directed: false },
  { value: "stretch", label: "Stretch", directed: false },
  { value: "blur", label: "Focus", directed: false },
];

/**
 * How a text box's build is handed out: all of it, or a line, a word or a
 * letter at a time — one box, its words arriving in turn, instead of a box
 * for each word. `gapMs` is the gap between pieces unless the build gives one.
 */
export const BUILD_DELIVERIES: Array<{ value: NonNullable<SlideBuild["delivery"]>; label: string; gapMs: number }> = [
  { value: "all", label: "All at once", gapMs: 0 },
  { value: "line", label: "By line", gapMs: 400 },
  { value: "word", label: "By word", gapMs: 150 },
  { value: "letter", label: "By letter", gapMs: 50 },
];

type Delivery = NonNullable<SlideBuild["delivery"]>;

/** Imported words in runs of their own sizes: built all at once, as the screens do. */
const isRichText = (element: SlideElement) =>
  Boolean(element.textBody?.paragraphs?.some((paragraph) => paragraph.runs.some((run) => run.fontSize !== undefined)));

/** A text box's words as the screens read them: its paragraphs, one a line. */
export function paragraphsOf(element: SlideElement): string[] {
  const paragraphs = element.textBody?.paragraphs;
  if (paragraphs && paragraphs.length > 0) return paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(""));
  return (element.content ?? "").split("\n");
}

/**
 * Which piece each character of `body` is in (`null` for a space), counted
 * from 0: each paragraph with words, each word, or each letter. As
 * `text::units_in` counts them.
 */
export function unitsIn(body: string, delivery: Delivery): Array<number | null> {
  const out: Array<number | null> = [];
  let next = 0;
  let inWord = false;
  let lineHasWords = false;
  for (const character of Array.from(body)) {
    if (character === "\n") {
      if ((delivery === "line" && lineHasWords) || (delivery === "word" && inWord)) next += 1;
      lineHasWords = false;
      inWord = false;
      out.push(null);
      continue;
    }
    if (/\s/u.test(character)) {
      if (delivery === "word" && inWord) next += 1;
      inWord = false;
      out.push(null);
      continue;
    }
    out.push(next);
    if (delivery === "letter") next += 1;
    inWord = true;
    lineHasWords = true;
  }
  return out;
}

/** How many pieces a text box is delivered in. */
export function unitCount(element: SlideElement, delivery: Delivery): number {
  let last = -1;
  for (const unit of unitsIn(paragraphsOf(element).join("\n"), delivery)) if (unit !== null) last = unit;
  return last + 1;
}

/** How an object's build is handed out, and in how many pieces: 1 for all at once. */
function deliveryOf(element: SlideElement, build: SlideBuild): { delivery: Delivery; units: number } {
  const delivery = build.delivery ?? "all";
  if (delivery === "all" || element.type !== "text" || isRichText(element)) return { delivery: "all", units: 1 };
  const units = unitCount(element, delivery);
  return units > 1 ? { delivery, units } : { delivery: "all", units: 1 };
}

/** Whether an object's builds can be handed out a piece at a time. */
export const canDeliverByPiece = (element: SlideElement) => element.type === "text" && !isRichText(element);

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
  /** How it is handed out, and into how many pieces, `gapMs` apart. */
  delivery: Delivery;
  units: number;
  gapMs: number;
};

/** From a build's first piece starting to its last one settling. */
export const spanMs = (placed: PlacedBuild) => placed.durationMs + placed.gapMs * Math.max(0, placed.units - 1);

/** A slide's builds in order, each with its step: 0 runs with the slide. */
export function buildTimeline(elements: SlideElement[]): { placed: PlacedBuild[]; clickSteps: number } {
  const items: Array<{
    order: number;
    seq: number;
    elementId: string;
    phase: "in" | "out";
    build: SlideBuild;
    pieces: { delivery: Delivery; units: number };
  }> = [];
  elements.forEach((element, index) => {
    if (element.isVisible === false || !element.builds) return;
    (["in", "out"] as const).forEach((phase, phaseIndex) => {
      const build = element.builds?.[phase];
      if (!build) return;
      items.push({
        order: build.order ?? index * 2 + phaseIndex,
        seq: items.length,
        elementId: element.id,
        phase,
        build,
        pieces: deliveryOf(element, build),
      });
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
    const { delivery, units } = item.pieces;
    const given = item.build.gapMs;
    const gapMs =
      units > 1
        ? Math.max(0, given !== undefined && Number.isFinite(given) ? given : BUILD_DELIVERIES.find((each) => each.value === delivery)?.gapMs ?? 0)
        : 0;
    const one: PlacedBuild = { elementId: item.elementId, phase: item.phase, step, beginMs, durationMs, build: item.build, delivery, units, gapMs };
    previousBase = base;
    previousEnd = beginMs + spanMs(one);
    placed.push(one);
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
 * its middle (`scaleX` more across), turned (degrees), blurred (a fraction
 * of the slide's height) and cut back from one side.
 */
export type BuildPose =
  | { hidden: true }
  | {
      hidden: false;
      opacity: number;
      dx: number;
      dy: number;
      scale: number;
      scaleX: number;
      rotate: number;
      blur: number;
      wipe: { from: "left" | "right" | "top" | "bottom"; shown: number } | null;
    };

/** Each line, word or letter of a text box in its own pose (`null`: as made). */
export type UnitLook = { units: Array<BuildPose | null>; delivery: Delivery };

/** How an object is drawn: all of it in one pose, or each piece in its own. */
export type BuildLook = BuildPose | UnitLook;

export const isUnitLook = (look: BuildLook | undefined): look is UnitLook => Boolean(look && "units" in look);

/** How far a rise or a drop travels, as a fraction of the slide. */
const RISE_DISTANCE = 0.06;
const SLIDE_DISTANCE = 0.15;
const BOUNCE_HEIGHT = 0.12;
const BLUR_AMOUNT = 0.02;

const easeOut = (p: number) => 1 - (1 - p) ** 3;
/** From 0 to 1, going a little past 1 and back on the way. */
const backOut = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
/** From 0 to 1 with a ball's bounces at the end. */
function bounceOut(p: number) {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p - 1.5 / d) ** 2 + 0.75;
  if (p < 2.5 / d) return n * (p - 2.25 / d) ** 2 + 0.9375;
  return n * (p - 2.625 / d) ** 2 + 0.984375;
}
/** From 0 to 1, springing past it and back a few times. */
const elasticOut = (p: number) => 2 ** (-10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

function fromSide(direction: string | undefined): [number, number] {
  const d = direction ?? "bottom";
  return d === "left" ? [-1, 0] : d === "right" ? [1, 0] : d === "top" ? [0, -1] : [0, 1];
}

/**
 * An effect `linear` of the way in (0 nothing, 1 all of it, in time: each
 * effect eases itself) as a pose. A build out plays it backwards.
 */
export function poseOf(effect: string, direction: string | undefined, linear: number): BuildPose {
  if (linear <= 0) return { hidden: true };
  const still: Extract<BuildPose, { hidden: false }> = {
    hidden: false,
    opacity: 1,
    dx: 0,
    dy: 0,
    scale: 1,
    scaleX: 1,
    rotate: 0,
    blur: 0,
    wipe: null,
  };
  if (linear >= 1) return still;
  const s = easeOut(linear);
  const away = 1 - s;
  switch (effect) {
    case "appear":
      return still;
    case "fly": {
      const [x, y] = fromSide(direction);
      return { ...still, dx: x * away, dy: y * away };
    }
    case "slide": {
      const [x, y] = fromSide(direction);
      return { ...still, opacity: s, dx: x * SLIDE_DISTANCE * away, dy: y * SLIDE_DISTANCE * away };
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
    case "bounce":
      return { ...still, opacity: Math.min(1, linear * 4), dy: -BOUNCE_HEIGHT * (1 - bounceOut(linear)) };
    case "elastic":
      return { ...still, opacity: Math.min(1, linear * 4), scale: Math.max(0, elasticOut(linear)) };
    case "spin":
      return { ...still, opacity: s, scale: 0.3 + 0.7 * s, rotate: -180 * away };
    case "flip":
      return { ...still, opacity: Math.min(1, s * 2), scaleX: s };
    case "stretch":
      return { ...still, opacity: s, scaleX: 1 + 1.5 * away };
    case "blur":
      return { ...still, opacity: s, blur: BLUR_AMOUNT * away };
    default:
      return { ...still, opacity: s };
  }
}

/** How far one build has run: 0 not begun, 1 done. */
function progressOf(placed: PlacedBuild, step: number, elapsedMs: number, beginMs: number, durationMs: number) {
  if (placed.step < step) return 1;
  if (placed.step > step) return 0;
  if (durationMs <= 0) return elapsedMs >= beginMs ? 1 : 0;
  return Math.min(1, Math.max(0, (elapsedMs - beginMs) / durationMs));
}

/** An object's look part-way through one of its builds. */
function lookOf(placed: PlacedBuild, step: number, elapsedMs: number): BuildLook {
  const shown = (p: number) => (placed.phase === "in" ? p : 1 - p);
  const pose = (p: number) => poseOf(placed.build.effect, placed.build.direction, shown(p));
  if (placed.units <= 1) return pose(progressOf(placed, step, elapsedMs, placed.beginMs, placed.durationMs));
  const units: Array<BuildPose | null> = [];
  for (let unit = 0; unit < placed.units; unit += 1) {
    const p = progressOf(placed, step, elapsedMs, placed.beginMs + placed.gapMs * unit, placed.durationMs);
    units.push(shown(p) < 1 ? pose(p) : null);
  }
  return { units, delivery: placed.delivery };
}

/**
 * The looks at `step`, `elapsedMs` into it — `poses` in `compositor/build.rs`.
 * An object missing from the map is drawn as it was made. `moving` says a
 * later moment will look different.
 */
export function posesAt(
  timeline: { placed: PlacedBuild[] },
  step: number,
  elapsedMs: number,
): { poses: Map<string, BuildLook>; moving: boolean } {
  let moving = false;
  const ins = new Map<string, [PlacedBuild, number]>();
  const outs = new Map<string, [PlacedBuild, number]>();
  for (const placed of timeline.placed) {
    const p = progressOf(placed, step, elapsedMs, placed.beginMs, spanMs(placed));
    if (placed.step === step && (p < 1 || elapsedMs < placed.beginMs)) moving = true;
    (placed.phase === "in" ? ins : outs).set(placed.elementId, [placed, p]);
  }
  const poses = new Map<string, BuildLook>();
  for (const id of new Set([...ins.keys(), ...outs.keys()])) {
    const entering = ins.get(id);
    const leaving = outs.get(id);
    if (leaving && leaving[1] >= 1) poses.set(id, { hidden: true });
    else if (leaving && leaving[1] > 0) poses.set(id, lookOf(leaving[0], step, elapsedMs));
    else if (entering && entering[1] < 1) poses.set(id, lookOf(entering[0], step, elapsedMs));
  }
  return { poses, moving };
}

/** How long a step takes to settle: its last build's end. */
export const stepLengthMs = (timeline: { placed: PlacedBuild[] }, step: number) =>
  timeline.placed
    .filter((placed) => placed.step === step)
    .reduce((longest, placed) => Math.max(longest, placed.beginMs + spanMs(placed)), 0);
