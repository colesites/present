// @ts-check

/**
 * Moving and resizing the boxes in the theme designer, and snapping them to
 * the slide's edges, middle and safe margins, and to each other.
 *
 * Frames are fractions of the slide, as looks keep them.
 */

/**
 * @typedef {import("./theme-look.mjs").ThemeFrame} Frame
 * @typedef {"move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"} DragMode
 * @typedef {{ axis: "x" | "y", at: number }} Guide
 */

/** The smallest a box can be made, as a fraction of the slide. */
export const MIN_SIZE = 0.04;

/** Where boxes snap on the slide: its edges, the safe margins and the middle. */
const SLIDE_LINES = [0, 0.05, 0.5, 0.95, 1];

/** @param {number} value */
const round4 = (value) => Math.round(value * 10_000) / 10_000;

/**
 * A frame moved or resized by `dx`, `dy` (fractions of the slide) from where
 * the drag began.
 *
 * @param {Frame} origin
 * @param {DragMode} mode
 * @param {number} dx
 * @param {number} dy
 * @returns {Frame}
 */
export function dragFrame(origin, mode, dx, dy) {
  let { x, y, width, height } = origin;
  if (mode === "move") {
    x += dx;
    y += dy;
  } else {
    if (mode.includes("e")) width = Math.max(MIN_SIZE, origin.width + dx);
    if (mode.includes("s")) height = Math.max(MIN_SIZE, origin.height + dy);
    if (mode.includes("w")) {
      const right = origin.x + origin.width;
      x = Math.min(right - MIN_SIZE, origin.x + dx);
      width = right - x;
    }
    if (mode.includes("n")) {
      const bottom = origin.y + origin.height;
      y = Math.min(bottom - MIN_SIZE, origin.y + dy);
      height = bottom - y;
    }
  }
  width = Math.min(1.2, width);
  height = Math.min(1.2, height);
  x = Math.min(1 - MIN_SIZE, Math.max(-width + MIN_SIZE, x));
  y = Math.min(1 - MIN_SIZE, Math.max(-height + MIN_SIZE, y));
  return { x: round4(x), y: round4(y), width: round4(width), height: round4(height) };
}

/**
 * The frame snapped to the nearest line within `threshold` (fractions of the
 * slide across and down), and the lines it met, to draw as guides. Only the
 * edges a drag moves snap: all three lines of a moving box, one edge of a
 * resized one.
 *
 * @param {Frame} frame
 * @param {DragMode} mode
 * @param {Frame[]} others
 * @param {{ x: number, y: number }} threshold
 * @returns {{ frame: Frame, guides: Guide[] }}
 */
export function snapFrame(frame, mode, others, threshold) {
  const lines = {
    x: [...SLIDE_LINES, ...others.flatMap((other) => [other.x, other.x + other.width / 2, other.x + other.width])],
    y: [...SLIDE_LINES, ...others.flatMap((other) => [other.y, other.y + other.height / 2, other.y + other.height])],
  };
  /** @type {Guide[]} */
  const guides = [];
  let { x, y, width, height } = frame;

  /**
   * @param {"x" | "y"} axis
   * @param {number[]} edges the frame's edges on that axis that may snap
   * @returns {{ delta: number, at: number } | null}
   */
  const nearest = (axis, edges) => {
    /** @type {{ delta: number, at: number } | null} */
    let best = null;
    for (const edge of edges) {
      for (const line of lines[axis]) {
        const delta = line - edge;
        if (Math.abs(delta) <= threshold[axis] && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, at: line };
        }
      }
    }
    return best;
  };

  if (mode === "move") {
    const across = nearest("x", [x, x + width / 2, x + width]);
    if (across) {
      x += across.delta;
      guides.push({ axis: "x", at: across.at });
    }
    const down = nearest("y", [y, y + height / 2, y + height]);
    if (down) {
      y += down.delta;
      guides.push({ axis: "y", at: down.at });
    }
  } else {
    if (mode.includes("e")) {
      const hit = nearest("x", [x + width]);
      if (hit && width + hit.delta >= MIN_SIZE) {
        width += hit.delta;
        guides.push({ axis: "x", at: hit.at });
      }
    }
    if (mode.includes("w")) {
      const hit = nearest("x", [x]);
      if (hit && width - hit.delta >= MIN_SIZE) {
        x += hit.delta;
        width -= hit.delta;
        guides.push({ axis: "x", at: hit.at });
      }
    }
    if (mode.includes("s")) {
      const hit = nearest("y", [y + height]);
      if (hit && height + hit.delta >= MIN_SIZE) {
        height += hit.delta;
        guides.push({ axis: "y", at: hit.at });
      }
    }
    if (mode.includes("n")) {
      const hit = nearest("y", [y]);
      if (hit && height - hit.delta >= MIN_SIZE) {
        y += hit.delta;
        height -= hit.delta;
        guides.push({ axis: "y", at: hit.at });
      }
    }
  }
  return { frame: { x: round4(x), y: round4(y), width: round4(width), height: round4(height) }, guides };
}

/**
 * A frame nudged by the arrow keys: a step of half a percent, or five with
 * Shift.
 *
 * @param {Frame} frame
 * @param {string} key
 * @param {boolean} large
 * @returns {Frame | null}
 */
export function nudgeFrame(frame, key, large) {
  const step = large ? 0.05 : 0.005;
  const moves = /** @type {Record<string, [number, number]>} */ ({
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  });
  const move = moves[key];
  return move ? dragFrame(frame, "move", move[0], move[1]) : null;
}
