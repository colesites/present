"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Id } from "@/../convex/_generated/dataModel";

// Hooks
import {
  useOrganization,
  usePlayback,
  useSongs,
  useServices,
  useCategories,
} from "@/hooks";

// Types
import type { ViewMode, BottomTab } from "@/types";

// UI Components
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui";

// Features
import { AppHeader } from "@/features/header";
import { ServicesSidebar } from "@/features/services";
import { SlidesGrid, OutputPreview } from "@/features/slides";
import { LyricsEditor } from "@/features/editor";
import { ShowsPanel } from "@/features/shows";

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
    setSelectedSongId,
    setSelectedCategoryId,
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
    removeFromService,
    enterService,
    exitService,
  } = useServices(orgId, songs);

  const { categories, createNewCategory } = useCategories(orgId);

  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>("show");
  const [bottomTab, setBottomTab] = useState<BottomTab>("shows");
  const [selected, setSelected] = useState<{
    songId: Id<"songs">;
    index: number;
  } | null>(null);
  const [editScrollToSlide, setEditScrollToSlide] = useState<number | null>(
    null
  );

  // Computed: slides for grid
  const slidesForGrid = useMemo(() => {
    if (!selectedSong) return [];
    return selectedSong.slides.map((slide, index) => ({
      song: selectedSong,
      slide,
      index,
    }));
  }, [selectedSong]);

  // Computed: active slide text for preview
  const activeSlideText = useMemo(() => {
    if (!activeSlideId || !songs.length) return null;
    const [songId, indexStr] = activeSlideId.split(":");
    const song = songs.find((s) => s._id === songId);
    return song?.slides[Number(indexStr)]?.text ?? null;
  }, [activeSlideId, songs]);

  // Computed: slide groups for output sidebar
  const slideGroups = useMemo(() => {
    if (!selectedSong) return [];
    const groups: { label: string; count: number }[] = [];
    let currentLabel = "";
    for (const slide of selectedSong.slides) {
      const label = slide.label || "Untitled";
      if (label !== currentLabel) {
        groups.push({ label, count: 1 });
        currentLabel = label;
      } else {
        const lastGroup = groups[groups.length - 1];
        if (lastGroup) lastGroup.count++;
      }
    }
    return groups;
  }, [selectedSong]);

  // Handlers
  const handleSelectSlide = useCallback(
    async (songId: Id<"songs">, index: number, text: string) => {
      setSelected({ songId, index });
      await selectSlide(`${songId}:${index}`, text);
    },
    [selectSlide]
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
    [setSelectedSongId]
  );

  const handleSelectServiceItem = useCallback(
    (index: number) => {
      const item = serviceItems[index];
      if (item?.song) {
        setServiceItemIndex(index);
        setSelectedSongId(item.song._id);
      }
    },
    [serviceItems, setServiceItemIndex, setSelectedSongId]
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
      if (viewMode === "show" && selectedSong && slidesForGrid.length > 0) {
        const currentIndex = selected?.index ?? 0;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          const nextIndex = Math.min(
            currentIndex + 1,
            slidesForGrid.length - 1
          );
          handleSelectSlide(
            selectedSong._id,
            nextIndex,
            slidesForGrid[nextIndex].slide.text
          );
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          const prevIndex = Math.max(currentIndex - 1, 0);
          handleSelectSlide(
            selectedSong._id,
            prevIndex,
            slidesForGrid[prevIndex].slide.text
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
        autoSaveId="present-main-layout"
      >
        {/* Left sidebar - Services (default ~200px on 1400px screen = 14%) */}
        <ResizablePanel defaultSize={14} minSize={10} maxSize={25}>
          <div className="h-full border-r border-border bg-card">
            <ServicesSidebar
              services={services}
              selectedServiceId={selectedServiceId}
              isInsideService={isInsideService}
              selectedService={selectedService}
              serviceItems={serviceItems}
              serviceItemIndex={serviceItemIndex}
              onEnterService={enterService}
              onExitService={exitService}
              onSelectServiceItem={handleSelectServiceItem}
              onRemoveFromService={handleRemoveFromService}
              onCreateService={createNewService}
              onRenameService={renameExistingService}
              onDeleteService={deleteService}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Center content with vertical split (slides + bottom tabs) */}
        <ResizablePanel defaultSize={66} minSize={30}>
          <ResizablePanelGroup
            direction="vertical"
            className="h-full"
            autoSaveId="present-center-layout"
          >
            {/* Main slides/editor area */}
            <ResizablePanel defaultSize={75} minSize={30}>
              <main className="flex h-full flex-col overflow-hidden bg-background">
                <div className="flex-1 overflow-auto p-4">
                  {viewMode === "show" ? (
                    <SlidesGrid
                      slides={slidesForGrid}
                      activeSlideId={activeSlideId}
                      selectedIndex={selected?.index ?? null}
                      onSelectSlide={handleSelectSlide}
                      onEditSlide={handleEditSlide}
                    />
                  ) : selectedSong ? (
                    <LyricsEditor
                      song={selectedSong}
                      fontFamily={fontFamily}
                      fontSize={fontSize}
                      fontBold={fontBold}
                      fontItalic={fontItalic}
                      fontUnderline={fontUnderline}
                      scrollToSlideIndex={editScrollToSlide}
                      onSave={handleSaveSong}
                      onFixLyrics={fixLyrics}
                      onFontStyleChange={updateFontStyle}
                      onScrollComplete={() => setEditScrollToSlide(null)}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Select a song to edit
                    </div>
                  )}
                </div>
              </main>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Bottom tabs panel (default ~200px = 25% of remaining height) */}
            <ResizablePanel defaultSize={25} minSize={15} maxSize={50}>
              <div className="flex h-full flex-col border-t border-border bg-card">
                <div className="flex shrink-0 items-center border-b border-border px-2">
                  {(["shows", "media", "scripture"] as BottomTab[]).map(
                    (tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setBottomTab(tab)}
                        className={`flex items-center gap-2 px-4 py-2 text-xs font-medium capitalize transition ${
                          bottomTab === tab
                            ? "border-b-2 border-primary text-primary"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab}
                      </button>
                    )
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {bottomTab === "shows" && (
                    <ShowsPanel
                      songs={filteredSongs}
                      categories={categories}
                      selectedSongId={selectedSongId}
                      selectedCategoryId={selectedCategoryId}
                      isInsideService={isInsideService}
                      selectedServiceId={selectedServiceId}
                      onSelectSong={setSelectedSongId}
                      onSelectCategory={setSelectedCategoryId}
                      onCreateSong={createNewSong}
                      onRenameSong={handleRenameSong}
                      onDeleteSong={deleteSong}
                      onAddToService={handleAddToService}
                      onCreateCategory={createNewCategory}
                      onFixLyrics={fixLyrics}
                    />
                  )}
                  {bottomTab === "media" && (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Media library coming soon
                    </div>
                  )}
                  {bottomTab === "scripture" && (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Scripture search coming soon
                    </div>
                  )}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right sidebar - Output Preview + Groups (default ~280px on 1400px screen = 20%) */}
        <ResizablePanel defaultSize={20} minSize={12} maxSize={35}>
          <div className="h-full border-l border-border bg-card">
            <OutputPreview
              text={activeSlideText}
              fontBold={fontBold}
              fontItalic={fontItalic}
              fontUnderline={fontUnderline}
              groups={slideGroups}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
