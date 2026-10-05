import { userMessage } from "../../renderer/shared/lib/user-error";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
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
  MessageOverlay,
  SlideElement,
  LibraryContent,
  LibrarySlide,
  ServicePresentation,
} from "../../shared/types";
import {
  useCategories,
  useOutputBroadcast,
  usePlayback,
  usePresentMediaFlow,
  useStageBroadcast,
  useShowVideoSync,
  useTimers,
  getLiveTimerText,
  isTimeUpShowing,
} from "../../renderer/shared/hooks";
import type { useAppSettings } from "../../renderer/shared/hooks/useAppSettings";
import { useWindowOpen } from "../../renderer/tauri/runtime";
import {
  filtersToCSS,
  MediaState,
  MediaItem,
  type MediaFilters,
} from "../media/hooks/useMediaFolders";
import type {
  OutputTextPosition,
  PropsOverlayItem,
} from "../../shared/types/output-window";
import {
  getActiveLibrarySlide,
  getActiveSlideText,
  getSlideGroups,
  getSlidesForGrid,
} from "../../renderer/shared/lib/present/selectors";
import { useSongAgent } from "../song-agent/useSongAgent";
import { useDesktopSessionStore } from "../../renderer/shared/store/desktopSession";
import { useAppNavigation } from "../../renderer/shared/hooks/useAppNavigation";
import { useAppHandlers } from "../../renderer/shared/hooks/useAppHandlers";
import {
  useControlActions,
  type ControlSwitch,
} from "../../renderer/shared/hooks/useControlActions";
import { MainView } from "./MainView";
import { Dialog } from "../../renderer/shared/components/Dialog";
import {
  createComposedLibraryDraft,
  DEFAULT_CANVAS_SIZE,
  getCanvasSizeDimensions,
  getSlideBackgroundColor,
  normalizeLibrarySlide,
  rebuildSlidesFromLyrics,
  reorderLibrarySlides,
} from "../library/lib/library-items";
import { useThemesModalStore } from "../../renderer/shared/store/themesModal";
import { useScripturePanelStore } from "../scripture/lib/panel-state";
import {
  applyLookToSlides,
  findBackgroundMedia,
  normalizeLook,
} from "../themes/theme-look.mjs";
import {
  importServicePresentationFile,
  type PresentationImportMode,
  type PresentationImportProgress,
  type PresentationImportSource,
} from "../library/lib/import-documents";
import {
  buildScriptureEditorLibraryItem,
  scriptureDraftToSlides,
} from "../scripture/lib/editor";
import {
  createScriptureLayoutTemplate,
} from "../scripture/lib/layout-template";
import { useScriptureLayoutTemplateStore } from "../scripture/lib/layout-template-state";
import { useScreenComposerState } from "../screen-composer";
import { useGlobalSearchStore } from "../../renderer/shared/store/globalSearchStore";
import { usePresentAiToolProvider } from "../../renderer/ai-operator/usePresentAiToolProvider";
import { useMenuChecks, useMenuCommand } from "../../renderer/tauri/menu-commands";

type EditedOutputSnapshot = {
  slideId: string;
  text: string;
  elements: SlideElement[] | null;
  canvasSize: CanvasSizePreset;
  backgroundColor: string | null;
};

const areEditedOutputSnapshotsEqual = (
  left: EditedOutputSnapshot | null,
  right: EditedOutputSnapshot,
) =>
  left?.slideId === right.slideId &&
  left.text === right.text &&
  left.canvasSize === right.canvasSize &&
  left.backgroundColor === right.backgroundColor &&
  JSON.stringify(left.elements ?? null) === JSON.stringify(right.elements ?? null);

const hasEditedOutputSnapshotContent = (snapshot: EditedOutputSnapshot) =>
  Boolean(snapshot.text.trim()) ||
  Boolean(snapshot.elements?.length) ||
  Boolean(snapshot.backgroundColor);

const editedOutputSnapshotToContent = (
  snapshot: EditedOutputSnapshot,
): OutputSlideContent => ({
  text: snapshot.text,
  footer: undefined,
  elements: normalizeSlideElements(snapshot.elements),
  canvasSize: snapshot.canvasSize,
  backgroundColor: snapshot.backgroundColor,
});

const resolveSavedSlideIndex = ({
  activeSlideId,
  libraryId,
  previousSlides,
  nextSlides,
  fallbackIndex,
}: {
  activeSlideId: string | null | undefined;
  libraryId: string;
  previousSlides?: LibrarySlide[];
  nextSlides: LibrarySlide[];
  fallbackIndex?: number | null;
}) => {
  if (!activeSlideId || nextSlides.length === 0) {
    return -1;
  }

  const separatorIndex = activeSlideId.indexOf(":");
  const idPart =
    separatorIndex >= 0 ? activeSlideId.slice(0, separatorIndex) : activeSlideId;
  const slideToken =
    separatorIndex >= 0 ? activeSlideId.slice(separatorIndex + 1) : "";

  if (
    !activeSlideId.startsWith("scripture:") &&
    String(idPart) !== String(libraryId)
  ) {
    return -1;
  }

  const nextIdIndex = nextSlides.findIndex((slide) => slide.id === slideToken);
  if (nextIdIndex >= 0) {
    return nextIdIndex;
  }

  const previousIdIndex =
    previousSlides?.findIndex((slide) => slide.id === slideToken) ?? -1;
  if (previousIdIndex >= 0 && previousIdIndex < nextSlides.length) {
    return previousIdIndex;
  }

  const parsedIndex = Number(slideToken);
  if (
    Number.isFinite(parsedIndex) &&
    parsedIndex >= 0 &&
    parsedIndex < nextSlides.length
  ) {
    return parsedIndex;
  }

  return fallbackIndex != null &&
    fallbackIndex >= 0 &&
    fallbackIndex < nextSlides.length
    ? fallbackIndex
    : -1;
};

const buildSavedSlideSnapshot = ({
  activeSlideId,
  libraryId,
  previousSlides,
  nextSlides,
  content,
  fallbackIndex,
}: {
  activeSlideId: string | null | undefined;
  libraryId: string;
  previousSlides?: LibrarySlide[];
  nextSlides: LibrarySlide[];
  content?: LibraryContent;
  fallbackIndex?: number | null;
}): EditedOutputSnapshot | null => {
  const slideIndex = resolveSavedSlideIndex({
    activeSlideId,
    libraryId,
    previousSlides,
    nextSlides,
    fallbackIndex,
  });
  const slide = slideIndex >= 0 ? nextSlides[slideIndex] : null;
  if (!slide) {
    return null;
  }

  const slideId = activeSlideId?.startsWith("scripture:")
    ? slide.id ?? `scripture:${slideIndex}`
    : `${libraryId}:${slide.id ?? slideIndex}`;
  return {
    slideId,
    text: slide.text,
    elements: slide.elements ?? [],
    canvasSize: content?.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE,
    backgroundColor: getSlideBackgroundColor(slide, content),
  };
};

type OutputSlideContent = {
  text: string;
  footer?: string;
  elements?: SlideElement[] | null;
  canvasSize?: CanvasSizePreset | null;
  backgroundColor?: string | null;
};

type PresentationImportUiState = {
  isVisible: boolean;
  title: string;
  detail: string;
  progress: number | null;
};

const IMPORT_ERROR_DURATION_MS = 6000;

/**
 * A presentation is an item of a service, so it needs one to go into. One
 * toast, however many times it is asked: by its id, a second replaces the
 * first rather than stacking under it.
 */
function toastImportNeedsService() {
  toast.error("Open a service first, then import files into it.", {
    id: "import-needs-service",
    duration: IMPORT_ERROR_DURATION_MS,
  });
}

function normalizeSlideElements(
  elements: SlideElement[] | null | undefined,
): SlideElement[] | null {
  return Array.isArray(elements) && elements.length > 0 ? elements : null;
}

/**
 * A presentation's slide — a PDF's page, a PowerPoint's — by its id: decks
 * imported into a service are `presentation_…`. It goes on the Slide layer,
 * not the Text layer.
 */
function isPresentationSlideId(slideId: string | null | undefined): boolean {
  return Boolean(slideId?.startsWith("presentation_"));
}

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
  localOrgId: Id<"organizations"> | null;
  userId: string | null;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  bottomTab: BottomTab;
  setBottomTab: (tab: BottomTab) => void;
  contentSource: ContentSource;
  mediaState: MediaState;
  settings: ReturnType<typeof useAppSettings>;
  showsPanelRef: React.RefObject<LibrariesPanelRef>;
  mediaPanelRef: React.RefObject<MediaPanelRef>;
  scripturePanelRef: React.RefObject<ScripturePanelRef>;
  showTextInOutput: boolean;
  setShowTextInOutput: (show: boolean) => void;
  showSlideInOutput: boolean;
  setShowSlideInOutput: (show: boolean) => void;
  showMediaInOutput: boolean;
  setShowMediaInOutput: (show: boolean) => void;
  hideBackgroundInOutput: boolean;
  setHideBackgroundInOutput: (hide: boolean) => void;
  outputTextPosition: OutputTextPosition;
  isTimerLayerEnabled: boolean;
  setIsTimerLayerEnabled: (show: boolean) => void;
  isMessageLayerEnabled: boolean;
  setIsMessageLayerEnabled: (show: boolean) => void;
}

