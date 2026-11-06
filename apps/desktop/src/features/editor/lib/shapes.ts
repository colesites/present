/**
 * Shapes in the editor: the shapes it can draw, and keeping a shape's
 * outline paths (`geometry`) in step with its box.
 *
 * Paths are SVG path data in the element's own canvas pixels from its
 * top-left, absolute `M L C Q Z` only: what both renderers read
 * (`CanvasSlideLayer`, `compositor/paths.rs`).
 *
 * No imports but types, so the tests can load this file on its own.
 */
import type {
  SlideElement,
  SlideGeometry,
  SlideLine,
  SlideShapePreset,
} from "../../../shared/types";

export const SHAPE_PRESETS: Array<{ value: SlideShapePreset; label: string }> = [
  { value: "rect", label: "Rectangle" },
  { value: "roundRect", label: "Rounded rectangle" },
  { value: "ellipse", label: "Oval" },
  { value: "triangle", label: "Triangle" },
  { value: "rightTriangle", label: "Right triangle" },
  { value: "diamond", label: "Diamond" },
  { value: "pentagon", label: "Pentagon" },
  { value: "hexagon", label: "Hexagon" },
  { value: "star", label: "Star" },
  { value: "arrow", label: "Arrow" },
  { value: "chevron", label: "Chevron" },
  { value: "line", label: "Line" },
];

/** A quarter circle's control-point distance, as a fraction of its radius. */
const KAPPA = 0.5522847498;

