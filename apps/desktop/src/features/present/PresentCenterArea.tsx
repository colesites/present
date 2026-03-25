"use client";

import { Activity } from "react";
import type { ComponentProps } from "react";
import type { BottomTab, ViewMode } from "../../types";
import type { SlideData } from "../../features/slides";
import type { Id } from "@present/backend/convex/_generated/dataModel";

import { SlidesGrid } from "../../features/slides";
import { LyricsEditor } from "../../features/editor";
import { ShowsPanel, type ShowsPanelRef } from "../../features/shows";
import { ScripturePanel, type ScripturePanelRef } from "../../features/scripture";
import type { ScriptureSlide } from "../../features/scripture/lib/slides";
import { MediaItem, VideoSettings } from "../media/hooks/useMediaFolders";

/* ---------------- TYPES (DERIVED, NOT INVENTED) ---------------- */

type EditorProps = ComponentProps<typeof LyricsEditor>;
type ShowsProps = ComponentProps<typeof ShowsPanel>;

type Props = {
  viewMode: ViewMode;
  bottomTab: BottomTab;

  slidesForGrid: SlideData[];
  activeSlideId: string | null;
  selectedIndex: number | null;

  selectedSong: EditorProps["song"] | null;
  selectedSongId: string | null;

  // handlers
  onSelectSlide: ComponentProps<typeof SlidesGrid>["onSelectSlide"];
  onEditSlide?: ComponentProps<typeof SlidesGrid>["onEditSlide"];

  // editor (FULL CONTRACT)
  editorProps: Pick<
    EditorProps,
    | "fontFamily"
    | "fontSize"
    | "fontBold"
    | "fontItalic"
    | "fontUnderline"
    | "onFontStyleChange"
    | "onSave"
    | "onFixLyrics"
    | "scrollToSlideIndex"
    | "onScrollComplete"
  >;

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
  showsPanelRef: React.RefObject<ShowsPanelRef | null>;
  scripturePanelRef: React.RefObject<ScripturePanelRef | null>;
  showsPanelProps: ShowsProps;

  onSendScripture: (slides: ScriptureSlide[]) => void;
  orgId: Id<"organizations"> | null;
  userId: Id<"users"> | null;
};

export function PresentCenterArea({
  viewMode,
  bottomTab,
  slidesForGrid,
  activeSlideId,
  selectedIndex,
  selectedSong,
  selectedSongId,
  onSelectSlide,
  onEditSlide,
  editorProps,
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
  return (
    <div className="relative h-full overflow-hidden">
      <Activity mode={viewMode === "show" && bottomTab === "media" ? "visible" : "hidden"}>
        <div className="absolute inset-0 overflow-auto p-4">
          {showViewMedia && !selectedSongId ? (
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
              {...editorProps}
            />
          )}
        </div>
      </Activity>

      <Activity mode={viewMode === "show" && bottomTab === "shows" ? "visible" : "hidden"}>
        <div className="absolute inset-0 overflow-hidden">
          <ShowsPanel ref={showsPanelRef} {...showsPanelProps} />
        </div>
      </Activity>

      <Activity mode={viewMode === "show" && bottomTab === "scripture" ? "visible" : "hidden"}>
        <div className="absolute inset-0 overflow-hidden">
          <ScripturePanel
            ref={scripturePanelRef}
            onSendToOutput={onSendScripture}
            orgId={orgId}
            userId={userId}
          />
        </div>
      </Activity>

      <Activity mode={viewMode === "edit" ? "visible" : "hidden"}>
        <div className="absolute inset-0 overflow-auto p-4">
          {selectedSong ? (
            <LyricsEditor song={selectedSong} {...editorProps} />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Select a song to edit
            </div>
          )}
        </div>
      </Activity>
    </div>
  );
}
