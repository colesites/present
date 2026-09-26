import type { SlideFill } from "../../../shared/types";

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
export function plainFillColor(fill: SlideFill): string {
  return fill.kind === "color" ? fill.color : fill.kind === "gradient" ? fill.from : fill.base;
}

/**
 * Paint the current path of `ctx` (a shape of `width` by `height` at the
 * origin) with the fill. The caller has built the path.
 */
export function paintFill(ctx: CanvasRenderingContext2D, fill: SlideFill, width: number, height: number) {
  if (fill.kind === "color") {
    ctx.fillStyle = fill.color;
    ctx.fill();
    return;
  }
  if (fill.kind === "gradient") {
    const { x1, y1, x2, y2 } = gradientLine(fill.angle, width, height);
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    gradient.addColorStop(0, fill.from);
    gradient.addColorStop(1, fill.to);
    ctx.fillStyle = gradient;
    ctx.fill();
    return;
  }
  ctx.fillStyle = fill.base;
  ctx.fill();
  const longer = Math.max(width, height);
  for (const spot of fill.spots.slice(0, 8)) {
    const radius = Math.max(1, Math.min(4, Math.max(0, spot.size)) * longer);
    const cx = spot.x * width;
    const cy = spot.y * height;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, spot.color);
    gradient.addColorStop(1, withAlpha(spot.color, 0));
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}

/** The fill as a CSS `background`, for a box of `width` by `height`. */
export function fillToCss(fill: SlideFill, width: number, height: number): string {
  if (fill.kind === "color") return fill.color;
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

/** A fill read from a style, if it is one this build knows. */
export function readFill(value: unknown): SlideFill | null {
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