const n = (value: number) => {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

const polygon = (points: Array<[number, number]>) =>
  `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${n(x)} ${n(y)}`).join(" ")} Z`;

/** A regular polygon or star fitted to the box: `count` points from the top. */
function radial(count: number, w: number, h: number, inner?: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const steps = inner === undefined ? count : count * 2;
  for (let index = 0; index < steps; index += 1) {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / steps;
    const r = inner !== undefined && index % 2 === 1 ? inner : 1;
    points.push([Math.cos(angle) * r, Math.sin(angle) * r]);
  }
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return points.map(([x, y]) => [((x - minX) / (maxX - minX)) * w, ((y - minY) / (maxY - minY)) * h]);
}

function roundedRect(w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return polygon([[0, 0], [w, 0], [w, h], [0, h]]);
  const k = r * KAPPA;
  return [
    `M ${n(r)} 0`,
    `L ${n(w - r)} 0`,
    `C ${n(w - r + k)} 0 ${n(w)} ${n(r - k)} ${n(w)} ${n(r)}`,
    `L ${n(w)} ${n(h - r)}`,
    `C ${n(w)} ${n(h - r + k)} ${n(w - r + k)} ${n(h)} ${n(w - r)} ${n(h)}`,
    `L ${n(r)} ${n(h)}`,
    `C ${n(r - k)} ${n(h)} 0 ${n(h - r + k)} 0 ${n(h - r)}`,
    `L 0 ${n(r)}`,
    `C 0 ${n(r - k)} ${n(r - k)} 0 ${n(r)} 0`,
    "Z",
  ].join(" ");
}

function ellipse(w: number, h: number): string {
  const [rx, ry] = [w / 2, h / 2];
  const [kx, ky] = [rx * KAPPA, ry * KAPPA];
  return [
    `M ${n(rx)} 0`,
    `C ${n(rx + kx)} 0 ${n(w)} ${n(ry - ky)} ${n(w)} ${n(ry)}`,
    `C ${n(w)} ${n(ry + ky)} ${n(rx + kx)} ${n(h)} ${n(rx)} ${n(h)}`,
    `C ${n(rx - kx)} ${n(h)} 0 ${n(ry + ky)} 0 ${n(ry)}`,
    `C 0 ${n(ry - ky)} ${n(rx - kx)} 0 ${n(rx)} 0`,
    "Z",
  ].join(" ");
}

/** A preset shape's paths at this size. */
export function presetGeometry(
  preset: SlideShapePreset,
  width: number,
  height: number,
  radius = 0,
): SlideGeometry {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  // A rounded rectangle made without a radius starts with a gentle one.
  const corner = preset === "roundRect" && radius <= 0 ? Math.round(Math.min(w, h) * 0.15) : radius;
  const geometry = (d: string, extra: { fill?: boolean } = {}): SlideGeometry => ({
    preset,
    ...(preset === "rect" || preset === "roundRect" ? { radius: corner } : {}),
    paths: [{ d, ...extra }],
  });
  switch (preset) {
    case "rect":
    case "roundRect":
      return geometry(roundedRect(w, h, corner));
    case "ellipse":
      return geometry(ellipse(w, h));
    case "triangle":
      return geometry(polygon([[w / 2, 0], [w, h], [0, h]]));
    case "rightTriangle":
      return geometry(polygon([[0, 0], [w, h], [0, h]]));
    case "diamond":
      return geometry(polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]));
    case "pentagon":
      return geometry(polygon(radial(5, w, h)));
    case "hexagon":
      return geometry(polygon([[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]]));
    case "star":
      return geometry(polygon(radial(5, w, h, 0.382)));
    case "arrow": {
      const head = Math.min(w * 0.45, h);
      return geometry(
        polygon([[0, h * 0.25], [w - head, h * 0.25], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h * 0.75], [0, h * 0.75]]),
      );
    }
    case "chevron": {
      const point = Math.min(w * 0.4, h / 2);
      return geometry(polygon([[0, 0], [w - point, 0], [w, h / 2], [w - point, h], [0, h], [point, h / 2]]));
    }
    case "line":
      return geometry(`M 0 ${n(h / 2)} L ${n(w)} ${n(h / 2)}`, { fill: false });
  }
}

/** How many numbers each path command takes, and which of them are x or y. */
const COMMAND_AXES: Record<string, Array<"x" | "y" | "-">> = {
  M: ["x", "y"],
  L: ["x", "y"],
  T: ["x", "y"],
  H: ["x"],
  V: ["y"],
  C: ["x", "y", "x", "y", "x", "y"],
  S: ["x", "y", "x", "y"],
  Q: ["x", "y", "x", "y"],
  // Radii, rotation, two flags, then the end point.
  A: ["x", "y", "-", "-", "-", "x", "y"],
  Z: [],
};

/** Path data stretched by `sx` across and `sy` down, from the top-left. */
export function scalePathData(d: string, sx: number, sy: number): string {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  let axes: Array<"x" | "y" | "-"> = [];
  let index = 0;
  for (const token of tokens) {
    if (/^[a-zA-Z]$/.test(token)) {
      axes = COMMAND_AXES[token.toUpperCase()] ?? [];
      index = 0;
      out.push(token);
      continue;
    }
    const value = Number(token);
    const axis = axes.length > 0 ? axes[index % axes.length] : "-";
    index += 1;
    out.push(n(axis === "x" ? value * sx : axis === "y" ? value * sy : value));
  }
  return out.join(" ");
}

/**
 * A shape whose box changed size, with its paths changed to fit: a shape
 * made here drawn again (its corners stay round), an imported one
 * stretched, as PowerPoint and Keynote stretch one.
 */
export function fitGeometryToBox(previous: SlideElement, next: SlideElement): SlideElement {
  const geometry = next.geometry;
  if (!geometry || geometry !== previous.geometry) return next;
  if (next.width === previous.width && next.height === previous.height) return next;
  if (geometry.preset) {
    return { ...next, geometry: presetGeometry(geometry.preset, next.width, next.height, geometry.radius ?? 0) };
  }
  const sx = previous.width > 0 ? next.width / previous.width : 1;
  const sy = previous.height > 0 ? next.height / previous.height : 1;
  return {
    ...next,
    geometry: { ...geometry, paths: geometry.paths.map((path) => ({ ...path, d: scalePathData(path.d, sx, sy) })) },
  };
}

export type OutlineStyle = "solid" | "dashed" | "dotted";

export type ShapeOutline = { color: string; width: number; style: OutlineStyle };

const dashFor = (style: OutlineStyle, width: number): number[] =>
  style === "dashed" ? [width * 3, width * 2] : style === "dotted" ? [0.01, width * 2] : [];

const styleOfDash = (line: SlideLine): OutlineStyle => {
  const first = line.dash?.[0];
  if (first === undefined) return "solid";
  return first < line.width * 0.5 ? "dotted" : "dashed";
};

/** A shape's outline, wherever it keeps it. */
export function shapeOutline(element: SlideElement): ShapeOutline {
  const style = element.style ?? {};
  if (element.geometry) {
    const line = style.line;
    return line
      ? { color: line.color, width: line.width, style: styleOfDash(line) }
      : { color: "#000000", width: 0, style: "solid" };
  }
  return { color: style.borderColor ?? "#000000", width: style.borderWidth ?? 0, style: "solid" };
}

/**
 * A plain box (a shape made before shapes had paths) as a rectangle with
 * paths, so it takes an outline style, a corner and a shape like any other.
 */
export function withGeometry(element: SlideElement): SlideElement {
  if (element.geometry) return element;
  const style = { ...(element.style ?? {}) };
  const radius = style.borderRadius ?? 0;
  const line: SlideLine | undefined =
    (style.borderWidth ?? 0) > 0 && style.borderColor
      ? { color: style.borderColor, width: style.borderWidth ?? 0 }
      : style.line;
  delete style.borderColor;
  delete style.borderWidth;
  delete style.borderRadius;
  return {
    ...element,
    geometry: presetGeometry(radius > 0 ? "roundRect" : "rect", element.width, element.height, radius),
    style: { ...style, ...(line ? { line } : {}) },
  };
}

/** The shape with a new outline: colour, width or style. */
export function withShapeOutline(element: SlideElement, patch: Partial<ShapeOutline>): SlideElement {
  const shaped = withGeometry(element);
  const current = shapeOutline(shaped);
  const next = { ...current, ...patch };
  const style = { ...(shaped.style ?? {}) };
  if (next.width <= 0) {
    delete style.line;
    return { ...shaped, style };
  }
  const line: SlideLine = {
    ...(style.line ?? {}),
    color: next.color,
    width: next.width,
    dash: dashFor(next.style, next.width),
    cap: next.style === "dotted" ? "round" : style.line?.cap,
  };
  if (!line.cap) delete line.cap;
  return { ...shaped, style: { ...style, line } };
}

/** Another shape in the same box, keeping its fill and outline. */
export function withShapePreset(element: SlideElement, preset: SlideShapePreset): SlideElement {
  const shaped = withGeometry(element);
  const radius = shaped.geometry?.radius ?? 0;
  const next: SlideElement = {
    ...shaped,
    geometry: presetGeometry(preset, shaped.width, shaped.height, preset === "roundRect" || preset === "rect" ? radius : 0),
  };
  // A line is all outline: give it one if it has none.
  if (preset === "line" && !(next.style?.line && next.style.line.width > 0)) {
    const color = next.style?.backgroundColor && next.style.backgroundColor !== "transparent" ? next.style.backgroundColor : "#ffffff";
    return withShapeOutline(next, { color, width: 8, style: "solid" });
  }
  return next;
}

/** Whether the corner radius means anything for this shape. */
export function hasCorners(element: SlideElement): boolean {
  if (!element.geometry) return true;
  return element.geometry.preset === "rect" || element.geometry.preset === "roundRect";
}

export function cornerRadius(element: SlideElement): number {
  if (!element.geometry) return element.style?.borderRadius ?? 0;
  return element.geometry.radius ?? 0;
}

/** The shape with rounder or squarer corners. */
export function withCornerRadius(element: SlideElement, radius: number): SlideElement {
  if (!element.geometry) {
    return { ...element, style: { ...(element.style ?? {}), borderRadius: radius } };
  }
  if (!hasCorners(element)) return element;
  return {
    ...element,
    geometry: presetGeometry(radius > 0 ? "roundRect" : "rect", element.width, element.height, radius),
  };
}
