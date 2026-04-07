"use client";

import { memo, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import type { BottomTab, ViewMode } from "../../shared/types";
import type { SlideData } from "../../features/slides";
import type { Id } from "@present/backend/convex/_generated/dataModel";

import { SlidesGrid } from "../../features/slides";
import { LyricsEditor } from "../../features/editor";
import { LibrariesPanel, type LibrariesPanelRef } from "../../features/shows";
import { ScripturePanel, type ScripturePanelRef } from "../../features/scripture";
import type { ScriptureSlide } from "../../features/scripture/lib/slides";
import { MediaItem, VideoSettings } from "../media/hooks/useMediaFolders";
import { cn } from "../../renderer/shared/lib/utils";
import { WorkspaceFooter } from "../../renderer/shared/components/WorkspaceFooter";

/* ---------------- TYPES (DERIVED, NOT INVENTED) ---------------- */

type EditorProps = ComponentProps<typeof LyricsEditor>;
type ShowsProps = ComponentProps<typeof LibrariesPanel>;

type Props = {
  viewMode: ViewMode;
  bottomTab: BottomTab;

  slidesForGrid: SlideData[];
  activeSlideId: string | null;
  selectedIndex: number | null;

  selectedLibraryItem: EditorProps["libraryItem"] | null;
  scriptureEditorItem: EditorProps["libraryItem"] | null;
  selectedLibraryId: string | null;

  // handlers
  onSelectSlide: ComponentProps<typeof SlidesGrid>["onSelectSlide"];
  onEditSlide?: ComponentProps<typeof SlidesGrid>["onEditSlide"];
  onReorderSlides?: ComponentProps<typeof SlidesGrid>["onReorderSlides"];

  // editor (FULL CONTRACT)
  editorProps: Pick<
    EditorProps,
    | "fontFamily"
    | "fontSize"
    | "fontBold"
    | "fontItalic"
    | "fontUnderline"
    | "libraryDefaultFontFamily"
    | "libraryDefaultFontSize"
    | "libraryDefaultFontWeight"
    | "scriptureDefaultFontFamily"
    | "scriptureDefaultFontSize"
    | "scriptureDefaultFontWeight"
    | "onFontStyleChange"
    | "onSave"
    | "onFixLyrics"
    | "onUpdateOutput"
    | "scrollToSlideIndex"
    | "onScrollComplete"
  >;
  onSaveScriptureEditor: EditorProps["onSave"];
  onUpdateScriptureEditorOutput: NonNullable<EditorProps["onUpdateOutput"]>;

  // media preview
  showViewMedia: MediaItem | null;
  showVideoRef: React.RefObject<HTMLVideoElement | null>;
  videoSettings: VideoSettings;
  onOutputPreviewMedia: () => void;
  onVideoPlay: () => void;
  onVideoPause: () => void;
  onVideoEnded: () => void;
  onVideoSeeked: (e: React.SyntheticEvent<HTMLVideoElement>) => void;

  // top panels
  showsPanelRef: React.RefObject<LibrariesPanelRef | null>;
  scripturePanelRef: React.RefObject<ScripturePanelRef | null>;
  showsPanelProps: ShowsProps;

  onSendScripture: (slides: ScriptureSlide[]) => void;
  orgId: Id<"organizations"> | null;
  userId: string | null;
};

// Keep tabs mounted but freeze hidden tab renders to avoid UI switch lag.
const Activity = memo(function Activity({
  mode,
  children,
}: {
  mode: "visible" | "hidden";
  children: React.ReactNode;
}) {
  return (
    <div className={cn("h-full w-full", mode === "hidden" ? "hidden" : "block")}>
      {children}
    </div>
  );
}, (previous, next) => {
  if (previous.mode === "hidden" && next.mode === "hidden") {
    return true;
  }
  return false;
});

export function PresentCenterArea({
  viewMode,
  bottomTab,
  slidesForGrid,
  activeSlideId,
  selectedIndex,
  selectedLibraryItem,
  scriptureEditorItem,
  selectedLibraryId,
  onSelectSlide,
  onEditSlide,
  onReorderSlides,
  editorProps,
  onSaveScriptureEditor,
  onUpdateScriptureEditorOutput,
  showViewMedia,
  showVideoRef,
  videoSettings,
  onOutputPreviewMedia,
  onVideoPlay,
  onVideoPause,
  onVideoEnded,
  onVideoSeeked,
  showsPanelRef,
  scripturePanelRef,
  showsPanelProps,
  onSendScripture,
  orgId,
  userId,
}: Props) {
  // Footer state
  const [scale, setScale] = useState(60);
  const [isGridView, setIsGridView] = useState(true);

  const mediaPane = useMemo(
    () => (
      <div className="absolute inset-0 overflow-auto p-4">
        {showViewMedia && !selectedLibraryId ? (
          <button
            type="button"
            onClick={onOutputPreviewMedia}
            className="mx-auto block aspect-video max-w-4xl overflow-hidden rounded-lg bg-black"
          >
            {showViewMedia.type === "image" ? (
              <img
                src={showViewMedia.url}
                alt=""
                className="h-full w-full object-contain"
              />
            ) : (
              <video
                ref={showVideoRef}
                src={showViewMedia.url}
                className="h-full w-full object-contain"
                controls
                loop={videoSettings.loop}
                muted
                onPlay={onVideoPlay}
                onPause={onVideoPause}
                onEnded={onVideoEnded}
                onSeeked={onVideoSeeked}
              />
            )}
          </button>
        ) : (
          <SlidesGrid
            slides={slidesForGrid}
            activeSlideId={activeSlideId}
            selectedIndex={selectedIndex}
            onSelectSlide={onSelectSlide}
            onEditSlide={onEditSlide}
            onReorderSlides={selectedLibraryItem ? onReorderSlides : undefined}
            externalScale={scale}
            isGridView={isGridView}
            {...editorProps}
          />
        )}
      </div>
    ),
    [
      activeSlideId,
      editorProps,
      isGridView,
      onEditSlide,
      onOutputPreviewMedia,
      onReorderSlides,
      onSelectSlide,
      onVideoEnded,
      onVideoPause,
      onVideoPlay,
      onVideoSeeked,
      scale,
      selectedIndex,
      selectedLibraryId,
      selectedLibraryItem,
      showVideoRef,
      showViewMedia,
      slidesForGrid,
      videoSettings.loop,
    ],
  );

  const showsPane = useMemo(
    () => (
      <div className="absolute inset-0 overflow-hidden">
        <LibrariesPanel ref={showsPanelRef} {...showsPanelProps} />
      </div>
    ),
    [showsPanelProps, showsPanelRef],
  );

  const scripturePane = useMemo(
    () => (
      <div className="absolute inset-0 overflow-hidden">
        <ScripturePanel
          ref={scripturePanelRef}
          onSendToOutput={onSendScripture}
          orgId={orgId}
          userId={userId}
          isActive={viewMode === "show" && bottomTab === "scripture"}
        />
      </div>
    ),
    [bottomTab, onSendScripture, orgId, scripturePanelRef, userId, viewMode],
  );

  const editPane = useMemo(
    () => (
      <div className="absolute inset-0 overflow-hidden p-2">
        {bottomTab === "scripture" &&
        (!selectedLibraryItem || activeSlideId?.startsWith("scripture:")) ? (
          <LyricsEditor
            libraryItem={scriptureEditorItem}
            {...editorProps}
            onSave={onSaveScriptureEditor}
            onUpdateOutput={onUpdateScriptureEditorOutput}
          />
        ) : (
          <LyricsEditor
            libraryItem={selectedLibraryItem}
            {...editorProps}
          />
        )}
      </div>
    ),
    [
      activeSlideId,
      bottomTab,
      editorProps,
      onSaveScriptureEditor,
      onUpdateScriptureEditorOutput,
      scriptureEditorItem,
      selectedLibraryItem,
    ],
  );

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      {/* Scrollable Content Area */}
      <div className="relative flex-1 overflow-hidden">
        <Activity mode={viewMode === "show" && bottomTab === "media" ? "visible" : "hidden"}>
          {mediaPane}
        </Activity>

        <Activity mode={viewMode === "show" && bottomTab === "shows" ? "visible" : "hidden"}>
          {showsPane}
        </Activity>

        <Activity mode={viewMode === "show" && bottomTab === "scripture" ? "visible" : "hidden"}>
          {scripturePane}
        </Activity>

        <Activity mode={viewMode === "edit" ? "visible" : "hidden"}>
          {editPane}
        </Activity>
      </div>

      {/* Footer Area - Reusable Workspace Footer */}
      {viewMode === "show" && (
        <WorkspaceFooter 
          isGridView={isGridView}
          onViewModeChange={setIsGridView}
          scale={scale}
          onScaleChange={setScale}
        />
      )}
    </div>
  );
}
