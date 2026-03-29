import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { MediaPanelRef } from "../media";
import type { ScripturePanelRef } from "../scripture";
import { useScripture } from "../scripture/hooks/useScripture";
import { db } from "../scripture/lib/db";
import type { ScriptureSlide } from "../scripture/lib/slides";
import { useServices } from "../services/hooks";
import type { ShowsPanelRef } from "../shows";
import { useLibrary } from "../library/hooks";
import type {
  LibraryItem,
  ViewMode,
  BottomTab,
  ContentSource,
} from "../../shared/types";
import {
  useCategories,
  useOutputBroadcast,
  usePlayback,
  usePresentMediaFlow,
  useShowVideoSync,
} from "../../renderer/shared/hooks";
import { MediaState, MediaItem } from "../media/hooks/useMediaFolders";
import {
  getActiveSlideText,
  getSlideGroups,
  getSlidesForGrid,
} from "../../renderer/shared/lib/present/selectors";
import { useSpeechAutopilot } from "../../renderer/shared/hooks/useSpeechAutopilot";
import { useAppNavigation } from "../../renderer/shared/hooks/useAppNavigation";
import { useAppHandlers } from "../../renderer/shared/hooks/useAppHandlers";
import { MainView } from "./MainView";

interface PresentContainerProps {
  orgId: Id<"organizations"> | undefined;
  userId: string | null;
  viewMode: ViewMode;
  bottomTab: BottomTab;
  contentSource: ContentSource;
  mediaState: MediaState;
  settings: any;
  showsPanelRef: React.RefObject<ShowsPanelRef>;
  mediaPanelRef: React.RefObject<MediaPanelRef>;
  scripturePanelRef: React.RefObject<ScripturePanelRef>;
  isAutopilotEnabled: boolean;
}

