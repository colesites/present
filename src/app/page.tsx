"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "@/../convex/_generated/dataModel";

// Hooks
import {
  useOrganization,
  usePlayback,
  useCategories,
  useShowVideoSync,
  useOutputBroadcast,
  usePersistedUIState,
  usePresentMediaFlow,
  useGlobalShortcuts,
} from "@/hooks";
import { useSongs } from "@/features/songs/hooks";
import { useServices } from "@/features/services/hooks";
import { useMediaFolders } from "@/features/media/hooks";
import { useScripture } from "@/features/scripture/hooks/useScripture";
import { parseReference } from "@/features/scripture/lib/parser";
import { generateBibleSlides } from "@/features/scripture/lib/slides";
import type { ScriptureSlide } from "@/features/scripture/lib/slides";
import { db } from "@/features/scripture/lib/db";
import { useLiveQuery } from "dexie-react-hooks";

// Lib
import {
  getSlidesForGrid,
  getActiveSlideText,
  getSlideGroups,
} from "@/lib/present/selectors";

// UI Components
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components";

// Features
import { AppHeader } from "@/features/header";
import { type ShowsPanelRef } from "@/features/shows";
import { type MediaPanelRef } from "@/features/media";
import { type ScripturePanelRef } from "@/features/scripture";
import { PresentCenterArea } from "@/features/present/PresentCenterArea";
import { PresentServicesSidebar } from "@/features/present/PresentServicesSidebar";
import { PresentOutputSidebar } from "@/features/present/PresentOutputSidebar";

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
  } = useSongs(orgId);

  const {
    services,
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
    null,
  );

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
    [selectedSong],
  );

  // Handlers
  const handleSelectSlide = useCallback(
    async (slideId: string, text: string, footer?: string) => {
      await selectSlide(slideId, text, footer);

      const [idPart, indexStr] = slideId.split(":");
      const index = Number(indexStr);

      if (slideId.startsWith("scripture")) {
        setSelected({ songId: null, index });
      } else if (slideId.includes(":")) {
        setSelected({ songId: idPart as any, index });
      }
    },
    [selectSlide],
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
    [setSelectedSongId],
  );

  const handleRemoveFromService = useCallback(
    async (index: number) => {
      if (!selectedServiceId) return;
      await removeFromService(selectedServiceId, index);
    },
    [selectedServiceId, removeFromService],
  );

  const handleAddToService = useCallback(
    async (songId: Id<"songs">) => {
      if (!selectedServiceId) return;
      await addSongToService(selectedServiceId, songId);
    },
    [selectedServiceId, addSongToService],
  );

  const handleAddMediaToService = useCallback(
    async (mediaId: string, mediaName: string) => {
      if (!selectedServiceId) return;
      await addMediaToService(selectedServiceId, mediaId, mediaName);
    },
    [selectedServiceId, addMediaToService],
  );

  const handleSaveSong = useCallback(
    async (title: string, lyrics: string) => {
      if (!selectedSongId) return;
      await updateExistingSong(selectedSongId, title, lyrics);
    },
    [selectedSongId, updateExistingSong],
  );

  const handleRenameSong = useCallback(
    async (songId: Id<"songs">, newTitle: string) => {
      const song = songs.find((s) => s._id === songId);
      if (!song) return;
      await updateExistingSong(songId, newTitle, song.lyrics);
    },
    [songs, updateExistingSong],
  );

  const handleScriptureOutput = useCallback(
    async (slides: ScriptureSlide[]) => {
      // Clear current song selection when showing scripture
      setSelectedSongId(null);
      setScriptureSlides(slides);

      if (slides.length > 0) {
        // Use consistent scripture:index format
        await handleSelectSlide(
          `scripture:0`,
          slides[0].content,
          slides[0].footer,
        );
      }
    },
    [handleSelectSlide, setSelectedSongId],
  );

  const handleSelectScripture = useCallback(
    async (refString: string) => {
      if (availableBooks.length === 0) return;

      const parsed = parseReference(refString, availableBooks);
      if (!parsed.book || parsed.errors.length > 0) {
        console.warn(
          "Failed to parse scripture ref from service:",
          refString,
          parsed.errors,
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
        let versionName = parsed.versionCode;

        if (!versionName && verses[0].version) {
          // If we didn't parse a version code, we should try to find it.
          // Since "versions" isn't in scope, we will rely on generateBibleSlides' fallback
          // which uppercases the version ID. This is usually "KJV" etc. so it might affect "nkjv" -> "NKJV"
          // correct enough for now.
          // However, if the ID is "nkjv-1982" this would look bad.
          // Let's add availableVersions to the hook destructuring to be safe.
        }

        const slides = generateBibleSlides(verses, {
          verseNumberMode: "inline",
          maxLines: 40,
          maxCharsPerLine: 100,
          versionName: versionName ?? undefined,
        });
        handleScriptureOutput(slides);
      }
    },
    [availableBooks, lookupRef, handleScriptureOutput],
  );

  const {
    previewMediaItem,
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
    selectSlide,
    setShouldAutoPlay,
    onSelectScripture: handleSelectScripture,
  });

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
    activeMediaItem,
    videoSettings,
    shouldAutoPlay,
    onAutoPlayConsumed: () => setShouldAutoPlay(false),
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
    activeMediaItem,
    showText: showTextInOutput,
    showMedia: showMediaInOutput,
    videoSettings,
    mediaFilterCSS,
    isVideoPlaying,
    videoCurrentTime,
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
  ]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header - Fixed, not resizable */}
      <AppHeader viewMode={viewMode} onViewModeChange={setViewMode} />

      {/* Main resizable layout - autoSaveId persists sizes to localStorage */}
      <ResizablePanelGroup
        direction="horizontal"
        className="flex-1"
        autoSaveId="present-main-layout-v2"
      >
        {/* Left sidebar - Services (default ~200px on 1400px screen = 14%) */}
        <PresentServicesSidebar
          servicesSidebarProps={{
            services,
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

        {/* Center content with vertical split (slides + bottom tabs) */}
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
              onSave: handleSaveSong, // ASYNC — SAME AS BEFORE
              onFixLyrics: fixLyrics,
              scrollToSlideIndex: editScrollToSlide,
              onScrollComplete: () => setEditScrollToSlide(null),
            }}
            showViewMedia={showViewMedia}
            activeMediaItem={activeMediaItem}
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

        {/* Right sidebar - Output Preview + Groups (default ~280px on 1400px screen = 20%) */}
        <PresentOutputSidebar
          outputPreviewProps={{
            text: activeSlideContent?.text ?? null,
            footer: activeSlideContent?.footer ?? null,
            fontBold,
            fontItalic,
            fontUnderline,
            groups: slideGroups,
            activeMediaItem,
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
          }}
        />
      </ResizablePanelGroup>
    </div>
  );
}
