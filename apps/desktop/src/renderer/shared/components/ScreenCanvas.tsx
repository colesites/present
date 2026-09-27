"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  blendWeight,
  cornerPinMatrix,
  DEFAULT_COLOR,
  ownOutputId,
  useOwnScreen,
  type BlendCurve,
  type ColorAdjust,
} from "../../tauri/screens";

/**
 * A screen's page drawn as Screen Configuration sets it, for this window's
 * output: the picture laid out at the screen's size, the part this output
 * shows of it (a grouped or blended screen's cell), placed on its target,
 * faded where it meets its neighbour, colour-adjusted and corner-pinned. The
 * native audience view does the same to its frames (`screen_picture.rs`);
 * this is it for a page.
 *
 * The page inside fills the picture's box (`h-full w-full`, and `cqw` rather
 * than `vw`), and takes its background from `--present-screen-color`.
 *
 * `effects` off leaves out the fade and the colour: for an audience page
 * whose frames are already drawn natively under it, with only the props it
 * draws itself on top.
 */
export function ScreenCanvas({ children, effects = true }: { children: ReactNode; effects?: boolean }) {
  const screen = useOwnScreen();
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1920 : window.innerWidth,
    height: typeof window === "undefined" ? 1080 : window.innerHeight,
    ratio: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  }));
  useEffect(() => {
    const measure = () =>
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
        ratio: window.devicePixelRatio || 1,
      });
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const output = useMemo(() => {
    const id = ownOutputId();
    return screen?.outputs.find((each) => each.id === id) ?? null;
  }, [screen]);
  const colour = { "--present-screen-color": screen?.color || "#000000" } as CSSProperties;

  const geometry = output?.geometry;
  if (!screen || !output || !geometry) {
    return (
      <div className="h-screen w-screen overflow-hidden [container-type:size]" style={colour}>
        {children}
      </div>
    );
  }

  // Everything in this window's CSS pixels: the output's own pixels are
  // `ratio` of them.
  const ratio = viewport.ratio;
  const [areaX, areaY, areaWidth, areaHeight] = geometry.target
    ? geometry.target.map((value) => value / ratio)
    : [0, 0, viewport.width, viewport.height];
  const [sourceX, sourceY, sourceWidth, sourceHeight] = geometry.source;
  const canvasWidth = screen.canvas[0] / ratio;
  const canvasHeight = screen.canvas[1] / ratio;
  // The part of the picture this output shows, stretched to its area.
  const across = areaWidth / Math.max(1, sourceWidth * canvasWidth);
  const down = areaHeight / Math.max(1, sourceHeight * canvasHeight);
  const offsetX = -sourceX * canvasWidth * across;
  const offsetY = -sourceY * canvasHeight * down;

  const pin = cornerPinMatrix(areaWidth, areaHeight, {
    topLeft: [output.corners.topLeft[0] / ratio, output.corners.topLeft[1] / ratio],
    topRight: [output.corners.topRight[0] / ratio, output.corners.topRight[1] / ratio],
    bottomRight: [output.corners.bottomRight[0] / ratio, output.corners.bottomRight[1] / ratio],
    bottomLeft: [output.corners.bottomLeft[0] / ratio, output.corners.bottomLeft[1] / ratio],
  });
  const color = effects ? output.color : DEFAULT_COLOR;

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div
        className="absolute overflow-hidden"
        style={{
          left: areaX,
          top: areaY,
          width: areaWidth,
          height: areaHeight,
          transformOrigin: "0 0",
          transform: pin ? `matrix3d(${pin.join(",")})` : undefined,
          filter: cssFilter(color),
        }}
      >
        <div
          className="absolute left-0 top-0 overflow-hidden [container-type:size]"
          style={{
            ...colour,
            width: canvasWidth,
            height: canvasHeight,
            transformOrigin: "0 0",
            transform: `translate(${offsetX}px, ${offsetY}px) scale(${across}, ${down})`,
          }}
        >
          {children}
        </div>
        {effects && color.blackLevel > 0 ? (
          // Black lifted: white over everything at that much, which is
          // `in·(1−b) + b` exactly.
          <div className="pointer-events-none absolute inset-0 bg-white" style={{ opacity: color.blackLevel }} />
        ) : null}
        {effects && geometry.blendLeft > 0 ? (
          <BlendEdge side="left" width={geometry.blendLeft} curve={geometry.curve} />
        ) : null}
        {effects && geometry.blendRight > 0 ? (
          <BlendEdge side="right" width={geometry.blendRight} curve={geometry.curve} />
        ) : null}
      </div>
    </div>
  );
}

/** CSS for an output's colour adjustments, or nothing when there are none. */
function cssFilter(color: ColorAdjust): string | undefined {
  const parts = [
    color.brightness !== 1 ? `brightness(${color.brightness})` : "",
    color.contrast !== 1 ? `contrast(${color.contrast})` : "",
    color.saturation !== 1 ? `saturate(${color.saturation})` : "",
    color.hue !== 0 ? `hue-rotate(${color.hue}deg)` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * The fade where an output meets its neighbour: black over the picture,
 * opaque at the outer edge and gone where the overlap ends, along the curve.
 */
function BlendEdge({ side, width, curve }: { side: "left" | "right"; width: number; curve: BlendCurve }) {
  const stops = Array.from({ length: 11 }, (_, index) => {
    const t = index / 10;
    return `rgba(0,0,0,${(1 - blendWeight(curve, t)).toFixed(3)}) ${(t * 100).toFixed(0)}%`;
  });
  return (
    <div
      className="pointer-events-none absolute inset-y-0"
      style={{
        [side]: 0,
        width: `${width * 100}%`,
        background: `linear-gradient(to ${side === "left" ? "right" : "left"}, ${stops.join(", ")})`,
      }}
    />
  );
}
