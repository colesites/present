"use client";

import React from "react";
import { 
  ResizableHandle, 
  ResizablePanel, 
  ResizablePanelGroup 
} from "../../components";
import { PresentServicesSidebar } from "./PresentServicesSidebar";
import { PresentCenterArea } from "./PresentCenterArea";
import { PresentOutputSidebar } from "./PresentOutputSidebar";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { SlideData } from "../../features/slides";
import { 
  MediaItem, 
  VideoSettings, 
  MediaFilters,
  MediaState
} from "../../features/media/hooks/useMediaFolders";
import type { ViewMode, BottomTab, Song, Category, Service, PlaybackState, ServiceItem, ContentSource } from "../../types/index";
import { fixLyrics } from "../../lib/lyrics";
import { ScriptureSlide } from "../../features/scripture/lib/slides";
import type { MediaPanelRef } from "../media/MediaPanel";
import type { ScripturePanelRef } from "../scripture/components/ScripturePanel";
import type { ShowsPanelRef } from "../shows/ShowsPanel";

export interface MainViewPresentState {
  slidesForGrid: SlideData[];
  activeSlideId: string | null;
  selected: { songId: Id<"songs"> | null; index: number } | null;
  selectedSong: Song | null;
  selectedSongId: Id<"songs"> | null;
  setSelectedSongId: (id: Id<"songs"> | null) => void;
  handleSelectSlide: (slideId: string, text: string, footer?: string) => Promise<void>;
  handleEditSlide: (songId: Id<"songs">, slideIndex: number) => void;
  handleSaveSong: (title: string, lyrics: string) => Promise<void>;
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

export interface MainViewSongState {
  filteredSongs: Song[];
  songsLoading: boolean;
  categories: Category[];
  selectedCategoryId: Id<"categories"> | null;
  setSelectedCategoryId: (id: Id<"categories"> | null) => void;
  createNewSong: (title: string, lyrics: string, categoryId?: Id<"categories">) => Promise<void>;
  handleRenameSong: (songId: Id<"songs">, newTitle: string) => Promise<void>;
  deleteSong: (songId: Id<"songs">) => Promise<void>;
  handleAddToService: (songId: Id<"songs">) => Promise<void>;
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
  setBottomTab: (tab: BottomTab) => void;
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
    onRenameService: (serviceId: Id<"services">, newName: string) => Promise<void>;
    onDeleteService: (serviceId: Id<"services">) => Promise<void>;
    onReorderServiceItems: (from: number, to: number) => Promise<void>;
    onReorderServices: (from: number, to: number) => Promise<void>;
  };

  presentState: MainViewPresentState;
  mediaState: MainViewMediaState;
  songState: MainViewSongState;
  styleState: MainViewStyleState;
  panelRefs: MainViewPanelRefs;
  outputState: MainViewOutputState;
  contentSource: ContentSource;
}

export function MainView({
  viewMode,
  bottomTab,
  setBottomTab,
  orgId,
  servicesSidebarProps,
  presentState,
  mediaState,
  songState,
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
  } = presentState;

  const {
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
  } = songState;

  const {
    fontFamily,
    fontSize,
    fontBold,
    fontItalic,
    fontUnderline,
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
      autoSaveId="present-main-layout-v10"
    >
      <ResizablePanel defaultSize="25" minSize="15" maxSize="30" order={1}>
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

      <ResizablePanel
        id="center-area"
        order={2}
        defaultSize="55"
        minSize="40"
        maxSize="75"
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
          showVideoRef={showVideoRef}
          videoSettings={videoSettings}
          onOutputPreviewMedia={() => handleOutputPreviewMedia()}
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
            contentSource,
          }}
          mediaPanelProps={{
            mediaState: mediaState.mediaState,
            onSelectForOutput: handleMediaPanelSelect,
            isInsideService,
            selectedServiceId,
            onAddToService: handleAddMediaToService,
            orgId: orgId ?? null,
          }}
          onSendScripture={handleScriptureOutput}
          orgId={orgId ?? null}
        />
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize="20" minSize="15" maxSize="22" order={3}>
        <PresentOutputSidebar
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
