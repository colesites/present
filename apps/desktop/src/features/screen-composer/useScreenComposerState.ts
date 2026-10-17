import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "../../renderer/tauri/runtime";
import type {
  ScreenComposerLayout,
  ScreenComposerMediaType,
  ScreenComposerMode,
  ScreenComposerPreset,
  ScreenComposerRegion,
  ScreenComposerSource,
  ScreenComposerStore,
} from "./types";

const STORAGE_KEY = "present-screen-composer-v2";
const MAX_REGIONS = 24;
const MIN_REGION_SIZE_PERCENT = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function isSource(value: unknown): value is ScreenComposerSource {
  return (
    value === "video" ||
    value === "camera-feed" ||
    value === "countdown" ||
    value === "slides"
  );
}

function isMediaType(value: unknown): value is ScreenComposerMediaType {
  return value === "image" || value === "video";
}

function defaultTextForSource(source: ScreenComposerSource) {
  if (source === "countdown") {
    return "00:00:00";
  }
  if (source === "camera-feed") {
    return "Camera feed";
  }
  return "Type text content here";
}

function normalizeRegion(input: Partial<ScreenComposerRegion>): ScreenComposerRegion {
  const width = clamp(
    Number.isFinite(input.width) ? Number(input.width) : 100,
    MIN_REGION_SIZE_PERCENT,
    100,
  );
  const height = clamp(
    Number.isFinite(input.height) ? Number(input.height) : 100,
    MIN_REGION_SIZE_PERCENT,
    100,
  );
  const x = clamp(Number.isFinite(input.x) ? Number(input.x) : 0, 0, 100 - width);
  const y = clamp(Number.isFinite(input.y) ? Number(input.y) : 0, 0, 100 - height);
  const rawSource: string = typeof input.source === "string" ? input.source : "slides";
  const source =
    rawSource === "lyrics"
      ? "slides"
      : isSource(rawSource)
        ? rawSource
        : "slides";
  const fitMode =
    input.fitMode === "contain" ||
    input.fitMode === "fill" ||
    input.fitMode === "scale-down"
      ? input.fitMode
      : "cover";
  const padding = clamp(Number.isFinite(input.padding) ? Number(input.padding) : 0, 0, 40);
  const borderRadius = clamp(
    Number.isFinite(input.borderRadius) ? Number(input.borderRadius) : 0,
    0,
    80,
  );

  const textContent =
    typeof input.textContent === "string"
      ? input.textContent
      : defaultTextForSource(source);

  return {
    id: input.id ?? createId("region"),
    name:
      typeof input.name === "string" && input.name.trim().length > 0
        ? input.name.trim()
        : "Region",
    x: roundToTwo(x),
    y: roundToTwo(y),
    width: roundToTwo(width),
    height: roundToTwo(height),
    source,
    fitMode,
    backgroundColor:
      typeof input.backgroundColor === "string" && input.backgroundColor.trim().length > 0
        ? input.backgroundColor
        : "rgba(10, 13, 28, 0.7)",
    padding: roundToTwo(padding),
    borderRadius: roundToTwo(borderRadius),
    textContent,
    footerText: typeof input.footerText === "string" ? input.footerText : "",
    mediaUrl:
      typeof input.mediaUrl === "string" && input.mediaUrl.trim().length > 0
        ? input.mediaUrl
        : null,
    mediaType: isMediaType(input.mediaType) ? input.mediaType : null,
    mediaLabel:
      typeof input.mediaLabel === "string" && input.mediaLabel.trim().length > 0
        ? input.mediaLabel.trim()
        : null,
    backgroundMediaUrl:
      typeof input.backgroundMediaUrl === "string" && input.backgroundMediaUrl.trim().length > 0
        ? input.backgroundMediaUrl
        : null,
    backgroundMediaType: isMediaType(input.backgroundMediaType) ? input.backgroundMediaType : null,
    backgroundMediaLabel:
      typeof input.backgroundMediaLabel === "string" && input.backgroundMediaLabel.trim().length > 0
        ? input.backgroundMediaLabel.trim()
        : null,
    showTextLayer:
      typeof input.showTextLayer === "boolean" ? input.showTextLayer : source === "slides",
    showMediaLayer:
      typeof input.showMediaLayer === "boolean"
        ? input.showMediaLayer
        : source === "video",
    slideId: typeof input.slideId === "string" ? input.slideId : null,
    slideText: typeof input.slideText === "string" ? input.slideText : null,
    slideFooter: typeof input.slideFooter === "string" ? input.slideFooter : null,
    slideElements: Array.isArray(input.slideElements) ? input.slideElements : null,
    slideCanvasSize: typeof input.slideCanvasSize === "string" ? input.slideCanvasSize : null,
    slideBackgroundColor:
      typeof input.slideBackgroundColor === "string" ? input.slideBackgroundColor : null,
  };
}

