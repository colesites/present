import { userMessage } from "../shared/lib/user-error";
import { useEffect } from "react";
import { toast } from "sonner";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type {
  BottomTab,
  LibraryItem,
  SidebarTab,
  ViewMode,
} from "../../shared/types";
import type { MediaItem } from "../../features/media/hooks/useMediaFolders";
import type { SlideData } from "../../features/slides";
import type { UseTimersResult } from "../shared/hooks";
import { useGlobalSearchStore } from "../shared/store/globalSearchStore";
import { useSidebarTabStore } from "../shared/store/sidebarTab";
import { aiOperatorBus } from "./operatorBus";
import type { AiToolCall, AiToolResult } from "../../shared/ai-operator/types";

type BooleanStateSetter = (value: boolean | ((previous: boolean) => boolean)) => void;
type RegisteredToolHandler = (call: AiToolCall) => Promise<AiToolResult> | AiToolResult;

interface UsePresentAiToolProviderProps {
  libraryItems: LibraryItem[];
  slidesForGrid: SlideData[];
  selected: { libraryId: string | null; index: number } | null;
  allMediaItems: MediaItem[];
  selectedServiceId: Id<"services"> | null;
  setSelectedLibraryId: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setBottomTab: (tab: BottomTab) => void;
  setShowTextInOutput: (show: boolean) => void;
  showTextInOutput: boolean;
  setShowMediaInOutput: (show: boolean) => void;
  showMediaInOutput: boolean;
  hideBackgroundInOutput: boolean;
  setHideBackgroundInOutput: (hide: boolean) => void;
  isOutputFrozen: boolean;
  setIsOutputFrozen: BooleanStateSetter;
  isTimerLayerEnabled: boolean;
  setIsTimerLayerEnabled: (show: boolean) => void;
  isMessageLayerEnabled: boolean;
  setIsMessageLayerEnabled: (show: boolean) => void;
  isGridView: boolean;
  setIsGridView: (isGridView: boolean) => void;
  selectMediaForOutput: (item: MediaItem | null) => void;
  handleSelectSlide: (slideId: string, text: string, footer?: string) => Promise<void>;
  handleSelectScripture: (reference: string) => Promise<void>;
  addLibraryItemToService: (serviceId: Id<"services">, libraryId: string) => Promise<void>;
  timers: UseTimersResult;
  toggleVideoPlayback: () => void;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findBest<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): T | null {
  const needle = normalize(query);
  if (!needle) return null;
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const haystack = normalize(getText(item));
    if (!haystack) continue;
    let score = 0;
    if (haystack === needle) score += 100;
    if (haystack.includes(needle)) score += 45;
    for (const word of needle.split(" ")) {
      if (word.length > 1 && haystack.includes(word)) score += 8;
    }
    if (!best || score > best.score) {
      best = { item, score };
    }
  }
  return best && best.score > 0 ? best.item : null;
}

