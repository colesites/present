"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useOwnScreen } from "../../tauri/screens";

/**
 * A screen's page drawn as Screen Configuration sets it: at the screen's own
 * size, scaled to the window, stretched to it or fitted inside it, with the
 * screen's colour behind. At the output's own size it simply fills the window.
 *
 * The page inside fills this box (`h-full w-full`), and takes its background
 * from `--present-screen-color`, so the screen's colour shows through it.
 */
export function ScreenCanvas({ children }: { children: ReactNode }) {
  const screen = useOwnScreen();
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1920 : window.innerWidth,
    height: typeof window === "undefined" ? 1080 : window.innerHeight,
  }));
  useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const colour = { "--present-screen-color": screen?.color || "#000000" } as React.CSSProperties;
  const size = screen?.size;
  if (!size || size.width <= 0 || size.height <= 0) {
    return (
      <div className="h-screen w-screen overflow-hidden" style={colour}>
        {children}
      </div>
    );
  }

  const across = viewport.width / size.width;
  const down = viewport.height / size.height;
  const fitted = screen.target === "fit";
  const scale = Math.min(across, down);
  const transform = fitted
    ? `translate(${(viewport.width - size.width * scale) / 2}px, ${(viewport.height - size.height * scale) / 2}px) scale(${scale})`
    : `scale(${across}, ${down})`;
  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <div
        className="overflow-hidden"
        style={{ ...colour, width: size.width, height: size.height, transform, transformOrigin: "0 0" }}
      >
        {children}
      </div>
    </div>
  );
}
