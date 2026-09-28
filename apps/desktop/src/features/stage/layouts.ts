"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Stage layouts: what a stage screen shows, as objects placed on a canvas,
 * as ProPresenter's stage layouts are. The media stage and the worship stage
 * are two of them, and can be changed like any other; new ones start blank
 * or from a template.
 *
 * Kept in this webview's storage and sent to every window when one changes
 * (the same way as the Screen Composer's store): the editor edits them, and
 * each stage screen draws the one its screen in Screen Configuration names.
 */

export type StageObjectKind =
  | "text"
  | "shape"
  | "current-text"
  | "next-text"
  | "current-slide"
  | "section"
  | "next-section"
  | "clock"
  | "timer"
  | "timer-label";

export type StageObjectStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  uppercase: boolean;
  /** Shrink the words to fit the box, from `fontSize` down. */
  fit: boolean;
  background: string | null;
  borderColor: string | null;
  borderWidth: number;
  radius: number;
  padding: number;
};

export type StageObject = {
  id: string;
  kind: StageObjectKind;
  /** In the layout's pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** A text object's words. */
  text?: string;
  shape?: "rectangle" | "ellipse";
  /** A small title in the box, like "Next Slide". `{timer}` is the timer's name. */
  caption?: string | null;
  clock?: { hours24: boolean; seconds: boolean };
  style: StageObjectStyle;
};

export type StageLayout = {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Behind everything; `null` for the screen's colour. */
  background: string | null;
  objects: StageObject[];
};

export const MEDIA_LAYOUT = "media";
export const WORSHIP_LAYOUT = "worship";
export const BUILT_IN_LAYOUTS = [MEDIA_LAYOUT, WORSHIP_LAYOUT];

export const OBJECT_KINDS: Array<{ kind: StageObjectKind; label: string; description: string }> = [
  { kind: "current-text", label: "Current Slide Text", description: "The words on screen now." },
  { kind: "next-text", label: "Next Slide Text", description: "The words coming next." },
  { kind: "current-slide", label: "Current Slide", description: "The slide as the room sees it, with its media." },
  { kind: "section", label: "Section", description: "Where the song is: [Chorus], [x2]." },
  { kind: "next-section", label: "Next Section", description: "The section coming next." },
  { kind: "timer", label: "Timer", description: "The live timer." },
  { kind: "timer-label", label: "Timer Name", description: "The live timer's name." },
  { kind: "clock", label: "Clock", description: "The time of day." },
  { kind: "text", label: "Text", description: "Words of your own." },
  { kind: "shape", label: "Shape", description: "A box or a circle." },
];

export const DEFAULT_STYLE: StageObjectStyle = {
  fontFamily: "Inter",
  fontSize: 60,
  fontWeight: "600",
  color: "#ffffff",
  align: "center",
  valign: "middle",
  uppercase: false,
  fit: true,
  background: null,
  borderColor: null,
  borderWidth: 0,
  radius: 0,
  padding: 16,
};