function cloneRegion(region: ScreenComposerRegion): ScreenComposerRegion {
  return { ...region };
}

function cloneLayout(layout: ScreenComposerLayout): ScreenComposerLayout {
  return {
    ...layout,
    regions: layout.regions.map(cloneRegion),
  };
}

function createRegionsFromPreset(preset: ScreenComposerPreset): ScreenComposerRegion[] {
  if (preset === "split-vertical") {
    return [
      normalizeRegion({
        name: "Region 1",
        x: 0,
        y: 0,
        width: 50,
        height: 100,
        source: "slides",
        textContent: "Worthy is the Lamb",
        showTextLayer: true,
        showMediaLayer: false,
      }),
      normalizeRegion({
        name: "Region 2",
        x: 50,
        y: 0,
        width: 50,
        height: 100,
        source: "video",
        showTextLayer: false,
        showMediaLayer: true,
      }),
    ];
  }

  if (preset === "split-horizontal") {
    return [
      normalizeRegion({
        name: "Region 1",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        source: "slides",
        textContent: "Holy forever",
      }),
      normalizeRegion({
        name: "Region 2",
        x: 0,
        y: 50,
        width: 100,
        height: 50,
        source: "video",
        showMediaLayer: true,
        showTextLayer: false,
      }),
    ];
  }

  if (preset === "grid-3") {
    return [
      normalizeRegion({
        name: "Region 1",
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        source: "slides",
        textContent: "Verse one",
      }),
      normalizeRegion({
        name: "Region 2",
        x: 50,
        y: 0,
        width: 50,
        height: 50,
        source: "slides",
        textContent: "Verse two",
      }),
      normalizeRegion({
        name: "Region 3",
        x: 0,
        y: 50,
        width: 100,
        height: 50,
        source: "video",
        showMediaLayer: true,
        showTextLayer: true,
        textContent: "Lower third text",
      }),
    ];
  }

  if (preset === "grid-4") {
    return [
      normalizeRegion({ name: "Region 1", x: 0, y: 0, width: 50, height: 50, source: "video", showMediaLayer: true, showTextLayer: false }),
      normalizeRegion({ name: "Region 2", x: 50, y: 0, width: 50, height: 50, source: "video", showMediaLayer: true, showTextLayer: false }),
      normalizeRegion({ name: "Region 3", x: 0, y: 50, width: 50, height: 50, source: "slides", textContent: "Lower left text" }),
      normalizeRegion({ name: "Region 4", x: 50, y: 50, width: 50, height: 50, source: "slides", textContent: "Lower right text" }),
    ];
  }

  return [
    normalizeRegion({
      name: "Region 1",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      source: "slides",
      textContent: "Main region",
      showTextLayer: true,
      showMediaLayer: false,
    }),
  ];
}

function createLayout(name: string, preset: ScreenComposerPreset = "single"): ScreenComposerLayout {
  return {
    id: createId("layout"),
    name,
    allowOverlap: false,
    updatedAt: Date.now(),
    regions: createRegionsFromPreset(preset),
  };
}

