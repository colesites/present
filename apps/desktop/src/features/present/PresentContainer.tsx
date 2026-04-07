import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { toast } from "sonner";
import type { MediaPanelRef } from "../media";
import type { ScripturePanelRef } from "../scripture";
import { useScripture } from "../scripture/hooks/useScripture";
import { db } from "../scripture/lib/db";
import type { ScriptureSlide } from "../scripture/lib/slides";
import { useServices } from "../services/hooks";
import type { LibrariesPanelRef } from "../shows";
import { useLibrary } from "../library/hooks";
import type {
  LibraryItem,
  LibraryItemDraft,
  ViewMode,
  BottomTab,
  ContentSource,
  CanvasSizePreset,
  SlideElement,
  ServicePresentation,
} from "../../shared/types";
import {
  useCategories,
  useOutputBroadcast,
  usePlayback,
  usePresentMediaFlow,
  useShowVideoSync,
} from "../../renderer/shared/hooks";
import type { useAppSettings } from "../../renderer/shared/hooks/useAppSettings";
import { MediaState, MediaItem } from "../media/hooks/useMediaFolders";
import {
  getActiveLibrarySlide,
  getActiveSlideText,
  getSlideGroups,
  getSlidesForGrid,
} from "../../renderer/shared/lib/present/selectors";
import { useSpeechAutopilot } from "../../renderer/shared/hooks/useSpeechAutopilot";
import { useAppNavigation } from "../../renderer/shared/hooks/useAppNavigation";
import { useAppHandlers } from "../../renderer/shared/hooks/useAppHandlers";
import { MainView } from "./MainView";
import {
  getSlideBackgroundColor,
  reorderLibrarySlides,
} from "../library/lib/library-items";
import {
  importServicePresentationFile,
  type PresentationImportMode,
  type PresentationImportSource,
} from "../library/lib/import-documents";
import {
  buildScriptureEditorLibraryItem,
  scriptureDraftToSlides,
} from "../scripture/lib/editor";

type EditedOutputSnapshot = {
  slideId: string;
  text: string;
  elements: SlideElement[];
  canvasSize: CanvasSizePreset;
  backgroundColor: string | null;
};

type OutputSlideContent = {
  text: string;
  footer?: string;
  elements?: SlideElement[] | null;
  canvasSize?: CanvasSizePreset | null;
  backgroundColor?: string | null;
};

const IMPORT_ERROR_DURATION_MS = 6000;

function buildServicePresentationLibraryItem(
  refId: string,
  presentation: ServicePresentation,
): LibraryItem {
  return {
    _id: `presentation_${refId}`,
    _creationTime: 0,
    orgId: "service-presentation",
    title: presentation.title,
    body: "",
    slides: presentation.slides,
    content: presentation.content,
    createdAt: 0,
    updatedAt: 0,
    version: 1,
    deleted: false,
    type: "slide",
  };
}

