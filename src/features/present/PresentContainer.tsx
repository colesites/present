"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MediaPanelRef } from "../media";
import type { ScripturePanelRef } from "../scripture";
import { useScripture } from "../scripture/hooks/useScripture";
import { db } from "../scripture/lib/db";
import type { ScriptureSlide } from "../scripture/lib/slides";
import { useServices } from "../services/hooks";
import type { ShowsPanelRef } from "../shows";
import { useSongs } from "../songs/hooks";
import type { Song, ViewMode, BottomTab } from "../../types";
import {
  useCategories,
  useOutputBroadcast,
  usePlayback,
  usePresentMediaFlow,
  useShowVideoSync,
} from "../../hooks";
import { MediaState, MediaItem } from "../media/hooks/useMediaFolders";
import {
  getActiveSlideText,
  getSlideGroups,
  getSlidesForGrid,
} from "../../lib/present/selectors";
import { useSpeechAutopilot } from "../../hooks/useSpeechAutopilot";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useAppHandlers } from "../../hooks/useAppHandlers";
import { MainView } from "./MainView";

interface PresentContainerProps {
  orgId: Id<"organizations"> | undefined;
  viewMode: ViewMode;
  bottomTab: BottomTab;
  setBottomTab: (tab: BottomTab) => void;
  mediaState: MediaState; 
  settings: Record<string, any>;   
  showsPanelRef: React.RefObject<ShowsPanelRef>;
  mediaPanelRef: React.RefObject<MediaPanelRef>;
  scripturePanelRef: React.RefObject<ScripturePanelRef>;
  isAutopilotEnabled: boolean;
}

