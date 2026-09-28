/**
 * Screen Configuration: the audience and stage screens, the outputs they go
 * to, and the ones the operator adds. `src-tauri/src/commands/screens.rs`.
 */

import { useCallback, useEffect, useState } from "react";

export type ScreenGroup = "audience" | "stage";
export type ScreenType = "single" | "mirror" | "grouped" | "edge-blend";
export type OutputKind = "display" | "ndi";
/** Where the picture goes on its output: the whole of it, or a rectangle in its pixels. */
export type OutputTarget =
  | { kind: "full" }
  | { kind: "custom"; x: number; y: number; width: number; height: number };
export type ColorAdjust = {
  brightness: number;
  contrast: number;
  saturation: number;
  /** Degrees. */
  hue: number;
  blackLevel: number;
};
/** How far each corner moves, in the output's pixels. */
export type CornerPin = {
  topLeft: [number, number];
  topRight: [number, number];
  bottomRight: [number, number];
  bottomLeft: [number, number];
};
export type BlendCurve = "linear" | "cubic" | "quadratic";
export type ScreenSize = { width: number; height: number };

/** A connected display, as the core reports it: sizes in physical pixels. */
export type ScreenOutput = {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
};

/** What part of the screen's picture an output shows, and where. */
export type OutputGeometry = {
  /** x, y, width, height, as fractions of the picture. */
  source: [number, number, number, number];
  /** In the output's pixels; `null` for all of it. */
  target: [number, number, number, number] | null;
  blendLeft: number;
  blendRight: number;
  curve: BlendCurve;
};

export type OutputInfo = {
  id: string;
  kind: OutputKind;
  ndiName?: string;
  target: OutputTarget;
  color: ColorAdjust;
  corners: CornerPin;
  /** The display chosen, while connected. For a built-in screen's first output, `null` is Automatic. */
  displayId: number | null;
  outputMissing: boolean;
  /** Where it goes right now. */
  display: ScreenOutput | null;
  open: boolean;
  /** Part of the screen as its type has it. */
  inUse: boolean;
  window: string | null;
  geometry: OutputGeometry | null;
  ndiSource: string | null;
};

export type ScreenInfo = {
  id: string;
  group: ScreenGroup;
  name: string;
  layout: string | null;
  /** What is behind everything on it; `null` for black. */
  color: string | null;
  screenType: ScreenType;
  grid: { columns: number };
  blend: { overlap: number; curve: BlendCurve };
  builtIn: boolean;
  /** The picture's size, in output pixels. */
  canvas: [number, number];
  open: boolean;
  outputs: OutputInfo[];
};

export type ScreenPatch = {
  name?: string;
  color?: string | null;
  layout?: string;
  screenType?: ScreenType;
  grid?: { columns: number };
  blend?: { overlap: number; curve: BlendCurve };
};

export type OutputPatch = {
  kind?: OutputKind;
  ndiName?: string | null;
  target?: OutputTarget;
  color?: ColorAdjust;
  corners?: CornerPin;
};

export const DEFAULT_COLOR: ColorAdjust = { brightness: 1, contrast: 1, saturation: 1, hue: 0, blackLevel: 0 };
export const DEFAULT_CORNERS: CornerPin = {
  topLeft: [0, 0],
  topRight: [0, 0],
  bottomRight: [0, 0],
  bottomLeft: [0, 0],
};

export const SCREENS_CHANGED_EVENT = "screens:changed";
export const IDENTIFY_EVENT = "screens:identify";
/** A display's mode changed, was kept, or was taken back. */
export const DISPLAY_MODE_EVENT = "display-mode:changed";

/** One mode a connected display can be put in. `src-tauri/src/services/display_modes.rs`. */
export type DisplayMode = {
  id: string;
  /** The desktop's size, in points. */
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  /** Hertz; 0 when the display does not say. */
  refreshRate: number;
  current: boolean;
};
export type DisplayModeChange = { displayId: number; waiting: boolean; reverted: boolean };

const inShell = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
};

export const getScreens = () => call<ScreenInfo[]>("get_screens");
export const addScreen = (group: ScreenGroup, displayId: number | null, ndi = false) =>
  call<string>("add_screen", { group, displayId, ndi });
export const updateScreen = (id: string, patch: ScreenPatch) => call<void>("update_screen", { id, patch });
export const removeScreen = (id: string) => call<boolean>("remove_screen", { id });
export const addOutput = (id: string, kind: OutputKind, displayId: number | null) =>
  call<string>("add_output", { id, kind, displayId });
export const removeOutput = (id: string, output: string) => call<void>("remove_output", { id, output });
export const updateOutput = (id: string, output: string, patch: OutputPatch) =>
  call<void>("update_output", { id, output, patch });
export const setOutputDisplay = (id: string, output: string, displayId: number | null) =>
  call<void>("set_output_display", { id, output, displayId });
export const openScreen = (id: string) => call<boolean>("open_screen", { id });
export const closeScreen = (id: string) => call<void>("close_screen", { id });
export const identifyScreens = (mode: "screens" | "outputs") => call<number>("identify_screens", { mode });
export const getDisplayModes = (displayId: number) => call<DisplayMode[]>("get_display_modes", { displayId });
/** Resolves to the seconds before the display goes back unless kept; 0 when nothing changed. */
export const setDisplayMode = (displayId: number, modeId: string) =>
  call<number>("set_display_mode", { displayId, modeId });