export function PresentContainer({
  orgId,
  localOrgId,
  userId,
  viewMode,
  setViewMode,
  bottomTab,
  setBottomTab,
  mediaState,
  settings,
  showsPanelRef,
  mediaPanelRef,
  scripturePanelRef,
  contentSource,
  showTextInOutput,
  setShowTextInOutput,
  showSlideInOutput,
  setShowSlideInOutput,
  showMediaInOutput,
  setShowMediaInOutput,
  hideBackgroundInOutput,
  setHideBackgroundInOutput,
  outputTextPosition,
  isTimerLayerEnabled,
  setIsTimerLayerEnabled,
  isMessageLayerEnabled,
  setIsMessageLayerEnabled,
}: PresentContainerProps) {
  const localWorkspaceOrgId = localOrgId ?? null;
  const {
    activeMediaItem,
    allMediaItems,
    selectMediaForOutput,
    videoSettings,
    updateVideoSettings,
    getMediaFiltersForItem,
    updateMediaFiltersForItem,
    resetMediaFiltersForItem,
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
    settingsTimerNameBannerHeightPx,
    settingsTimerClockColor,
    settingsTimerNameColor,
    settingsTimerNameBannerEnabled,
    settingsTimerShowName,
    settingsTimerNameBannerColor,
    settingsTimerTitlePosition,
    settingsTimerBoxColor,
    settingsTimerTimeUp,
    settingsLibraryFontFamily,
    settingsLibraryFontSize,
    settingsLibraryFontWeight,
    settingsLang,
    settingsSpeechInputDeviceId,
    settingsAgent,
    setSettingsAudioOutputDeviceId,
    setSettingsAudioOutputDeviceLabel,
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
    searchMode: librarySearchMode,
    setSelectedItemId: setSelectedLibraryId,
    setSelectedCategoryId,
    setSearchQuery,
    setSearchMode: setLibrarySearchMode,
    createNewItem: createNewLibraryItem,
    createComposedItem: createComposedLibraryItem,
    createItemFromDraft: createLibraryItemFromDraft,
    saveExistingItem: updateExistingLibraryItem,
    reorderItemSlides,
    deleteItem: deleteLibraryItem,
    isLoading: libraryLoading,
  } = useLibrary(
    { orgId: localWorkspaceOrgId, userId: userId ?? null },
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
    serviceTemplates,
    selectedServiceTemplateId,
    setServiceItemIndex,
    selectedServiceGroupId,
    setSelectedServiceGroupId,
    createNewService,
    selectDefaultServiceTemplate,
    createServiceTemplate,
    renameServiceTemplate,
    addGroupToServiceTemplate,
    renameServiceTemplateGroup,
    deleteServiceTemplateGroup,
    addItemToServiceTemplate,
    removeItemFromServiceTemplate,
    moveServiceTemplateItemToGroup,
    reorderServiceTemplateGroup,
    deleteServiceTemplate,
    renameExistingService,
    deleteService,
    deleteServices,
    archiveServices,
    addLibraryItemToService: addLibraryToService,
    addPresentationToService,
    addGroupToService,
    renameServiceGroup,
    deleteServiceGroup,
    moveServiceItemToGroup,
    reorderServiceGroup,
    renameServiceItem,
    updateMediaInServices,
    removeMediaFromServices,
    updatePresentationInService,
    addMediaToService,
    addScriptureToService,
    removeFromService,
    reorderServiceItems,
    reorderServices,
    enterService,
    exitService,
  } = useServices({ orgId: localWorkspaceOrgId, userId }, libraryItems);

  const { categories, createNewCategory } = useCategories({
    orgId: orgId ?? null,
    userId,
  });

  // Sync data into the global search store for the AppHeader command palette
  const setGlobalServices = useGlobalSearchStore((s) => s.setServices);
  const setGlobalLibraryItems = useGlobalSearchStore((s) => s.setLibraryItems);
  const setGlobalActions = useGlobalSearchStore((s) => s.setActions);

  useEffect(() => {
    setGlobalServices(services);
  }, [services, setGlobalServices]);

  useEffect(() => {
    setGlobalLibraryItems(libraryItems);
  }, [libraryItems, setGlobalLibraryItems]);

  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);

  // Scripture Logic
  const { lookupRef } = useScripture();
  const availableBooks = useLiveQuery(() => db.books.toArray(), []) ?? [];
  const [scriptureSlides, setScriptureSlides] = useState<ScriptureSlide[]>([]);

  const [selected, setSelected] = useState<{
    libraryId: string | null;
    index: number;
  } | null>(null);
  const [isGridView, setIsGridView] = useState(true);
  const [selectedPresentationLibraryId, setSelectedPresentationLibraryId] =
    useState<string | null>(null);
  const [editScrollToSlide, setEditScrollToSlide] = useState<number | null>(
    null
  );
  const [isOutputFrozen, setIsOutputFrozen] = useState(false);
  const [editedOutputSnapshot, setEditedOutputSnapshot] =
    useState<EditedOutputSnapshot | null>(null);
  const [liveOutputSnapshot, setLiveOutputSnapshot] =
    useState<EditedOutputSnapshot | null>(null);
  const pendingSavedOutputSnapshotRef = useRef<EditedOutputSnapshot | null>(null);
  // Banner overlay currently being broadcast to the audience output, or null
  // when nothing is shown. Lifted here so the Messages tab can publish it and
  // useOutputBroadcast can forward it to the output window.
  const [activeMessageOverlay, setActiveMessageOverlay] =
    useState<MessageOverlay | null>(null);
  // IDs of props that are currently visible on the output (subset of the
  // org's saved props). Stored as strings to stay independent of the Convex
  // generated Id type.
  const [activePropIds, setActivePropIds] = useState<string[]>([]);
  const [activePropShownAtMsById, setActivePropShownAtMsById] = useState<
    Record<string, number>
  >({});
  const [livePropDrafts, setLivePropDrafts] = useState<
    Record<string, Partial<PropsOverlayItem> & { name?: string }>
  >({});

  const handleEnterService = useCallback(
    (serviceId: Id<"services">) => {
      const isReturningToCurrentService =
        String(selectedServiceId) === String(serviceId);
      const selectedServiceItem = isReturningToCurrentService
        ? serviceItems[serviceItemIndex ?? -1]
        : null;

      // Restore the service's last opened library deck when returning from a
      // panel that cleared it, so the slide grid is immediately usable.
      if (selectedServiceItem?.type === "library" && selectedServiceItem.refId) {
        setSelectedPresentationLibraryId(null);
        setSelectedLibraryId(selectedServiceItem.refId);
      }

      enterService(serviceId);
    },
    [
      enterService,
      selectedServiceId,
      serviceItemIndex,
      serviceItems,
      setSelectedLibraryId,
    ],
  );

  // Timer state lives here so both the rail Timer tab and the output
  // broadcast effect read from the same source. (Used to be inside
  // OutputPreview, which forced the embedded duplicate UI.)
  const timers = useTimers();
  const [presentationImportState, setPresentationImportState] =
    useState<PresentationImportUiState>({
      isVisible: false,
      title: "Importing presentation",
      detail: "",
      progress: null,
    });
  const screenComposer = useScreenComposerState();
  // While the Screen Composer is open, the Media panel and the slides fill
  // the region selected in it.
  const composerWindowOpen = useWindowOpen("screen-composer");
  const setScriptureLayoutTemplate = useScriptureLayoutTemplateStore(
    (state) => state.setTemplate,
  );

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
  const selectedServiceLibraryItem = useMemo(() => {
    if (!isInsideService || serviceItemIndex === null) {
      return null;
    }

    const item = serviceItems[serviceItemIndex];
    if (item?.type !== "library") {
      return null;
    }

    return (
      item.libraryItem ??
      libraryItems.find((libraryItem) => String(libraryItem._id) === item.refId) ??
      null
    );
  }, [isInsideService, libraryItems, serviceItemIndex, serviceItems]);
  const shouldUseServiceLibraryFallback =
    viewMode === "show" && bottomTab === "media";
  const selectedDeckItem =
    selectedLibraryItem ??
    selectedPresentationItem ??
    (shouldUseServiceLibraryFallback ? selectedServiceLibraryItem : null);
  const selectedDeckLibraryId =
    selectedLibraryId ??
    selectedPresentationLibraryId ??
    (shouldUseServiceLibraryFallback
      ? String(selectedServiceLibraryItem?._id ?? "") || null
      : null);
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
  const effectiveSelectedPresentationLibraryId =
    selectedPresentationLibraryId &&
    servicePresentationLibraryItems.some(
      (item) => String(item._id) === selectedPresentationLibraryId,
    )
      ? selectedPresentationLibraryId
      : null;

  // Memos
  const slidesForGrid = useMemo(() => {
    if (selectedDeckItem) {
      return getSlidesForGrid(selectedDeckItem);
    }
    if (
      scriptureSlides.length > 0 &&
      (bottomTab === "scripture" || activeSlideId?.startsWith("scripture:"))
    ) {
      return scriptureSlides.map((item, i) => ({
        slide: { text: item.content, label: item.label, footer: item.footer },
        index: i,
        id: undefined as string | undefined,
        libraryItem: null as LibraryItem | null,
      }));
    }
    return [];
  }, [
    activeSlideId,
    bottomTab,
    selectedDeckItem,
    scriptureSlides,
  ]);

  // Stage 4: mirror the live position into the Rust core.
  //
  // The core owns "which deck, which slide" so that the AI Operator, the UI
  // and — from Stage 6 — anything else drive the same state through the same
  // commands, rather than the operator panel reaching into React setters.
  // React stays the sender here; the reverse direction lands with the slide
  // rendering in Stage 5.
  useEffect(() => {
    let cancelled = false;
    const libraryId = selected?.libraryId ?? null;
    const slideIndex = selected?.index ?? null;

    void import("../../renderer/tauri/presentation")
      .then(async (core) => {
        if (cancelled) return;
        await core.setDeck(libraryId, slidesForGrid.length);
        if (cancelled) return;
        // `index: -1` is how this component says "deck open, nothing showing".
        if (slideIndex !== null && slideIndex >= 0) {
          await core.goToSlide(slideIndex);
        }
      })
      .catch((error: unknown) => {
        console.error("[Present] could not mirror the position to the Rust core", error);
      });

    return () => {
      cancelled = true;
    };
  }, [selected, slidesForGrid.length]);

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
      !effectiveSelectedPresentationLibraryId
    ) {
      return true;
    }
    return false;
  }, [
    activeSlideId,
    bottomTab,
    selectedLibraryId,
    effectiveSelectedPresentationLibraryId,
    scriptureSlides.length,
  ]);

  const activeSlideContent = useMemo<OutputSlideContent | null>(() => {
    if (activeSlideId?.startsWith("scripture:")) {
      const indexStr = activeSlideId.split(":")[1];
      const index = parseInt(indexStr, 10);
      const slide =
        scriptureSlides.find((candidate) => candidate.id === activeSlideId) ??
        (Number.isFinite(index) ? scriptureSlides[index] : null);
      return slide
        ? {
            text: slide.content,
            footer: slide.footer,
            // Only use element/canvas rendering when the slide actually has authored elements.
            // Plain generated scripture should use the scripture text layer path.
            elements: normalizeSlideElements(slide.elements),
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
        elements: normalizeSlideElements(activeLibrarySlide.slide.elements),
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
  }, [
    activeSlideId,
    availableSlideDeckItems,
    scriptureSlides,
  ]);

  // Keep one stable live slide payload for every display surface. Autosave can
  // briefly make the active library item unavailable during local/remote
  // refresh; during that gap, keep the last good content instead of letting
  // preview/output/stage collapse. When autosave returns the updated slide,
  // replace the snapshot so every screen updates without another click.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (
        pendingSavedOutputSnapshotRef.current &&
        pendingSavedOutputSnapshotRef.current.slideId !== activeSlideId
      ) {
        pendingSavedOutputSnapshotRef.current = null;
      }

      if (!activeSlideId || !activeSlideContent || editedOutputSnapshot) {
        return;
      }

      const nextSnapshot: EditedOutputSnapshot = {
        slideId: activeSlideId,
        text: activeSlideContent.text ?? "",
        elements: normalizeSlideElements(activeSlideContent.elements),
        canvasSize: activeSlideContent.canvasSize ?? DEFAULT_CANVAS_SIZE,
        backgroundColor: activeSlideContent.backgroundColor ?? null,
      };

      const pendingSavedSnapshot = pendingSavedOutputSnapshotRef.current;
      if (pendingSavedSnapshot?.slideId === nextSnapshot.slideId) {
        if (!areEditedOutputSnapshotsEqual(pendingSavedSnapshot, nextSnapshot)) {
          return;
        }
        pendingSavedOutputSnapshotRef.current = null;
      }

      setLiveOutputSnapshot((current) => {
        if (
          current?.slideId === nextSnapshot.slideId &&
          !hasEditedOutputSnapshotContent(nextSnapshot)
        ) {
          return current;
        }
        if (areEditedOutputSnapshotsEqual(current, nextSnapshot)) {
          return current;
        }
        return nextSnapshot;
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeSlideContent,
    activeSlideId,
    editedOutputSnapshot,
  ]);

  const broadcastSnapshot =
    editedOutputSnapshot?.slideId === activeSlideId
      ? editedOutputSnapshot
      : liveOutputSnapshot?.slideId === activeSlideId
        ? liveOutputSnapshot
        : null;

  const outputSlideContent = useMemo<OutputSlideContent | null>(
    () =>
      broadcastSnapshot
        ? editedOutputSnapshotToContent(broadcastSnapshot)
        : activeSlideContent,
    [activeSlideContent, broadcastSnapshot],
  );

  const outputActiveSlideId =
    broadcastSnapshot?.slideId ?? activeSlideId ?? null;
  // A presentation's slide shows as the Slide layer says, any other as the
  // Text layer does.
  const isPresentationSlideLive = isPresentationSlideId(outputActiveSlideId);
  const slideShowsInOutput = isPresentationSlideLive ? showSlideInOutput : showTextInOutput;

  const publishSavedSlidesToLiveOutput = useCallback(
    ({
      libraryId,
      nextSlides,
      content,
      previousSlides,
      fallbackIndex,
    }: {
      libraryId: string;
      nextSlides: LibrarySlide[];
      content?: LibraryContent;
      previousSlides?: LibrarySlide[];
      fallbackIndex?: number | null;
    }) => {
      const snapshot = buildSavedSlideSnapshot({
        activeSlideId,
        libraryId,
        previousSlides,
        nextSlides,
        content,
        fallbackIndex,
      });
      if (!snapshot) {
        return;
      }
      setEditedOutputSnapshot(null);
      pendingSavedOutputSnapshotRef.current = snapshot;
      setLiveOutputSnapshot(snapshot);
    },
    [activeSlideId],
  );

  const lastAutoEnabledSlideRef = useRef<string | null>(null);
  const previousOutputActiveSlideRef = useRef<string | null>(null);

  const stageSequence = useMemo(
    () =>
      slidesForGrid.map((entry) => ({
        id:
          entry.id
          ?? (entry.libraryItem
            ? `${entry.libraryItem._id}:${'id' in entry.slide && entry.slide.id != null ? entry.slide.id : entry.index}`
            : `scripture:${entry.index}`),
        text: entry.slide.text ?? null,
        footer: ('footer' in entry.slide ? entry.slide.footer : undefined) ?? null,
        label: entry.slide.label ?? null,
        repeat: ('sectionRepeat' in entry.slide ? entry.slide.sectionRepeat : undefined) ?? null,
        inlineInstruction: ('modifier' in entry.slide ? entry.slide.modifier : undefined) ?? null,
      })),
    [slidesForGrid],
  );

  const stageActiveIndex = useMemo(() => {
    if (outputActiveSlideId) {
      const byIdIndex = stageSequence.findIndex((entry) => entry.id === outputActiveSlideId);
      if (byIdIndex >= 0) {
        return byIdIndex;
      }
    }
    if (selected && selected.index >= 0 && selected.index < stageSequence.length) {
      return selected.index;
    }
    return -1;
  }, [outputActiveSlideId, selected, stageSequence]);

  const stageNextSlide = stageActiveIndex >= 0 ? stageSequence[stageActiveIndex + 1] ?? null : null;
  const stageCurrentSlide =
    stageActiveIndex >= 0 ? stageSequence[stageActiveIndex] ?? null : null;

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

  // A song slide's own image or video, from its theme: the media layer
  // while that slide is live, as scripture's background is for scripture.
  // Slides that share it (a song themed with one video) share the layer, so
  // it plays on from slide to slide rather than starting again.
  const liveSlideBackgroundId = useMemo(() => {
    if (isScriptureActive || !selected?.libraryId) return null;
    const item = availableSlideDeckItems.find(
      (candidate) => String(candidate._id) === selected.libraryId,
    );
    return item?.slides[selected.index]?.backgroundId ?? null;
  }, [availableSlideDeckItems, isScriptureActive, selected]);
  // Media the operator chooses (or clears) while that slide is live wins
  // over it, until the slide changes: a click in the Media panel always
  // does something.
  const liveSlideKey = selected?.libraryId ? `${selected.libraryId}:${selected.index}` : null;
  const [operatorMediaForSlide, setOperatorMediaForSlide] = useState<string | null>(null);
  const slideBackgroundMediaItem = useMemo(
    () =>
      liveSlideKey && operatorMediaForSlide === liveSlideKey
        ? null
        : (findBackgroundMedia(liveSlideBackgroundId, allMediaItems) as MediaItem | null),
    [allMediaItems, liveSlideBackgroundId, liveSlideKey, operatorMediaForSlide],
  );

  const effectiveActiveMediaItem = isScriptureActive
    ? (scriptureBackgroundMediaItem ?? activeMediaItem)
    : (slideBackgroundMediaItem ?? activeMediaItem);
  const effectiveMediaFilters = useMemo<MediaFilters>(
    () => getMediaFiltersForItem(effectiveActiveMediaItem),
    [effectiveActiveMediaItem, getMediaFiltersForItem],
  );
  const effectiveMediaFilterCSS = useMemo(
    () => filtersToCSS(effectiveMediaFilters),
    [effectiveMediaFilters],
  );
  const handleEffectiveMediaFiltersChange = useCallback(
    (filters: Partial<MediaFilters>) => {
      updateMediaFiltersForItem(effectiveActiveMediaItem, filters);
    },
    [effectiveActiveMediaItem, updateMediaFiltersForItem],
  );
  const handleResetEffectiveMediaFilters = useCallback(() => {
    resetMediaFiltersForItem(effectiveActiveMediaItem);
  }, [effectiveActiveMediaItem, resetMediaFiltersForItem]);

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
    setViewMode,
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
    scriptureEditorDefaults: {
      canvasSize: "1920x1080",
      fontFamily: settingsScriptureFontFamily,
      fontSize: settingsScriptureFontSize,
      footerFontSize: settingsScriptureFooterFontSize,
      fontWeight: settingsScriptureFontWeight,
      textAlign: settingsScriptureTextAlign,
      verticalAlign: settingsScriptureVerticalAlign,
      footerAlign: settingsScriptureFooterAlign,
      footerPosition: settingsScriptureFooterPosition,
    },
  });

  useEffect(() => {
    setGlobalActions({
      onSelectService: handleEnterService,
      onSelectLibraryItem: handleSetSelectedDeckLibraryId,
      onSelectScripture: handleSelectScripture,
    });
  }, [
    handleEnterService,
    handleSetSelectedDeckLibraryId,
    handleSelectScripture,
    setGlobalActions,
  ]);

  const handleUpdateEditedSlideOutput = useCallback(
    (payload: EditedOutputSnapshot) => {
      setEditedOutputSnapshot(payload);
    },
    [],
  );

  const handleSaveScriptureEditor = useCallback(
    async (draft: LibraryItemDraft) => {
      setEditedOutputSnapshot(null);
      const draftSlides = scriptureDraftToSlides(draft, scriptureSlides);
      const templateSlide =
        draft.slides[selected?.index ?? -1] ??
        draft.slides.find((slide) => (slide.elements?.length ?? 0) > 0) ??
        draft.slides[0] ??
        null;

      setScriptureSlides(draftSlides);
      publishSavedSlidesToLiveOutput({
        libraryId: "scripture",
        nextSlides: draft.slides,
        content: draft.content,
        previousSlides: scriptureEditorItem?.slides,
        fallbackIndex: selected?.index ?? null,
      });
      setScriptureLayoutTemplate(
        createScriptureLayoutTemplate({
          slide: templateSlide,
          canvasSize: draft.content?.presentation?.canvasSize,
        }),
      );
    },
    [
      publishSavedSlidesToLiveOutput,
      scriptureEditorItem?.slides,
      scriptureSlides,
      selected,
      setScriptureLayoutTemplate,
    ],
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
      setScriptureLayoutTemplate(
        createScriptureLayoutTemplate({
          slide: {
            elements: payload.elements,
            backgroundColor: payload.backgroundColor ?? undefined,
            useBackgroundColor: Boolean(payload.backgroundColor),
          },
          canvasSize: payload.canvasSize,
        }),
      );
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
    [setScriptureLayoutTemplate],
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
      const targetLibraryId =
        (draft._id ? String(draft._id) : selectedDeckLibraryId) ?? null;
      const previousSlides = selectedDeckItem?.slides;
      const fallbackIndex =
        targetLibraryId && selected?.libraryId === targetLibraryId
          ? selected.index
          : null;

      if (selectedServiceId && selectedServicePresentationItem?.presentation) {
        const presentationLibraryId =
          selectedDeckLibraryId ?? `presentation_${selectedServicePresentationItem.refId}`;
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
        publishSavedSlidesToLiveOutput({
          libraryId: presentationLibraryId,
          nextSlides: draft.slides,
          content: draft.content,
          previousSlides,
          fallbackIndex,
        });
        return;
      }

      await handleSaveLibraryItem(draft);
      if (targetLibraryId) {
        publishSavedSlidesToLiveOutput({
          libraryId: targetLibraryId,
          nextSlides: draft.slides,
          content: draft.content,
          previousSlides,
          fallbackIndex,
        });
      }
    },
    [
      handleSaveLibraryItem,
      publishSavedSlidesToLiveOutput,
      selected,
      selectedDeckItem?.slides,
      selectedDeckLibraryId,
      selectedServiceId,
      selectedServicePresentationItem,
      updatePresentationInService,
    ],
  );

  const saveMiniLyricsBody = useCallback(
    async (libraryId: string, body: string) => {
      const item = libraryItems.find(
        (candidate) => String(candidate._id) === libraryId,
      );
      if (!item) {
        throw new Error("Library item not found.");
      }

      // The same slides with new words, so the one on screen is still the
      // one on screen and shows the edit at once (`rebuildSlidesFromLyrics`).
      const canvasSize = item.content?.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE;
      const slides = rebuildSlidesFromLyrics(body, item.slides, canvasSize, libraryTextDefaults);
      await updateExistingLibraryItem(
        libraryId,
        {
          title: item.title,
          body,
          slides,
          content: item.content,
        },
        item.categoryId ? String(item.categoryId) : undefined,
      );
      publishSavedSlidesToLiveOutput({
        libraryId,
        nextSlides: slides,
        content: item.content,
        previousSlides: item.slides,
        fallbackIndex:
          selected?.libraryId === libraryId ? selected.index : null,
      });
    },
    [
      libraryItems,
      libraryTextDefaults,
      publishSavedSlidesToLiveOutput,
      selected,
      updateExistingLibraryItem,
    ],
  );

  // The song showing here is what the Themes panel applies to in Show view:
  // a library song, not a service's imported presentation or scripture.
  const setThemeTarget = useThemesModalStore((state) => state.setTarget);
  const themeTargetItem =
    viewMode === "show" &&
    selectedDeckItem &&
    selectedDeckItem.type !== "scripture" &&
    selectedDeckLibraryId &&
    !selectedDeckLibraryId.startsWith("presentation_")
      ? selectedDeckItem
      : null;
  const themeTargetLiveIndex =
    themeTargetItem && selected?.libraryId === String(themeTargetItem._id) ? selected.index : null;
  useEffect(() => {
    if (!themeTargetItem) {
      setThemeTarget("show", null);
      return;
    }
    setThemeTarget("show", {
      surface: "show",
      libraryId: String(themeTargetItem._id),
      title: themeTargetItem.title || "this song",
      slides: themeTargetItem.slides,
      slideIndex:
        themeTargetLiveIndex !== null && themeTargetLiveIndex < themeTargetItem.slides.length
          ? themeTargetLiveIndex
          : null,
      canvasSize: themeTargetItem.content?.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE,
      themeId: themeTargetItem.content?.theme?.id ?? null,
    });
  }, [setThemeTarget, themeTargetItem, themeTargetLiveIndex]);

  // A theme chosen in the panel for that song: saved to it, and onto the
  // output at once if the song is live.
  const pendingTheme = useThemesModalStore((state) => state.pending);
  const consumePendingTheme = useThemesModalStore((state) => state.consumePending);
  useEffect(() => {
    if (!pendingTheme || pendingTheme.surface !== "show") return;
    const { theme, onlySlideIndex, libraryId, nonce } = pendingTheme;
    consumePendingTheme(nonce);
    const item = libraryItems.find((candidate) => String(candidate._id) === libraryId);
    if (!item) {
      toast.error("That song isn't in the library any more.");
      return;
    }
    const canvasSize = item.content?.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE;
    const slides = applyLookToSlides(
      item.slides.map((slide) => normalizeLibrarySlide(slide, canvasSize, libraryTextDefaults)),
      normalizeLook(theme.look),
      getCanvasSizeDimensions(canvasSize),
      { onlySlideIndex },
    ) as LibrarySlide[];
    const content: LibraryContent | undefined =
      onlySlideIndex !== null ? item.content : { ...item.content, theme };
    void updateExistingLibraryItem(
      libraryId,
      { title: item.title, body: item.body, slides, content },
      item.categoryId ? String(item.categoryId) : undefined,
    )
      .then(() => {
        publishSavedSlidesToLiveOutput({
          libraryId,
          nextSlides: slides,
          content,
          previousSlides: item.slides,
          fallbackIndex: selected?.libraryId === libraryId ? selected.index : null,
        });
        toast.success(
          onlySlideIndex !== null
            ? `${theme.name} is on slide ${onlySlideIndex + 1} of ${item.title}`
            : `${theme.name} is on ${item.title}`,
        );
      })
      .catch((error: unknown) => {
        toast.error(userMessage(error, "The theme couldn't be applied.", "Present"));
      });
  }, [
    consumePendingTheme,
    libraryItems,
    libraryTextDefaults,
    pendingTheme,
    publishSavedSlidesToLiveOutput,
    selected,
    updateExistingLibraryItem,
  ]);

  const handleOpenMiniEditor = useCallback(
    (libraryId: string, initialSlideIndex?: number | null) => {
      const item = libraryItems.find(
        (candidate) => String(candidate._id) === libraryId,
      );
      if (!item) {
        toast.error("Library item not found.");
        return;
      }

      void window.electronAPI?.openMiniLyricsWindow?.({
        libraryId: String(item._id),
        title: item.title,
        body: item.body,
        initialSlideIndex: initialSlideIndex ?? null,
      });
    },
    [libraryItems],
  );

  const handleOpenMiniEditorForSlide = useCallback(
    (libraryId: string, slideIndex: number) => {
      handleOpenMiniEditor(libraryId, slideIndex);
    },
    [handleOpenMiniEditor],
  );

  useEffect(() => {
    if (!window.electronAPI?.onMiniLyricsSaveRequest) {
      return;
    }

    return window.electronAPI.onMiniLyricsSaveRequest((request) => {
      void saveMiniLyricsBody(
        request.payload.libraryId,
        request.payload.body,
      )
        .then(() => {
          window.electronAPI.respondMiniLyricsSave({
            requestId: request.requestId,
            ok: true,
          });
        })
        .catch((error) => {
          window.electronAPI.respondMiniLyricsSave({
            requestId: request.requestId,
            ok: false,
            error:
              userMessage(error, "The lyrics couldn't be saved. Try again.", "Present"),
          });
        });
    });
  }, [saveMiniLyricsBody]);

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

  const selectMediaForOutputWithComposer = useCallback(
    (item: MediaItem | null) => {
      const region = screenComposer.selectedRegion;
      const regionTakesMedia = region?.source === "video" || region?.source === "slides";
      // The Media panel fills the region selected in the Screen Composer
      // while it is being composed, and the screen is left as it is: the
      // operator is building a layout, not changing what the room sees.
      if (composerWindowOpen && !screenComposer.enabled && region && regionTakesMedia) {
        screenComposer.updateRegion(
          region.id,
          region.source === "video"
            ? { mediaUrl: item?.url ?? null, mediaType: item?.type ?? null, mediaLabel: item?.name ?? null }
            : {
                backgroundMediaUrl: item?.url ?? null,
                backgroundMediaType: item?.type ?? null,
                backgroundMediaLabel: item?.name ?? null,
              },
        );
        return;
      }
      if (screenComposer.enabled && screenComposer.selectedRegion) {
        // Straight onto the screen as well as the draft: the operator is
        // choosing what the region shows, with the composer on air.
        if (screenComposer.selectedRegion.source === "video") {
          screenComposer.updateRegion(
            screenComposer.selectedRegion.id,
            {
              mediaUrl: item?.url ?? null,
              mediaType: item?.type ?? null,
              mediaLabel: item?.name ?? null,
            },
            { live: true },
          );
        }

        if (screenComposer.selectedRegion.source === "slides") {
          screenComposer.updateRegion(
            screenComposer.selectedRegion.id,
            {
              backgroundMediaUrl: item?.url ?? null,
              backgroundMediaType: item?.type ?? null,
              backgroundMediaLabel: item?.name ?? null,
            },
            { live: true },
          );
        }
      }

      setOperatorMediaForSlide(liveSlideKey);
      selectMediaForOutput(item);
    },
    [composerWindowOpen, liveSlideKey, screenComposer, selectMediaForOutput],
  );

  const {
    showViewMedia,
    onSelectServiceItem: handleSelectServiceItem,
    onDoubleClickServiceItem: handleDoubleClickServiceItem,
    onOutputPreviewMedia: handleOutputPreviewMedia,
    onMediaPanelSelect: handleMediaPanelSelect,
    isPreviewOutputting,
  } = usePresentMediaFlow({
    serviceItems,
    allMediaItems,
    activeMediaItem,
    setServiceItemIndex: (index) => {
      setSelectedServiceGroupId(null);
      setServiceItemIndex(index);
    },
    setSelectedLibraryId,
    selectMediaForOutput: selectMediaForOutputWithComposer,
    setShouldAutoPlay,
    onSelectScripture: (refId: string) => {
      setEditedOutputSnapshot(null);
      setSelectedPresentationLibraryId(null);
      handleSelectScripture(refId);
      // And in the Bible panel, whichever view is open, so a passage in the
      // service can be read and put up from the Bible tab without going to
      // Show. The panel shows whatever reference its search holds.
      useScripturePanelStore.getState().setLookupValue(refId);
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

  useEffect(() => {
    if (
      !(screenComposer.enabled || composerWindowOpen) ||
      !screenComposer.selectedRegion ||
      screenComposer.selectedRegion.source !== "slides"
    ) {
      return;
    }

    const currentRegion = screenComposer.selectedRegion;
    const nextSlideId = outputActiveSlideId ?? null;
    const nextSlideText = outputSlideContent?.text ?? null;
    const nextSlideFooter = outputSlideContent?.footer ?? null;
    const nextSlideElements = outputSlideContent?.elements ?? null;
    const nextSlideCanvasSize = outputSlideContent?.canvasSize ?? null;
    const nextSlideBackgroundColor = outputSlideContent?.backgroundColor ?? null;

    const isRegionInSync =
      (currentRegion.slideId ?? null) === nextSlideId &&
      (currentRegion.slideText ?? null) === nextSlideText &&
      (currentRegion.slideFooter ?? null) === nextSlideFooter &&
      (currentRegion.slideElements ?? null) === nextSlideElements &&
      (currentRegion.slideCanvasSize ?? null) === nextSlideCanvasSize &&
      (currentRegion.slideBackgroundColor ?? null) === nextSlideBackgroundColor;

    if (isRegionInSync) {
      return;
    }

    // The selected slides region follows the slide the operator shows, on
    // the screen as well as in the draft.
    if (!outputActiveSlideId && !outputSlideContent) {
      screenComposer.updateRegion(
        screenComposer.selectedRegion.id,
        {
          slideId: null,
          slideText: null,
          slideFooter: null,
          slideElements: null,
          slideCanvasSize: null,
          slideBackgroundColor: null,
        },
        { live: true },
      );
      return;
    }

    screenComposer.updateRegion(
      screenComposer.selectedRegion.id,
      {
        slideId: nextSlideId,
        slideText: nextSlideText,
        slideFooter: nextSlideFooter,
        slideElements: nextSlideElements,
        slideCanvasSize: nextSlideCanvasSize,
        slideBackgroundColor: nextSlideBackgroundColor,
      },
      { live: true },
    );
  }, [
    composerWindowOpen,
    screenComposer,
    outputActiveSlideId,
    outputSlideContent,
  ]);

  // The song agent: follows the song on screen as it is sung, and offers
  // the one it hears when the band starts another.
  const songAgentSessionToken = useDesktopSessionStore((state) => state.sessionToken);
  const serviceSongIds = useMemo(
    () =>
      serviceItems
        .filter((item) => item.type === "library" && item.refId)
        .map((item) => String(item.refId)),
    [serviceItems],
  );
  useSongAgent({
    libraryItems,
    serviceSongIds,
    live: selected?.libraryId ? selected : null,
    showSlide: (libraryId, slideIndex, text) =>
      handleLiveSlideSelect(`${libraryId}:${slideIndex}`, text),
    openSong: handleSetSelectedDeckLibraryId,
    sessionToken: songAgentSessionToken,
    lang: settingsLang,
    inputDeviceId: settingsSpeechInputDeviceId,
    follow: settingsAgent.songFollow,
    suggest: settingsAgent.songSuggest,
  });

  const {
    liveVideoItem,
    playLive,
    pauseLive,
    seekLive,
    setRateLive,
    videoRate,
    isVideoPlaying,
    videoCurrentTime,
    videoTimeSampledAtMs,
    toggleVideoPlayback,
  } = useShowVideoSync({
    activeMediaItem: effectiveActiveMediaItem,
    videoSettings,
    shouldAutoPlay,
    onAutoPlayConsumed: () => setShouldAutoPlay(false),
    forcePlay:
      (isScriptureActive || Boolean(slideBackgroundMediaItem)) &&
      effectiveActiveMediaItem?.type === "video",
  });

  const liveVideoControls = useMemo(
    () => ({
      id: liveVideoItem?.id ?? null,
      play: playLive,
      pause: pauseLive,
      seek: seekLive,
      setRate: setRateLive,
    }),
    [liveVideoItem?.id, pauseLive, playLive, seekLive, setRateLive],
  );

  // Offer, but never automatically force, a newly connected audio output.
  // This runs in the presenter window only, so the settings window cannot
  // create duplicate prompts.
  const knownAudioOutputIdsRef = useRef<Set<string> | null>(null);
  const [pendingAudioOutput, setPendingAudioOutput] = useState<{
    deviceId: string;
    label: string;
  } | null>(null);
  useEffect(() => {
    let disposed = false;
    const refreshAudioOutputs = async () => {
      const { listAudioDevices } = await import("../../renderer/tauri/sound");
      const { outputs } = await listAudioDevices();
      if (disposed) return;
      const previous = knownAudioOutputIdsRef.current;
      knownAudioOutputIdsRef.current = new Set(outputs.map((device) => device.id));
      if (!previous) return;
      const connected = outputs.find((device) => !previous.has(device.id));
      if (!connected) return;
      setPendingAudioOutput({
        deviceId: connected.id,
        label: connected.label.trim() || "New audio output",
      });
    };

    // The system's own list, which has no change event here: looked at again
    // every few seconds, which costs Core Audio a few milliseconds.
    const check = (): void => {
      refreshAudioOutputs().catch((error: unknown) =>
        console.error("[Audio] could not list the audio outputs", error),
      );
    };
    check();
    const intervalId = window.setInterval(check, 3000);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, []);

  usePresentAiToolProvider({
    libraryItems,
    slidesForGrid,
    selected,
    allMediaItems,
    selectedServiceId,
    setSelectedLibraryId: handleSetSelectedDeckLibraryId,
    setViewMode,
    setBottomTab,
    setShowTextInOutput,
    selectMediaForOutput: selectMediaForOutputWithComposer,
    handleSelectSlide: handleLiveSlideSelect,
    handleSelectScripture,
    addLibraryItemToService: addLibraryToService,
    timers,
    toggleVideoPlayback,
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
  });

  // The ticks in the application menu's Presentation and View menus: what is
  // on the audience output now (`services/app_menu.rs`).
  useMenuChecks({
    text: showTextInOutput,
    slide: showSlideInOutput,
    media: showMediaInOutput,
    background: !hideBackgroundInOutput,
    freeze: isOutputFrozen,
    timer: isTimerLayerEnabled,
    messages: isMessageLayerEnabled,
    grid: isGridView,
  });

  // The media and timer items in the Presentation menu: the transport and the
  // timer panel's own buttons, for the timer the panel has selected.
  useMenuCommand("presentation.play-media", toggleVideoPlayback);
  useMenuCommand("presentation.timer-play", () => {
    if (timers.activeTimer) timers.toggleTimerPlayback(timers.activeTimer.id);
  });
  useMenuCommand("presentation.timer-reset", () => {
    if (timers.activeTimer) timers.resetTimer(timers.activeTimer.id);
  });
  useMenuCommand("presentation.timer-stop-all", timers.stopAllTimers);

  // Foot pedals, MIDI and OSC reach the same handlers a click does
  // (`services/control` in the core, `useControlActions`).
  /** What a control's on, off or toggle means for a flag that is `current`. */
  const applySwitch = (to: ControlSwitch, current: boolean) =>
    to === "toggle" ? !current : to === "on";

  const moveServiceItem = useCallback(
    (by: number) => {
      if (!serviceItems.length) return;
      const from = serviceItemIndex ?? (by > 0 ? -1 : serviceItems.length);
      const next = Math.min(Math.max(from + by, 0), serviceItems.length - 1);
      if (next !== serviceItemIndex) handleSelectServiceItem(next);
    },
    [handleSelectServiceItem, serviceItemIndex, serviceItems.length],
  );

  useControlActions({
    onNextItem: () => moveServiceItem(1),
    onPreviousItem: () => moveServiceItem(-1),
    onText: (to) => setShowTextInOutput(applySwitch(to, showTextInOutput)),
    onSlide: (to) => setShowSlideInOutput(applySwitch(to, showSlideInOutput)),
    onMedia: (to) => setShowMediaInOutput(applySwitch(to, showMediaInOutput)),
    // "Background on" is the operator's hide-background switched off.
    onBackground: (to) => setHideBackgroundInOutput(!applySwitch(to, !hideBackgroundInOutput)),
    onFreeze: (to) => setIsOutputFrozen(applySwitch(to, isOutputFrozen)),
    onClearMedia: () => selectMediaForOutputWithComposer(null),
    onScripture: (reference) => {
      void handleSelectScripture(reference);
    },
  });

  useStageBroadcast({
    currentText: outputSlideContent?.text ?? null,
    currentFooter: outputSlideContent?.footer ?? null,
    currentLabel: stageCurrentSlide?.label ?? null,
    currentRepeat: stageCurrentSlide?.repeat ?? null,
    currentInlineInstruction: stageCurrentSlide?.inlineInstruction ?? null,
    nextText: stageNextSlide?.text ?? null,
    nextFooter: stageNextSlide?.footer ?? null,
    nextLabel: stageNextSlide?.label ?? null,
    nextRepeat: stageNextSlide?.repeat ?? null,
    nextInlineInstruction: stageNextSlide?.inlineInstruction ?? null,
  });

  useEffect(() => {
    if (previousOutputActiveSlideRef.current === outputActiveSlideId) {
      return;
    }
    previousOutputActiveSlideRef.current = outputActiveSlideId;

    // A slide taken live shows: the words turn the Text layer on, and a
    // presentation's slide, a page with no words of its own, the Slide layer.
    const hasSlideContent = isPresentationSlideLive
      ? Boolean(outputSlideContent?.elements?.length || outputSlideContent?.text?.trim())
      : Boolean(outputSlideContent?.text?.trim());
    const layerShowing = isPresentationSlideLive ? showSlideInOutput : showTextInOutput;
    if (!hasSlideContent || layerShowing) {
      return;
    }
    if (!outputActiveSlideId) {
      return;
    }
    if (lastAutoEnabledSlideRef.current === outputActiveSlideId) {
      return;
    }

    if (isPresentationSlideLive) {
      setShowSlideInOutput(true);
    } else {
      setShowTextInOutput(true);
    }
    lastAutoEnabledSlideRef.current = outputActiveSlideId;
  }, [
    isPresentationSlideLive,
    outputActiveSlideId,
    outputSlideContent?.elements?.length,
    outputSlideContent?.text,
    setShowSlideInOutput,
    setShowTextInOutput,
    showSlideInOutput,
    showTextInOutput,
  ]);

  // Broadcast the active timer to the audience output + stage. (Was inline
  // inside OutputPreview before the timer UI moved to the sidebar rail.)
  useEffect(() => {
    if (!window.electronAPI) return;
    const activeTimer = timers.activeTimer;
    const payload = {
      type: "timer-update",
      timerLabel: activeTimer?.name ?? "Timer Name",
      timerText: getLiveTimerText(activeTimer, settingsTimerTimeUp),
      timerRunning: activeTimer?.isRunning ?? false,
      timerVisible: isTimerLayerEnabled,
      // Once it has run out: the message's colour, and whether it blinks.
      timerTimeUp: isTimeUpShowing(activeTimer, settingsTimerTimeUp)
        ? { color: settingsTimerTimeUp.color, blink: settingsTimerTimeUp.blink }
        : null,
    };
    // The audience screens show the name only when Settings says to; the
    // stage screens show it as their layouts say, so theirs keeps it.
    window.electronAPI.sendToOutput(
      settingsTimerShowName ? payload : { ...payload, timerLabel: null },
    );
    if (window.electronAPI.sendToStage) {
      window.electronAPI.sendToStage(payload);
    }
    window.electronAPI.sendToWorshipStage?.(payload);
  }, [
    isTimerLayerEnabled,
    settingsTimerShowName,
    settingsTimerTimeUp,
    timers.activeTimer,
    timers.activeTimer?.isRunning,
    timers.activeTimer?.secondsValue,
    timers.activeTimer?.name,
    timers.activeTimer?.finished,
  ]);

  // Resolve the active prop IDs into the full overlay payload that
  // useOutputBroadcast forwards to the audience window.
  const orgPropsList = useQuery(
    api.props.listByOrg,
    orgId ? { orgId } : "skip",
  );
  const resolvedPropsOverlay = useMemo(() => {
    if (!orgPropsList || activePropIds.length === 0) return [];
    const byId = new Map(
      orgPropsList.map((prop) => [prop._id as unknown as string, prop]),
    );
    return activePropIds
      .map((id) => byId.get(id))
      .filter((prop): prop is NonNullable<typeof prop> => Boolean(prop))
      .sort((left, right) => right.order - left.order)
      .map((prop) => {
        const id = prop._id as unknown as string;
        const draft = livePropDrafts[id] ?? {};
        const mediaId = draft.mediaId ?? prop.mediaId;
        const mediaItem = mediaId
          ? allMediaItems.find((item) => item.id === mediaId) ?? null
          : null;
        return {
          id,
          kind: mediaItem?.type ?? prop.kind,
          mediaId,
          imageUrl:
            mediaItem?.type === "image"
              ? mediaItem.url
              : prop.imageUrl,
          mediaUrl:
            mediaItem?.type === "video"
              ? mediaItem.url
              : prop.mediaUrl,
          youtubeUrl: draft.youtubeUrl ?? prop.youtubeUrl,
          ndiSourceName: draft.ndiSourceName ?? prop.ndiSourceName,
          captureDeviceId: draft.captureDeviceId ?? prop.captureDeviceId,
          captureDeviceLabel:
            draft.captureDeviceLabel ?? prop.captureDeviceLabel,
          shownAtMs: activePropShownAtMsById[id],
          text: draft.text ?? prop.text,
          position: draft.position ?? prop.position,
          opacity: draft.opacity ?? prop.opacity,
          sizePercent: draft.sizePercent ?? prop.sizePercent,
          color: draft.color ?? prop.color,
          fontSize: draft.fontSize ?? prop.fontSize,
        };
      });
  }, [
    orgPropsList,
    activePropIds,
    activePropShownAtMsById,
    allMediaItems,
    livePropDrafts,
  ]);

  const handleSetActivePropIds = useCallback((ids: string[]) => {
    setActivePropIds(ids);
    setActivePropShownAtMsById((current) => {
      const next: Record<string, number> = {};
      const now = Date.now();
      for (const id of ids) {
        next[id] = current[id] ?? now;
      }
      return next;
    });
  }, []);

  const handleSetLivePropDraft = useCallback(
    (propId: string, patch: Partial<PropsOverlayItem> & { name?: string }) => {
      setLivePropDrafts((prev) => ({
        ...prev,
        [propId]: {
          ...(prev[propId] ?? {}),
          ...patch,
        },
      }));
    },
    [],
  );

  const handleClearLivePropDraft = useCallback((propId: string) => {
    setLivePropDrafts((prev) => {
      if (!prev[propId]) return prev;
      const next = { ...prev };
      delete next[propId];
      return next;
    });
  }, []);

  // Pushing a master slide to the live output uses the existing
  // edited-snapshot channel: synthesize an EditedOutputSnapshot with the
  // master's color as the background and its body as the text. The audience
  // output already knows how to render that shape, so we don't need a new
  // broadcast type.
  const handlePushMasterSlide = useCallback(
    (master: { name: string; color: string; body: string }) => {
      setEditedOutputSnapshot({
        slideId: `master:${master.name}:${Date.now()}`,
        text: master.body || "",
        elements: [],
        canvasSize: DEFAULT_CANVAS_SIZE,
        backgroundColor: master.color,
      });
      setShowTextInOutput(Boolean(master.body));
    },
    [setShowTextInOutput],
  );

  useOutputBroadcast({
    activeMediaItem: effectiveActiveMediaItem,
    showText: slideShowsInOutput,
    showMedia: showMediaInOutput,
    hideBackground: hideBackgroundInOutput,
    textPosition: outputTextPosition,
    videoSettings,
    mediaFilterCSS: effectiveMediaFilterCSS,
    isVideoPlaying:
      isScriptureActive && effectiveActiveMediaItem?.type === "video"
        ? true
        : isVideoPlaying,
    videoCurrentTime,
    videoTimeSampledAtMs,
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
      nameBannerHeightPx: settingsTimerNameBannerHeightPx,
      clockColor: settingsTimerClockColor,
      nameColor: settingsTimerNameColor,
      nameBannerEnabled: settingsTimerNameBannerEnabled,
      nameBannerColor: settingsTimerNameBannerColor,
      titlePosition: settingsTimerTitlePosition,
      boxColor: settingsTimerBoxColor,
    },
    screenComposerEnabled: screenComposer.enabled,
    screenComposerLayout: screenComposer.liveLayout,
    // The banner shows whenever an overlay is active — `activeMessageOverlay`
    // is the single source of truth (set on "Show", cleared on "Hide" /
    // auto-dismiss). It must NOT be gated on the looks-layer flag, which lives
    // in a different component and updates on a separate render pass — that
    // race made the banner appear in the operator preview but never reach the
    // main output.
    messageOverlay: activeMessageOverlay,
    propsOverlay: resolvedPropsOverlay,
    activeSlideId: outputActiveSlideId,
    slideText: outputSlideContent?.text ?? null,
    slideFooter: outputSlideContent?.footer ?? null,
    slideElements: outputSlideContent?.elements ?? null,
    slideCanvasSize: outputSlideContent?.canvasSize ?? null,
    slideBackgroundColor: outputSlideContent?.backgroundColor ?? null,
    presentationSlide: isPresentationSlideLive,
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

      // Into the service that is open, or the one chosen in the list, which
      // opens: the deck is shown in it once it is in.
      if (!selectedServiceId) {
        toastImportNeedsService();
        return;
      }
      if (!isInsideService) {
        handleEnterService(selectedServiceId);
      }

      let importedCount = 0;

      for (const file of files) {
        try {
          const fileLabel = `${file.name} (${importedCount + 1} of ${files.length})`;
          setPresentationImportState({
            isVisible: true,
            title: mode === "images" ? "Importing presentation images" : "Importing presentation",
            detail: `Preparing ${fileLabel}`,
            progress:
              files.length > 0
                ? (importedCount / files.length) * 100
                : null,
          });

          const presentation = await importServicePresentationFile(
            file,
            mode,
            (progress: PresentationImportProgress) => {
              const fileBaseProgress = files.length > 0 ? (importedCount / files.length) * 100 : 0;
              const fileWeight = files.length > 0 ? 100 / files.length : 100;
              const nextProgress =
                progress.percent == null
                  ? null
                  : Math.min(
                      99,
                      fileBaseProgress + (progress.percent / 100) * fileWeight,
                    );

              setPresentationImportState({
                isVisible: true,
                title:
                  mode === "images"
                    ? "Importing presentation images"
                    : "Importing presentation",
                detail: `${progress.detail ?? "Processing file"} • ${fileLabel}`,
                progress: nextProgress,
              });
            },
          );
          const refId = await addPresentationToService(
            selectedServiceId,
            presentation,
          );
          if (!refId) {
            toast.error(`${file.name} couldn't be imported.`, {
              duration: IMPORT_ERROR_DURATION_MS,
            });
            continue;
          }

          importedCount += 1;
          const presentationLibraryId = `presentation_${refId}`;
          setServiceItemIndex(serviceItems.length + importedCount - 1);
          setSelectedServiceGroupId(null);
          setSelectedLibraryId(null);
          setSelectedPresentationLibraryId(presentationLibraryId);
          setSelected({ libraryId: presentationLibraryId, index: 0 });
        } catch (error) {
          toast.error(
            userMessage(error, `${file.name} couldn't be imported.`, "Import"),
            {
              duration: IMPORT_ERROR_DURATION_MS,
            },
          );
        }
      }

      setPresentationImportState({
        isVisible: false,
        title: "Importing presentation",
        detail: "",
        progress: null,
      });

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
      handleEnterService,
      isInsideService,
      selectedServiceId,
      serviceItems.length,
      setSelected,
      setServiceItemIndex,
      setSelectedServiceGroupId,
      setSelectedLibraryId,
      setSelectedPresentationLibraryId,
    ],
  );

  // One import at a time: asked again while its dialog is open or its files
  // are being read, it does nothing rather than open a second.
  const importInProgressRef = useRef(false);
  const handleImportRequest = useCallback(async (mode: PresentationImportMode = "presentation") => {
    if (!selectedServiceId) {
      toastImportNeedsService();
      return;
    }

    if (!window.electronAPI?.selectPresentationFiles) {
      toast.error("File import is unavailable in this build.", {
        duration: IMPORT_ERROR_DURATION_MS,
      });
      return;
    }

    if (importInProgressRef.current) {
      return;
    }
    importInProgressRef.current = true;
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
        userMessage(error, "The import couldn't be opened. Try again.", "Present"),
        {
          duration: IMPORT_ERROR_DURATION_MS,
        },
      );
    } finally {
      importInProgressRef.current = false;
    }
  }, [handleImportFiles, selectedServiceId]);

  // File ▸ Import, with the handler as it is now. Listened for once: the
  // handler is new on nearly every render of this window, which redraws as
  // the timers tick, and listening afresh on each could leave listeners from
  // the renders just gone still hearing the menu, each carrying it out as
  // things stood when it was made — the same toast three or four times.
  const importRequestRef = useRef(handleImportRequest);
  useEffect(() => {
    importRequestRef.current = handleImportRequest;
  });
  useEffect(() => {
    if (!window.electronAPI?.onOpenImportFromMenu) {
      return;
    }

    return window.electronAPI.onOpenImportFromMenu((mode) => {
      void importRequestRef.current(mode ?? "presentation");
    });
  }, []);

  return (
    <>
      <MainView
        viewMode={viewMode}
        bottomTab={bottomTab}
        contentSource={contentSource}
        orgId={orgId}
        localOrgId={localWorkspaceOrgId}
        userId={userId}
        servicesSidebarProps={{
          services,
          isLoading: servicesLoading,
          selectedServiceId,
          isInsideService,
          selectedService,
          serviceItems,
          serviceGroups: selectedService?.groups ?? [],
          serviceTemplates,
          selectedServiceTemplateId,
          templateLibraryItems: libraryItems,
          templateMediaItems: allMediaItems,
          serviceItemIndex,
          selectedServiceGroupId,
          onEnterService: handleEnterService,
          onExitService: exitService,
          onSelectServiceItem: handleSelectServiceItem,
          onSelectServiceGroup: (groupId) => {
            setSelectedServiceGroupId(groupId);
            setServiceItemIndex(null);
          },
          onDoubleClickServiceItem: handleDoubleClickServiceItem,
          onOpenMiniEditor: handleOpenMiniEditor,
          onRemoveFromService: handleRemoveFromService,
          onAddGroupToService: selectedServiceId
            ? (label: string) => addGroupToService(selectedServiceId, label)
            : () => Promise.resolve(),
          onRenameServiceGroup: selectedServiceId
            ? (groupId: string, label: string) =>
                renameServiceGroup(selectedServiceId, groupId, label)
            : () => Promise.resolve(),
          onDeleteServiceGroup: selectedServiceId
            ? (groupId: string) => deleteServiceGroup(selectedServiceId, groupId)
            : () => Promise.resolve(),
          onMoveServiceItemToGroup: selectedServiceId
            ? (index: number, groupId: string | null, toIndex?: number) =>
                moveServiceItemToGroup(selectedServiceId, index, groupId, toIndex)
            : () => Promise.resolve(),
          onReorderServiceGroup: selectedServiceId
            ? (groupId: string, toLayoutIndex: number) =>
                reorderServiceGroup(selectedServiceId, groupId, toLayoutIndex)
            : () => Promise.resolve(),
          onRenameServiceItem: selectedServiceId
            ? (index: number, label: string) =>
                renameServiceItem(selectedServiceId, index, label)
            : () => Promise.resolve(),
          onSelectServiceTemplate: selectDefaultServiceTemplate,
          onCreateServiceTemplate: createServiceTemplate,
          onRenameServiceTemplate: renameServiceTemplate,
          onAddGroupToServiceTemplate: addGroupToServiceTemplate,
          onRenameServiceTemplateGroup: renameServiceTemplateGroup,
          onDeleteServiceTemplateGroup: deleteServiceTemplateGroup,
          onAddItemToServiceTemplate: addItemToServiceTemplate,
          onRemoveItemFromServiceTemplate: removeItemFromServiceTemplate,
          onMoveServiceTemplateItemToGroup: moveServiceTemplateItemToGroup,
          onReorderServiceTemplateGroup: reorderServiceTemplateGroup,
          onDeleteServiceTemplate: deleteServiceTemplate,
          onCreateService: async (name, templateId) => {
            await createNewService(name, templateId);
          },
          onRenameService: renameExistingService,
          onDeleteService: deleteService,
          onDeleteServices: deleteServices,
          onArchiveServices: archiveServices,
          onReorderServiceItems: selectedServiceId
            ? (from: number, to: number) =>
                reorderServiceItems(selectedServiceId, from, to)
            : () => Promise.resolve(),
          onReorderServices: reorderServices,
          onAddScriptureToService: addScriptureToService,
        }}
        presentState={{
          slidesForGrid,
          activeSlideId,
          outputActiveSlideId,
          selected,
          isGridView,
          setIsGridView,
          selectedLibraryItem: selectedDeckItem,
          selectedLibraryId: selectedDeckLibraryId,
          setSelectedLibraryId: handleSetSelectedDeckLibraryId,
          handleSelectSlide: handleLiveSlideSelect,
          handleEditSlide,
          handleOpenMiniEditorForSlide,
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
          isPreviewOutputting,
          effectiveActiveMediaItem,
          videoSettings,
          handleOutputPreviewMedia,
          liveVideoControls,
          videoRate,
          onToggleVideoPlayback: toggleVideoPlayback,
          handleMediaPanelSelect,
          handleAddMediaToService,
          handleRenameMediaInServices: updateMediaInServices,
          handleRemoveMediaFromServices: removeMediaFromServices,
          updateVideoSettings,
          showMediaInOutput,
          setShowMediaInOutput,
          onClearMedia: () => selectMediaForOutputWithComposer(null),
          mediaFilters: effectiveMediaFilters,
          onMediaFiltersChange: handleEffectiveMediaFiltersChange,
          onResetFilters: handleResetEffectiveMediaFilters,
          isVideoPlaying,
          videoCurrentTime,
          videoTimeSampledAtMs,
        }}
        libraryState={{
          libraryItems,
          filteredLibraryItems,
          libraryLoading,
          categories,
          selectedCategoryId,
          setSelectedCategoryId,
          createNewLibraryItem: async (title, body, categoryId, content) => {
            return createNewLibraryItem(title, body, categoryId, content);
          },
          createLibraryItemFromDraft: async (draft, categoryId) => {
            await createLibraryItemFromDraft(draft, categoryId);
          },
          createComposedLibraryItem: async (
            title,
            itemIds,
            categoryId,
            slideSelections,
          ) => {
            await createComposedLibraryItem(
              title,
              itemIds,
              categoryId,
              slideSelections,
            );
          },
          updateComposedLibraryItem: async (
            itemId,
            title,
            itemIds,
            categoryId,
            slideSelections,
          ) => {
            const byId = new Map(libraryItems.map((item) => [String(item._id), item]));
            const selectedItems = itemIds
              .map((id) => byId.get(String(id)))
              .filter((item): item is (typeof libraryItems)[number] =>
                Boolean(item),
              );
            if (selectedItems.length === 0) return;
            const draft = createComposedLibraryDraft(
              title,
              selectedItems,
              libraryTextDefaults,
              slideSelections,
            );
            await updateExistingLibraryItem(itemId, draft, categoryId);
          },
          handleRenameLibraryItem,
          deleteLibraryItem,
          handleAddToService,
          onOpenMiniEditor: handleOpenMiniEditor,
          createNewCategory: async (name) => {
            return createNewCategory(name);
          },
          searchQuery,
          setSearchQuery,
          searchMode: librarySearchMode,
          setSearchMode: setLibrarySearchMode,
          contentSource,
          presentationImportState,
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
            nameBannerHeightPx: settingsTimerNameBannerHeightPx,
            clockColor: settingsTimerClockColor,
            nameColor: settingsTimerNameColor,
            nameBannerEnabled: settingsTimerNameBannerEnabled,
            nameBannerColor: settingsTimerNameBannerColor,
            titlePosition: settingsTimerTitlePosition,
            timeUp: settingsTimerTimeUp,
          },
          updateFontStyle,
        }}
        speechSettings={{
          lang: settingsLang,
          inputDeviceId: settingsSpeechInputDeviceId,
          bible: {
            onHeard: settingsAgent.bibleOnHeard,
            addToService: settingsAgent.bibleAddToService,
            voiceCommands: settingsAgent.bibleVoiceCommands,
          },
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
          showSlideInOutput,
          setShowSlideInOutput,
          isPresentationSlideLive,
          hideBackgroundInOutput,
          setHideBackgroundInOutput,
          outputTextPosition,
          isTimerLayerEnabled,
          setIsTimerLayerEnabled,
          isMessageLayerEnabled,
          setIsMessageLayerEnabled,
          activeMessageOverlay,
          onShowMessageOverlay: setActiveMessageOverlay,
          activePropIds,
          propsOverlay: resolvedPropsOverlay,
          onSetLivePropDraft: handleSetLivePropDraft,
          onClearLivePropDraft: handleClearLivePropDraft,
          onSetActivePropIds: handleSetActivePropIds,
          onPushMasterSlide: handlePushMasterSlide,
          timers,
        }}
      />
      {pendingAudioOutput ? (
        <Dialog
          title="Use new audio output?"
          onClose={() => setPendingAudioOutput(null)}
        >
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {pendingAudioOutput.label}
            </span>{" "}
            was connected. Would you like Present to use it for video audio?
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingAudioOutput(null)}
              className="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => {
                setSettingsAudioOutputDeviceId(pendingAudioOutput.deviceId);
                setSettingsAudioOutputDeviceLabel(pendingAudioOutput.label);
                setPendingAudioOutput(null);
              }}
              className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              Use this output
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
