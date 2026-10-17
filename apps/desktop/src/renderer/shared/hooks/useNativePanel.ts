"use client";

import { useEffect, useState, type RefObject } from "react";

import type { NativePanelGeometry, NativePanelSource, PanelRect } from "../../tauri/native-panels";

const panels = () => import("../../tauri/native-panels");

/**
 * The panel's place is sent at least this often, changed or not: a panel
 * whose page goes quiet for fifteen seconds hides its picture
 * (`NativePanel::is_current`), so one left behind never shows through.
 */
const STILL_HERE_MS = 1000;

/** Frames between fresh looks at the boxes around the panel: their clipping and corners. */
const LOOK_AT_ANCESTORS_EVERY = 60;

/**
 * Frames between fresh looks at those boxes' colours when the theme has not
 * changed. Looking takes the clearing off and draws it again, which repaints
 * them — every box around the panel, the window's own among them — so it is
 * done when the theme changes, and otherwise only now and then.
 */
const LOOK_AT_COLOURS_EVERY = 600;

/** Counts changes that can change the boxes' colours: the theme, on `html` or `body`, or the system's. */
let themeChanges = 0;
let themeWatched = false;

function watchTheme() {
  if (themeWatched) return;
  themeWatched = true;
  const changed = () => {
    themeChanges += 1;
  };
  const observer = new MutationObserver(changed);
  const watched = { attributes: true, attributeFilter: ["class", "style", "data-theme"] };
  observer.observe(document.documentElement, watched);
  if (document.body) observer.observe(document.body, watched);
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", changed);
}

/** Who draws a panel's picture: being set up, the app natively, or the page. */
export type PanelDrawing = "pending" | "native" | "page";

/**
 * Draw the picture of the element `ref` points at natively, under the page
 * (`src-tauri/src/services/surface/panel.rs`), showing `source` — as the
 * audience screen is drawn under its window's page. `"native"` once it is, so
 * the caller stops drawing it itself; `"pending"` while it is being set up;
 * `"page"` where it cannot be — another platform, a refusal, a box this page
 * cannot clear — so the caller draws it as it always has, and with no
 * `source`.
 *
 * The picture is a layer the app draws, so a busy page cannot make it
 * stutter. The page stays on top of it: it clears the panel's box (`Clearing`)
 * and goes on drawing everything else — the panel's frame, menus, dialogs,
 * toasts, props — over the picture, where they always were. It says where
 * the panel is, measured each frame and sent when it changes.
 *
 * An element that was drawn under the panel, and would now show over the
 * picture, is marked `data-under-native` beside it and hidden while it is
 * drawn natively.
 */