let idCount = 0;
export const newObjectId = () => {
  idCount += 1;
  return `obj-${Date.now().toString(36)}-${idCount}`;
};
export const newLayoutId = () => `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const card = {
  background: "rgba(0, 0, 0, 0.8)",
  borderColor: "rgba(161, 161, 170, 0.7)",
  borderWidth: 2,
  radius: 16,
  padding: 24,
};

/** A new object of `kind`, placed and styled as that kind usually is. */
export function objectOf(kind: StageObjectKind, at: { x: number; y: number; width: number; height: number }): StageObject {
  const base: StageObject = { id: newObjectId(), kind, ...at, style: { ...DEFAULT_STYLE } };
  switch (kind) {
    case "text":
      return { ...base, text: "Text", style: { ...base.style, fontSize: 48 } };
    case "shape":
      return {
        ...base,
        shape: "rectangle",
        style: { ...base.style, background: "rgba(255, 255, 255, 0.12)", radius: 12 },
      };
    case "current-text":
      return {
        ...base,
        caption: "Current Slide",
        style: { ...base.style, ...card, align: "left", valign: "top", fontWeight: "500", color: "#f4f4f5" },
      };
    case "next-text":
      return {
        ...base,
        caption: "Next Slide",
        style: {
          ...base.style,
          ...card,
          borderColor: "rgba(252, 211, 77, 0.7)",
          align: "left",
          valign: "top",
          fontWeight: "500",
          color: "#fcd34d",
        },
      };
    case "current-slide":
      return { ...base, style: { ...base.style, padding: 0 } };
    case "section":
    case "next-section":
      return {
        ...base,
        style: {
          ...base.style,
          fontSize: 56,
          fontWeight: "900",
          uppercase: true,
          align: "left",
          color: kind === "section" ? "#e0f2fe" : "#fde68a",
          fit: false,
          padding: 0,
        },
      };
    case "clock":
      return {
        ...base,
        caption: "Clock",
        clock: { hours24: false, seconds: true },
        style: { ...base.style, ...card, radius: 10, fontWeight: "500", color: "#d4d4d8" },
      };
    case "timer":
      return {
        ...base,
        caption: "{timer}",
        style: { ...base.style, ...card, radius: 10, fontWeight: "500", color: "#e35f4a" },
      };
    case "timer-label":
      return { ...base, style: { ...base.style, fontSize: 40, uppercase: true, color: "#a1a1aa" } };
  }
}

const place = (kind: StageObjectKind, x: number, y: number, width: number, height: number, change: Partial<StageObject> = {}) => ({
  ...objectOf(kind, { x, y, width, height }),
  ...change,
});

/** The media stage as it always looked: the slides above, the timer and the clock below. */
export function mediaLayout(): StageLayout {
  return {
    id: MEDIA_LAYOUT,
    name: "Media stage",
    width: 1920,
    height: 1080,
    background: null,
    objects: [
      place("current-text", 40, 40, 908, 760),
      place("next-text", 972, 40, 908, 760),
      place("timer", 40, 824, 908, 216),
      place("clock", 972, 824, 908, 216),
    ],
  };
}

/** The worship stage as it always looked: the slide over its media, the section above. */
export function worshipLayout(): StageLayout {
  return {
    id: WORSHIP_LAYOUT,
    name: "Worship stage",
    width: 1920,
    height: 1080,
    background: null,
    objects: [
      place("current-slide", 0, 0, 1920, 1080),
      place("section", 40, 40, 1840, 110, {
        style: {
          ...DEFAULT_STYLE,
          fontSize: 60,
          fontWeight: "900",
          uppercase: true,
          align: "left",
          valign: "top",
          color: "#e0f2fe",
          fit: false,
          padding: 0,
          background: null,
        },
      }),
    ],
  };
}

export const TEMPLATES: Array<{ id: string; name: string; description: string; make: () => Omit<StageLayout, "id"> }> = [
  { id: "blank", name: "Blank", description: "Nothing on it yet.", make: () => ({ name: "Blank", width: 1920, height: 1080, background: null, objects: [] }) },
  {
    id: "current-next",
    name: "Current + Next Text",
    description: "Current words large, next ones under them, the timer and the clock along the bottom.",
    make: () => ({
      name: "Current + Next Text",
      width: 1920,
      height: 1080,
      background: null,
      objects: [
        place("current-text", 40, 30, 1840, 520, { caption: null, style: { ...objectOf("current-text", { x: 0, y: 0, width: 0, height: 0 }).style, background: null, borderWidth: 0, fontSize: 110, align: "left" } }),
        place("next-text", 40, 570, 1840, 300, { caption: null, style: { ...objectOf("next-text", { x: 0, y: 0, width: 0, height: 0 }).style, background: null, borderWidth: 0, borderColor: "rgba(252, 211, 77, 0.5)", fontSize: 80, align: "left" } }),
        place("timer", 40, 890, 580, 160),
        place("clock", 670, 890, 580, 160),
        place("section", 1300, 890, 580, 160, { style: { ...DEFAULT_STYLE, fontSize: 48, fontWeight: "900", uppercase: true, align: "right", color: "#e0f2fe", fit: true, padding: 0 } }),
      ],
    }),
  },
  { id: "media", name: "Media desk", description: "The media stage: current and next slides, the timer, the clock.", make: () => ({ ...mediaLayout(), name: "Media desk" }) },
  { id: "worship", name: "Words for the band", description: "The worship stage: the slide as the room sees it, with its section.", make: () => ({ ...worshipLayout(), name: "Words for the band" }) },
  {
    id: "current-timers",
    name: "Current + Timers",
    description: "The current words, with a large timer and the clock.",
    make: () => ({
      name: "Current + Timers",
      width: 1920,
      height: 1080,
      background: null,
      objects: [
        place("current-text", 40, 40, 1840, 620),
        place("timer", 40, 690, 1200, 350, { style: { ...objectOf("timer", { x: 0, y: 0, width: 0, height: 0 }).style, fontSize: 220 } }),
        place("clock", 1270, 690, 610, 350, { style: { ...objectOf("clock", { x: 0, y: 0, width: 0, height: 0 }).style, fontSize: 110 } }),
      ],
    }),
  },
  {
    id: "clock",
    name: "System Clock",
    description: "The time, filling the screen.",
    make: () => ({
      name: "System Clock",
      width: 1920,
      height: 1080,
      background: null,
      objects: [place("clock", 160, 290, 1600, 500, { caption: null, style: { ...DEFAULT_STYLE, fontSize: 320, fontWeight: "600", color: "#ffffff" } })],
    }),
  },
  {
    id: "timer",
    name: "Timer",
    description: "The live timer, filling the screen, with its name.",
    make: () => ({
      name: "Timer",
      width: 1920,
      height: 1080,
      background: null,
      objects: [
        place("timer-label", 160, 170, 1600, 140),
        place("timer", 160, 330, 1600, 520, { caption: null, style: { ...DEFAULT_STYLE, fontSize: 380, fontWeight: "700", color: "#ffffff" } }),
      ],
    }),
  },
];

const STORAGE_KEY = "present-stage-layouts-v1";
const CHANGED_EVENT = "present:stage-layouts-changed";

/** Which layout the editor should show, when another window opens it. */
const EDITOR_LAYOUT_KEY = "present-stage-editor-layout";
export const EDITOR_LAYOUT_EVENT = "present:stage-editor-layout";

/** Ask the Stage Layouts window for `layout`: as it opens, or if it is open. */
export function askEditorFor(layout: string) {
  try {
    window.localStorage.setItem(EDITOR_LAYOUT_KEY, layout);
  } catch {
    // The window still opens, on the first layout.
  }
  void import("@tauri-apps/api/event")
    .then(({ emitTo }) => emitTo("stage-editor", EDITOR_LAYOUT_EVENT, layout))
    .catch((): void => undefined);
}

/** The layout the editor was asked for as it opened, taken once. */
export function takeEditorLayout(): string | null {
  try {
    const asked = window.localStorage.getItem(EDITOR_LAYOUT_KEY);
    window.localStorage.removeItem(EDITOR_LAYOUT_KEY);
    return asked;
  } catch {
    return null;
  }
}

const isLayout = (value: unknown): value is StageLayout => {
  if (!value || typeof value !== "object") return false;
  const layout = value as Partial<StageLayout>;
  return typeof layout.id === "string" && typeof layout.name === "string" && Array.isArray(layout.objects);
};

const sanitize = (layout: StageLayout): StageLayout => ({
  ...layout,
  width: Math.min(Math.max(Math.round(layout.width) || 1920, 320), 7680),
  height: Math.min(Math.max(Math.round(layout.height) || 1080, 240), 4320),
  objects: layout.objects
    .filter((object) => object && typeof object.id === "string" && typeof object.kind === "string")
    .map((object) => ({ ...object, style: { ...DEFAULT_STYLE, ...object.style } })),
});

/** Every layout: the two built in (as changed, or as they start), then the rest. */
export function readLayouts(raw: string | null): StageLayout[] {
  let stored: StageLayout[] = [];
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    stored = Array.isArray(parsed) ? parsed.filter(isLayout).map(sanitize) : [];
  } catch {
    stored = [];
  }
  const media = stored.find((layout) => layout.id === MEDIA_LAYOUT) ?? mediaLayout();
  const worship = stored.find((layout) => layout.id === WORSHIP_LAYOUT) ?? worshipLayout();
  const rest = stored.filter((layout) => !BUILT_IN_LAYOUTS.includes(layout.id));
  return [media, worship, ...rest];
}

const readStored = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/** Every stage layout, kept current across windows, and the ways to change them. */
export function useStageLayouts() {
  const [layouts, setLayouts] = useState<StageLayout[]>(() => readLayouts(readStored()));
  const lastRef = useRef<string>(JSON.stringify(layouts));
  const currentRef = useRef(layouts);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;
    const take = (raw: string | null) => {
      if (raw === null || raw === lastRef.current) return;
      lastRef.current = raw;
      const next = readLayouts(raw);
      currentRef.current = next;
      setLayouts(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) take(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen<string>(CHANGED_EVENT, ({ payload }) => take(payload)))
      .then((unlisten) => {
        if (cancelled) unlisten();
        else detach = unlisten;
      })
      .catch((): void => undefined);
    return () => {
      cancelled = true;
      detach?.();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const commit = useCallback((next: StageLayout[]) => {
    const raw = JSON.stringify(next);
    lastRef.current = raw;
    currentRef.current = next;
    setLayouts(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      // The other windows are still told.
    }
    void import("@tauri-apps/api/event")
      .then(({ emit }) => emit(CHANGED_EVENT, raw))
      .catch((): void => undefined);
  }, []);

  const save = useCallback(
    (layout: StageLayout) => {
      const current = currentRef.current;
      const clean = sanitize(layout);
      commit(
        current.some((each) => each.id === layout.id)
          ? current.map((each) => (each.id === layout.id ? clean : each))
          : [...current, clean],
      );
    },
    [commit],
  );

  /** Take a layout away; one of the two built in goes back to how it started. */
  const remove = useCallback(
    (id: string) => {
      const current = currentRef.current;
      commit(
        id === MEDIA_LAYOUT
          ? current.map((each) => (each.id === id ? mediaLayout() : each))
          : id === WORSHIP_LAYOUT
            ? current.map((each) => (each.id === id ? worshipLayout() : each))
            : current.filter((each) => each.id !== id),
      );
    },
    [commit],
  );

  return { layouts, save, remove };
}