function sanitizeLayout(layout: Partial<ScreenComposerLayout>): ScreenComposerLayout {
  const regions = Array.isArray(layout.regions)
    ? layout.regions.slice(0, MAX_REGIONS).map((region, index) =>
        normalizeRegion({
          ...region,
          name: region.name ?? `Region ${index + 1}`,
        }),
      )
    : createRegionsFromPreset("single");

  return {
    id: typeof layout.id === "string" && layout.id.length > 0 ? layout.id : createId("layout"),
    name:
      typeof layout.name === "string" && layout.name.trim().length > 0
        ? layout.name.trim()
        : "Layout",
    allowOverlap: Boolean(layout.allowOverlap),
    updatedAt:
      typeof layout.updatedAt === "number" && Number.isFinite(layout.updatedAt)
        ? layout.updatedAt
        : Date.now(),
    regions,
  };
}

function ensureStoreShape(input: unknown): ScreenComposerStore {
  const fallbackLayout = createLayout("Main", "single");

  if (!input || typeof input !== "object") {
    return {
      version: 2,
      enabled: false,
      mode: "edit",
      activeLayoutId: fallbackLayout.id,
      liveLayoutId: fallbackLayout.id,
      selectedRegionId: fallbackLayout.regions[0]?.id ?? null,
      layouts: [fallbackLayout],
      liveLayout: cloneLayout(fallbackLayout),
    };
  }

  const candidate = input as Partial<ScreenComposerStore>;
  const layouts = Array.isArray(candidate.layouts)
    ? candidate.layouts.slice(0, 40).map((layout) => sanitizeLayout(layout))
    : [fallbackLayout];
  const activeLayout = layouts.find((layout) => layout.id === candidate.activeLayoutId) ?? layouts[0];
  const liveLayout = candidate.liveLayout ? sanitizeLayout(candidate.liveLayout) : cloneLayout(activeLayout);
  const selectedRegionInActive = activeLayout.regions.some(
    (region) => region.id === candidate.selectedRegionId,
  )
    ? (candidate.selectedRegionId as string)
    : (activeLayout.regions[0]?.id ?? null);

  return {
    version: 2,
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : false,
    mode: candidate.mode === "live" ? "live" : "edit",
    activeLayoutId: activeLayout.id,
    liveLayoutId:
      typeof candidate.liveLayoutId === "string" && candidate.liveLayoutId.length > 0
        ? candidate.liveLayoutId
        : activeLayout.id,
    selectedRegionId: selectedRegionInActive,
    layouts,
    liveLayout,
  };
}

function loadStoredState(): ScreenComposerStore {
  if (typeof window === "undefined") {
    return ensureStoreShape(null);
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return ensureStoreShape(null);
    }
    return ensureStoreShape(JSON.parse(raw));
  } catch {
    return ensureStoreShape(null);
  }
}

function withUpdatedActiveLayout(
  store: ScreenComposerStore,
  updater: (layout: ScreenComposerLayout) => ScreenComposerLayout,
) {
  const activeLayoutIndex = store.layouts.findIndex((layout) => layout.id === store.activeLayoutId);
  if (activeLayoutIndex < 0) {
    return store;
  }

  const nextLayouts = [...store.layouts];
  nextLayouts[activeLayoutIndex] = updater(nextLayouts[activeLayoutIndex]);

  return {
    ...store,
    layouts: nextLayouts,
  };
}

function nextRegionName(regions: ScreenComposerRegion[]) {
  return `Region ${regions.length + 1}`;
}

/**
 * Sent to every window with the whole store when one of them changes it.
 *
 * The composer is edited in its own window, and the operator window is the
 * one that puts the layout on screen. Between them there was only
 * localStorage, read again on a timer and on focus, and a window in the
 * background is not given its timers on time: media chosen for a region
 * reached the screen when somebody next clicked into the operator window, or
 * did not seem to reach it at all. The same fix as Settings'
 * (`useAppSettings`).
 */