export function useNativePanel(
  ref: RefObject<HTMLElement | null>,
  id: string,
  source: NativePanelSource | null,
): PanelDrawing {
  const kind = source ? (source.kind === "preview" ? `preview:${source.screen}` : "media") : null;
  const sourceKey = source ? JSON.stringify(source) : null;
  // The panel attached, and the one refused, by id and kind: a change of
  // what it shows is never mistaken for one already settled.
  const [attached, setAttached] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  // Attached when the kind of thing shown changes; a new file or clock goes
  // to the panel already there (below).
  useEffect(() => {
    const element = ref.current;
    if (!kind || !sourceKey || !element) return;
    const key = `${id}|${kind}`;
    let stopped = false;
    let frame = 0;
    let rafId = 0;
    let onVisibility: (() => void) | null = null;
    const startingSource = JSON.parse(sourceKey) as NativePanelSource;
    const measure = new Measure(element);
    const clearing = new Clearing(element);

    void (async () => {
      if (!clearing.possible()) {
        setRefused(key);
        return;
      }
      const core = await panels();
      await core.ready();
      if (stopped) return;
      const ok = await core.attachNativePanel(id, startingSource, measure.geometry());
      if (stopped) return;
      if (!ok) {
        setRefused(key);
        return;
      }
      setAttached(key);
      watchTheme();
      let lastSent = "";
      let sentAt = 0;
      let themeSeen = themeChanges;
      const tick = () => {
        if (stopped) return;
        frame += 1;
        const geometry = measure.geometry(frame % LOOK_AT_ANCESTORS_EVERY === 0);
        const colours = themeSeen !== themeChanges || frame % LOOK_AT_COLOURS_EVERY === 0;
        themeSeen = themeChanges;
        // In the same frame as the layout it follows: the page is cleared
        // where the panel is now, never a frame behind.
        clearing.follow(geometry, colours);
        const sent = JSON.stringify(geometry);
        const now = performance.now();
        if (sent !== lastSent || now - sentAt > STILL_HERE_MS) {
          lastSent = sent;
          sentAt = now;
          void core.setNativePanelGeometry(id, geometry).catch((): void => undefined);
        }
        rafId = window.requestAnimationFrame(tick);
      };
      tick();
      // A window covered or minimised runs no frames, so this is said at
      // once: the panel stops drawing while it is away, and starts the moment
      // it is back.
      onVisibility = () => {
        if (stopped) return;
        const geometry = measure.geometry();
        lastSent = JSON.stringify(geometry);
        sentAt = performance.now();
        void core.setNativePanelGeometry(id, geometry).catch((): void => undefined);
      };
      document.addEventListener("visibilitychange", onVisibility);
    })();

    return () => {
      stopped = true;
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      window.cancelAnimationFrame(rafId);
      clearing.restore();
      void panels()
        .then((core) => core.detachNativePanel(id))
        .catch((): void => undefined);
    };
    // `sourceKey` is read only for the first source; later ones go through
    // the effect below without attaching again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind, ref]);

  // A new file or a new clock, on the panel already showing.
  const isAttached = attached === `${id}|${kind}`;
  useEffect(() => {
    if (!isAttached || !sourceKey) return;
    void panels()
      .then((core) => core.setNativePanelSource(id, JSON.parse(sourceKey) as NativePanelSource))
      .catch((): void => undefined);
  }, [id, isAttached, sourceKey]);

  if (!kind) return "page";
  if (isAttached) return "native";
  return refused === `${id}|${kind}` ? "page" : "pending";
}

/** One panel's measurements, with what changes rarely kept between frames. */
class Measure {
  private clippers: HTMLElement[] = [];
  private corners = { radius: 0, corners: 0 };

  constructor(private readonly element: HTMLElement) {
    this.lookAtAncestors();
  }

  geometry(lookAtAncestors = false): NativePanelGeometry {
    if (lookAtAncestors) this.lookAtAncestors();
    const rect = toRect(this.element.getBoundingClientRect());
    let clip = intersect(rect, [0, 0, window.innerWidth, window.innerHeight]);
    for (const clipper of this.clippers) {
      const box = clipper.getBoundingClientRect();
      clip = intersect(clip, [
        box.left + clipper.clientLeft,
        box.top + clipper.clientTop,
        clipper.clientWidth,
        clipper.clientHeight,
      ]);
    }
    // On the page whether or not the page is being shown: a window that is
    // away keeps its panels where they are, and the page cleared for them, so
    // nothing has to be put back — and flash — when it returns.
    const visible = clip[2] >= 1 && clip[3] >= 1;
    return {
      rect: rect.map(round) as PanelRect,
      clip: clip.map(round) as PanelRect,
      visible,
      active: document.visibilityState === "visible",
      viewport: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio || 1,
      radius: this.corners.radius,
      corners: this.corners.corners,
    };
  }

  /** The boxes around the panel that clip it, and which of its corners they round. */
  private lookAtAncestors() {
    const clippers: HTMLElement[] = [];
    for (let node = this.element.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") clippers.push(node);
    }
    this.clippers = clippers;
    this.corners = roundedCorners(this.element, clippers);
  }
}

/** The background properties the page's clearing sets on a box, to be put back as they were. */
const BACKGROUND = [
  "background-color",
  "background-image",
  "background-position",
  "background-size",
  "background-repeat",
  "background-origin",
  "background-clip",
] as const;

type Saved = { property: string; value: string; priority: string }[];

/** A panel's hole in a box: where, and how its corners round. `null` while it is out of sight. */
type Hole = { rect: PanelRect; radius: number; corners: number } | null;

/** A box cleared for one or more panels. */
type ClearedBox = {
  /** Its own inline background, to put back. */
  saved: Saved;
  /** The colour it paints, redrawn around the holes. */
  colour: string;
  /** Each panel's hole in it, by the panel's key. */
  holes: Map<string, Hole>;
  /** What it was last drawn from, so an unchanged box is not drawn again. */
  drawn: string;
};

/**
 * The page's clearing for every panel drawn natively in it. Boxes are shared —
 * the center pane and the preview are both inside the app's layout — so each
 * box is drawn once, around every panel's hole in it.
 */
const page = {
  boxes: new Map<HTMLElement, ClearedBox>(),
  panels: new Set<string>(),
  /** Panels by the parent their underlays are hidden in. */
  containers: new Map<HTMLElement, number>(),
};

/** The rules that clear the page for every panel; added once. */
function addRules() {
  if (document.getElementById("present-native-panels")) return;
  const style = document.createElement("style");
  style.id = "present-native-panels";
  style.textContent = `
html[data-native-panels], html[data-native-panels] body { background: transparent !important; }
[data-native-panel] { background: transparent !important; }
[data-native-container] > [data-under-native] { visibility: hidden !important; }
`;
  document.head.appendChild(style);
}

function putBack(box: HTMLElement, saved: Saved) {
  for (const { property, value, priority } of saved) {
    if (value) box.style.setProperty(property, value, priority);
    else box.style.removeProperty(property);
  }
}

/** Draw `box`'s colour around every hole in it, or as it was with none showing. */
function drawBox(box: HTMLElement, cleared: ClearedBox) {
  const area = toRect(box.getBoundingClientRect());
  const holes = [...cleared.holes.values()].filter((hole): hole is NonNullable<Hole> => hole !== null);
  const key = JSON.stringify([area, holes, cleared.colour]);
  if (key === cleared.drawn) return;
  cleared.drawn = key;
  const style = box.style;
  if (holes.length === 0) {
    putBack(box, cleared.saved);
    return;
  }
  const layers = around(area, holes, cleared.colour);
  style.setProperty("background-color", "transparent", "important");
  style.setProperty("background-image", layers.map((layer) => layer.image).join(", ") || "none", "important");
  style.setProperty("background-position", layers.map((layer) => layer.position).join(", ") || "0 0", "important");
  style.setProperty("background-size", layers.map((layer) => layer.size).join(", ") || "auto", "important");
  style.setProperty("background-repeat", "no-repeat", "important");
  style.setProperty("background-origin", "border-box", "important");
  style.setProperty("background-clip", "border-box", "important");
}

/**
 * Clears the page where one panel is, so the picture under it shows, and puts
 * it back after.
 *
 * The page's own background goes (`html`, `body`); the app's layout paints
 * the window's colour. The panel's box is made clear, and so is every box
 * around it that paints a colour: its colour is redrawn around the panel —
 * and around any other panel in it — with rounded pieces at the corners the
 * panel's box rounds, so the box looks as it did, only the panel's part
 * clear. Its children, and everything else the page draws, are untouched.
 */
class Clearing {
  /** The boxes around the panel that paint a colour, innermost first. */
  private boxes: HTMLElement[] = [];
  private active = false;
  private static next = 0;
  private readonly key = `panel-${(Clearing.next += 1)}`;

  constructor(private readonly element: HTMLElement) {}

  /** Whether every box around the panel paints only a colour, which can be redrawn around a hole. */
  possible(): boolean {
    for (let node = this.element.parentElement; node && node !== document.body; node = node.parentElement) {
      if (page.boxes.has(node)) continue;
      if (window.getComputedStyle(node).backgroundImage !== "none") return false;
    }
    return true;
  }

  /** Clear the page where the panel is now. */
  follow(geometry: NativePanelGeometry, lookAgain: boolean) {
    if (!this.active) {
      this.active = true;
      addRules();
      page.panels.add(this.key);
      document.documentElement.setAttribute("data-native-panels", "");
      this.element.setAttribute("data-native-panel", "");
      const container = this.element.parentElement;
      if (container) {
        page.containers.set(container, (page.containers.get(container) ?? 0) + 1);
        container.setAttribute("data-native-container", "");
      }
      lookAgain = true;
    }
    if (lookAgain) this.lookAtBoxes();

    const whole =
      geometry.visible && geometry.clip.every((value, index) => Math.abs(value - geometry.rect[index]) < 0.5);
    const hole: Hole = geometry.visible
      ? {
          rect: geometry.clip,
          radius: whole ? geometry.radius : 0,
          corners: whole ? geometry.corners : 0,
        }
      : null;
    for (const box of this.boxes) {
      const cleared = page.boxes.get(box);
      if (!cleared) continue;
      cleared.holes.set(this.key, hole);
      drawBox(box, cleared);
    }
  }

  /** Put the page back as it was where this panel was. */
  restore() {
    for (const box of this.boxes) this.leave(box);
    this.boxes = [];
    if (!this.active) return;
    this.active = false;
    this.element.removeAttribute("data-native-panel");
    const container = this.element.parentElement;
    if (container) {
      const left = (page.containers.get(container) ?? 1) - 1;
      if (left > 0) page.containers.set(container, left);
      else {
        page.containers.delete(container);
        container.removeAttribute("data-native-container");
      }
    }
    page.panels.delete(this.key);
    if (page.panels.size === 0) document.documentElement.removeAttribute("data-native-panels");
  }

  /** This panel's hole goes from `box`; the box is put back when it has none. */
  private leave(box: HTMLElement) {
    const cleared = page.boxes.get(box);
    if (!cleared) return;
    cleared.holes.delete(this.key);
    if (cleared.holes.size === 0) {
      putBack(box, cleared.saved);
      page.boxes.delete(box);
    } else {
      drawBox(box, cleared);
    }
  }

  /**
   * The boxes around the panel that paint a colour, and the colour each
   * paints — read with the clearing taken off for the moment, every panel's,
   * so a box another panel has already cleared is seen in its own colour,
   * not as the clear one it has been given; and so a change of theme is
   * followed. All within one task: nothing is painted in between.
   */
  private lookAtBoxes() {
    const boxes: HTMLElement[] = [];
    for (let node = this.element.parentElement; node && node !== document.body; node = node.parentElement) {
      const cleared = page.boxes.get(node);
      if (cleared) putBack(node, cleared.saved);
      const colour = window.getComputedStyle(node).backgroundColor;
      if (!paints(colour)) {
        if (cleared) {
          cleared.holes.delete(this.key);
          if (cleared.holes.size === 0) page.boxes.delete(node);
          else {
            cleared.drawn = "";
            drawBox(node, cleared);
          }
        }
        continue;
      }
      if (cleared) {
        cleared.colour = colour;
        // Taken off above: drawn again, with every panel's hole.
        cleared.drawn = "";
      } else {
        page.boxes.set(node, {
          saved: BACKGROUND.map((property) => ({
            property,
            value: node.style.getPropertyValue(property),
            priority: node.style.getPropertyPriority(property),
          })),
          colour,
          holes: new Map(),
          drawn: "",
        });
      }
      boxes.push(node);
    }
    // A box this panel was in and is no longer.
    for (const box of this.boxes) {
      if (!boxes.includes(box)) this.leave(box);
    }
    this.boxes = boxes;
  }
}

/** Whether a computed colour paints anything. */
function paints(colour: string): boolean {
  if (!colour || colour === "transparent") return false;
  const alpha = /rgba?\(([^)]+)\)/.exec(colour)?.[1]?.split(/[\s,/]+/).filter(Boolean)[3];
  return alpha === undefined || Number.parseFloat(alpha) > 0;
}

type Layer = { image: string; position: string; size: string };

/**
 * A box's colour around `holes`, in the box's own pixels from the page's:
 * the box cut into rows at each hole's top and bottom, each row's colour
 * drawn between the holes across it, and a rounded piece at each corner a
 * panel rounds, filling what lies outside the curve.
 */
function around(area: PanelRect, holes: NonNullable<Hole>[], colour: string): Layer[] {
  const [boxX, boxY, width, height] = area;
  const local = holes.map((hole) => {
    const left = clamp(hole.rect[0] - boxX, 0, width);
    const top = clamp(hole.rect[1] - boxY, 0, height);
    return {
      left,
      top,
      right: clamp(hole.rect[0] + hole.rect[2] - boxX, left, width),
      bottom: clamp(hole.rect[1] + hole.rect[3] - boxY, top, height),
      radius: hole.radius,
      corners: hole.corners,
    };
  });
  const solid = `linear-gradient(${colour}, ${colour})`;
  const px = (value: number) => `${round(value)}px`;
  const layers: Layer[] = [];
  const add = (image: string, x: number, y: number, w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    layers.push({ image, position: `${px(x)} ${px(y)}`, size: `${px(w)} ${px(h)}` });
  };

  const edges = [...new Set([0, height, ...local.flatMap((hole) => [hole.top, hole.bottom])])].sort((a, b) => a - b);
  for (let row = 0; row + 1 < edges.length; row += 1) {
    const [top, bottom] = [edges[row], edges[row + 1]];
    if (bottom <= top) continue;
    const across = local
      .filter((hole) => hole.top < bottom && hole.bottom > top && hole.right > hole.left)
      .sort((a, b) => a.left - b.left);
    let x = 0;
    for (const hole of across) {
      add(solid, x, top, hole.left - x, bottom - top);
      x = Math.max(x, hole.right);
    }
    add(solid, x, top, width - x, bottom - top);
  }

  for (const hole of local) {
    const r = Math.min(hole.radius, (hole.right - hole.left) / 2, (hole.bottom - hole.top) / 2);
    if (r <= 0) continue;
    const corner = (at: string) =>
      `radial-gradient(circle at ${at}, transparent ${px(Math.max(0, r - 0.5))}, ${colour} ${px(r)})`;
    if (hole.corners & 1) add(corner("100% 100%"), hole.left, hole.top, r, r);
    if (hole.corners & 2) add(corner("0% 100%"), hole.right - r, hole.top, r, r);
    if (hole.corners & 4) add(corner("100% 0%"), hole.left, hole.bottom - r, r, r);
    if (hole.corners & 8) add(corner("0% 0%"), hole.right - r, hole.bottom - r, r, r);
  }
  return layers;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const round = (value: number) => Math.round(value * 100) / 100;

const toRect = (box: DOMRect): PanelRect => [box.left, box.top, box.width, box.height];

const intersect = (a: PanelRect, b: PanelRect): PanelRect => {
  const left = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const right = Math.min(a[0] + a[2], b[0] + b[2]);
  const bottom = Math.min(a[1] + a[3], b[1] + b[3]);
  return [left, top, Math.max(0, right - left), Math.max(0, bottom - top)];
};

/** The rounding of the clipping box whose corners are the panel's own. */
function roundedCorners(element: HTMLElement, clippers: HTMLElement[]) {
  const rect = element.getBoundingClientRect();
  const near = (a: number, b: number) => Math.abs(a - b) < 1.5;
  for (const box of [element, ...clippers]) {
    const edges = box.getBoundingClientRect();
    const style = window.getComputedStyle(box);
    const at = [
      [edges.left, edges.top, rect.left, rect.top, style.borderTopLeftRadius, 1],
      [edges.right, edges.top, rect.right, rect.top, style.borderTopRightRadius, 2],
      [edges.left, edges.bottom, rect.left, rect.bottom, style.borderBottomLeftRadius, 4],
      [edges.right, edges.bottom, rect.right, rect.bottom, style.borderBottomRightRadius, 8],
    ] as const;
    let corners = 0;
    let radius = 0;
    for (const [x, y, panelX, panelY, value, bit] of at) {
      const corner = Number.parseFloat(value) || 0;
      if (corner > 0 && near(x, panelX) && near(y, panelY)) {
        corners |= bit;
        radius = Math.max(radius, corner);
      }
    }
    if (corners) return { radius, corners };
  }
  return { radius: 0, corners: 0 };
}
