"use client";

import * as React from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../renderer/shared/components";
import { PresentServicesSidebar } from "./PresentServicesSidebar";
import { PresentCenterArea } from "./PresentCenterArea";
import { PresentOutputSidebar } from "./PresentOutputSidebar";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { SlideData } from "../../features/slides";
import {
  MediaItem,
  VideoSettings,
  MediaFilters,
  MediaState,
} from "../../features/media/hooks/useMediaFolders";
import type {
  OutputTextPosition,
  ScriptureFooterPosition,
  ScriptureTextAlign,
  ScriptureVerticalAlign,
} from "../../shared/types/output-window";
import type {
  ViewMode,
  BottomTab,
  LibraryItem,
  LibraryItemDraft,
  LibraryContent,
  CanvasSizePreset,
  Category,
  Service,
  PlaybackState,
  ServiceItem,
  ContentSource,
  MessageOverlay,
  SlideElement,
} from "../../shared/types/index";
import { SidebarRail } from "../sidebar-rail";
import type { LibrarySearchMode } from "../library/hooks";
import { MediaPanel } from "../media";
import type { UseTimersResult } from "../../renderer/shared/hooks";
import { fixLyrics } from "../../renderer/shared/lib/lyrics";
import { ScriptureSlide } from "../../features/scripture/lib/slides";
import type { MediaPanelRef } from "../media/MediaPanel";
import type { ScripturePanelRef } from "../scripture/components/ScripturePanel";
import type { LibrariesPanelRef } from "../shows/LibrariesPanel";

export interface MainViewPresentState {
  slidesForGrid: SlideData[];
  activeSlideId: string | null;
  outputActiveSlideId: string | null;
  selected: { libraryId: string | null; index: number } | null;
  selectedLibraryItem: LibraryItem | null;
  scriptureEditorItem: LibraryItem | null;
  selectedLibraryId: string | null;
  setSelectedLibraryId: (id: string | null) => void;
  handleSelectSlide: (
    slideId: string,
    text: string,
    footer?: string
  ) => Promise<void>;
  handleEditSlide: (libraryId: string, slideIndex: number) => void;
  handleSaveLibraryItem: (draft: LibraryItemDraft) => Promise<void>;
  handleSaveScriptureEditor: (draft: LibraryItemDraft) => Promise<void>;
  handleUpdateEditedSlideOutput: EditorUpdateOutputHandler;
  handleUpdateScriptureEditedSlideOutput: EditorUpdateOutputHandler;
  handleReorderLibrarySlides: (fromIndex: number, toIndex: number) => Promise<void>;
  editScrollToSlide: number | null;
  setEditScrollToSlide: (index: number | null) => void;
  handleScriptureOutput: (slides: ScriptureSlide[]) => void;
  activeSlideContent: {
    text: string;
    footer?: string;
    elements?: SlideElement[] | null;
    canvasSize?: CanvasSizePreset | null;
    backgroundColor?: string | null;
  } | null;
  slideGroups: { label: string; count: number }[];
}

export type EditorUpdateOutputHandler = (payload: {
  slideId: string;
  text: string;
  elements: SlideElement[];
  canvasSize: CanvasSizePreset;
  backgroundColor: string | null;
}) => void;

export interface MainViewMediaState {
  mediaState: MediaState;
  showViewMedia: MediaItem | null;
  effectiveActiveMediaItem: MediaItem | null;
  showVideoRef: React.RefObject<HTMLVideoElement | null>;
  videoSettings: VideoSettings;
  handleOutputPreviewMedia: () => void;
  handleVideoPlay: () => void;
  handleVideoPause: () => void;
  handleVideoEnded: () => void;
  handleVideoSeeked: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
  onToggleVideoPlayback: () => void;
  handleMediaPanelSelect: (item: MediaItem | null) => void;
  handleAddMediaToService: (
    mediaId: string,
    mediaName: string
  ) => Promise<void>;
  updateVideoSettings: (s: Partial<VideoSettings>) => void | Promise<void>;
  showMediaInOutput: boolean;
  setShowMediaInOutput: (show: boolean) => void;
  onClearMedia: () => void;
  mediaFilters: MediaFilters;
  onMediaFiltersChange: (f: Partial<MediaFilters>) => void;
  onResetFilters: () => void;
  isVideoPlaying: boolean;
  videoCurrentTime: number;
}

