import type { SlideFill, SlidePaint } from "../../../shared/types";

/**
 * Painting a shape's `fill` on a canvas and as CSS, the two ways slides are
 * drawn in the app. Both follow `compositor/fill.rs`, which draws the same
 * fill on the NDI and native outputs.
 */

/** A colour as the same colour at another opacity, for soft edges. */
export function withAlpha(color: string, alpha: number): string {
  const text = color.trim();
  const hex = text.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  let channels: [number, number, number] | null = null;
  let baseAlpha = 1;
  if (hex && (hex.length === 3 || hex.length === 4)) {
    channels = [0, 1, 2].map((index) => parseInt(hex[index] + hex[index], 16)) as [number, number, number];
    if (hex.length === 4) baseAlpha = parseInt(hex[3] + hex[3], 16) / 255;
  } else if (hex && (hex.length === 6 || hex.length === 8)) {
    channels = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
    if (hex.length === 8) baseAlpha = parseInt(hex.slice(6, 8), 16) / 255;
  } else {
    const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
    if (rgb) {
      channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
      if (rgb[4]) baseAlpha = rgb[4].endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
    }
  }
  if (!channels) return alpha <= 0 ? "rgba(0,0,0,0)" : text;
  const value = Math.max(0, Math.min(1, baseAlpha * alpha));
  return `rgba(${channels.join(",")},${Math.round(value * 1000) / 1000})`;
}

/** Where a gradient at `angle` degrees starts and ends across a box. */
export function gradientLine(angle: number, width: number, height: number) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const half = (width * Math.abs(dx) + height * Math.abs(dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return { x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half };
}

/** The one colour for a renderer, or a fallback, that paints only colours. */
export function plainFillColor(fill: SlidePaint): string {
  switch (fill.kind) {
    case "color":
      return fill.color;
    case "gradient":
      return fill.from;
    case "mix":
      return fill.base;
    default:
      return fill.stops[0]?.color ?? "transparent";
  }
}

/**
 * Paint the current path of `ctx` (a shape of `width` by `height` at the
 * origin) with the fill. The caller has built the path.
 */
export function paintFill(
  ctx: CanvasRenderingContext2D,
  fill: SlidePaint,
  width: number,
  height: number,
  path?: Path2D,
) {
  const fillPath = () => (path ? ctx.fill(path) : ctx.fill());
  if (fill.kind === "color") {
    ctx.fillStyle = fill.color;
    fillPath();
    return;
  }
  if (fill.kind === "linear" || fill.kind === "radial") {
    const stops = fill.stops.length > 0 ? fill.stops : [{ offset: 0, color: "transparent" }];
    let gradient: CanvasGradient;
    if (fill.kind === "linear") {
      const { x1, y1, x2, y2 } = gradientLine(fill.angle, width, height);
      gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    } else {
      const cx = fill.cx * width;
      const cy = fill.cy * height;
      // Out to the farthest corner, as the compositor draws it.
      const radius = Math.max(
        1,
        ...[
          [0, 0],
          [width, 0],
          [0, height],
          [width, height],
        ].map(([x, y]) => Math.hypot(x - cx, y - cy)),
      );
      gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    }
    for (const stop of stops) {
      gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
    }
    ctx.fillStyle = gradient;
    fillPath();
    return;
  }
  if (fill.kind === "gradient") {
    const { x1, y1, x2, y2 } = gradientLine(fill.angle, width, height);
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    gradient.addColorStop(0, fill.from);
    gradient.addColorStop(1, fill.to);
    ctx.fillStyle = gradient;
    fillPath();
    return;
  }
  ctx.fillStyle = fill.base;
  fillPath();
  const longer = Math.max(width, height);
  for (const spot of fill.spots.slice(0, 8)) {
    const radius = Math.max(1, Math.min(4, Math.max(0, spot.size)) * longer);
    const cx = spot.x * width;
    const cy = spot.y * height;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, spot.color);
    gradient.addColorStop(1, withAlpha(spot.color, 0));
    ctx.fillStyle = gradient;
    fillPath();
  }
}

