"use client";

import { memo, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import { Loader2, Presentation } from "lucide-react";
import type { BottomTab, ViewMode } from "../../shared/types";
import type { SlideData } from "../../features/slides";

import { SlidesGrid } from "../../features/slides";
import { LyricsEditor } from "../../features/editor";
import { LibrariesPanel, type LibrariesPanelRef } from "../../features/shows";
import { ScripturePanel, type ScripturePanelRef } from "../../features/scripture";
import type { ScriptureSlide } from "../../features/scripture/lib/slides";
import { MediaItem, VideoSettings } from "../media/hooks/useMediaFolders";
import { cn } from "../../renderer/shared/lib/utils";
import { WorkspaceFooter } from "../../renderer/shared/components/WorkspaceFooter";
import { SongAgentControl } from "../song-agent/SongAgentControl";

/* ---------------- TYPES (DERIVED, NOT INVENTED) ---------------- */

type EditorProps = ComponentProps<typeof LyricsEditor>;
type ShowsProps = ComponentProps<typeof LibrariesPanel>;
type ScriptureProps = ComponentProps<typeof ScripturePanel>;

type Props = {
  viewMode: ViewMode;
  bottomTab: BottomTab;
  lockSingleSlideView?: boolean;
  importOverlay?: {
    isVisible: boolean;
    title: string;
    detail: string;
    progress: number | null;
  };

  slidesForGrid: SlideData[];
  activeSlideId: string | null;
  selectedIndex: number | null;
  isGridView: boolean;
  onGridViewChange: (isGridView: boolean) => void;

  selectedLibraryItem: EditorProps["libraryItem"] | null;
  scriptureEditorItem: EditorProps["libraryItem"] | null;
  selectedLibraryId: string | null;

  // handlers
  onSelectSlide: ComponentProps<typeof SlidesGrid>["onSelectSlide"];
  onEditSlide?: ComponentProps<typeof SlidesGrid>["onEditSlide"];
  onOpenMiniEditor?: ComponentProps<typeof SlidesGrid>["onOpenMiniEditor"];
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
  isPreviewOutputting: boolean;
  showVideoRef: React.RefObject<HTMLVideoElement | null>;
  videoSettings: VideoSettings;
  onOutputPreviewMedia: () => void;
  onVideoPlay: () => void;
  onVideoPause: () => void;
  onVideoEnded: () => void;
  onVideoSeeked: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
  onVideoTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) => void;

  // top panels
  showsPanelRef: React.RefObject<LibrariesPanelRef | null>;
  scripturePanelRef: React.RefObject<ScripturePanelRef | null>;
  showsPanelProps: ShowsProps;
  speechLang: string;
  speechInputDeviceId: string | null;

  onSendScripture: (slides: ScriptureSlide[]) => void;
  selectedServiceId: ScriptureProps["selectedServiceId"];
  onAddScriptureToService: ScriptureProps["onAddScriptureToService"];
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
  isGridView,
  onGridViewChange,
  selectedLibraryItem,
  scriptureEditorItem,
  selectedLibraryId,
  onSelectSlide,
  onEditSlide,
  onOpenMiniEditor,
  onReorderSlides,
  editorProps,
  onSaveScriptureEditor,
  onUpdateScriptureEditorOutput,
  showViewMedia,
  isPreviewOutputting,
  showVideoRef,
  videoSettings,
  onOutputPreviewMedia,
  onVideoPlay,
  onVideoPause,
  onVideoEnded,
  onVideoSeeked,
  onVideoTimeUpdate,
  showsPanelRef,
  scripturePanelRef,
  showsPanelProps,
  speechLang,
  speechInputDeviceId,
  onSendScripture,
  selectedServiceId,
  onAddScriptureToService,
  lockSingleSlideView = false,
  importOverlay,
}: Props) {
  // Footer state
  const [scale, setScale] = useState(60);
  const effectiveScale = lockSingleSlideView ? 100 : scale;
  const effectiveIsGridView = lockSingleSlideView ? true : isGridView;

  const mediaPane = useMemo(
    () => (
      <div className="absolute inset-0 overflow-auto p-4" data-slides-scroll>
        {showViewMedia && !selectedLibraryId ? (
          <div className="mx-auto max-w-4xl">
            {showViewMedia.type === "image" ? (
              <button
                type="button"
                onClick={onOutputPreviewMedia}
                aria-label={`Send ${showViewMedia.name} to output`}
                className="block aspect-video w-full overflow-hidden rounded-lg bg-black"
              >
                <img
                  src={showViewMedia.url}
                  alt=""
                  className="h-full w-full object-contain"
                />
              </button>
            ) : (
              <div className="overflow-hidden rounded-lg bg-black">
                <video
                  ref={showVideoRef}
                  src={showViewMedia.url}
                  aria-label={`${showViewMedia.name} service preview`}
                  className="aspect-video w-full object-contain"
                  controls
                  loop={videoSettings.loop}
                  muted={videoSettings.muted}
                  onClick={(event) => {
                    if (isPreviewOutputting) {
                      return;
                    }
                    onOutputPreviewMedia();
                    void event.currentTarget.play();
                  }}
                  onPlay={onVideoPlay}
                  onPause={onVideoPause}
                  onEnded={onVideoEnded}
                  onSeeked={onVideoSeeked}
                  onTimeUpdate={onVideoTimeUpdate}
                >
                  <track kind="captions" />
                </video>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-medium text-foreground">
                {showViewMedia.name}
              </p>
            </div>
          </div>
        ) : (
          <SlidesGrid
            slides={slidesForGrid}
            activeSlideId={activeSlideId}
            selectedIndex={selectedIndex}
            onSelectSlide={onSelectSlide}
            onEditSlide={onEditSlide}
            onOpenMiniEditor={onOpenMiniEditor}
            onReorderSlides={selectedLibraryItem ? onReorderSlides : undefined}
            externalScale={effectiveScale}
            isGridView={effectiveIsGridView}
            forceSingleColumn={lockSingleSlideView}
            {...editorProps}
          />
        )}
      </div>
    ),
    [
      activeSlideId,
      editorProps,
      effectiveIsGridView,
      effectiveScale,
      lockSingleSlideView,
      onEditSlide,
      onOpenMiniEditor,
      onOutputPreviewMedia,
      isPreviewOutputting,
      onReorderSlides,
      onSelectSlide,
      onVideoEnded,
      onVideoPause,
      onVideoPlay,
      onVideoSeeked,
      onVideoTimeUpdate,
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
          selectedServiceId={selectedServiceId}
          onAddScriptureToService={onAddScriptureToService}
          isActive={viewMode === "show" && bottomTab === "scripture"}
          speechLang={speechLang}
          speechInputDeviceId={speechInputDeviceId}
          activeSlideId={activeSlideId}
        />
      </div>
    ),
    [
      bottomTab,
      activeSlideId,
      onAddScriptureToService,
      onSendScripture,
      speechInputDeviceId,
      speechLang,
      scripturePanelRef,
      selectedServiceId,
      viewMode,
    ],
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
      {importOverlay?.isVisible ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/72 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/95 p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary">
                <Presentation className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {importOverlay.title}
                  </p>
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {importOverlay.detail}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-secondary/70">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                  style={{
                    width: `${Math.max(8, importOverlay.progress ?? 18)}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Importing presentation</span>
                <span>
                  {importOverlay.progress != null
                    ? `${Math.min(100, Math.max(0, Math.round(importOverlay.progress)))}%`
                    : "Working..."}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
          leftContent={<SongAgentControl />}
          showTransitionPicker
          isGridView={effectiveIsGridView}
          onViewModeChange={onGridViewChange}
          scale={effectiveScale}
          onScaleChange={setScale}
          disableViewModeToggle={lockSingleSlideView}
          disableScaleControl={lockSingleSlideView}
        />
      )}
    </div>
  );
}