export interface MainViewLibraryState {
  filteredLibraryItems: LibraryItem[];
  libraryLoading: boolean;
  categories: Category[];
  selectedCategoryId: string | null;
  setSelectedCategoryId: (id: string | null) => void;
  createNewLibraryItem: (
    title: string,
    body: string,
    categoryId?: string,
    content?: LibraryContent,
  ) => Promise<string | null | undefined | void>;
  createLibraryItemFromDraft: (
    draft: LibraryItemDraft,
    categoryId?: string,
  ) => Promise<void>;
  createComposedLibraryItem: (
    title: string,
    itemIds: string[],
    categoryId?: string,
    slideSelections?: Record<string, number[]>,
  ) => Promise<void>;
  handleRenameLibraryItem: (
    libraryId: string,
    newTitle: string
  ) => Promise<void>;
  deleteLibraryItem: (libraryId: string) => Promise<void>;
  handleAddToService: (libraryId: string) => Promise<void>;
  createNewCategory: (name: string) => Promise<void>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchMode: LibrarySearchMode;
  setSearchMode: (mode: LibrarySearchMode) => void;
  contentSource: ContentSource;
  presentationImportState?: {
    isVisible: boolean;
    title: string;
    detail: string;
    progress: number | null;
  };
}

export interface MainViewStyleState {
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  scriptureFontFamily: string;
  scriptureFontSize: number;
  scriptureFooterFontSize: number;
  scriptureFontWeight: string;
  scriptureTextAlign: ScriptureTextAlign;
  scriptureVerticalAlign: ScriptureVerticalAlign;
  scriptureFooterAlign: ScriptureTextAlign;
  scriptureFooterPosition: ScriptureFooterPosition;
  libraryDefaultFontFamily: string;
  libraryDefaultFontSize: number;
  libraryDefaultFontWeight: string;
  setScriptureFontSize: (size: number) => void;
  setScriptureTextAlign: (align: ScriptureTextAlign) => void;
  setScriptureVerticalAlign: (align: ScriptureVerticalAlign) => void;
  setScriptureFooterAlign: (align: ScriptureTextAlign) => void;
  setScriptureFooterPosition: (position: ScriptureFooterPosition) => void;
  timerLayout: {
    xPercent: number;
    yPercent: number;
    clockFontPx: number;
    nameFontPx: number;
    clockColor: string;
    nameColor: string;
    nameBannerEnabled: boolean;
    nameBannerColor: string;
    titlePosition: "top" | "bottom";
  };
  updateFontStyle: (style: Partial<PlaybackState>) => void;
}

export interface MainViewPanelRefs {
  showsPanelRef: React.RefObject<LibrariesPanelRef | null>;
  mediaPanelRef: React.RefObject<MediaPanelRef | null>;
  scripturePanelRef: React.RefObject<ScripturePanelRef | null>;
}

export interface MainViewOutputState {
  isFrozen: boolean;
  onToggleFreeze: () => void;
  showTextInOutput: boolean;
  setShowTextInOutput: (show: boolean) => void;
  hideBackgroundInOutput: boolean;
  setHideBackgroundInOutput: (hide: boolean) => void;
  outputTextPosition: OutputTextPosition;
  isTimerLayerEnabled: boolean;
  setIsTimerLayerEnabled: (show: boolean) => void;
  isMessageLayerEnabled: boolean;
  setIsMessageLayerEnabled: (show: boolean) => void;
  activeMessageOverlay: MessageOverlay | null;
  onShowMessageOverlay: (overlay: MessageOverlay | null) => void;
  activePropIds: string[];
  onSetActivePropIds: (ids: string[]) => void;
  onPushMasterSlide: (master: {
    name: string;
    color: string;
    body: string;
  }) => void;
  timers: UseTimersResult;
}