export function PresentContainer({
  orgId,
  userId,
  viewMode,
  bottomTab,
  mediaState,
  settings,
  showsPanelRef,
  mediaPanelRef,
  scripturePanelRef,
  isAutopilotEnabled,
  contentSource,
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
    settingsTimerXPercent,
    settingsTimerYPercent,
    settingsTimerClockFontPx,
    settingsTimerNameFontPx,
    settingsTimerClockColor,
    settingsTimerNameColor,
    settingsTimerNameBannerEnabled,
    settingsTimerNameBannerColor,
    settingsTimerTitlePosition,
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
    libraryItems,
    filteredItems: filteredLibraryItems,
    selectedItem: selectedLibraryItem,
    selectedItemId: selectedLibraryId,
    selectedCategoryId,
    searchQuery,
    setSelectedItemId: setSelectedLibraryId,
    setSelectedCategoryId,
    setSearchQuery,
    createNewItem: createNewLibraryItem,
    updateExistingItem: updateExistingLibraryItem,
    deleteItem: deleteLibraryItem,
    isLoading: libraryLoading,
  } = useLibrary(
    { orgId: orgId ?? null, userId: userId ?? null },
    contentSource
  );

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
    addLibraryItemToService: addLibraryToService,
    addMediaToService,
    removeFromService,
    reorderServiceItems,
    reorderServices,
    enterService,
    exitService,
  } = useServices({ orgId: orgId ?? null, userId }, libraryItems);

  const { categories, createNewCategory } = useCategories({
    orgId: orgId ?? null,
    userId,
  });

  // Output visibility toggles
  const [showTextInOutput, setShowTextInOutput] = useState(true);
  const [showMediaInOutput, setShowMediaInOutput] = useState(true);
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);

  // Scripture Logic
  const { lookupRef } = useScripture();
  const availableBooks = useLiveQuery(() => db.books.toArray(), []) ?? [];
  const [scriptureSlides, setScriptureSlides] = useState<ScriptureSlide[]>([]);

  const [selected, setSelected] = useState<{
    libraryId: string | null;
    index: number;
  } | null>(null);
  const [editScrollToSlide, setEditScrollToSlide] = useState<number | null>(
    null
  );
  const [isOutputFrozen, setIsOutputFrozen] = useState(false);

  // Memos
  const slidesForGrid = useMemo(() => {
    if (selectedLibraryItem) return getSlidesForGrid(selectedLibraryItem);
    if (bottomTab === "scripture" && scriptureSlides.length > 0) {
      return scriptureSlides.map((item, i) => ({
        slide: { text: item.content, label: item.label, footer: item.footer },
        index: i,
        libraryItem: null as LibraryItem | null,
      }));
    }
    return [];
  }, [bottomTab, selectedLibraryItem, scriptureSlides]);

  const isScriptureActive = useMemo(() => {
    if (activeSlideId?.startsWith("scripture:")) return true;
    if (bottomTab === "scripture" && !selectedLibraryId) return true;
    if (scriptureSlides.length > 0 && !selectedLibraryId) return true;
    return false;
  }, [activeSlideId, bottomTab, selectedLibraryId, scriptureSlides.length]);

  const activeSlideContent = useMemo(() => {
    if (activeSlideId?.startsWith("scripture:")) {
      const indexStr = activeSlideId.split(":")[1];
      const index = parseInt(indexStr, 10);
      const slide = scriptureSlides[index];
      return slide ? { text: slide.content, footer: slide.footer } : null;
    }
    const text = getActiveSlideText(activeSlideId, libraryItems);
    return text ? { text } : null;
  }, [activeSlideId, libraryItems, scriptureSlides]);

  const slideGroups = useMemo(
    () => getSlideGroups(selectedLibraryItem),
    [selectedLibraryItem]
  );

  const scriptureBackgroundMediaItem = useMemo(
    () =>
      settingsScriptureBackgroundId
        ? activeMediaItem &&
          activeMediaItem.id === settingsScriptureBackgroundId
          ? activeMediaItem
          : (allMediaItems.find(
              (item: MediaItem) => item.id === settingsScriptureBackgroundId
            ) ?? null)
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
    handleSaveLibraryItem,
    handleRenameLibraryItem,
    handleScriptureOutput,
    handleSelectScripture,
  } = useAppHandlers({
    setSelected,
    setViewMode: () => {
      /* No-op in PresentContainer */
    }, // Not used in PresentContainer for now, but signature requires it
    setSelectedLibraryId,
    setScriptureSlides,
    setShowTextInOutput,
    setEditScrollToSlide,
    selectSlide: (id, text, footer, options) => {
      // Logic for selecting a slide
      return selectSlide(id, text, footer, options);
    },
    removeFromService,
    addLibraryItemToService: addLibraryToService,
    addMediaToService,
    updateExistingLibraryItem,
    libraryItems,
    selectedServiceId,
    selectedLibraryId,
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
    setSelectedLibraryId,
    selectMediaForOutput,
    selectSlide: (slideId: string, text: string) =>
      selectSlide(slideId, text, undefined, {
        suppressBroadcast: isOutputFrozen,
      }),
    setShouldAutoPlay,
    onSelectScripture: handleSelectScripture,
    onClearScripture: () => {
      setScriptureSlides([]);
      setSelected({ libraryId: null, index: -1 });
    },
  });

  // Coordination Hooks
  useSpeechAutopilot({
    isAutopilotEnabled,
    viewMode,
    slidesForGrid,
    selected,
    handleSelectSlide: async (id, text, footer) => {
      handleSelectSlide(id, text, footer);
    },
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
    isVideoPlaying:
      isScriptureActive && effectiveActiveMediaItem?.type === "video"
        ? true
        : isVideoPlaying,
    videoCurrentTime,
    isFrozen: isOutputFrozen,
    scriptureStyle: {
      fontSize: settingsScriptureFontSize,
      fontFamily: settingsScriptureFontFamily,
      textAlign: settingsScriptureTextAlign,
    },
    libraryStyle: {
      fontFamily,
      fontSize,
      fontBold,
      fontItalic,
      fontUnderline,
    },
    timerLayout: {
      xPercent: settingsTimerXPercent,
      yPercent: settingsTimerYPercent,
      clockFontPx: settingsTimerClockFontPx,
      nameFontPx: settingsTimerNameFontPx,
      clockColor: settingsTimerClockColor,
      nameColor: settingsTimerNameColor,
      nameBannerEnabled: settingsTimerNameBannerEnabled,
      nameBannerColor: settingsTimerNameBannerColor,
      titlePosition: settingsTimerTitlePosition,
    },
    activeSlideId,
    slideText: activeSlideContent?.text ?? null,
    slideFooter: activeSlideContent?.footer ?? null,
  });

  useAppNavigation({
    viewMode,
    selectedLibraryItem,
    selectedLibraryId,
    selected,
    slidesForGrid,
    handleSelectSlide,
    scriptureSlidesCount: scriptureSlides.length,
  });

  return (
    <MainView
      viewMode={viewMode}
      bottomTab={bottomTab}
      contentSource={contentSource}
      orgId={orgId}
      userId={userId}
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
        onCreateService: async (name) => {
          await createNewService(name);
        },
        onRenameService: renameExistingService,
        onDeleteService: deleteService,
        onReorderServiceItems: selectedServiceId
          ? (from: number, to: number) =>
              reorderServiceItems(selectedServiceId, from, to)
          : () => Promise.resolve(),
        onReorderServices: reorderServices,
      }}
      presentState={{
        slidesForGrid,
        activeSlideId,
        selected,
        selectedLibraryItem,
        selectedLibraryId,
        setSelectedLibraryId,
        handleSelectSlide,
        handleEditSlide,
        handleSaveLibraryItem,
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
      libraryState={{
        filteredLibraryItems,
        libraryLoading,
        categories,
        selectedCategoryId,
        setSelectedCategoryId,
        createNewLibraryItem: async (title, body, categoryId) => {
          await createNewLibraryItem(title, body, categoryId);
        },
        handleRenameLibraryItem,
        deleteLibraryItem,
        handleAddToService,
        createNewCategory: async (name) => {
          await createNewCategory(name);
        },
        searchQuery,
        setSearchQuery,
        contentSource,
      }}
      styleState={{
        fontFamily,
        fontSize,
        fontBold,
        fontItalic,
        fontUnderline,
        scriptureFontFamily: settingsScriptureFontFamily,
        scriptureFontSize: settingsScriptureFontSize,
        scriptureTextAlign: settingsScriptureTextAlign,
        timerLayout: {
          xPercent: settingsTimerXPercent,
          yPercent: settingsTimerYPercent,
          clockFontPx: settingsTimerClockFontPx,
          nameFontPx: settingsTimerNameFontPx,
          clockColor: settingsTimerClockColor,
          nameColor: settingsTimerNameColor,
          nameBannerEnabled: settingsTimerNameBannerEnabled,
          nameBannerColor: settingsTimerNameBannerColor,
          titlePosition: settingsTimerTitlePosition,
        },
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