interface PresentContainerProps {
  orgId: Id<"organizations"> | undefined;
  userId: string | null;
  viewMode: ViewMode;
  bottomTab: BottomTab;
  contentSource: ContentSource;
  mediaState: MediaState;
  settings: ReturnType<typeof useAppSettings>;
  showsPanelRef: React.RefObject<LibrariesPanelRef>;
  mediaPanelRef: React.RefObject<MediaPanelRef>;
  scripturePanelRef: React.RefObject<ScripturePanelRef>;
  isAutopilotEnabled: boolean;
  showTextInOutput: boolean;
  setShowTextInOutput: (show: boolean) => void;
  showMediaInOutput: boolean;
  setShowMediaInOutput: (show: boolean) => void;
  isTimerLayerEnabled: boolean;
  setIsTimerLayerEnabled: (show: boolean) => void;
  isMessageLayerEnabled: boolean;
  setIsMessageLayerEnabled: (show: boolean) => void;
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
  showTextInOutput,
  setShowTextInOutput,
  showMediaInOutput,
  setShowMediaInOutput,
  isTimerLayerEnabled,
  setIsTimerLayerEnabled,
  isMessageLayerEnabled,
  setIsMessageLayerEnabled,
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
    settingsScriptureFooterFontSize,
    settingsScriptureFontFamily,
    settingsScriptureFontWeight,
    settingsScriptureTextAlign,
    settingsScriptureVerticalAlign,
    settingsScriptureFooterAlign,
    settingsScriptureFooterPosition,
    setSettingsScriptureFontSize,
    setSettingsScriptureTextAlign,
    setSettingsScriptureVerticalAlign,
    setSettingsScriptureFooterAlign,
    setSettingsScriptureFooterPosition,
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
    settingsLibraryFontFamily,
    settingsLibraryFontSize,
    settingsLibraryFontWeight,
  } = settings;

  const libraryTextDefaults = useMemo(
    () => ({
      fontFamily: settingsLibraryFontFamily,
      fontSize: settingsLibraryFontSize,
      fontWeight: settingsLibraryFontWeight,
    }),
    [
      settingsLibraryFontFamily,
      settingsLibraryFontSize,
      settingsLibraryFontWeight,
    ],
  );

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
    createComposedItem: createComposedLibraryItem,
    saveExistingItem: updateExistingLibraryItem,
    reorderItemSlides,
    deleteItem: deleteLibraryItem,
    isLoading: libraryLoading,
  } = useLibrary(
    { orgId: orgId ?? null, userId: userId ?? null },
    contentSource,
    {
      defaultTextStyle: libraryTextDefaults,
    },
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
    addPresentationToService,
    updatePresentationInService,
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

  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);

  // Scripture Logic
  const { lookupRef } = useScripture();
  const availableBooks = useLiveQuery(() => db.books.toArray(), []) ?? [];
  const [scriptureSlides, setScriptureSlides] = useState<ScriptureSlide[]>([]);

  const [selected, setSelected] = useState<{
    libraryId: string | null;
    index: number;
  } | null>(null);
  const [selectedPresentationLibraryId, setSelectedPresentationLibraryId] =
    useState<string | null>(null);
  const [editScrollToSlide, setEditScrollToSlide] = useState<number | null>(
    null
  );
  const [isOutputFrozen, setIsOutputFrozen] = useState(false);
  const [editedOutputSnapshot, setEditedOutputSnapshot] =
    useState<EditedOutputSnapshot | null>(null);

  const servicePresentationLibraryItems = useMemo(
    () =>
      serviceItems
        .filter(
          (item): item is (typeof serviceItems)[number] & {
            presentation: ServicePresentation;
          } => item.type === "presentation" && item.presentation != null,
        )
        .map((item) =>
          buildServicePresentationLibraryItem(item.refId, item.presentation),
        ),
    [serviceItems],
  );
  const selectedPresentationItem =
    servicePresentationLibraryItems.find(
      (item) => String(item._id) === selectedPresentationLibraryId,
    ) ?? null;
  const selectedServicePresentationItem = useMemo(
    () =>
      serviceItems.find(
        (item): item is (typeof serviceItems)[number] & {
          presentation: ServicePresentation;
        } =>
          item.type === "presentation" &&
          item.presentation != null &&
          `presentation_${item.refId}` === selectedPresentationLibraryId,
      ) ?? null,
    [selectedPresentationLibraryId, serviceItems],
  );
  const selectedDeckItem = selectedLibraryItem ?? selectedPresentationItem;
  const selectedDeckLibraryId = selectedLibraryId ?? selectedPresentationLibraryId;
  const handleSetSelectedDeckLibraryId = useCallback(
    (id: string | null) => {
      if (id && id.startsWith("presentation_")) {
        setSelectedPresentationLibraryId(id);
        setSelectedLibraryId(null);
        return;
      }

      setSelectedPresentationLibraryId(null);
      setSelectedLibraryId(id);
    },
    [setSelectedLibraryId],
  );
  const availableSlideDeckItems = useMemo(
    () => [...libraryItems, ...servicePresentationLibraryItems],
    [libraryItems, servicePresentationLibraryItems],
  );

  useEffect(() => {
    if (!selectedPresentationLibraryId) {
      return;
    }

    const stillExists = servicePresentationLibraryItems.some(
      (item) => String(item._id) === selectedPresentationLibraryId,
    );
    if (!stillExists) {
      setSelectedPresentationLibraryId(null);
    }
  }, [selectedPresentationLibraryId, servicePresentationLibraryItems]);

  // Memos
  const slidesForGrid = useMemo(() => {
    if (selectedLibraryItem) {
      return getSlidesForGrid(selectedLibraryItem);
    }
    if (selectedPresentationItem) {
      return selectedPresentationItem.slides.map((slide, index) => ({
        libraryItem: null as LibraryItem | null,
        slide,
        index,
        id: `${selectedPresentationItem._id}:${slide.id ?? index}`,
      }));
    }
    if (bottomTab === "scripture" && scriptureSlides.length > 0) {
      return scriptureSlides.map((item, i) => ({
        slide: { text: item.content, label: item.label, footer: item.footer },
        index: i,
        libraryItem: null as LibraryItem | null,
      }));
    }
    return [];
  }, [bottomTab, selectedLibraryItem, selectedPresentationItem, scriptureSlides]);

  const scriptureEditorItem = useMemo(
    () =>
      buildScriptureEditorLibraryItem(scriptureSlides, {
        canvasSize: "1920x1080",
        fontFamily: settingsScriptureFontFamily,
        fontSize: settingsScriptureFontSize,
        footerFontSize: settingsScriptureFooterFontSize,
        fontWeight: settingsScriptureFontWeight,
        textAlign: settingsScriptureTextAlign,
        verticalAlign: settingsScriptureVerticalAlign,
        footerAlign: settingsScriptureFooterAlign,
        footerPosition: settingsScriptureFooterPosition,
      }),
    [
      scriptureSlides,
      settingsScriptureFontFamily,
      settingsScriptureFontSize,
      settingsScriptureFooterFontSize,
      settingsScriptureFontWeight,
      settingsScriptureTextAlign,
      settingsScriptureVerticalAlign,
      settingsScriptureFooterAlign,
      settingsScriptureFooterPosition,
    ],
  );

  const isScriptureActive = useMemo(() => {
    if (activeSlideId?.startsWith("scripture:")) {
      return scriptureSlides.length > 0;
    }
    if (
      bottomTab === "scripture" &&
      scriptureSlides.length > 0 &&
      !selectedLibraryId &&
      !selectedPresentationLibraryId
    ) {
      return true;
    }
    return false;
  }, [
    activeSlideId,
    bottomTab,
    selectedLibraryId,
    selectedPresentationLibraryId,
    scriptureSlides.length,
  ]);

  const activeSlideContent = useMemo<OutputSlideContent | null>(() => {
    if (activeSlideId?.startsWith("scripture:")) {
      const indexStr = activeSlideId.split(":")[1];
      const index = parseInt(indexStr, 10);
      const slide = scriptureSlides[index];
      return slide
        ? {
            text: slide.content,
            footer: slide.footer,
            elements: slide.elements ?? null,
            canvasSize: slide.canvasSize ?? "1920x1080",
            backgroundColor:
              slide.useBackgroundColor ? slide.backgroundColor ?? null : null,
          }
        : null;
    }
    const activeLibrarySlide = getActiveLibrarySlide(
      activeSlideId,
      availableSlideDeckItems,
    );
    if (activeLibrarySlide) {
      return {
        text: activeLibrarySlide.slide.text,
        elements: activeLibrarySlide.slide.elements ?? null,
        canvasSize:
          activeLibrarySlide.item.content?.presentation?.canvasSize ?? null,
        backgroundColor: getSlideBackgroundColor(
          activeLibrarySlide.slide,
          activeLibrarySlide.item.content,
        ),
      };
    }
    const text = getActiveSlideText(activeSlideId, availableSlideDeckItems);
    return text ? { text, elements: null, canvasSize: null } : null;
  }, [activeSlideId, availableSlideDeckItems, scriptureSlides]);

  const outputSlideContent = useMemo<OutputSlideContent | null>(
    () =>
      editedOutputSnapshot
        ? {
            text: editedOutputSnapshot.text,
            footer: undefined,
            elements: editedOutputSnapshot.elements,
            canvasSize: editedOutputSnapshot.canvasSize,
            backgroundColor: editedOutputSnapshot.backgroundColor,
          }
        : activeSlideContent,
    [activeSlideContent, editedOutputSnapshot],
  );

  const outputActiveSlideId =
    editedOutputSnapshot?.slideId ?? activeSlideId ?? null;

  const slideGroups = useMemo(
    () => getSlideGroups(selectedDeckItem),
    [selectedDeckItem],
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
    setSelectedLibraryId: handleSetSelectedDeckLibraryId,
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
    libraryItems: availableSlideDeckItems,
    selectedServiceId,
    selectedLibraryId: selectedDeckLibraryId,
    isOutputFrozen,
    availableBooks,
    lookupRef,
  });

  const handleUpdateEditedSlideOutput = useCallback(
    (payload: EditedOutputSnapshot) => {
      setEditedOutputSnapshot(payload);
    },
    [],
  );

  const handleSaveScriptureEditor = useCallback(
    async (draft: LibraryItemDraft) => {
      setEditedOutputSnapshot(null);
      setScriptureSlides((previousSlides) =>
        scriptureDraftToSlides(draft, previousSlides),
      );
    },
    [],
  );

  const handleUpdateScriptureEditedSlideOutput = useCallback(
    (payload: EditedOutputSnapshot) => {
      const match = payload.slideId.match(/^scripture:(\d+)$/);
      if (!match) {
        return;
      }

      const index = Number.parseInt(match[1] ?? "", 10);
      if (!Number.isFinite(index)) {
        return;
      }

      setEditedOutputSnapshot(null);
      setScriptureSlides((previousSlides) =>
        previousSlides.map((slide, slideIndex) => {
          if (slideIndex !== index) {
            return slide;
          }

          const nextSlides = scriptureDraftToSlides(
            {
              title: "Scripture",
              body: payload.text,
              slides: [
                {
                  id: payload.slideId,
                  text: payload.text,
                  label: slide.label,
                  elements: payload.elements,
                  backgroundColor: payload.backgroundColor ?? undefined,
                  useBackgroundColor: Boolean(payload.backgroundColor),
                },
              ],
              content: {
                presentation: {
                  canvasSize: payload.canvasSize,
                },
              },
            },
            [slide],
          );

          return nextSlides[0] ?? slide;
        }),
      );
    },
    [],
  );

  const handleLiveSlideSelect = useCallback(
    async (slideId: string, text: string, footer?: string) => {
      setEditedOutputSnapshot(null);
      await handleSelectSlide(slideId, text, footer);
    },
    [handleSelectSlide],
  );

  const handleLiveScriptureOutput = useCallback(
    (slides: ScriptureSlide[]) => {
      setEditedOutputSnapshot(null);
      handleScriptureOutput(slides);
    },
    [handleScriptureOutput],
  );

  const handleSaveSelectedDeckItem = useCallback(
    async (draft: LibraryItemDraft) => {
      setEditedOutputSnapshot(null);

      if (selectedServiceId && selectedServicePresentationItem?.presentation) {
        await updatePresentationInService(
          selectedServiceId,
          selectedServicePresentationItem.refId,
          {
            ...selectedServicePresentationItem.presentation,
            title:
              draft.title.trim() || selectedServicePresentationItem.presentation.title,
            slides: draft.slides,
            content: draft.content,
          },
        );
        return;
      }

      await handleSaveLibraryItem(draft);
    },
    [
      handleSaveLibraryItem,
      selectedServiceId,
      selectedServicePresentationItem,
      updatePresentationInService,
    ],
  );

  const handleReorderLibrarySlides = async (fromIndex: number, toIndex: number) => {
    if (!selectedDeckLibraryId) {
      return;
    }

    if (selectedServiceId && selectedServicePresentationItem?.presentation) {
      const reorderedSlides = reorderLibrarySlides(
        selectedServicePresentationItem.presentation.slides,
        fromIndex,
        toIndex,
      );
      await updatePresentationInService(
        selectedServiceId,
        selectedServicePresentationItem.refId,
        {
          ...selectedServicePresentationItem.presentation,
          slides: reorderedSlides,
        },
      );
    } else {
      await reorderItemSlides(selectedDeckLibraryId, fromIndex, toIndex);
    }

    setSelected((current) => {
      if (!current || current.libraryId !== selectedDeckLibraryId) {
        return current;
      }

      if (current.index === fromIndex) {
        return { ...current, index: toIndex };
      }

      if (fromIndex < current.index && current.index <= toIndex) {
        return { ...current, index: current.index - 1 };
      }

      if (toIndex <= current.index && current.index < fromIndex) {
        return { ...current, index: current.index + 1 };
      }

      return current;
    });
  };

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
    setShouldAutoPlay,
    onSelectScripture: (refId: string) => {
      setEditedOutputSnapshot(null);
      setSelectedPresentationLibraryId(null);
      handleSelectScripture(refId);
    },
    onSelectPresentation: (refId: string) => {
      setEditedOutputSnapshot(null);
      const presentationLibraryId = `presentation_${refId}`;
      setSelectedPresentationLibraryId(presentationLibraryId);
      setSelected({
        libraryId: presentationLibraryId,
        index: 0,
      });
    },
    onClearScripture: () => {
      setEditedOutputSnapshot(null);
      setScriptureSlides([]);
      setSelected({ libraryId: null, index: -1 });
    },
    onClearPresentation: () => {
      setSelectedPresentationLibraryId(null);
    },
  });

  // Coordination Hooks
  useSpeechAutopilot({
    isAutopilotEnabled,
    viewMode,
    slidesForGrid,
    selected,
    handleSelectSlide: async (id, text, footer) => {
      await handleLiveSlideSelect(id, text, footer);
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
    toggleVideoPlayback,
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
      footerFontSize: settingsScriptureFooterFontSize,
      fontFamily: settingsScriptureFontFamily,
      fontWeight: settingsScriptureFontWeight,
      textAlign: settingsScriptureTextAlign,
      verticalAlign: settingsScriptureVerticalAlign,
      footerAlign: settingsScriptureFooterAlign,
      footerPosition: settingsScriptureFooterPosition,
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
    activeSlideId: outputActiveSlideId,
    slideText: outputSlideContent?.text ?? null,
    slideFooter: outputSlideContent?.footer ?? null,
    slideElements: outputSlideContent?.elements ?? null,
    slideCanvasSize: outputSlideContent?.canvasSize ?? null,
    slideBackgroundColor: outputSlideContent?.backgroundColor ?? null,
  });

  useAppNavigation({
    viewMode,
    bottomTab,
    selectedLibraryId: selectedDeckLibraryId,
    selected,
    slidesForGrid,
    handleSelectSlide: handleLiveSlideSelect,
  });

  const handleImportFiles = useCallback(
    async (
      files: PresentationImportSource[],
      mode: PresentationImportMode = "presentation",
    ) => {
      if (files.length === 0) {
        return;
      }

      if (!selectedServiceId || !isInsideService) {
        toast.error("Open a service first, then import files into it.", {
          duration: IMPORT_ERROR_DURATION_MS,
        });
        return;
      }

      let importedCount = 0;

      for (const file of files) {
        try {
          const presentation = await importServicePresentationFile(file, mode);
          const refId = await addPresentationToService(
            selectedServiceId,
            presentation,
          );
          if (!refId) {
            throw new Error(`Failed to import ${file.name}.`);
          }

          importedCount += 1;
          const presentationLibraryId = `presentation_${refId}`;
          setServiceItemIndex(serviceItems.length + importedCount - 1);
          setSelectedLibraryId(null);
          setSelectedPresentationLibraryId(presentationLibraryId);
          setSelected({ libraryId: presentationLibraryId, index: 0 });
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : `Failed to import ${file.name}.`,
            {
              duration: IMPORT_ERROR_DURATION_MS,
            },
          );
        }
      }

      if (importedCount > 0) {
        toast.success(
          importedCount === 1
            ? `Imported 1 file as ${
                mode === "images" ? "presentation images" : "presentation"
              }`
            : `Imported ${importedCount} files as ${
                mode === "images" ? "presentation images" : "presentation"
              }`,
        );
      }
    },
    [
      addPresentationToService,
      isInsideService,
      selectedServiceId,
      serviceItems.length,
      setSelected,
      setServiceItemIndex,
      setSelectedLibraryId,
      setSelectedPresentationLibraryId,
    ],
  );

  const handleImportRequest = useCallback(async (mode: PresentationImportMode = "presentation") => {
    if (!selectedServiceId || !isInsideService) {
      toast.error("Open a service first, then import files into it.", {
        duration: IMPORT_ERROR_DURATION_MS,
      });
      return;
    }

    if (!window.electronAPI?.selectPresentationFiles) {
      toast.error("File import is unavailable in this build.", {
        duration: IMPORT_ERROR_DURATION_MS,
      });
      return;
    }

    try {
      const selectedFiles = await window.electronAPI.selectPresentationFiles();
      if (!selectedFiles?.length) {
        return;
      }

      await handleImportFiles(
        selectedFiles.map((file) => ({
          name: file.name,
          path: file.path,
          bytes: file.bytes,
          lastModified: file.lastModified,
        })),
        mode,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to open the import dialog.",
        {
          duration: IMPORT_ERROR_DURATION_MS,
        },
      );
    }
  }, [handleImportFiles, isInsideService, selectedServiceId]);

  useEffect(() => {
    if (!window.electronAPI?.onOpenImportFromMenu) {
      return;
    }

    return window.electronAPI.onOpenImportFromMenu((mode) => {
      void handleImportRequest(mode ?? "presentation");
    });
  }, [handleImportRequest]);

  return (
    <>
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
        outputActiveSlideId,
        selected,
        selectedLibraryItem: selectedDeckItem,
        selectedLibraryId: selectedDeckLibraryId,
        setSelectedLibraryId: handleSetSelectedDeckLibraryId,
        handleSelectSlide: handleLiveSlideSelect,
        handleEditSlide,
        handleSaveLibraryItem: handleSaveSelectedDeckItem,
        handleUpdateEditedSlideOutput,
        scriptureEditorItem,
        handleSaveScriptureEditor,
        handleUpdateScriptureEditedSlideOutput,
        handleReorderLibrarySlides,
        editScrollToSlide,
        setEditScrollToSlide,
        handleScriptureOutput: handleLiveScriptureOutput,
        activeSlideContent: outputSlideContent,
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
        onToggleVideoPlayback: toggleVideoPlayback,
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
        createComposedLibraryItem: async (title, itemIds, categoryId) => {
          await createComposedLibraryItem(title, itemIds, categoryId);
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
        scriptureFooterFontSize: settingsScriptureFooterFontSize,
        scriptureFontWeight: settingsScriptureFontWeight,
        scriptureTextAlign: settingsScriptureTextAlign,
        scriptureVerticalAlign: settingsScriptureVerticalAlign,
        scriptureFooterAlign: settingsScriptureFooterAlign,
        scriptureFooterPosition: settingsScriptureFooterPosition,
        libraryDefaultFontFamily: settingsLibraryFontFamily,
        libraryDefaultFontSize: settingsLibraryFontSize,
        libraryDefaultFontWeight: settingsLibraryFontWeight,
        setScriptureFontSize: setSettingsScriptureFontSize,
        setScriptureTextAlign: setSettingsScriptureTextAlign,
        setScriptureVerticalAlign: setSettingsScriptureVerticalAlign,
        setScriptureFooterAlign: setSettingsScriptureFooterAlign,
        setScriptureFooterPosition: setSettingsScriptureFooterPosition,
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
        isTimerLayerEnabled,
        setIsTimerLayerEnabled,
        isMessageLayerEnabled,
        setIsMessageLayerEnabled,
      }}
      />
    </>
  );
}