/** The fill as a CSS `background`, for a box of `width` by `height`. */
export function fillToCss(fill: SlidePaint, width: number, height: number): string {
  if (fill.kind === "color") return fill.color;
  if (fill.kind === "linear" || fill.kind === "radial") {
    const stops = fill.stops.map((stop) => `${stop.color} ${stop.offset * 100}%`).join(", ");
    return fill.kind === "linear"
      ? `linear-gradient(${fill.angle + 90}deg, ${stops})`
      : `radial-gradient(farthest-corner at ${fill.cx * 100}% ${fill.cy * 100}%, ${stops})`;
  }
  if (fill.kind === "gradient") {
    // CSS measures its angle from "up", clockwise; the fill from "right".
    return `linear-gradient(${fill.angle + 90}deg, ${fill.from}, ${fill.to})`;
  }
  const longer = Math.max(width, height, 1);
  const spots = fill.spots.slice(0, 8).map((spot) => {
    const radius = Math.max(0, spot.size) * longer;
    const rx = (radius / Math.max(width, 1)) * 100;
    const ry = (radius / Math.max(height, 1)) * 100;
    return `radial-gradient(${rx}% ${ry}% at ${spot.x * 100}% ${spot.y * 100}%, ${spot.color}, ${withAlpha(spot.color, 0)})`;
  });
  return [...spots, fill.base].join(", ");
}

/**
 * A fill the editors can change: an imported gradient of many stops as a
 * gradient between its first and last.
 */
export function editableFill(fill: SlidePaint | null | undefined): SlideFill | null {
  if (!fill) return null;
  if (fill.kind === "linear" || fill.kind === "radial") {
    const first = fill.stops[0]?.color ?? "#000000";
    const last = fill.stops[fill.stops.length - 1]?.color ?? first;
    return { kind: "gradient", from: first, to: last, angle: fill.kind === "linear" ? fill.angle : 90 };
  }
  return fill;
}

/** A fill read from a style, if it is one this build knows. */
export function readFill(value: unknown): SlidePaint | null {
  if (!value || typeof value !== "object") return null;
  const fill = value as Record<string, unknown>;
  const text = (key: string) => (typeof fill[key] === "string" ? (fill[key] as string) : null);
  const color = text("color");
  const from = text("from");
  const to = text("to");
  const base = text("base");
  if (fill.kind === "color" && color) return { kind: "color", color };
  if (fill.kind === "gradient" && from && to) {
    return { kind: "gradient", from, to, angle: Number(fill.angle) || 0 };
  }
  if ((fill.kind === "linear" || fill.kind === "radial") && Array.isArray(fill.stops)) {
    const stops = (fill.stops as unknown[])
      .filter((stop): stop is Record<string, unknown> => Boolean(stop) && typeof stop === "object")
      .filter((stop) => typeof stop.color === "string")
      .map((stop) => ({ offset: Number(stop.offset) || 0, color: stop.color as string }));
    if (stops.length === 0) return null;
    return fill.kind === "linear"
      ? { kind: "linear", angle: Number(fill.angle) || 0, stops }
      : {
          kind: "radial",
          cx: Number.isFinite(Number(fill.cx)) ? Number(fill.cx) : 0.5,
          cy: Number.isFinite(Number(fill.cy)) ? Number(fill.cy) : 0.5,
          stops,
        };
  }
  if (fill.kind === "mix" && base && Array.isArray(fill.spots)) {
    return {
      kind: "mix",
      base,
      spots: (fill.spots as unknown[])
        .filter((spot): spot is Record<string, unknown> => Boolean(spot) && typeof spot === "object")
        .filter((spot) => typeof spot.color === "string")
        .map((spot) => ({
          color: spot.color as string,
          x: Number(spot.x) || 0,
          y: Number(spot.y) || 0,
          size: Number(spot.size) || 0,
        })),
    };
  }
  return null;
}
