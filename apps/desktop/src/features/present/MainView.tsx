"use client";

import * as React from "react";
import { 
  ResizableHandle, 
  ResizablePanel, 
  ResizablePanelGroup 
} from "../../components";
import { PresentServicesSidebar } from "./PresentServicesSidebar";
import { PresentCenterArea } from "./PresentCenterArea";
import { PresentOutputSidebar } from "./PresentOutputSidebar";
import { Kbd } from "../../components/ui/kbd";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { SlideData } from "../../features/slides";
import { 
  MediaItem, 
  VideoSettings, 
  MediaFilters,
  MediaState
} from "../../features/media/hooks/useMediaFolders";
import { MediaPanel } from "../media";
import type { ViewMode, BottomTab, LibraryItem, Category, Service, PlaybackState, ServiceItem, ContentSource } from "../../types/index";
import { fixLyrics } from "../../lib/lyrics";
import { ScriptureSlide } from "../../features/scripture/lib/slides";
import type { MediaPanelRef } from "../media/MediaPanel";
import type { ScripturePanelRef } from "../scripture/components/ScripturePanel";
import type { ShowsPanelRef } from "../shows/ShowsPanel";

export interface MainViewPresentState {
  slidesForGrid: SlideData[];
  activeSlideId: string | null;
  selected: { libraryId: string | null; index: number } | null;
  selectedLibraryItem: LibraryItem | null;
  selectedLibraryId: string | null;
  setSelectedLibraryId: (id: string | null) => void;
  handleSelectSlide: (slideId: string, text: string, footer?: string) => Promise<void>;
  handleEditSlide: (libraryId: string, slideIndex: number) => void;
  handleSaveLibraryItem: (title: string, body: string) => Promise<void>;
  editScrollToSlide: number | null;
  setEditScrollToSlide: (index: number | null) => void;
  handleScriptureOutput: (slides: ScriptureSlide[]) => void;
  activeSlideContent: { text: string; footer?: string } | null;
  slideGroups: { label: string; count: number }[];
}

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
  handleMediaPanelSelect: (item: MediaItem | null) => void;
  handleAddMediaToService: (mediaId: string, mediaName: string) => Promise<void>;
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
  createNewLibraryItem: (title: string, body: string, categoryId?: string) => Promise<void>;
  handleRenameLibraryItem: (libraryId: string, newTitle: string) => Promise<void>;
  deleteLibraryItem: (libraryId: string) => Promise<void>;
  handleAddToService: (libraryId: string) => Promise<void>;
  createNewCategory: (name: string) => Promise<void>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  contentSource: ContentSource;
}

export interface MainViewStyleState {
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  scriptureFontFamily: string;
  scriptureFontSize: number;
  scriptureTextAlign: "left" | "center" | "right";
  updateFontStyle: (style: Partial<PlaybackState>) => void;
}

export interface MainViewPanelRefs {
  showsPanelRef: React.RefObject<ShowsPanelRef | null>;
  mediaPanelRef: React.RefObject<MediaPanelRef | null>;
  scripturePanelRef: React.RefObject<ScripturePanelRef | null>;
}

export interface MainViewOutputState {
  isFrozen: boolean;
  onToggleFreeze: () => void;
  showTextInOutput: boolean;
  setShowTextInOutput: (show: boolean) => void;
}


interface MainViewProps {
  viewMode: ViewMode;
  bottomTab: BottomTab;
  orgId: Id<"organizations"> | undefined;
  userId: Id<"users"> | null;
  
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
    onRenameService: (serviceId: Id<"services">, newName: string) => Promise<void>;
    onDeleteService: (serviceId: Id<"services">) => Promise<void>;
    onReorderServiceItems: (from: number, to: number) => Promise<void>;
    onReorderServices: (from: number, to: number) => Promise<void>;
  };

  presentState: MainViewPresentState;
  mediaState: MainViewMediaState;
  libraryState: MainViewLibraryState;
  styleState: MainViewStyleState;
  panelRefs: MainViewPanelRefs;
  outputState: MainViewOutputState;
  contentSource: ContentSource;
}

