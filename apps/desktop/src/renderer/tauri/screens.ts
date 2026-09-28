/**
 * Screen Configuration: the audience and stage screens, the outputs they go
 * to, and the ones the operator adds. `src-tauri/src/commands/screens.rs`.
 */

import { useCallback, useEffect, useState } from "react";

export type ScreenGroup = "audience" | "stage";
export type ScreenType = "single" | "mirror" | "grouped" | "edge-blend";
export type OutputKind = "display" | "ndi" | "syphon" | "sdi" | "placeholder";
/** Drawn by Present and sent, rather than a window on a display. */
export const isStream = (kind: OutputKind) => kind === "ndi" || kind === "syphon" || kind === "sdi";
/** Where the picture goes on its output: the whole of it, or a rectangle in its pixels. */
export type OutputTarget =
  | { kind: "full" }
  | { kind: "custom"; x: number; y: number; width: number; height: number }
  /** One part of the output cut into equal parts, counted across then down. */
  | { kind: "split"; columns: number; rows: number; cell: number };
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
  /** An NDI source's or a Syphon server's name, as the operator set it. */
  sourceName?: string;
  /** An SDI output's DeckLink device, by its persistent id. */
  device?: string;
  /** An NDI or SDI output's video mode, by its code. */
  videoMode?: string;
  /** An NDI output's custom size, a Syphon server's or a placeholder's. */
  size?: [number, number];
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
  /** What receivers see it as, for an NDI source or a Syphon server. */
  source: string | null;
  /** Why it could not start, the last time it was turned on. */
  error: string | null;
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
  sourceName?: string | null;
  device?: string | null;
  videoMode?: string | null;
  size?: [number, number] | null;
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

const inShell = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
};

export const getScreens = () => call<ScreenInfo[]>("get_screens");
/** A screen with its first output on a display, or sent as `kind`. */
export const addScreen = (group: ScreenGroup, displayId: number | null, kind: OutputKind = "display") =>
  call<string>("add_screen", { group, displayId, kind });
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

/** What Present can send a screen to here. `src-tauri/src/commands/screens.rs`. */
export type StreamOutputs = {
  syphon: boolean;
  /** Blackmagic Desktop Video is installed. */
  sdi: boolean;
  sdiDevices: Array<{ id: string; name: string }>;
  sdiModes: VideoMode[];
  /** The modes an NDI output is offered. */
  ndiModes: VideoMode[];
};

export type VideoMode = { code: string; label: string; width: number; height: number };

const NO_STREAMS: StreamOutputs = { syphon: false, sdi: false, sdiDevices: [], sdiModes: [], ndiModes: [] };

/** What a sent output or a placeholder is made at, as `stream_size` in `services/screens.rs` has it. */
export const outputSize = (output: OutputInfo, streams: StreamOutputs): [number, number] => {
  const mode = (modes: VideoMode[], fallback: string) => {
    const found = modes.find((each) => each.code === (output.videoMode ?? fallback)) ?? modes.find((each) => each.code === fallback);
    return found ? ([found.width, found.height] as [number, number]) : null;
  };
  if (output.kind === "display" && output.display) return [output.display.bounds.width, output.display.bounds.height];
  if (output.kind === "sdi") return mode(streams.sdiModes, "Hp29") ?? [1920, 1080];
  if (output.kind === "ndi") return output.size ?? mode(streams.ndiModes, "Hp30") ?? [1920, 1080];
  return output.size ?? [1920, 1080];
};

/** Syphon, and SDI with its devices and modes: asked once, and again every few seconds for a card plugged in. */
export function useStreamOutputs(pollMs = 5_000): StreamOutputs {
  const [outputs, setOutputs] = useState<StreamOutputs>(NO_STREAMS);
  useEffect(() => {
    if (!inShell()) return;
    let cancelled = false;
    const read = () => {
      call<StreamOutputs>("get_stream_outputs")
        .then((next) => {
          if (!cancelled) setOutputs((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
        })
        .catch((error: unknown) => console.error("[Screens] could not read the stream outputs", error));
    };
    read();
    const intervalId = window.setInterval(read, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [pollMs]);
  return outputs;
}

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