interface MainViewProps {
  viewMode: ViewMode;
  bottomTab: BottomTab;
  orgId: Id<"organizations"> | undefined;

  servicesSidebarProps: {
    services: Service[];
    isLoading: boolean;
    selectedServiceId: Id<"services"> | null;
    isInsideService: boolean;
    selectedService: Service | null;
    serviceItems: ServiceItem[];
    serviceItemIndex: number;
    onEnterService: (serviceId: Id<"services">) => void;
    onExitService: () => void;
    onSelectServiceItem: (index: number) => void;
    onDoubleClickServiceItem: (index: number) => void;
    onRemoveFromService: (index: number) => Promise<void>;
    onCreateService: (name: string) => Promise<void>;
    onRenameService: (
      serviceId: Id<"services">,
      newName: string
    ) => Promise<void>;
    onDeleteService: (serviceId: Id<"services">) => Promise<void>;
    onReorderServiceItems: (from: number, to: number) => Promise<void>;
    onReorderServices: (from: number, to: number) => Promise<void>;
    onAddScriptureToService: (
      serviceId: Id<"services">,
      ref: string,
      text: string,
    ) => Promise<void>;
  };

  presentState: MainViewPresentState;
  mediaState: MainViewMediaState;
  libraryState: MainViewLibraryState;
  styleState: MainViewStyleState;
  speechSettings: {
    lang: string;
    inputDeviceId: string | null;
  };
  panelRefs: MainViewPanelRefs;
  outputState: MainViewOutputState;
  contentSource: ContentSource;
  isPptxSelection?: boolean;
}

