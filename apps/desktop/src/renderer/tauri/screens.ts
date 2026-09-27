/**
 * Screen Configuration: the audience and stage screens, the outputs they go
 * to, and the ones the operator adds. `src-tauri/src/commands/screens.rs`.
 */

import { useCallback, useEffect, useState } from "react";

export type ScreenGroup = "audience" | "stage";
export type StageLayout = "media" | "worship";
/** How the picture goes on its output: stretched to it, or fitted inside. */
export type OutputTarget = "full" | "fit";
export type ScreenSize = { width: number; height: number };

/** A connected display, as the core reports it: sizes in physical pixels. */
export type ScreenOutput = {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
};

export type ScreenInfo = {
  id: string;
  group: ScreenGroup;
  name: string;
  layout?: StageLayout;
  /** The size it is drawn at; absent for its output's own. */
  size?: ScreenSize;
  /** What is behind everything on it; absent for black. */
  color?: string;
  target: OutputTarget;
  builtIn: boolean;
  /** The output chosen, while connected. For the built-in three, `null` is Automatic. */
  displayId: number | null;
  /** An output was chosen and is not connected. */
  outputMissing: boolean;
  /** Where it goes right now. */
  output: ScreenOutput | null;
  open: boolean;
  window: string;
};

export type ScreenPatch = {
  name?: string;
  size?: ScreenSize | null;
  color?: string | null;
  target?: OutputTarget;
  layout?: StageLayout;
};

export const SCREENS_CHANGED_EVENT = "screens:changed";
export const IDENTIFY_EVENT = "screens:identify";

const inShell = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
};

export const getScreens = () => call<ScreenInfo[]>("get_screens");
export const addScreen = (group: ScreenGroup, displayId: number | null) =>
  call<string>("add_screen", { group, displayId });
export const updateScreen = (id: string, patch: ScreenPatch) => call<void>("update_screen", { id, patch });
export const removeScreen = (id: string) => call<boolean>("remove_screen", { id });
export const setScreenDisplay = (id: string, displayId: number | null) =>
  call<void>("set_screen_display", { id, displayId });
export const openScreen = (id: string) => call<boolean>("open_screen", { id });
export const closeScreen = (id: string) => call<boolean>("close_screen", { id });
export const identifyScreens = (mode: "screens" | "outputs") => call<number>("identify_screens", { mode });

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
