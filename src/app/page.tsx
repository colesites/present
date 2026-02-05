"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  Activity,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Id } from "@/../convex/_generated/dataModel";
// UI Components
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  FontSizeInput,
  FontFamilySelect,
} from "@/components";
import { cn } from "@/lib/utils";
// Features
import { AppHeader } from "@/features/header";
import type { MediaPanelRef } from "@/features/media";
import { useMediaFolders } from "@/features/media/hooks";
import { PresentCenterArea } from "@/features/present/PresentCenterArea";
import { PresentOutputSidebar } from "@/features/present/PresentOutputSidebar";
import { PresentServicesSidebar } from "@/features/present/PresentServicesSidebar";
import type { ScripturePanelRef } from "@/features/scripture";
import { useScripture } from "@/features/scripture/hooks/useScripture";
import { db } from "@/features/scripture/lib/db";
import { parseReference } from "@/features/scripture/lib/parser";
import type { ScriptureSlide } from "@/features/scripture/lib/slides";
import { generateBibleSlides } from "@/features/scripture/lib/slides";
import { useServices } from "@/features/services/hooks";
import type { ShowsPanelRef } from "@/features/shows";
import { useSongs } from "@/features/songs/hooks";
// Hooks
import {
  useCategories,
  useGlobalShortcuts,
  useOrganization,
  useOutputBroadcast,
  usePersistedUIState,
  usePlayback,
  usePresentMediaFlow,
  useShowVideoSync,
} from "@/hooks";
// Lib
import {
  getActiveSlideText,
  getSlideGroups,
  getSlidesForGrid,
} from "@/lib/present/selectors";

type Settings = {
  scriptureSpeechLang: string;
  scriptureBackgroundMediaId?: string | null;
  scriptureFontSize: number;
  scriptureFontFamily: string;
  scriptureTextAlign: "left" | "center" | "right";
};

const SETTINGS_STORAGE_KEY = "present-settings";

const SETTINGS_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "en-IE", label: "English (Ireland)" },
  { value: "en-IN", label: "English (India)" },
  { value: "en-NG", label: "English (Nigeria)" },
  { value: "en-NZ", label: "English (New Zealand)" },
  { value: "en-PH", label: "English (Philippines)" },
  { value: "en-ZA", label: "English (South Africa)" },
];