export function MainView({
  viewMode,
  bottomTab,
  orgId,
  servicesSidebarProps,
  presentState,
  mediaState,
  libraryState,
  styleState,
  speechSettings,
  panelRefs,
  outputState,
  contentSource,
  isPptxSelection = false,
}: MainViewProps) {
  const {
    isFrozen: isOutputFrozen,
    onToggleFreeze,
    showTextInOutput,
    setShowTextInOutput,
    hideBackgroundInOutput,
    setHideBackgroundInOutput,
    outputTextPosition,
    isTimerLayerEnabled,
    setIsTimerLayerEnabled,
    isMessageLayerEnabled,
    setIsMessageLayerEnabled,
    activeMessageOverlay,
    onShowMessageOverlay,
    activePropIds,
    onSetActivePropIds,
    onPushMasterSlide,
    timers,
  } = outputState;

  const {
    showViewMedia,
    effectiveActiveMediaItem,
    showVideoRef,
    videoSettings,
    handleOutputPreviewMedia,
    handleVideoPlay,
    handleVideoPause,
    handleVideoEnded,
    handleVideoSeeked,
    onToggleVideoPlayback,
    handleMediaPanelSelect,
    handleAddMediaToService,
    updateVideoSettings,
    showMediaInOutput,
    setShowMediaInOutput,
    onClearMedia,
    mediaFilters,
    onMediaFiltersChange: updateMediaFilters,
    onResetFilters,
    isVideoPlaying,
    videoCurrentTime,
  } = mediaState;

  const {
    slidesForGrid,
    activeSlideId,
    outputActiveSlideId,
    selected,
    selectedLibraryItem,
    scriptureEditorItem,
    selectedLibraryId,
    setSelectedLibraryId,
    handleSelectSlide,
    handleEditSlide,
    handleSaveLibraryItem,
    handleSaveScriptureEditor,
    handleUpdateEditedSlideOutput,
    handleReorderLibrarySlides,
    editScrollToSlide,
    setEditScrollToSlide,
    handleScriptureOutput,
    handleUpdateScriptureEditedSlideOutput,
    activeSlideContent,
    slideGroups,
  } = presentState;

  const {
    filteredLibraryItems,
    libraryLoading,
    categories,
    selectedCategoryId,
    setSelectedCategoryId,
    createNewLibraryItem,
    createLibraryItemFromDraft,
    createComposedLibraryItem,
    handleRenameLibraryItem,
    deleteLibraryItem,
    handleAddToService,
    createNewCategory,
    searchQuery,
    setSearchQuery,
    searchMode,
    setSearchMode,
    presentationImportState,
  } = libraryState;

  const {
    fontFamily,
    fontSize,
    fontBold,
    fontItalic,
    fontUnderline,
    scriptureFontFamily,
    scriptureFontSize,
    scriptureFooterFontSize,
    scriptureFontWeight,
    scriptureTextAlign,
    scriptureVerticalAlign,
    scriptureFooterAlign,
    scriptureFooterPosition,
    libraryDefaultFontFamily,
    libraryDefaultFontSize,
    libraryDefaultFontWeight,
    timerLayout,
    updateFontStyle,
  } = styleState;

  const {
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
    onReorderServiceItems: reorderServiceItems,
    onReorderServices: reorderServices,
    onAddScriptureToService,
  } = servicesSidebarProps;

  const { showsPanelRef, mediaPanelRef, scripturePanelRef } = panelRefs;

  const handleEditorScrollComplete = React.useCallback(() => {
    setEditScrollToSlide(null);
  }, [setEditScrollToSlide]);

  const editorProps = React.useMemo(
    () => ({
      fontFamily,
      fontSize,
      fontBold,
      fontItalic,
      fontUnderline,
      libraryDefaultFontFamily,
      libraryDefaultFontSize,
      libraryDefaultFontWeight,
      scriptureDefaultFontFamily: scriptureFontFamily,
      scriptureDefaultFontSize: scriptureFontSize,
      scriptureDefaultFontWeight: scriptureFontWeight,
      onFontStyleChange: updateFontStyle,
      onSave: handleSaveLibraryItem,
      onFixLyrics: fixLyrics,
      onUpdateOutput: handleUpdateEditedSlideOutput,
      scrollToSlideIndex: editScrollToSlide,
      onScrollComplete: handleEditorScrollComplete,
    }),
    [
      editScrollToSlide,
      fontBold,
      fontFamily,
      fontItalic,
      fontSize,
      fontUnderline,
      handleEditorScrollComplete,
      handleSaveLibraryItem,
      handleUpdateEditedSlideOutput,
      libraryDefaultFontFamily,
      libraryDefaultFontSize,
      libraryDefaultFontWeight,
      scriptureFontFamily,
      scriptureFontSize,
      scriptureFontWeight,
      updateFontStyle,
    ],
  );

  const showsPanelProps = React.useMemo(
    () => ({
      libraryItems: filteredLibraryItems,
      isLoading: libraryLoading,
      categories,
      selectedLibraryId,
      selectedCategoryId,
      isInsideService,
      selectedServiceId,
      onSelectLibraryItem: setSelectedLibraryId,
      onSelectCategory: setSelectedCategoryId,
      onCreateLibraryItem: createNewLibraryItem,
      onNewLibraryItem: async () => {
        // Create an empty item that opens straight in the editor's Lyrics
        // view (no modal). editorView:"source" makes LyricsEditor default to
        // the lyrics tab so the operator starts typing immediately.
        const newId = await createNewLibraryItem(
          "Untitled",
          "",
          selectedCategoryId ?? undefined,
          { editorView: "source" },
        );
        if (newId) {
          handleEditSlide(String(newId), 0);
        }
      },
      onCreateLibraryItemFromDraft: createLibraryItemFromDraft,
      onCreateComposedLibraryItem: createComposedLibraryItem,
      onRenameLibraryItem: handleRenameLibraryItem,
      onDeleteLibraryItem: deleteLibraryItem,
      onAddToService: handleAddToService,
      onCreateCategory: createNewCategory,
      onFixLyrics: fixLyrics,
      searchQuery,
      onSearchChange: setSearchQuery,
      searchMode,
      onSearchModeChange: setSearchMode,
      contentSource,
      speechLang: speechSettings.lang,
      speechInputDeviceId: speechSettings.inputDeviceId,
    }),
    [
      categories,
      contentSource,
      createComposedLibraryItem,
      createLibraryItemFromDraft,
      createNewCategory,
      createNewLibraryItem,
      deleteLibraryItem,
      filteredLibraryItems,
      handleAddToService,
      handleRenameLibraryItem,
      isInsideService,
      libraryLoading,
      searchQuery,
      searchMode,
      selectedCategoryId,
      selectedLibraryId,
      selectedServiceId,
      speechSettings.inputDeviceId,
      speechSettings.lang,
      setSearchQuery,
      setSearchMode,
      setSelectedCategoryId,
      setSelectedLibraryId,
    ],
  );

  const handleOutputPreviewMediaClick = React.useCallback(() => {
    handleOutputPreviewMedia();
  }, [handleOutputPreviewMedia]);

  const handleToggleTextInOutput = React.useCallback(() => {
    setShowTextInOutput(!showTextInOutput);
  }, [setShowTextInOutput, showTextInOutput]);

  const handleToggleMediaInOutput = React.useCallback(() => {
    setShowMediaInOutput(!showMediaInOutput);
  }, [setShowMediaInOutput, showMediaInOutput]);

  const handleToggleHideBackground = React.useCallback(() => {
    setHideBackgroundInOutput(!hideBackgroundInOutput);
  }, [hideBackgroundInOutput, setHideBackgroundInOutput]);

  const handleClearOutputMedia = React.useCallback(() => {
    onClearMedia();
  }, [onClearMedia]);

  const handleToggleTimerLayer = React.useCallback(() => {
    setIsTimerLayerEnabled(!isTimerLayerEnabled);
  }, [isTimerLayerEnabled, setIsTimerLayerEnabled]);

  const handleToggleMessageLayer = React.useCallback(() => {
    const nextEnabled = !isMessageLayerEnabled;
    setIsMessageLayerEnabled(nextEnabled);
    if (!nextEnabled) {
      onShowMessageOverlay(null);
    }
  }, [
    isMessageLayerEnabled,
    onShowMessageOverlay,
    setIsMessageLayerEnabled,
  ]);

  const outputPreviewProps = React.useMemo(
    () => ({
      text: activeSlideContent?.text ?? null,
      footer: activeSlideContent?.footer ?? null,
      slideElements: activeSlideContent?.elements ?? null,
      canvasSize: activeSlideContent?.canvasSize ?? null,
      backgroundColor: activeSlideContent?.backgroundColor ?? null,
      activeSlideId: outputActiveSlideId,
      fontFamily,
      fontSize,
      fontBold,
      fontItalic,
      fontUnderline,
      scriptureFontFamily,
      scriptureFontSize,
      scriptureFooterFontSize,
      scriptureFontWeight,
      scriptureTextAlign,
      scriptureVerticalAlign,
      scriptureFooterAlign,
      scriptureFooterPosition,
      groups: slideGroups,
      activeMediaItem: effectiveActiveMediaItem,
      videoSettings,
      onVideoSettingsChange: updateVideoSettings,
      onToggleVideoPlayback,
      showText: showTextInOutput,
      showMedia: showMediaInOutput,
      hideBackground: hideBackgroundInOutput,
      textPosition: outputTextPosition,
      onToggleText: handleToggleTextInOutput,
      onToggleMedia: handleToggleMediaInOutput,
      onToggleHideBackground: handleToggleHideBackground,
      onClearMedia: handleClearOutputMedia,
      mediaFilters,
      onMediaFiltersChange: updateMediaFilters,
      onResetFilters,
      isVideoPlaying,
      videoCurrentTime,
      isFrozen: isOutputFrozen,
      onToggleFreeze,
      isTimerLayerEnabled,
      onToggleTimerLayer: handleToggleTimerLayer,
      isMessageLayerEnabled,
      onToggleMessageLayer: handleToggleMessageLayer,
      activeMessageOverlay,
      timers,
      timerLayout,
    }),
    [
      activeSlideContent?.backgroundColor,
      activeSlideContent?.canvasSize,
      activeSlideContent?.elements,
      activeSlideContent?.footer,
      activeSlideContent?.text,
      effectiveActiveMediaItem,
      fontBold,
      fontFamily,
      fontItalic,
      fontSize,
      fontUnderline,
      handleClearOutputMedia,
      handleToggleHideBackground,
      handleToggleMediaInOutput,
      handleToggleMessageLayer,
      handleToggleTextInOutput,
      handleToggleTimerLayer,
      activeMessageOverlay,
      hideBackgroundInOutput,
      isMessageLayerEnabled,
      isOutputFrozen,
      isTimerLayerEnabled,
      isVideoPlaying,
      mediaFilters,
      onResetFilters,
      onToggleFreeze,
      outputActiveSlideId,
      scriptureFooterAlign,
      scriptureFooterPosition,
      scriptureFontFamily,
      scriptureFontSize,
      scriptureFooterFontSize,
      scriptureFontWeight,
      scriptureTextAlign,
      scriptureVerticalAlign,
      showMediaInOutput,
      showTextInOutput,
      outputTextPosition,
      slideGroups,
      timers,
      timerLayout,
      onToggleVideoPlayback,
      updateMediaFilters,
      updateVideoSettings,
      videoCurrentTime,
      videoSettings,
    ],
  );

  const handleReorderServiceItemsSafe = React.useCallback(
    (from: number, to: number) => {
      return reorderServiceItems(from, to);
    },
    [reorderServiceItems],
  );

  const mergedServicesSidebarProps = React.useMemo(
    () => ({
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
      onReorderServiceItems: handleReorderServiceItemsSafe,
      onReorderServices: reorderServices,
    }),
    [
      createNewService,
      deleteService,
      enterService,
      exitService,
      handleDoubleClickServiceItem,
      handleRemoveFromService,
      handleReorderServiceItemsSafe,
      handleSelectServiceItem,
      isInsideService,
      renameExistingService,
      reorderServices,
      selectedService,
      selectedServiceId,
      serviceItemIndex,
      serviceItems,
      services,
      servicesLoading,
    ],
  );

  const renderShowMode = () => (
    <ResizablePanelGroup
      direction="horizontal"
      className="flex-1 w-full h-full"
      autoSaveId="present-main-layout-v13"
    >
      <ResizablePanel defaultSize="80" order={1}>
        <ResizablePanelGroup direction="vertical">
          {/* Top Row: Services (Left) + Center (Workspace) */}
          <ResizablePanel defaultSize="70">
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize="20" minSize="15" maxSize="35" order={1}>
                <PresentServicesSidebar
                  servicesSidebarProps={mergedServicesSidebarProps}
                />
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize="80" order={2}>
                <PresentCenterArea
                  viewMode={viewMode}
                  bottomTab={bottomTab}
                  slidesForGrid={slidesForGrid}
                  activeSlideId={activeSlideId}
                  selectedIndex={selected?.index ?? null}
                  selectedLibraryItem={selectedLibraryItem}
                  scriptureEditorItem={scriptureEditorItem}
                  selectedLibraryId={selectedLibraryId}
                  onSelectSlide={handleSelectSlide}
                  onEditSlide={handleEditSlide}
                  onReorderSlides={handleReorderLibrarySlides}
                  editorProps={editorProps}
                  onSaveScriptureEditor={handleSaveScriptureEditor}
                  onUpdateScriptureEditorOutput={
                    handleUpdateScriptureEditedSlideOutput
                  }
                  showViewMedia={showViewMedia}
                  showVideoRef={showVideoRef}
                  videoSettings={videoSettings}
                  onOutputPreviewMedia={handleOutputPreviewMediaClick}
                  onVideoPlay={handleVideoPlay}
                  onVideoPause={handleVideoPause}
                  onVideoEnded={handleVideoEnded}
                  onVideoSeeked={handleVideoSeeked}
                  showsPanelRef={showsPanelRef}
                  scripturePanelRef={scripturePanelRef}
                  showsPanelProps={showsPanelProps}
                  speechLang={speechSettings.lang}
                  speechInputDeviceId={speechSettings.inputDeviceId}
                  onSendScripture={handleScriptureOutput}
                  selectedServiceId={selectedServiceId}
                  onAddScriptureToService={onAddScriptureToService}
                  lockSingleSlideView={isPptxSelection}
                  importOverlay={presentationImportState}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Bottom Row: Wide Media Panel (spanning left till right sidebar).
              This row is exclusively for photo/video MEDIA — the workspace
              tabs (Audio / Text / Timer / Messages / Layers / Masters) live
              inside the right column under the Output preview. */}
          <ResizablePanel defaultSize="30" minSize="15">
            <div className="flex h-full flex-col border-t border-border bg-card overflow-hidden">
              <div className="min-h-0 flex-1 relative">
                <MediaPanel
                  ref={mediaPanelRef}
                  mediaState={mediaState.mediaState}
                  onSelectForOutput={handleMediaPanelSelect}
                  isInsideService={isInsideService}
                  selectedServiceId={selectedServiceId}
                  onAddToService={handleAddMediaToService}
                  orgId={orgId ?? null}
                />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Right Column: Output Preview on top, workspace rail (Audio / Text /
          Timer / Messages / Layers / Masters) underneath. The rail used to
          live in the main-area bottom row by mistake — that footer is now
          exclusively the photo/video media panel. */}
      <ResizablePanel defaultSize="22" minSize="20" maxSize="35" order={2}>
        <ResizablePanelGroup
          direction="vertical"
          autoSaveId="present-right-column-v1"
        >
          <ResizablePanel defaultSize="45" minSize="25">
            <PresentOutputSidebar outputPreviewProps={outputPreviewProps} />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="55" minSize="30">
            <SidebarRail
              orgId={orgId ?? null}
              isTimerLayerEnabled={isTimerLayerEnabled}
              onToggleTimerLayer={handleToggleTimerLayer}
              isTextLayerEnabled={showTextInOutput}
              onToggleTextLayer={handleToggleTextInOutput}
              isMessageLayerEnabled={isMessageLayerEnabled}
              onSetMessageLayerEnabled={setIsMessageLayerEnabled}
              activeMessageOverlay={activeMessageOverlay}
              onShowMessageOverlay={onShowMessageOverlay}
              onPushMasterSlide={onPushMasterSlide}
              activePropIds={activePropIds}
              onSetActivePropIds={onSetActivePropIds}
              timers={timers}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );

  const renderEditMode = () => (
    <div className="h-full w-full bg-background overflow-hidden">
      <PresentCenterArea
        viewMode="edit"
        bottomTab={bottomTab}
        slidesForGrid={slidesForGrid}
        activeSlideId={activeSlideId}
        selectedIndex={selected?.index ?? null}
        selectedLibraryItem={selectedLibraryItem}
        scriptureEditorItem={scriptureEditorItem}
        selectedLibraryId={selectedLibraryId}
        onSelectSlide={handleSelectSlide}
        onEditSlide={handleEditSlide}
        onReorderSlides={handleReorderLibrarySlides}
        editorProps={editorProps}
        onSaveScriptureEditor={handleSaveScriptureEditor}
        onUpdateScriptureEditorOutput={
          handleUpdateScriptureEditedSlideOutput
        }
        showViewMedia={showViewMedia}
        showVideoRef={showVideoRef}
        videoSettings={videoSettings}
        onOutputPreviewMedia={handleOutputPreviewMediaClick}
        onVideoPlay={handleVideoPlay}
        onVideoPause={handleVideoPause}
        onVideoEnded={handleVideoEnded}
        onVideoSeeked={handleVideoSeeked}
        showsPanelRef={showsPanelRef}
        scripturePanelRef={scripturePanelRef}
        showsPanelProps={showsPanelProps}
        speechLang={speechSettings.lang}
        speechInputDeviceId={speechSettings.inputDeviceId}
        onSendScripture={handleScriptureOutput}
        selectedServiceId={selectedServiceId}
        onAddScriptureToService={onAddScriptureToService}
        lockSingleSlideView={isPptxSelection}
      />
    </div>
  );

  return viewMode === "edit" ? renderEditMode() : renderShowMode();
}