function formatSecondsDuration(totalSeconds: number) {
  const safe = Math.max(1, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function ok(call: AiToolCall, data?: unknown): AiToolResult {
  return { callId: call.id, ok: true, data };
}

function fail(call: AiToolCall, code: string, message: string): AiToolResult {
  return {
    callId: call.id,
    ok: false,
    error: { code, message },
  };
}

function referenceParts(reference: string) {
  const match = reference.match(/^(.+?)\s+(\d+)(?::(\d+))?/);
  return {
    reference,
    book: match?.[1],
    chapter: match?.[2] ? Number.parseInt(match[2], 10) : undefined,
    verse: match?.[3] ? Number.parseInt(match[3], 10) : undefined,
  };
}

function stringArg(call: AiToolCall, keys: string[]): string {
  for (const key of keys) {
    const value = call.arguments[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function booleanArg(call: AiToolCall, key = "enabled"): boolean {
  return Boolean(call.arguments[key]);
}

function targetArg(call: AiToolCall, keys: string[]): string {
  return normalize(stringArg(call, keys));
}

const sidebarTabAliases: Record<string, SidebarTab> = {
  audio: "audio",
  music: "audio",
  sound: "audio",
  text: "text",
  lyrics: "text",
  words: "text",
  timer: "timer",
  countdown: "timer",
  message: "messages",
  messages: "messages",
  announcement: "messages",
  announcements: "messages",
  layer: "layers",
  layers: "layers",
  prop: "layers",
  props: "layers",
  master: "masters",
  masters: "masters",
  template: "masters",
  templates: "masters",
};

function parseSidebarTab(value: string): SidebarTab | null {
  return sidebarTabAliases[normalize(value)] ?? null;
}

type CenterPanel =
  | "media"
  | "library"
  | "scripture"
  | "search"
  | "edit"
  | "settings"
  | "browser";

function parseCenterPanel(value: string): CenterPanel | null {
  const target = normalize(value);
  if (!target) return null;
  if (/\b(search|find|palette)\b/.test(target)) return "search";
  if (/\b(bible|scripture|verse|verses)\b/.test(target)) return "scripture";
  if (/\b(library|libraries|songs|shows|schedule|service|services|notes)\b/.test(target)) {
    return "library";
  }
  if (/\b(media|backgrounds?|videos?|images?)\b/.test(target)) return "media";
  if (/\b(edit|editor|lyrics editor)\b/.test(target)) return "edit";
  if (/\b(settings|preferences)\b/.test(target)) return "settings";
  if (/\b(browser|web|website)\b/.test(target)) return "browser";
  return null;
}

type DisplayTarget = "output" | "stage" | "looks" | "composer";

function parseDisplayTarget(value: string): DisplayTarget | null {
  const target = normalize(value);
  if (/\b(output|audience|main display|main screen|projector|presentation display)\b/.test(target)) {
    return "output";
  }
  if (/\b(stage|confidence|stage display)\b/.test(target)) return "stage";
  if (/\b(looks|look window|looks window)\b/.test(target)) return "looks";
  if (/\b(composer|screen composer|layout composer)\b/.test(target)) return "composer";
  return null;
}

export function usePresentAiToolProvider({
  libraryItems,
  slidesForGrid,
  selected,
  allMediaItems,
  selectedServiceId,
  setSelectedLibraryId,
  setViewMode,
  setBottomTab,
  setShowTextInOutput,
  showTextInOutput,
  setShowMediaInOutput,
  showMediaInOutput,
  hideBackgroundInOutput,
  setHideBackgroundInOutput,
  isOutputFrozen,
  setIsOutputFrozen,
  isTimerLayerEnabled,
  setIsTimerLayerEnabled,
  isMessageLayerEnabled,
  setIsMessageLayerEnabled,
  isGridView,
  setIsGridView,
  selectMediaForOutput,
  handleSelectSlide,
  handleSelectScripture,
  addLibraryItemToService,
  timers,
  toggleVideoPlayback,
}: UsePresentAiToolProviderProps) {
  useEffect(() => {
    const openCenterPanel = (panel: CenterPanel): void => {
      if (panel === "search") {
        useGlobalSearchStore.getState().openSearch();
        return;
      }
      if (panel === "edit") {
        setViewMode("edit");
        return;
      }
      if (panel === "settings") {
        setViewMode("settings");
        return;
      }
      if (panel === "browser") {
        setViewMode("browser");
        return;
      }
      setViewMode("show");
      setBottomTab(
        panel === "scripture" ? "scripture" : panel === "library" ? "shows" : "media",
      );
    };

    const closeCenterPanel = (panel: CenterPanel): void => {
      if (panel === "search") {
        useGlobalSearchStore.getState().closeSearch();
        return;
      }
      if (panel === "edit" || panel === "settings" || panel === "browser") {
        setViewMode("show");
        setBottomTab("media");
        return;
      }
      setViewMode("show");
      setBottomTab(panel === "media" ? "shows" : "media");
    };

    const openDisplay = async (call: AiToolCall, display: DisplayTarget) => {
      const api = window.electronAPI;
      if (!api) {
        return fail(call, "WINDOW_API_UNAVAILABLE", "Electron window API is unavailable.");
      }
      if (display === "output") {
        await api.openOutputWindow?.();
      } else if (display === "stage") {
        await api.openMediaStageWindow?.();
      } else if (display === "looks") {
        await api.openLooksWindow?.();
      } else {
        await api.openScreenComposerWindow?.();
      }
      return ok(call, { display });
    };

    const closeDisplay = async (call: AiToolCall, display: DisplayTarget) => {
      const api = window.electronAPI;
      if (!api) {
        return fail(call, "WINDOW_API_UNAVAILABLE", "Electron window API is unavailable.");
      }
      if (display === "output") {
        await api.closeOutputWindow?.();
      } else if (display === "stage") {
        await api.closeMediaStageWindow?.();
      } else if (display === "looks") {
        await api.closeLooksWindow?.();
      } else {
        await api.closeScreenComposerWindow?.();
      }
      return ok(call, { display });
    };

    const unsupported = (call: AiToolCall) =>
      fail(
        call,
        "PROVIDER_NOT_CONFIGURED",
        `${call.name} is registered but its provider is not configured yet.`,
      );

    const handlers: Record<string, RegisteredToolHandler> = {
      open_song: async (call) => {
        const songQuery = stringArg(call, ["song", "query"]);
        const song = findBest(libraryItems, songQuery, (item) => item.title);
        if (!song) {
          return fail(call, "SONG_NOT_FOUND", `Could not find "${songQuery}".`);
        }

        setViewMode("show");
        setBottomTab("shows");
        setSelectedLibraryId(String(song._id));
        setShowTextInOutput(true);
        const section =
          typeof call.arguments.section === "string"
            ? normalize(call.arguments.section)
            : "";
        const slideIndex = section
          ? Math.max(
              0,
              song.slides.findIndex((slide) =>
                normalize(`${slide.label ?? ""} ${slide.text ?? ""}`).includes(section),
              ),
            )
          : 0;
        const slide = song.slides[slideIndex] ?? song.slides[0];
        if (slide) {
          await handleSelectSlide(
            `${song._id}:${slideIndex}`,
            slide.text,
            "footer" in slide && typeof slide.footer === "string"
              ? slide.footer
              : undefined,
          );
        }
        toast.success(`AI Operator opened ${song.title}`);
        return ok(call, { songId: String(song._id), title: song.title });
      },

      search_song: async (call) => handlers.open_song(call),

      queue_song: async (call) => {
        const songQuery = stringArg(call, ["song"]);
        if (!selectedServiceId) {
          return fail(call, "NO_SERVICE", "No service is selected.");
        }
        const song = findBest(libraryItems, songQuery, (item) => item.title);
        if (!song) {
          return fail(call, "SONG_NOT_FOUND", `Could not find "${songQuery}".`);
        }
        await addLibraryItemToService(selectedServiceId, String(song._id));
        toast.success(`AI Operator queued ${song.title}`);
        return ok(call, { songId: String(song._id), title: song.title });
      },

      next_slide: async (call) => handlers.go_to_slide({
        ...call,
        arguments: { slide: (selected?.index ?? 0) + 2 },
      }),

      previous_slide: async (call) => handlers.go_to_slide({
        ...call,
        arguments: { slide: selected?.index ?? 0 },
      }),

      go_to_slide: async (call) => {
        if (slidesForGrid.length === 0) {
          return fail(call, "NO_SLIDES", "There are no slides to control.");
        }
        const nextIndex = Number(call.arguments.slide ?? 1) - 1;
        const boundedIndex = Math.max(0, Math.min(nextIndex, slidesForGrid.length - 1));
        const target = slidesForGrid[boundedIndex];
        if (!target) {
          return fail(call, "SLIDE_NOT_FOUND", "The requested slide does not exist.");
        }
        const slideId =
          target.id ??
          (target.libraryItem
            ? `${target.libraryItem._id}:${target.index}`
            : `scripture:${target.index}`);
        await handleSelectSlide(slideId, target.slide.text, target.slide.footer);
        setShowTextInOutput(true);
        return ok(call, { slideIndex: boundedIndex, slideCount: slidesForGrid.length });
      },

      start_presentation: async (call) => {
        if (slidesForGrid.length === 0) {
          return fail(call, "NO_SLIDES", "There are no slides to start.");
        }
        const first = slidesForGrid[0];
        const slideId =
          first.id ??
          (first.libraryItem ? `${first.libraryItem._id}:0` : "scripture:0");
        await handleSelectSlide(slideId, first.slide.text, first.slide.footer);
        setViewMode("show");
        setShowTextInOutput(true);
        return ok(call, { slideIndex: 0 });
      },

      stop_presentation: (call) => {
        setShowTextInOutput(false);
        return ok(call);
      },

      open_bible_verse: async (call) => {
        const reference = String(
          call.arguments.reference ??
            [
              call.arguments.book,
              call.arguments.chapter,
              call.arguments.verse ? `:${call.arguments.verse}` : "",
            ]
              .filter(Boolean)
              .join(" "),
        ).trim();
        if (!reference) {
          return fail(call, "NO_REFERENCE", "No Bible reference was provided.");
        }
        setViewMode("show");
        setBottomTab("scripture");
        setShowTextInOutput(true);
        await handleSelectScripture(reference);
        toast.success(`AI Operator opened ${reference}`);
        return ok(call, referenceParts(reference));
      },

      search_bible: async (call) => handlers.open_bible_verse({
        ...call,
        arguments: { reference: stringArg(call, ["reference", "query"]) },
      }),

      play_video: async (call) => {
        const mediaQuery = stringArg(call, ["media", "background"]);
        const item = findBest(allMediaItems, mediaQuery, (media) => media.name);
        if (!item) {
          return fail(call, "MEDIA_NOT_FOUND", `Could not find "${mediaQuery}".`);
        }
        setViewMode("show");
        setBottomTab("media");
        setShowMediaInOutput(true);
        selectMediaForOutput(item);
        toast.success(`AI Operator selected ${item.name}`);
        return ok(call, { mediaId: item.id, title: item.name, type: item.type });
      },

      change_background: async (call) => handlers.play_video({
        ...call,
        arguments: { media: stringArg(call, ["background", "media"]) },
      }),

      stop_video: (call) => {
        toggleVideoPlayback();
        return ok(call);
      },

      start_countdown: (call) => {
        const activeTimer = timers.activeTimer;
        if (!activeTimer) {
          return fail(call, "NO_TIMER", "No timer exists.");
        }
        const seconds =
          typeof call.arguments.seconds === "number" ? call.arguments.seconds : 300;
        timers.setExpandedTimerId(activeTimer.id);
        timers.updateTimer(activeTimer.id, {
          duration: formatSecondsDuration(seconds),
          type: "countdown",
          name:
            typeof call.arguments.label === "string"
              ? call.arguments.label
              : activeTimer.name,
        });
        window.setTimeout(() => timers.toggleTimerPlayback(activeTimer.id), 0);
        setIsTimerLayerEnabled(true);
        toast.success("AI Operator started countdown");
        return ok(call, { timerId: activeTimer.id, seconds });
      },

      stop_countdown: (call) => {
        timers.stopAllTimers();
        return ok(call);
      },

      reset_countdown: (call) => {
        if (timers.activeTimer) {
          timers.resetTimer(timers.activeTimer.id);
        }
        return ok(call);
      },

      set_text_visibility: (call) => {
        const enabled = booleanArg(call);
        setShowTextInOutput(enabled);
        return ok(call, { enabled });
      },

      toggle_text: (call) => {
        const enabled = !showTextInOutput;
        setShowTextInOutput(enabled);
        return ok(call, { enabled });
      },

      set_media_visibility: (call) => {
        const enabled = booleanArg(call);
        setShowMediaInOutput(enabled);
        return ok(call, { enabled });
      },

      toggle_media: (call) => {
        const enabled = !showMediaInOutput;
        setShowMediaInOutput(enabled);
        return ok(call, { enabled });
      },

      set_background_visibility: (call) => {
        const enabled = booleanArg(call);
        setHideBackgroundInOutput(!enabled);
        return ok(call, { enabled });
      },

      toggle_background: (call) => {
        const enabled = hideBackgroundInOutput;
        setHideBackgroundInOutput(!enabled);
        return ok(call, { enabled });
      },

      set_output_freeze: (call) => {
        const enabled = booleanArg(call);
        setIsOutputFrozen(enabled);
        return ok(call, { enabled });
      },

      toggle_output_freeze: (call) => {
        const enabled = !isOutputFrozen;
        setIsOutputFrozen(enabled);
        return ok(call, { enabled });
      },

      set_timer_layer: (call) => {
        const enabled = booleanArg(call);
        setIsTimerLayerEnabled(enabled);
        return ok(call, { enabled });
      },

      toggle_timer_layer: (call) => {
        const enabled = !isTimerLayerEnabled;
        setIsTimerLayerEnabled(enabled);
        return ok(call, { enabled });
      },

      set_message_layer: (call) => {
        const enabled = booleanArg(call);
        setIsMessageLayerEnabled(enabled);
        return ok(call, { enabled });
      },

      toggle_message_layer: (call) => {
        const enabled = !isMessageLayerEnabled;
        setIsMessageLayerEnabled(enabled);
        return ok(call, { enabled });
      },

      set_slide_grid: (call) => {
        const visible = Boolean(call.arguments.visible);
        setViewMode("show");
        setIsGridView(visible);
        return ok(call, { visible });
      },

      toggle_slide_grid: (call) => {
        const visible = !isGridView;
        setViewMode("show");
        setIsGridView(visible);
        return ok(call, { visible });
      },

      set_view_mode: (call) => {
        const mode = targetArg(call, ["mode"]);
        if (/\b(edit|editor)\b/.test(mode)) {
          setViewMode("edit");
          return ok(call, { mode: "edit" });
        }
        if (/\b(browser|web)\b/.test(mode)) {
          setViewMode("browser");
          return ok(call, { mode: "browser" });
        }
        if (/\b(settings|preferences)\b/.test(mode)) {
          setViewMode("settings");
          return ok(call, { mode: "settings" });
        }
        setViewMode("show");
        return ok(call, { mode: "show" });
      },

      open_panel: (call) => {
        const raw = stringArg(call, ["panel", "target"]);
        const sidebarTab = parseSidebarTab(raw);
        if (sidebarTab) {
          useSidebarTabStore.getState().setActiveTab(sidebarTab);
          return ok(call, { panel: sidebarTab, scope: "sidebar" });
        }
        const panel = parseCenterPanel(raw);
        if (!panel) {
          return fail(call, "UNKNOWN_PANEL", `Unknown panel: ${raw || "none"}.`);
        }
        openCenterPanel(panel);
        return ok(call, { panel, scope: "center" });
      },

      close_panel: (call) => {
        const raw = stringArg(call, ["panel", "target"]);
        const sidebarTab = parseSidebarTab(raw);
        if (sidebarTab) {
          useSidebarTabStore.getState().setActiveTab("masters");
          return ok(call, { panel: sidebarTab, scope: "sidebar" });
        }
        const panel = parseCenterPanel(raw);
        if (!panel) {
          return fail(call, "UNKNOWN_PANEL", `Unknown panel: ${raw || "none"}.`);
        }
        closeCenterPanel(panel);
        return ok(call, { panel, scope: "center" });
      },

      open_sidebar_tab: (call) => {
        const raw = stringArg(call, ["tab", "panel"]);
        const tab = parseSidebarTab(raw);
        if (!tab) {
          return fail(call, "UNKNOWN_SIDEBAR_TAB", `Unknown sidebar tab: ${raw || "none"}.`);
        }
        useSidebarTabStore.getState().setActiveTab(tab);
        return ok(call, { tab });
      },

      open_display: async (call) => {
        const display = parseDisplayTarget(stringArg(call, ["display", "target"]));
        if (!display) {
          return fail(call, "UNKNOWN_DISPLAY", "Unknown display target.");
        }
        return openDisplay(call, display);
      },

      close_display: async (call) => {
        const display = parseDisplayTarget(stringArg(call, ["display", "target"]));
        if (!display) {
          return fail(call, "UNKNOWN_DISPLAY", "Unknown display target.");
        }
        return closeDisplay(call, display);
      },

      open_library: (call) => {
        openCenterPanel("library");
        return ok(call);
      },

      open_notes: (call) => {
        openCenterPanel("library");
        return ok(call);
      },

      open_schedule: (call) => {
        openCenterPanel("library");
        return ok(call);
      },

      open_settings: (call) => {
        openCenterPanel("settings");
        return ok(call);
      },

      favorite_song: unsupported,
      change_translation: unsupported,
      play_audio: unsupported,
      start_stream: unsupported,
      stop_stream: unsupported,
      switch_scene: unsupported,
    };

    console.info("[AI Operator] Present tool provider mounted", {
      libraryItems: libraryItems.length,
      slides: slidesForGrid.length,
      mediaItems: allMediaItems.length,
      selectedServiceId,
    });

    return aiOperatorBus.onCommand(async ({ call, resolve }) => {
      try {
        console.info("[AI Operator] provider received tool", {
          tool: call.name,
          arguments: call.arguments,
        });
        const handler = handlers[call.name];
        if (!handler) {
          resolve(fail(call, "UNKNOWN_TOOL", `Unknown AI Operator tool: ${call.name}`));
          return;
        }
        const result = await handler(call);
        console.info("[AI Operator] provider handled tool", {
          tool: call.name,
          ok: result.ok,
          error: result.error,
        });
        resolve(result);
      } catch (error) {
        resolve(
          fail(
            call,
            "EXECUTION_ERROR",
            userMessage(error, "The AI Operator couldn't do that. Try again.", "AI Operator"),
          ),
        );
      }
    });
  }, [
    addLibraryItemToService,
    allMediaItems,
    handleSelectScripture,
    handleSelectSlide,
    hideBackgroundInOutput,
    isGridView,
    isMessageLayerEnabled,
    isOutputFrozen,
    isTimerLayerEnabled,
    libraryItems,
    selected,
    selectedServiceId,
    selectMediaForOutput,
    setBottomTab,
    setHideBackgroundInOutput,
    setIsGridView,
    setIsMessageLayerEnabled,
    setIsOutputFrozen,
    setIsTimerLayerEnabled,
    setSelectedLibraryId,
    setShowMediaInOutput,
    setShowTextInOutput,
    setViewMode,
    showMediaInOutput,
    showTextInOutput,
    slidesForGrid,
    timers,
    toggleVideoPlayback,
  ]);
}