export default function Home() {
  // Organization & auth
  const { orgId } = useOrganization();

  // Data hooks
  const {
    activeSlideId,
    fontFamily,
    fontSize,
    fontBold,
    fontItalic,
    fontUnderline,
    selectSlide,
    updateFontStyle,
  } = usePlayback(orgId);

  const {
    songs,
    filteredSongs,
    selectedSong,
    selectedSongId,
    selectedCategoryId,
    searchQuery,
    setSelectedSongId,
    setSelectedCategoryId,
    setSearchQuery,
    createNewSong,
    updateExistingSong,
    deleteSong,
    isLoading: songsLoading,
  } = useSongs(orgId);

  const {
    services,
    isLoading: servicesLoading,
    selectedService,
    selectedServiceId,
    isInsideService,
    serviceItemIndex,
    serviceItems,
    setServiceItemIndex,
    createNewService,
    renameExistingService,
    deleteService,
    addSongToService,
    addMediaToService,
    removeFromService,
    reorderServiceItems,
    reorderServices,
    enterService,
    exitService,
  } = useServices(orgId, songs);

  const { categories, createNewCategory } = useCategories(orgId);

  // Media state - lifted up for pre-rendering with Activity
  const mediaState = useMediaFolders();
  const {
    folders,
    activeMediaItem,
    allMediaItems,
    selectMediaForOutput,
    videoSettings,
    updateVideoSettings,
    mediaFilters,
    updateMediaFilters,
    resetMediaFilters,
    mediaFilterCSS,
  } = mediaState;

  // Output visibility toggles
  const [showTextInOutput, setShowTextInOutput] = useState(true);
  const [showMediaInOutput, setShowMediaInOutput] = useState(true);
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);

  // Scripture Logic for Service Items
  const { lookupRef } = useScripture();
  const availableBooks = useLiveQuery(() => db.books.toArray()) ?? [];

  /* handleSelectScripture moved below handleScriptureOutput */

  /* usePresentMediaFlow moved below handleSelectScripture */

  /* useShowVideoSync moved below usePresentMediaFlow */

  // Panel Refs for shortcuts
  const showsPanelRef = useRef<ShowsPanelRef>(null);
  const mediaPanelRef = useRef<MediaPanelRef>(null);
  const scripturePanelRef = useRef<ScripturePanelRef>(null);

  // UI state (defaults match server render)
  const { viewMode, setViewMode, bottomTab, setBottomTab } =
    usePersistedUIState();

  const [settingsLang, setSettingsLang] = useState("en-US");
  const [settingsScriptureBackgroundId, setSettingsScriptureBackgroundId] =
    useState<string | null>(null);
  const [settingsScriptureFontSize, setSettingsScriptureFontSize] =
    useState(18);
  const [settingsScriptureFontFamily, setSettingsScriptureFontFamily] =
    useState("Inter");
  const [settingsScriptureTextAlign, setSettingsScriptureTextAlign] = useState<
    "left" | "center" | "right"
  >("left");
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  const [settingsMediaFolderId, setSettingsMediaFolderId] = useState<
    string | "all"
  >("all");

  const settingsMediaItems = useMemo(
    () =>
      settingsMediaFolderId === "all"
        ? allMediaItems
        : allMediaItems.filter(
            (item) => item.folderId === settingsMediaFolderId,
          ),
    [allMediaItems, settingsMediaFolderId],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        if (typeof parsed.scriptureSpeechLang === "string") {
          setSettingsLang(parsed.scriptureSpeechLang);
        }
        if (typeof parsed.scriptureBackgroundMediaId === "string") {
          setSettingsScriptureBackgroundId(parsed.scriptureBackgroundMediaId);
        }
        if (typeof parsed.scriptureFontSize === "number") {
          setSettingsScriptureFontSize(parsed.scriptureFontSize);
        }
        if (typeof parsed.scriptureFontFamily === "string") {
          setSettingsScriptureFontFamily(parsed.scriptureFontFamily);
        }
        if (
          parsed.scriptureTextAlign === "left" ||
          parsed.scriptureTextAlign === "center" ||
          parsed.scriptureTextAlign === "right"
        ) {
          setSettingsScriptureTextAlign(parsed.scriptureTextAlign);
        }
      }
    } catch {
    } finally {
      setSettingsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    try {
      const next: Settings = {
        scriptureSpeechLang: settingsLang,
        scriptureBackgroundMediaId: settingsScriptureBackgroundId ?? null,
        scriptureFontSize: settingsScriptureFontSize,
        scriptureFontFamily: settingsScriptureFontFamily,
        scriptureTextAlign: settingsScriptureTextAlign,
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, [
    settingsHydrated,
    settingsLang,
    settingsScriptureBackgroundId,
    settingsScriptureFontSize,
    settingsScriptureFontFamily,
    settingsScriptureTextAlign,
  ]);

  useEffect(() => {
    if (settingsMediaFolderId !== "all") return;
    if (folders.length === 0) return;
    setSettingsMediaFolderId(folders[0].id);
  }, [folders, settingsMediaFolderId]);

  const [scriptureSlides, setScriptureSlides] = useState<ScriptureSlide[]>([]);

  // Global Keyboard Shortcuts
  useGlobalShortcuts({
    setBottomTab,
    showsPanelRef,
    mediaPanelRef,
    scripturePanelRef,
  });

  const [selected, setSelected] = useState<{
    songId: Id<"songs"> | null;
    index: number;
  } | null>(null);
  const [editScrollToSlide, setEditScrollToSlide] = useState<number | null>(
    null
  );
  const [isOutputFrozen, setIsOutputFrozen] = useState(false);
  const [isAutopilotEnabled, setIsAutopilotEnabled] = useState(false);

  const slidesForGrid = useMemo(() => {
    if (selectedSong) return getSlidesForGrid(selectedSong);
    if (scriptureSlides.length > 0) {
      return scriptureSlides.map((item, i) => ({
        slide: { text: item.content, label: item.label, footer: item.footer },
        index: i,
        song: null as any,
      }));
    }
    return [];
  }, [selectedSong, scriptureSlides]);
  const isScriptureActive = useMemo(() => {
    if (activeSlideId?.startsWith("scripture:")) return true;
    if (bottomTab === "scripture" && !selectedSongId) return true;
    if (scriptureSlides.length > 0 && !selectedSongId) return true;
    return false;
  }, [activeSlideId, bottomTab, selectedSongId, scriptureSlides.length]);

  const activeSlideContent = useMemo(() => {
    if (activeSlideId?.startsWith("scripture:")) {
      const indexStr = activeSlideId.split(":")[1];
      const index = parseInt(indexStr, 10);
      const slide = scriptureSlides[index];
      return slide ? { text: slide.content, footer: slide.footer } : null;
    }
    const text = getActiveSlideText(activeSlideId, songs);
    return text ? { text } : null;
  }, [activeSlideId, songs, scriptureSlides]);
  const slideGroups = useMemo(
    () => getSlideGroups(selectedSong),
    [selectedSong]
  );

  const scriptureBackgroundMediaItem = useMemo(
    () =>
      settingsScriptureBackgroundId
        ? activeMediaItem &&
          activeMediaItem.id === settingsScriptureBackgroundId
          ? activeMediaItem
          : (allMediaItems.find(
              (item) => item.id === settingsScriptureBackgroundId,
            ) ?? null)
        : null,
    [activeMediaItem, allMediaItems, settingsScriptureBackgroundId],
  );

  const effectiveActiveMediaItem =
    isScriptureActive || viewMode === "settings"
      ? (scriptureBackgroundMediaItem ?? activeMediaItem)
      : activeMediaItem;

  // Handlers
  const handleSelectSlide = useCallback(
    async (slideId: string, text: string, footer?: string) => {
      setShowTextInOutput(true);
      await selectSlide(slideId, text, footer, {
        suppressBroadcast: isOutputFrozen,
      });

      const [idPart, indexStr] = slideId.split(":");
      const index = Number(indexStr);

      if (slideId.startsWith("scripture")) {
        setSelected({ songId: null, index });
      } else if (slideId.includes(":")) {
        setSelected({ songId: idPart as any, index });
      }
    },
    [selectSlide, isOutputFrozen]
  );

  const handleEditSlide = useCallback(
    (songId: Id<"songs">, slideIndex: number) => {
      // Switch to edit mode and select the song
      setSelectedSongId(songId);
      setViewMode("edit");
      // Store the slide index to scroll to after switching to edit mode
      setSelected({ songId, index: slideIndex });
      setEditScrollToSlide(slideIndex);
    },
    [setSelectedSongId, setViewMode],
  );

  const handleRemoveFromService = useCallback(
    async (index: number) => {
      if (!selectedServiceId) return;
      await removeFromService(selectedServiceId, index);
    },
    [selectedServiceId, removeFromService]
  );

  const handleAddToService = useCallback(
    async (songId: Id<"songs">) => {
      if (!selectedServiceId) return;
      await addSongToService(selectedServiceId, songId);
    },
    [selectedServiceId, addSongToService]
  );

  const handleAddMediaToService = useCallback(
    async (mediaId: string, mediaName: string) => {
      if (!selectedServiceId) return;
      await addMediaToService(selectedServiceId, mediaId, mediaName);
    },
    [selectedServiceId, addMediaToService]
  );

  const handleSaveSong = useCallback(
    async (title: string, lyrics: string) => {
      if (!selectedSongId) return;
      await updateExistingSong(selectedSongId, title, lyrics);
    },
    [selectedSongId, updateExistingSong]
  );

  const handleRenameSong = useCallback(
    async (songId: Id<"songs">, newTitle: string) => {
      const song = songs.find((s) => s._id === songId);
      if (!song) return;
      await updateExistingSong(songId, newTitle, song.lyrics);
    },
    [songs, updateExistingSong]
  );

  const handleScriptureOutput = useCallback(
    async (slides: ScriptureSlide[]) => {
      setShowTextInOutput(true);
      // Clear current song selection when showing scripture
      setSelectedSongId(null);
      setScriptureSlides(slides);

      if (slides.length > 0) {
        // Use consistent scripture:index format
        await handleSelectSlide(
          `scripture:0`,
          slides[0].content,
          slides[0].footer
        );
      }
    },
    [handleSelectSlide, setSelectedSongId]
  );

  const handleSelectScripture = useCallback(
    async (refString: string) => {
      if (availableBooks.length === 0) return;

      const parsed = parseReference(refString, availableBooks);
      if (!parsed.book || parsed.errors.length > 0) {
        console.warn(
          "Failed to parse scripture ref from service:",
          refString,
          parsed.errors
        );
        return;
      }

      const verses = await lookupRef(parsed);

      if (verses.length > 0) {
        // Try to determine version name from the first verse
        // (lookupRef handles getting the version ID, but we need the code display name)
        // Since we don't have direct access to "versions" list here easily without adding it,
        // we can try to extract it from the ref string if present, or rely on the verse.version fallback.
        // However, the best way is to let generateBibleSlides handle it if we can't find it.
        // Actually, "lookupRef" returns verses with "version" (ID).
        // Let's see if we can get the version code from the ref string first.
        const slides = generateBibleSlides(verses, {
          verseNumberMode: "inline",
          maxLines: 40,
          maxCharsPerLine: 100,
          versionName: parsed.versionCode ?? undefined,
        });
        handleScriptureOutput(slides);
      }
    },
    [availableBooks, lookupRef, handleScriptureOutput]
  );

  const {
    showViewMedia,
    onSelectServiceItem: handleSelectServiceItem,
    onDoubleClickServiceItem: handleDoubleClickServiceItem,
    onOutputPreviewMedia: handleOutputPreviewMedia,
    onMediaPanelSelect: handleMediaPanelSelect,
  } = usePresentMediaFlow({
    serviceItems,
    allMediaItems,
    activeMediaItem,
    setServiceItemIndex,
    setSelectedSongId,
    selectMediaForOutput,
    selectSlide: (slideId: string, text: string) =>
      selectSlide(slideId, text, undefined, {
        suppressBroadcast: isOutputFrozen,
      }),
    setShouldAutoPlay,
    onSelectScripture: handleSelectScripture,
    onClearScripture: () => {
      setScriptureSlides([]);
      setSelected({ songId: null, index: -1 });
    },
  });
  const recognitionRef = useRef<any>(null);
  const lastTranscriptRef = useRef<string>("");
  const lastMatchedIndexRef = useRef<number | null>(null);
  const slideStartTimeRef = useRef<number | null>(null);
  const currentSlideIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isAutopilotEnabled || viewMode !== "show") {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      lastTranscriptRef.current = "";
      lastMatchedIndexRef.current = null;
      slideStartTimeRef.current = null;
      currentSlideIndexRef.current = null;
      return;
    }

    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      const results = event.results;
      if (!results || results.length === 0) return;
      const lastResult = results[results.length - 1];
      const transcript = String(lastResult[0]?.transcript || "").trim();
      if (!transcript) return;

      const normalizedTranscript = transcript
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!normalizedTranscript) return;
      if (normalizedTranscript === lastTranscriptRef.current) return;
      lastTranscriptRef.current = normalizedTranscript;

      if (slidesForGrid.length === 0) return;

      const words = normalizedTranscript.split(" ").filter(Boolean);
      if (words.length === 0) return;

      const scores: number[] = [];

      for (let i = 0; i < slidesForGrid.length; i += 1) {
        const slideText = String(slidesForGrid[i].slide.text || "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!slideText) {
          scores[i] = 0;
          continue;
        }
        let score = 0;
        for (const w of words) {
          if (w && slideText.includes(w)) {
            score += 1;
          }
        }
        scores[i] = score;
      }

      const currentIndex = selected?.index ?? 0;
      const currentScore = scores[currentIndex] ?? 0;

      if (currentSlideIndexRef.current !== currentIndex) {
        currentSlideIndexRef.current = currentIndex;
        slideStartTimeRef.current = Date.now();
        lastMatchedIndexRef.current = null;
      }

      const nextIndex = currentIndex + 1;
      if (nextIndex >= slidesForGrid.length) return;

      const nextScore = scores[nextIndex] ?? 0;
      if (nextScore === 0) return;

      const now = Date.now();
      const MIN_HOLD_MS = 2500;
      const FINISH_SCORE = 3;

      if (slideStartTimeRef.current == null) {
        slideStartTimeRef.current = now;
        return;
      }

      const elapsed = now - slideStartTimeRef.current;
      const finished =
        currentScore >= FINISH_SCORE ||
        (elapsed >= MIN_HOLD_MS && currentScore > 0);

      if (!finished) return;

      if (nextScore <= currentScore) return;

      if (nextIndex === lastMatchedIndexRef.current) return;

      lastMatchedIndexRef.current = nextIndex;
      slideStartTimeRef.current = now;

      const target = slidesForGrid[nextIndex];
      if (!target) return;

      const slideId = target.song
        ? `${target.song._id}:${target.index}`
        : `scripture:${target.index}`;

      handleSelectSlide(slideId, target.slide.text, target.slide.footer);
    };

    recognition.onend = () => {
      if (isAutopilotEnabled && viewMode === "show") {
        try {
          recognition.start();
        } catch {}
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {}

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      lastTranscriptRef.current = "";
      lastMatchedIndexRef.current = null;
      slideStartTimeRef.current = null;
      currentSlideIndexRef.current = null;
    };
  }, [
    isAutopilotEnabled,
    viewMode,
    slidesForGrid,
    selected,
    handleSelectSlide,
  ]);

  const {
    showVideoRef,
    isVideoPlaying,
    videoCurrentTime,
    handleVideoPlay,
    handleVideoPause,
    handleVideoEnded,
    handleVideoSeeked,
  } = useShowVideoSync({
    showViewMedia,
    activeMediaItem: effectiveActiveMediaItem,
    videoSettings,
    shouldAutoPlay,
    onAutoPlayConsumed: () => setShouldAutoPlay(false),
    forcePlay:
      (viewMode === "settings" && effectiveActiveMediaItem?.type === "video") ||
      (isScriptureActive && effectiveActiveMediaItem?.type === "video"),
  });

  const fixLyrics = useCallback(async (lyrics: string): Promise<string> => {
    const res = await fetch("/api/lyrics/fix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lyrics }),
    });
    const data = await res.json();
    if (data.notes?.includes("failed")) {
      throw new Error(data.notes);
    }
    return data.cleanedLyrics ?? lyrics;
  }, []);

  useOutputBroadcast({
    activeMediaItem: effectiveActiveMediaItem,
    showText: showTextInOutput,
    showMedia: showMediaInOutput,
    videoSettings,
    mediaFilterCSS,
    isVideoPlaying:
      (viewMode === "settings" && effectiveActiveMediaItem?.type === "video") ||
      (isScriptureActive && effectiveActiveMediaItem?.type === "video")
        ? true
        : isVideoPlaying,
    videoCurrentTime,
    isFrozen: isOutputFrozen,
    scriptureStyle: {
      fontSize: settingsScriptureFontSize,
      fontFamily: settingsScriptureFontFamily,
      textAlign: settingsScriptureTextAlign,
    },
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+S to save in edit mode
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "s" &&
        viewMode === "edit" &&
        selectedSongId
      ) {
        e.preventDefault();
        // Save is handled by LyricsEditor component
        return;
      }

      // Arrow navigation in show mode
      if (
        viewMode === "show" &&
        (selectedSong || scriptureSlides.length > 0) &&
        slidesForGrid.length > 0
      ) {
        const currentIndex = selected?.index ?? 0;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          const nextIndex = Math.min(
            currentIndex + 1,
            slidesForGrid.length - 1,
          );
          const nextSlide = slidesForGrid[nextIndex];
          const slideId = nextSlide.song
            ? `${nextSlide.song._id}:${nextSlide.index}`
            : `scripture:${nextSlide.index}`;
          handleSelectSlide(
            slideId,
            nextSlide.slide.text,
            nextSlide.slide.footer,
          );
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          const prevIndex = Math.max(currentIndex - 1, 0);
          const prevSlide = slidesForGrid[prevIndex];
          const slideId = prevSlide.song
            ? `${prevSlide.song._id}:${prevSlide.index}`
            : `scripture:${prevSlide.index}`;
          handleSelectSlide(
            slideId,
            prevSlide.slide.text,
            prevSlide.slide.footer,
          );
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    viewMode,
    selectedSong,
    selectedSongId,
    selected,
    slidesForGrid,
    handleSelectSlide,
    scriptureSlides.length,
  ]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        isAutopilotEnabled={isAutopilotEnabled}
        onToggleAutopilot={() => setIsAutopilotEnabled((prev) => !prev)}
      />

      <Activity mode={viewMode === "settings" ? "visible" : "hidden"}>
        <div className="flex flex-1">
          <aside className="flex w-60 flex-col gap-4 border-r border-border bg-card px-4 py-4">
            <div>
              <h1 className="text-sm font-semibold">Settings</h1>
              <p className="text-[11px] text-muted-foreground">
                Configure Present for your context
              </p>
            </div>

            <nav className="space-y-1 text-xs">
              <div className="rounded-md bg-primary/10 px-2 py-1.5 font-medium text-primary">
                Scripture
              </div>
            </nav>
          </aside>

          <main className="flex flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-border bg-card px-6 py-3">
              <h2 className="text-sm font-semibold">Scripture</h2>
              <p className="text-[11px] text-muted-foreground">
                Control how voice search listens for Bible passages.
              </p>
            </div>

            <div className="flex flex-1 flex-col space-y-6 overflow-hidden px-6 py-4">
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Voice language
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Choose the language or accent the microphone should expect
                  when identifying scripture.
                </p>
                <div className="mt-2 max-w-xs">
                  <select
                    value={settingsLang}
                    onChange={(e) => setSettingsLang(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  >
                    {SETTINGS_LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Typography
                </h3>
                <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 w-fit">
                  <FontFamilySelect
                    value={settingsScriptureFontFamily}
                    onChange={setSettingsScriptureFontFamily}
                  />

                  <FontSizeInput
                    value={settingsScriptureFontSize}
                    onChange={setSettingsScriptureFontSize}
                    presets={[6, 8, 10, 12, 14, 16, 18, 20, 24, 30]}
                    unit="vh"
                    min={1}
                    max={50}
                  />
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Text Alignment
                </h3>
                <div className="flex items-center gap-2">
                  {(["left", "center", "right"] as const).map((align) => (
                    <button
                      key={align}
                      type="button"
                      onClick={() => setSettingsScriptureTextAlign(align)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs capitalize transition",
                        settingsScriptureTextAlign === align
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {align}
                    </button>
                  ))}
                </div>
              </section>

              <section className="flex flex-1 flex-col space-y-2 min-h-0">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Scripture background
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Choose a media file to display behind scripture passages.
                </p>
                {allMediaItems.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Add media in the Media tab to pick a background.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-1 flex-col space-y-3 min-h-0">
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSettingsScriptureBackgroundId(null)}
                        className={
                          settingsScriptureBackgroundId === null
                            ? "rounded-md border border-primary bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
                            : "rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                        }
                      >
                        Use current media
                      </button>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        Background override media
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col space-y-2 min-h-0">
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <span className="text-[11px] text-muted-foreground">
                          Folder
                        </span>
                        <select
                          value={settingsMediaFolderId}
                          onChange={(e) =>
                            setSettingsMediaFolderId(e.target.value)
                          }
                          className="h-7 rounded-md border border-input bg-background px-2 text-[11px] text-foreground"
                        >
                          <option value="all">All folders</option>
                          {folders.map((folder) => (
                            <option key={folder.id} value={folder.id}>
                              {folder.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex-1 overflow-y-auto rounded-md border border-border bg-card p-2">
                        <div className="grid grid-cols-6 gap-1.5">
                          {settingsMediaItems.map((item) => {
                            const isActive =
                              settingsScriptureBackgroundId === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  setSettingsScriptureBackgroundId(item.id);
                                  selectMediaForOutput(item);
                                }}
                                className={
                                  (isActive
                                    ? "border-primary ring-1 ring-primary "
                                    : "border-border hover:border-primary ") +
                                  "relative aspect-video overflow-hidden rounded-md border bg-black"
                                }
                              >
                                {item.type === "image" ? (
                                  <img
                                    src={item.url}
                                    alt={item.name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <video
                                    src={item.url}
                                    className="h-full w-full object-cover"
                                    muted
                                    onMouseEnter={(e) => e.currentTarget.play()}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.pause();
                                      e.currentTarget.currentTime = 0;
                                    }}
                                  />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </main>
        </div>
      </Activity>

      <Activity mode={viewMode === "settings" ? "hidden" : "visible"}>
        <ResizablePanelGroup
          direction="horizontal"
          className="flex-1"
          autoSaveId="present-main-layout-v2"
        >
          <PresentServicesSidebar
            order={1}
            servicesSidebarProps={{
              services,
              isLoading: servicesLoading,
              selectedServiceId,
              isInsideService,
              selectedService,
              serviceItems,
              serviceItemIndex,
              onEnterService: enterService,
              onExitService: exitService,
              onSelectServiceItem: handleSelectServiceItem,
              onDoubleClickServiceItem: handleDoubleClickServiceItem,
              onRemoveFromService: handleRemoveFromService,
              onCreateService: createNewService,
              onRenameService: renameExistingService,
              onDeleteService: deleteService,
              onReorderServiceItems: selectedServiceId
                ? (from, to) => reorderServiceItems(selectedServiceId, from, to)
                : undefined,
              onReorderServices: reorderServices,
            }}
          />

          <ResizableHandle withHandle />

          <ResizablePanel
            id="center-area"
            order={2}
            defaultSize={66}
            minSize={30}
          >
            <PresentCenterArea
              viewMode={viewMode}
              bottomTab={bottomTab}
              setBottomTab={setBottomTab}
              slidesForGrid={slidesForGrid}
              activeSlideId={activeSlideId}
              selectedIndex={selected?.index ?? null}
              selectedSong={selectedSong}
              selectedSongId={selectedSongId}
              onSelectSlide={handleSelectSlide}
              onEditSlide={handleEditSlide}
              editorProps={{
                fontFamily,
                fontSize,
                fontBold,
                fontItalic,
                fontUnderline,
                onFontStyleChange: updateFontStyle,
                onSave: handleSaveSong,
                onFixLyrics: fixLyrics,
                scrollToSlideIndex: editScrollToSlide,
                onScrollComplete: () => setEditScrollToSlide(null),
              }}
              showViewMedia={showViewMedia}
              activeMediaItem={effectiveActiveMediaItem}
              showVideoRef={showVideoRef}
              videoSettings={videoSettings}
              onOutputPreviewMedia={handleOutputPreviewMedia}
              onVideoPlay={handleVideoPlay}
              onVideoPause={handleVideoPause}
              onVideoEnded={handleVideoEnded}
              onVideoSeeked={handleVideoSeeked}
              showsPanelRef={showsPanelRef}
              mediaPanelRef={mediaPanelRef}
              scripturePanelRef={scripturePanelRef}
              showsPanelProps={{
                songs: filteredSongs,
                isLoading: songsLoading,
                categories,
                selectedSongId,
                selectedCategoryId,
                isInsideService,
                selectedServiceId,
                onSelectSong: setSelectedSongId,
                onSelectCategory: setSelectedCategoryId,
                onCreateSong: createNewSong,
                onRenameSong: handleRenameSong,
                onDeleteSong: deleteSong,
                onAddToService: handleAddToService,
                onCreateCategory: createNewCategory,
                onFixLyrics: fixLyrics,
                searchQuery,
                onSearchChange: setSearchQuery,
              }}
              mediaPanelProps={{
                mediaState,
                onSelectForOutput: handleMediaPanelSelect,
                isInsideService,
                selectedServiceId,
                onAddToService: handleAddMediaToService,
                orgId,
              }}
              onSendScripture={handleScriptureOutput}
              orgId={orgId}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <PresentOutputSidebar
            order={3}
            outputPreviewProps={{
              text: activeSlideContent?.text ?? null,
              footer: activeSlideContent?.footer ?? null,
              fontFamily,
              fontSize,
              fontBold,
              fontItalic,
              fontUnderline,
              groups: slideGroups,
              activeMediaItem: effectiveActiveMediaItem,
              videoSettings,
              onVideoSettingsChange: updateVideoSettings,
              showText: showTextInOutput,
              showMedia: showMediaInOutput,
              onToggleText: () => setShowTextInOutput(!showTextInOutput),
              onToggleMedia: () => setShowMediaInOutput(!showMediaInOutput),
              onClearMedia: () => selectMediaForOutput(null),
              mediaFilters,
              onMediaFiltersChange: updateMediaFilters,
              onResetFilters: resetMediaFilters,
              isVideoPlaying,
              videoCurrentTime,
              isFrozen: isOutputFrozen,
              onToggleFreeze: () => setIsOutputFrozen((prev) => !prev),
            }}
          />
        </ResizablePanelGroup>
      </Activity>
    </div>
  );
}