export function MainView({
  viewMode,
  bottomTab,
  orgId,
  userId,
  servicesSidebarProps,
  presentState,
  mediaState,
  libraryState,
  styleState,
  panelRefs,
  outputState,
  contentSource,
}: MainViewProps) {
  const {
    isFrozen: isOutputFrozen,
    onToggleFreeze,
    showTextInOutput,
    setShowTextInOutput,
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
    handleMediaPanelSelect,
    handleAddMediaToService,
    updateVideoSettings,
    showMediaInOutput,
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
  } = presentState;

  const {
    filteredLibraryItems,
    libraryLoading,
    categories,
    selectedCategoryId,
    setSelectedCategoryId,
    createNewLibraryItem,
    handleRenameLibraryItem,
    deleteLibraryItem,
    handleAddToService,
    createNewCategory,
    searchQuery,
    setSearchQuery,
  } = libraryState;

  const {
    fontFamily,
    fontSize,
    fontBold,
    fontItalic,
    fontUnderline,
    scriptureFontFamily,
    scriptureFontSize,
    scriptureTextAlign,
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
  } = servicesSidebarProps;

  const {
    showsPanelRef,
    mediaPanelRef,
    scripturePanelRef,
  } = panelRefs;

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="flex-1 w-full h-full"
      autoSaveId="present-main-layout-v11"
    >
      <ResizablePanel defaultSize="78" minSize="60" maxSize="84" order={1}>
        <ResizablePanelGroup
          direction="vertical"
          className="h-full w-full"
          autoSaveId="present-workspace-layout-v11"
        >
          <ResizablePanel defaultSize="68" minSize="45" maxSize="84" order={1}>
            <ResizablePanelGroup
              direction="horizontal"
              className="h-full w-full"
              autoSaveId="present-main-top-layout-v11"
            >
              <ResizablePanel defaultSize="24" minSize="16" maxSize="32" order={1}>
                <PresentServicesSidebar
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
                    onRemoveFromService: (index: number) => handleRemoveFromService(index),
                    onCreateService: createNewService,
                    onRenameService: renameExistingService,
                    onDeleteService: deleteService,
                    onReorderServiceItems: reorderServiceItems,
                    onReorderServices: reorderServices,
                  }}
                />
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize="76" minSize="56" maxSize="84" order={2}>
                <PresentCenterArea
                  viewMode={viewMode}
                  bottomTab={bottomTab}
                  slidesForGrid={slidesForGrid}
                  activeSlideId={activeSlideId}
                  selectedIndex={selected?.index ?? null}
                  selectedLibraryItem={selectedLibraryItem}
                  selectedLibraryId={selectedLibraryId}
                  onSelectSlide={handleSelectSlide}
                  onEditSlide={handleEditSlide}
                  editorProps={{
                    fontFamily,
                    fontSize,
                    fontBold,
                    fontItalic,
                    fontUnderline,
                    onFontStyleChange: updateFontStyle,
                    onSave: handleSaveLibraryItem,
                    onFixLyrics: fixLyrics,
                    scrollToSlideIndex: editScrollToSlide,
                    onScrollComplete: () => setEditScrollToSlide(null),
                  }}
                  showViewMedia={showViewMedia}
                  showVideoRef={showVideoRef}
                  videoSettings={videoSettings}
                  onOutputPreviewMedia={() => handleOutputPreviewMedia()}
                  onVideoPlay={handleVideoPlay}
                  onVideoPause={handleVideoPause}
                  onVideoEnded={handleVideoEnded}
                  onVideoSeeked={handleVideoSeeked}
                  showsPanelRef={showsPanelRef}
                  scripturePanelRef={scripturePanelRef}
                  showsPanelProps={{
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
                    onRenameLibraryItem: handleRenameLibraryItem,
                    onDeleteLibraryItem: deleteLibraryItem,
                    onAddToService: handleAddToService,
                    onCreateCategory: createNewCategory,
                    onFixLyrics: fixLyrics,
                    searchQuery,
                    onSearchChange: setSearchQuery,
                    contentSource,
                  }}
                  onSendScripture={handleScriptureOutput}
                  orgId={orgId ?? null}
                  userId={userId}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="32" minSize="16" maxSize="55" order={2}>
            <div className="flex h-full flex-col border-t border-border bg-card">
              <div className="flex h-8 items-center justify-between border-b border-border px-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Media
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Search <Kbd className="ml-1">⌘M</Kbd>
                </span>
              </div>
              <div className="min-h-0 flex-1">
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

      <ResizablePanel defaultSize="22" minSize="16" maxSize="28" order={2}>
        <PresentOutputSidebar
          outputPreviewProps={{
            text: activeSlideContent?.text ?? null,
            footer: activeSlideContent?.footer ?? null,
            activeSlideId,
            fontFamily,
            fontSize,
            fontBold,
            fontItalic,
            fontUnderline,
            scriptureFontFamily,
            scriptureFontSize,
            scriptureTextAlign,
            groups: slideGroups,
            activeMediaItem: effectiveActiveMediaItem,
            videoSettings,
            onVideoSettingsChange: updateVideoSettings,
            showText: showTextInOutput,
            showMedia: showMediaInOutput,
            onToggleText: () => setShowTextInOutput(!showTextInOutput),
            onClearMedia: () => onClearMedia(),
            mediaFilters,
            onMediaFiltersChange: updateMediaFilters,
            onResetFilters,
            isVideoPlaying,
            videoCurrentTime,
            isFrozen: isOutputFrozen,
            onToggleFreeze,
          }}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