export const keepDisplayMode = (displayId: number) => call<void>("keep_display_mode", { displayId });
export const revertDisplayMode = (displayId: number) => call<void>("revert_display_mode", { displayId });

/** The logical size of an output: what a screen at its own size is drawn at. */
export const ownSize = (output: ScreenOutput): ScreenSize => {
  const scale = output.scaleFactor > 0 ? output.scaleFactor : 1;
  return {
    width: Math.round(output.bounds.width / scale),
    height: Math.round(output.bounds.height / scale),
  };
};

/**
 * Every screen, kept current: on each change the core announces, and asked
 * again now and then so a window closed some other way shows as off.
 */
export function useScreens(pollMs = 2_500) {
  const [screens, setScreens] = useState<ScreenInfo[] | null>(null);
  const refresh = useCallback(async () => {
    if (!inShell()) {
      setScreens((previous) => previous ?? []);
      return;
    }
    try {
      setScreens(await getScreens());
    } catch (error) {
      console.error("[Screens] could not read the screens", error);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!inShell()) return;
    let cancelled = false;
    let detach: (() => void) | null = null;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<ScreenInfo[]>(SCREENS_CHANGED_EVENT, ({ payload }) => {
          if (Array.isArray(payload)) setScreens(payload);
        }),
      )
      .then((unlisten) => {
        if (cancelled) unlisten();
        else detach = unlisten;
      })
      .catch((): void => undefined);
    const intervalId = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => {
      cancelled = true;
      detach?.();
      window.clearInterval(intervalId);
    };
  }, [pollMs, refresh]);

  return { screens, refresh };
}

/** Which screen this window is: `?screen=` for an added one, else by its page. */
export const ownScreenId = (): string | null => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const screen = params.get("screen");
  if (screen) return screen;
  const page = params.get("window");
  if (page === "media-stage") return "media";
  if (page === "worship-stage") return "worship";
  if (window.location.pathname.endsWith("output.html")) return "audience";
  return null;
};

/** Which of its screen's outputs this window is: `?output=`, or the first. */
export const ownOutputId = (): string => {
  if (typeof window === "undefined") return "main";
  return new URLSearchParams(window.location.search).get("output") || "main";
};

/**
 * The transform that moves a `width` by `height` box's corners by `pin`, as
 * CSS `matrix3d` numbers, origin at the top left: `corner_pin_matrix` in
 * `services/screens.rs`. `null` when nothing moves or the corners fold over.
 */
export function cornerPinMatrix(width: number, height: number, pin: CornerPin): number[] | null {
  const moved = [pin.topLeft, pin.topRight, pin.bottomRight, pin.bottomLeft].some(([x, y]) => x !== 0 || y !== 0);
  if (!moved || width <= 0 || height <= 0) return null;
  const [x0, y0] = [pin.topLeft[0], pin.topLeft[1]];
  const [x1, y1] = [width + pin.topRight[0], pin.topRight[1]];
  const [x2, y2] = [width + pin.bottomRight[0], height + pin.bottomRight[1]];
  const [x3, y3] = [pin.bottomLeft[0], height + pin.bottomLeft[1]];
  const [dx1, dx2, dx3] = [x1 - x2, x3 - x2, x0 - x1 + x2 - x3];
  const [dy1, dy2, dy3] = [y1 - y2, y3 - y2, y0 - y1 + y2 - y3];
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(determinant) < 1e-9) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  const a = (x1 - x0 + g * x1) / width;
  const b = (x3 - x0 + h * x3) / height;
  const d = (y1 - y0 + g * y1) / width;
  const e = (y3 - y0 + h * y3) / height;
  return [a, d, 0, g / width, b, e, 0, h / height, 0, 0, 1, 0, x0, y0, 0, 1];
}

/** How much of the picture shows at `t` across a blended edge: `BlendCurve::weight`. */
export function blendWeight(curve: BlendCurve, t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  if (curve === "linear") return x;
  if (curve === "cubic") return x * x * (3 - 2 * x);
  return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
}

/** This window's own screen, kept current. Asked once and then told. */
export function useOwnScreen(): ScreenInfo | null {
  const [screen, setScreen] = useState<ScreenInfo | null>(null);
  useEffect(() => {
    const id = ownScreenId();
    if (!id || !inShell()) return;
    let cancelled = false;
    let detach: (() => void) | null = null;
    const pick = (screens: ScreenInfo[]) => {
      if (!cancelled) setScreen(screens.find((each) => each.id === id) ?? null);
    };
    void getScreens()
      .then(pick)
      .catch((): void => undefined);
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<ScreenInfo[]>(SCREENS_CHANGED_EVENT, ({ payload }) => {
          if (Array.isArray(payload)) pick(payload);
        }),
      )
      .then((unlisten) => {
        if (cancelled) unlisten();
        else detach = unlisten;
      })
      .catch((): void => undefined);
    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);
  return screen;
}