const COMPOSER_CHANGED_EVENT = "present:composer-changed";

/**
 * A drag changes the store on every pointer move. The first change goes at
 * once, so media chosen for a region is on screen straight away; the rest of
 * a burst goes as its latest, this often, rather than sixty whole stores a
 * second for the operator window to take in.
 */
const SEND_EVERY_MS = 100;

export function useScreenComposerState() {
  const initialStore = useMemo(() => loadStoredState(), []);
  const [store, setStore] = useState<ScreenComposerStore>(initialStore);
  const lastSerializedRef = useRef<string>(JSON.stringify(initialStore));
  const sending = useRef<{ timer: number | null; latest: string | null; sentAt: number }>({
    timer: null,
    latest: null,
    sentAt: 0,
  });

  const send = useCallback((serialized: string) => {
    const state = sending.current;
    const emitNow = (payload: string) => {
      state.sentAt = Date.now();
      void import("@tauri-apps/api/event")
        .then(({ emit }) => emit(COMPOSER_CHANGED_EVENT, payload))
        .catch((): void => undefined);
    };
    state.latest = serialized;
    if (state.timer !== null) return;
    const wait = SEND_EVERY_MS - (Date.now() - state.sentAt);
    if (wait <= 0) {
      state.latest = null;
      emitNow(serialized);
      return;
    }
    state.timer = window.setTimeout(() => {
      state.timer = null;
      const latest = state.latest;
      state.latest = null;
      if (latest !== null) emitNow(latest);
    }, wait);
  }, []);

  useEffect(
    () => () => {
      const state = sending.current;
      if (state.timer !== null) window.clearTimeout(state.timer);
    },
    [],
  );

  useEffect(() => {
    const serialized = JSON.stringify(store);
    if (serialized === lastSerializedRef.current) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // Ignore persistence failures; the other windows are still told.
    }
    lastSerializedRef.current = serialized;
    send(serialized);
  }, [send, store]);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>(COMPOSER_CHANGED_EVENT, ({ payload }) => {
          if (typeof payload !== "string" || payload === lastSerializedRef.current) return;
          try {
            const next = ensureStoreShape(JSON.parse(payload));
            // What this window will hold, so it is not written and sent back.
            lastSerializedRef.current = JSON.stringify(next);
            setStore(next);
          } catch {
            // A store this window cannot read stays out of it.
          }
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

  const syncFromStorage = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw || raw === lastSerializedRef.current) {
        return;
      }

      const next = ensureStoreShape(JSON.parse(raw));
      setStore(next);
      lastSerializedRef.current = raw;
    } catch {
      // Ignore sync failures.
    }
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) {
        return;
      }
      try {
        if (event.newValue === lastSerializedRef.current) {
          return;
        }
        const next = ensureStoreShape(JSON.parse(event.newValue));
        setStore(next);
        lastSerializedRef.current = event.newValue;
      } catch {
        // Ignore cross-window parse errors.
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", syncFromStorage);
    // In the desktop app every change arrives as `COMPOSER_CHANGED_EVENT`;
    // reading the store twice a second in every window is only for where it
    // cannot.
    const intervalId = isTauri() ? null : window.setInterval(syncFromStorage, 500);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", syncFromStorage);
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [syncFromStorage]);

  const activeLayout = useMemo(
    () => store.layouts.find((layout) => layout.id === store.activeLayoutId) ?? store.layouts[0],
    [store.activeLayoutId, store.layouts],
  );

  const selectedRegion = useMemo(
    () =>
      activeLayout?.regions.find((region) => region.id === store.selectedRegionId) ??
      activeLayout?.regions[0] ??
      null,
    [activeLayout, store.selectedRegionId],
  );

  const setMode = useCallback((mode: ScreenComposerMode) => {
    setStore((previous) => ({ ...previous, mode }));
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setStore((previous) => ({ ...previous, enabled }));
  }, []);

  const setActiveLayoutId = useCallback((layoutId: string) => {
    setStore((previous) => {
      const nextActiveLayout = previous.layouts.find((layout) => layout.id === layoutId);
      if (!nextActiveLayout) {
        return previous;
      }

      return {
        ...previous,
        activeLayoutId: layoutId,
        selectedRegionId: nextActiveLayout.regions[0]?.id ?? null,
      };
    });
  }, []);

  const setSelectedRegionId = useCallback((regionId: string | null) => {
    setStore((previous) => ({ ...previous, selectedRegionId: regionId }));
  }, []);

  const applyPresetToActiveLayout = useCallback((preset: ScreenComposerPreset) => {
    setStore((previous) =>
      withUpdatedActiveLayout(previous, (layout) => ({
        ...layout,
        regions: createRegionsFromPreset(preset),
        updatedAt: Date.now(),
      })),
    );

    setStore((previous) => {
      const currentActive = previous.layouts.find((layout) => layout.id === previous.activeLayoutId);
      return {
        ...previous,
        selectedRegionId: currentActive?.regions[0]?.id ?? null,
      };
    });
  }, []);

  const addRegion = useCallback(() => {
    setStore((previous) =>
      withUpdatedActiveLayout(previous, (layout) => {
        if (layout.regions.length >= MAX_REGIONS) {
          return layout;
        }

        const anchor = layout.regions.find((region) => region.id === previous.selectedRegionId);
        const baseRegion = anchor ?? layout.regions[layout.regions.length - 1];
        const nextRegion = normalizeRegion({
          name: nextRegionName(layout.regions),
          x: baseRegion ? baseRegion.x + 3 : 5,
          y: baseRegion ? baseRegion.y + 3 : 5,
          width: baseRegion ? baseRegion.width : 40,
          height: baseRegion ? baseRegion.height : 40,
          source: "slides",
          textContent: "New region",
        });

        return {
          ...layout,
          regions: [...layout.regions, nextRegion],
          updatedAt: Date.now(),
        };
      }),
    );

    setStore((previous) => {
      const currentActive = previous.layouts.find((layout) => layout.id === previous.activeLayoutId);
      const newest = currentActive?.regions[currentActive.regions.length - 1] ?? null;
      return {
        ...previous,
        selectedRegionId: newest?.id ?? previous.selectedRegionId,
      };
    });
  }, []);

  const duplicateRegion = useCallback((regionId: string) => {
    setStore((previous) =>
      withUpdatedActiveLayout(previous, (layout) => {
        if (layout.regions.length >= MAX_REGIONS) {
          return layout;
        }

        const target = layout.regions.find((region) => region.id === regionId);
        if (!target) {
          return layout;
        }

        const duplicate = normalizeRegion({
          ...target,
          id: createId("region"),
          name: `${target.name} Copy`,
          x: target.x + 2,
          y: target.y + 2,
        });

        return {
          ...layout,
          regions: [...layout.regions, duplicate],
          updatedAt: Date.now(),
        };
      }),
    );

    setStore((previous) => {
      const currentActive = previous.layouts.find((layout) => layout.id === previous.activeLayoutId);
      const newest = currentActive?.regions[currentActive.regions.length - 1] ?? null;
      return {
        ...previous,
        selectedRegionId: newest?.id ?? previous.selectedRegionId,
      };
    });
  }, []);

  const removeRegion = useCallback((regionId: string) => {
    setStore((previous) =>
      withUpdatedActiveLayout(previous, (layout) => {
        if (layout.regions.length <= 1) {
          return layout;
        }
        const nextRegions = layout.regions.filter((region) => region.id !== regionId);
        if (nextRegions.length === layout.regions.length) {
          return layout;
        }
        return {
          ...layout,
          regions: nextRegions,
          updatedAt: Date.now(),
        };
      }),
    );

    setStore((previous) => {
      const currentActive = previous.layouts.find((layout) => layout.id === previous.activeLayoutId);
      const hasSelected = currentActive?.regions.some(
        (region) => region.id === previous.selectedRegionId,
      );
      return {
        ...previous,
        selectedRegionId:
          hasSelected ? previous.selectedRegionId : (currentActive?.regions[0]?.id ?? null),
      };
    });
  }, []);

  const updateRegion = useCallback(
    (
      regionId: string,
      update: Partial<
        Pick<
          ScreenComposerRegion,
          | "x"
          | "y"
          | "width"
          | "height"
          | "source"
          | "fitMode"
          | "backgroundColor"
          | "padding"
          | "borderRadius"
          | "name"
          | "textContent"
          | "footerText"
          | "mediaUrl"
          | "mediaType"
          | "mediaLabel"
          | "showTextLayer"
          | "showMediaLayer"
          | "backgroundMediaUrl"
          | "backgroundMediaType"
          | "backgroundMediaLabel"
          | "slideId"
          | "slideText"
          | "slideFooter"
          | "slideElements"
          | "slideCanvasSize"
          | "slideBackgroundColor"
        >
      >,
      options?: {
        /**
         * Also on the layout on screen, if the region is in it: for what a
         * region shows (its media, the slide it follows), which the operator
         * expects to see at once. Its size, place and look are drafts until
         * Apply.
         */
        live?: boolean;
      },
    ) => {
      setStore((previous) => {
        const next = withUpdatedActiveLayout(previous, (layout) => {
          const nextRegions = layout.regions.map((region) =>
            region.id === regionId ? normalizeRegion({ ...region, ...update }) : region,
          );
          return {
            ...layout,
            regions: nextRegions,
            updatedAt: Date.now(),
          };
        });
        if (!options?.live || !next.liveLayout.regions.some((region) => region.id === regionId)) {
          return next;
        }
        return {
          ...next,
          liveLayout: {
            ...next.liveLayout,
            regions: next.liveLayout.regions.map((region) =>
              region.id === regionId ? normalizeRegion({ ...region, ...update }) : region,
            ),
            updatedAt: Date.now(),
          },
        };
      });
    },
    [],
  );

  /**
   * Move a region up or down the stack. Later regions are drawn over earlier
   * ones, on the screen as here, so the list order is the stacking order.
   */
  const moveRegion = useCallback(
    (regionId: string, to: "front" | "back" | "forward" | "backward") => {
      setStore((previous) =>
        withUpdatedActiveLayout(previous, (layout) => {
          const from = layout.regions.findIndex((region) => region.id === regionId);
          if (from < 0) return layout;
          const last = layout.regions.length - 1;
          const target =
            to === "front"
              ? last
              : to === "back"
                ? 0
                : to === "forward"
                  ? Math.min(from + 1, last)
                  : Math.max(from - 1, 0);
          if (target === from) return layout;
          const regions = [...layout.regions];
          const [moved] = regions.splice(from, 1);
          regions.splice(target, 0, moved);
          return { ...layout, regions, updatedAt: Date.now() };
        }),
      );
    },
    [],
  );

  const setAllowOverlap = useCallback((allowOverlap: boolean) => {
    setStore((previous) =>
      withUpdatedActiveLayout(previous, (layout) => ({
        ...layout,
        allowOverlap,
        updatedAt: Date.now(),
      })),
    );
  }, []);

  const createLayoutFromPreset = useCallback(
    (name: string, preset: ScreenComposerPreset = "single") => {
      setStore((previous) => {
        const nextLayout = createLayout(name.trim().length > 0 ? name.trim() : "New Layout", preset);
        return {
          ...previous,
          layouts: [...previous.layouts, nextLayout],
          activeLayoutId: nextLayout.id,
          selectedRegionId: nextLayout.regions[0]?.id ?? null,
        };
      });
    },
    [],
  );

  const renameLayout = useCallback((layoutId: string, name: string) => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      return;
    }
    setStore((previous) => ({
      ...previous,
      layouts: previous.layouts.map((layout) =>
        layout.id === layoutId
          ? {
              ...layout,
              name: normalizedName,
              updatedAt: Date.now(),
            }
          : layout,
      ),
    }));
  }, []);

  const saveActiveLayoutAs = useCallback((name: string) => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      return;
    }

    setStore((previous) => {
      const active = previous.layouts.find((layout) => layout.id === previous.activeLayoutId);
      if (!active) {
        return previous;
      }

      const copiedLayout: ScreenComposerLayout = {
        ...cloneLayout(active),
        id: createId("layout"),
        name: normalizedName,
        updatedAt: Date.now(),
        regions: active.regions.map((region, index) =>
          normalizeRegion({
            ...region,
            id: createId("region"),
            name: region.name || `Region ${index + 1}`,
          }),
        ),
      };

      return {
        ...previous,
        layouts: [...previous.layouts, copiedLayout],
        activeLayoutId: copiedLayout.id,
        selectedRegionId: copiedLayout.regions[0]?.id ?? null,
      };
    });
  }, []);

  const deleteLayout = useCallback((layoutId: string) => {
    setStore((previous) => {
      if (previous.layouts.length <= 1) {
        return previous;
      }

      const nextLayouts = previous.layouts.filter((layout) => layout.id !== layoutId);
      const nextActive = nextLayouts.find((layout) => layout.id === previous.activeLayoutId) ?? nextLayouts[0];
      const removedLive = previous.liveLayoutId === layoutId;
      const nextLive = removedLive ? cloneLayout(nextActive) : previous.liveLayout;

      return {
        ...previous,
        layouts: nextLayouts,
        activeLayoutId: nextActive.id,
        selectedRegionId: nextActive.regions[0]?.id ?? null,
        liveLayoutId: removedLive ? nextActive.id : previous.liveLayoutId,
        liveLayout: nextLive,
      };
    });
  }, []);

  const applyActiveLayoutToLive = useCallback(() => {
    setStore((previous) => {
      const current = previous.layouts.find((layout) => layout.id === previous.activeLayoutId);
      if (!current) {
        return previous;
      }
      return {
        ...previous,
        liveLayoutId: current.id,
        liveLayout: cloneLayout(current),
      };
    });
  }, []);

  const goLiveLayout = useCallback((layoutId: string) => {
    setStore((previous) => {
      const layout = previous.layouts.find((candidate) => candidate.id === layoutId);
      if (!layout) {
        return previous;
      }
      // Going live puts the layout on the screen. It used to copy the
      // layout and leave the output as it was until "Output enabled" was also
      // ticked, so the audience kept seeing the slide. The region being
      // worked on stays the one selected.
      const selectedStays = layout.regions.some((region) => region.id === previous.selectedRegionId);
      return {
        ...previous,
        enabled: true,
        activeLayoutId: layout.id,
        liveLayoutId: layout.id,
        selectedRegionId: selectedStays ? previous.selectedRegionId : (layout.regions[0]?.id ?? null),
        liveLayout: cloneLayout(layout),
      };
    });
  }, []);

  return {
    enabled: store.enabled,
    mode: store.mode,
    layouts: store.layouts,
    activeLayoutId: store.activeLayoutId,
    activeLayout,
    liveLayoutId: store.liveLayoutId,
    liveLayout: store.liveLayout,
    selectedRegionId: store.selectedRegionId,
    selectedRegion,
    setMode,
    setEnabled,
    setActiveLayoutId,
    setSelectedRegionId,
    applyPresetToActiveLayout,
    addRegion,
    duplicateRegion,
    removeRegion,
    updateRegion,
    setAllowOverlap,
    createLayoutFromPreset,
    saveActiveLayoutAs,
    renameLayout,
    deleteLayout,
    applyActiveLayoutToLive,
    goLiveLayout,
    moveRegion,
  };
}

export type ScreenComposerController = ReturnType<typeof useScreenComposerState>;