export function PresentContainer({
  orgId,
  viewMode,
  bottomTab,
  setBottomTab,
  mediaState,
  settings,
  showsPanelRef,
  mediaPanelRef,
  scripturePanelRef,
  isAutopilotEnabled,
}: PresentContainerProps) {
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

  const {
    settingsScriptureFontSize,
    settingsScriptureFontFamily,
    settingsScriptureTextAlign,
    settingsScriptureBackgroundId,
  } = settings;

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

  // Output visibility toggles
  const [showTextInOutput, setShowTextInOutput] = useState(true);
  const [showMediaInOutput, setShowMediaInOutput] = useState(true);
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);

  // Scripture Logic
  const { lookupRef } = useScripture();
  const availableBooks = useLiveQuery(() => db.books.toArray(), []) ?? [];
  const [scriptureSlides, setScriptureSlides] = useState<ScriptureSlide[]>([]);

  const [selected, setSelected] = useState<{
    songId: Id<"songs"> | null;
    index: number;
  } | null>(null);
  const [editScrollToSlide, setEditScrollToSlide] = useState<number | null>(null);
  const [isOutputFrozen, setIsOutputFrozen] = useState(false);

  // Memos
  const slidesForGrid = useMemo(() => {
    if (selectedSong) return getSlidesForGrid(selectedSong);
    if (scriptureSlides.length > 0) {
      return scriptureSlides.map((item, i) => ({
        slide: { text: item.content, label: item.label, footer: item.footer },
        index: i,
        song: null as Song | null,
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

  const slideGroups = useMemo(() => getSlideGroups(selectedSong), [selectedSong]);

  const scriptureBackgroundMediaItem = useMemo(
    () =>
      settingsScriptureBackgroundId
        ? activeMediaItem && activeMediaItem.id === settingsScriptureBackgroundId
          ? activeMediaItem
          : allMediaItems.find((item: MediaItem) => item.id === settingsScriptureBackgroundId) ?? null
        : null,
    [activeMediaItem, allMediaItems, settingsScriptureBackgroundId]
  );

  const effectiveActiveMediaItem = isScriptureActive
    ? (scriptureBackgroundMediaItem ?? activeMediaItem)
    : activeMediaItem;

  // Handlers Hook
  const {
    handleSelectSlide,
    handleEditSlide,
    handleRemoveFromService,
    handleAddToService,
    handleAddMediaToService,
    handleSaveSong,
    handleRenameSong,
    handleScriptureOutput,
    handleSelectScripture,
  } = useAppHandlers({
    setSelected,
    setViewMode: () => { /* No-op in PresentContainer */ }, // Not used in PresentContainer for now, but signature requires it
    setSelectedSongId,
    setScriptureSlides,
    setShowTextInOutput,
    setEditScrollToSlide,
    selectSlide,
    removeFromService,
    addSongToService,
    addMediaToService,
    updateExistingSong,
    songs,
    selectedServiceId,
    selectedSongId,
    isOutputFrozen,
    availableBooks,
    lookupRef,
  });

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

  // Coordination Hooks
  useSpeechAutopilot({
    isAutopilotEnabled,
    viewMode,
    slidesForGrid,
    selected,
    handleSelectSlide,
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
    activeMediaItem: effectiveActiveMediaItem,
    videoSettings,
    shouldAutoPlay,
    onAutoPlayConsumed: () => setShouldAutoPlay(false),
    forcePlay: isScriptureActive && effectiveActiveMediaItem?.type === "video",
  });

  useOutputBroadcast({
    activeMediaItem: effectiveActiveMediaItem,
    showText: showTextInOutput,
    showMedia: showMediaInOutput,
    videoSettings,
    mediaFilterCSS,
    isVideoPlaying: (isScriptureActive && effectiveActiveMediaItem?.type === "video") ? true : isVideoPlaying,
    videoCurrentTime,
    isFrozen: isOutputFrozen,
    scriptureStyle: {
      fontSize: settingsScriptureFontSize,
      fontFamily: settingsScriptureFontFamily,
      textAlign: settingsScriptureTextAlign,
    },
    songStyle: {
      fontFamily,
      fontSize,
      fontBold,
      fontItalic,
      fontUnderline,
    },
    activeSlideId,
    slideText: activeSlideContent?.text ?? null,
    slideFooter: activeSlideContent?.footer ?? null,
  });

  useAppNavigation({
    viewMode,
    selectedSong,
    selectedSongId,
    selected,
    slidesForGrid,
    handleSelectSlide,
    scriptureSlidesCount: scriptureSlides.length,
  });

  return (
    <MainView
      viewMode={viewMode}
      bottomTab={bottomTab}
      setBottomTab={setBottomTab}
      orgId={orgId}
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
          ? (from: number, to: number) => reorderServiceItems(selectedServiceId, from, to)
          : () => Promise.resolve(),
        onReorderServices: reorderServices,
      }}
      presentState={{
        slidesForGrid,
        activeSlideId,
        selected,
        selectedSong,
        selectedSongId,
        setSelectedSongId,
        handleSelectSlide,
        handleEditSlide,
        handleSaveSong,
        editScrollToSlide,
        setEditScrollToSlide,
        handleScriptureOutput,
        activeSlideContent,
        slideGroups,
      }}
      mediaState={{
        mediaState,
        showViewMedia,
        effectiveActiveMediaItem,
        showVideoRef,
        videoSettings,
        handleOutputPreviewMedia,
        handleVideoPlay,
        handleVideoPause,
        handleVideoEnded,
        handleVideoSeeked,
        handleMediaPanelSelect,
        handleAddMediaToService,
        updateVideoSettings,
        showMediaInOutput,
        setShowMediaInOutput,
        onClearMedia: () => selectMediaForOutput(null),
        mediaFilters,
        onMediaFiltersChange: updateMediaFilters,
        onResetFilters: resetMediaFilters,
        isVideoPlaying,
        videoCurrentTime,
      }}
      songState={{
        filteredSongs,
        songsLoading,
        categories,
        selectedCategoryId,
        setSelectedCategoryId,
        createNewSong,
        handleRenameSong,
        deleteSong,
        handleAddToService,
        createNewCategory,
        searchQuery,
        setSearchQuery,
      }}
      styleState={{
        fontFamily,
        fontSize,
        fontBold,
        fontItalic,
        fontUnderline,
        updateFontStyle,
      }}
      panelRefs={{
        showsPanelRef,
        mediaPanelRef,
        scripturePanelRef,
      }}
      outputState={{
        isFrozen: isOutputFrozen,
        onToggleFreeze: () => setIsOutputFrozen((prev) => !prev),
        showTextInOutput,
        setShowTextInOutput,
      }}
    />
  );
}
