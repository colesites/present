import { useEffect } from "react";
import { toast } from "sonner";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { LibraryItem, ViewMode, BottomTab } from "../../shared/types";
import type { MediaItem } from "../../features/media/hooks/useMediaFolders";
import type { SlideData } from "../../features/slides";
import type { UseTimersResult } from "../shared/hooks";
import { aiOperatorBus } from "./operatorBus";
import type { AiToolCall, AiToolResult } from "../../shared/ai-operator/types";

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
  selectMediaForOutput,
  handleSelectSlide,
  handleSelectScripture,
  addLibraryItemToService,
  timers,
  toggleVideoPlayback,
}: UsePresentAiToolProviderProps) {
  useEffect(() => {
    return aiOperatorBus.onCommand(async ({ call, resolve }) => {
      try {
        const args = call.arguments;

        if (call.name === "open_song" || call.name === "search_song") {
          const songQuery = String(args.song ?? args.query ?? "");
          const song = findBest(libraryItems, songQuery, (item) => item.title);
          if (!song) {
            resolve(fail(call, "SONG_NOT_FOUND", `Could not find "${songQuery}".`));
            return;
          }

          setViewMode("show");
          setBottomTab("shows");
          setSelectedLibraryId(String(song._id));
          const section = typeof args.section === "string" ? normalize(args.section) : "";
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
          resolve(ok(call, { songId: String(song._id), title: song.title }));
          return;
        }

        if (call.name === "queue_song") {
          const songQuery = String(args.song ?? "");
          if (!selectedServiceId) {
            resolve(fail(call, "NO_SERVICE", "No service is selected."));
            return;
          }
          const song = findBest(libraryItems, songQuery, (item) => item.title);
          if (!song) {
            resolve(fail(call, "SONG_NOT_FOUND", `Could not find "${songQuery}".`));
            return;
          }
          await addLibraryItemToService(selectedServiceId, String(song._id));
          toast.success(`AI Operator queued ${song.title}`);
          resolve(ok(call, { songId: String(song._id), title: song.title }));
          return;
        }

        if (call.name === "next_slide" || call.name === "previous_slide" || call.name === "go_to_slide") {
          if (slidesForGrid.length === 0) {
            resolve(fail(call, "NO_SLIDES", "There are no slides to control."));
            return;
          }
          const currentIndex = selected?.index ?? 0;
          const nextIndex =
            call.name === "go_to_slide"
              ? Number(args.slide ?? 1) - 1
              : call.name === "next_slide"
                ? currentIndex + 1
                : currentIndex - 1;
          const boundedIndex = Math.max(0, Math.min(nextIndex, slidesForGrid.length - 1));
          const target = slidesForGrid[boundedIndex];
          if (!target) {
            resolve(fail(call, "SLIDE_NOT_FOUND", "The requested slide does not exist."));
            return;
          }
          const slideId =
            target.id ??
            (target.libraryItem
              ? `${target.libraryItem._id}:${target.index}`
              : `scripture:${target.index}`);
          await handleSelectSlide(slideId, target.slide.text, target.slide.footer);
          resolve(ok(call, { slideIndex: boundedIndex, slideCount: slidesForGrid.length }));
          return;
        }

        if (call.name === "start_presentation") {
          if (slidesForGrid.length === 0) {
            resolve(fail(call, "NO_SLIDES", "There are no slides to start."));
            return;
          }
          const first = slidesForGrid[0];
          const slideId =
            first.id ??
            (first.libraryItem ? `${first.libraryItem._id}:0` : "scripture:0");
          await handleSelectSlide(slideId, first.slide.text, first.slide.footer);
          resolve(ok(call, { slideIndex: 0 }));
          return;
        }

        if (call.name === "stop_presentation") {
          setShowTextInOutput(false);
          resolve(ok(call));
          return;
        }

        if (call.name === "open_bible_verse" || call.name === "search_bible") {
          const reference = String(
            args.reference ??
              [args.book, args.chapter, args.verse ? `:${args.verse}` : ""]
                .filter(Boolean)
                .join(" "),
          ).trim();
          if (!reference) {
            resolve(fail(call, "NO_REFERENCE", "No Bible reference was provided."));
            return;
          }
          setViewMode("show");
          setBottomTab("scripture");
          await handleSelectScripture(reference);
          toast.success(`AI Operator opened ${reference}`);
          resolve(ok(call, referenceParts(reference)));
          return;
        }

        if (call.name === "play_video" || call.name === "change_background") {
          const mediaQuery = String(args.media ?? args.background ?? "");
          const item = findBest(allMediaItems, mediaQuery, (media) => media.name);
          if (!item) {
            resolve(fail(call, "MEDIA_NOT_FOUND", `Could not find "${mediaQuery}".`));
            return;
          }
          setViewMode("show");
          setBottomTab("media");
          selectMediaForOutput(item);
          toast.success(`AI Operator selected ${item.name}`);
          resolve(ok(call, { mediaId: item.id, title: item.name, type: item.type }));
          return;
        }

        if (call.name === "stop_video") {
          toggleVideoPlayback();
          resolve(ok(call));
          return;
        }

        if (call.name === "start_countdown") {
          const activeTimer = timers.activeTimer;
          if (!activeTimer) {
            resolve(fail(call, "NO_TIMER", "No timer exists."));
            return;
          }
          const seconds = typeof args.seconds === "number" ? args.seconds : 300;
          timers.setExpandedTimerId(activeTimer.id);
          timers.updateTimer(activeTimer.id, {
            duration: formatSecondsDuration(seconds),
            type: "countdown",
            name: typeof args.label === "string" ? args.label : activeTimer.name,
          });
          window.setTimeout(() => timers.toggleTimerPlayback(activeTimer.id), 0);
          setShowTextInOutput(true);
          toast.success("AI Operator started countdown");
          resolve(ok(call, { timerId: activeTimer.id, seconds }));
          return;
        }

        if (call.name === "stop_countdown") {
          timers.stopAllTimers();
          resolve(ok(call));
          return;
        }

        if (call.name === "reset_countdown") {
          if (timers.activeTimer) {
            timers.resetTimer(timers.activeTimer.id);
          }
          resolve(ok(call));
          return;
        }

        if (call.name === "open_library") {
          setViewMode("show");
          setBottomTab("shows");
          resolve(ok(call));
          return;
        }

        if (call.name === "open_notes" || call.name === "open_schedule") {
          setViewMode("show");
          setBottomTab("shows");
          resolve(ok(call));
          return;
        }

        if (call.name === "open_settings") {
          setViewMode("settings");
          resolve(ok(call));
          return;
        }

        if (
          call.name === "favorite_song" ||
          call.name === "change_translation" ||
          call.name === "play_audio" ||
          call.name === "start_stream" ||
          call.name === "stop_stream" ||
          call.name === "switch_scene"
        ) {
          resolve(
            fail(
              call,
              "PROVIDER_NOT_CONFIGURED",
              `${call.name} is registered but its provider is not configured yet.`,
            ),
          );
          return;
        }

        resolve(fail(call, "UNKNOWN_TOOL", `Unknown AI Operator tool: ${call.name}`));
      } catch (error) {
        resolve(
          fail(
            call,
            "EXECUTION_ERROR",
            error instanceof Error ? error.message : "AI Operator tool failed.",
          ),
        );
      }
    });
  }, [
    addLibraryItemToService,
    allMediaItems,
    handleSelectScripture,
    handleSelectSlide,
    libraryItems,
    selected,
    selectedServiceId,
    selectMediaForOutput,
    setBottomTab,
    setSelectedLibraryId,
    setShowTextInOutput,
    setViewMode,
    slidesForGrid,
    timers,
    toggleVideoPlayback,
  ]);
}
