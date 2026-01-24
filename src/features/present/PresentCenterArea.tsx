"use client";

import { Activity } from "react";
import type { ComponentProps } from "react";
import type { BottomTab, ViewMode } from "@/types";
import type { SlideData } from "@/features/slides";
import type { Id } from "@/../convex/_generated/dataModel";

import { SlidesGrid } from "@/features/slides";
import { LyricsEditor } from "@/features/editor";
import { ShowsPanel, type ShowsPanelRef } from "@/features/shows";
import { MediaPanel, type MediaPanelRef } from "@/features/media";
import { ScripturePanel, type ScripturePanelRef } from "@/features/scripture";
import type { ScriptureSlide } from "@/features/scripture/lib/slides";
import { Kbd } from "@/components/ui/kbd";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components";

/* ---------------- TYPES (DERIVED, NOT INVENTED) ---------------- */

type EditorProps = ComponentProps<typeof LyricsEditor>;
type ShowsProps = ComponentProps<typeof ShowsPanel>;
type MediaProps = ComponentProps<typeof MediaPanel>;

type Props = {
  viewMode: ViewMode;
  bottomTab: BottomTab;
  setBottomTab: (tab: BottomTab) => void;

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
  showViewMedia: any;
  activeMediaItem: any;
  showVideoRef: React.RefObject<HTMLVideoElement | null>;
  videoSettings: any;
  onOutputPreviewMedia: () => void;
  onVideoPlay: () => void;
  onVideoPause: () => void;
  onVideoEnded: () => void;
  onVideoSeeked: (e: React.SyntheticEvent<HTMLVideoElement>) => void;

  // bottom panels
  showsPanelRef: React.RefObject<ShowsPanelRef | null>;
  mediaPanelRef: React.RefObject<MediaPanelRef | null>;
  scripturePanelRef: React.RefObject<ScripturePanelRef | null>;
  showsPanelProps: ShowsProps;
  mediaPanelProps: MediaProps;

  onSendScripture: (slides: ScriptureSlide[]) => void;
  orgId: Id<"organizations"> | null;
};

export function PresentCenterArea({
  viewMode,
  bottomTab,
  setBottomTab,
  slidesForGrid,
  activeSlideId,
  selectedIndex,
  selectedSong,
  selectedSongId,
  onSelectSlide,
  onEditSlide,
  editorProps,
  showViewMedia,
  activeMediaItem,
  showVideoRef,
  videoSettings,
  onOutputPreviewMedia,
  onVideoPlay,
  onVideoPause,
  onVideoEnded,
  onVideoSeeked,
  showsPanelRef,
  mediaPanelRef,
  scripturePanelRef,
  showsPanelProps,
  mediaPanelProps,
  onSendScripture,
  orgId,
}: Props) {
  return (
    <ResizablePanelGroup direction="vertical" className="h-full">
      {/* MAIN */}
      <ResizablePanel defaultSize={75} minSize={30}>
        <div className="relative h-full overflow-hidden">
          {/* SHOW */}
          <Activity mode={viewMode === "show" ? "visible" : "hidden"}>
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
                      muted={videoSettings.muted}
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

          {/* EDIT */}
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
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* BOTTOM */}
      <ResizablePanel defaultSize={25} minSize={15} maxSize={50}>
        <div className="flex h-full flex-col border-t">
          <div className="flex items-center border-b px-2">
            {(["shows", "media", "scripture"] as BottomTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setBottomTab(tab)}
                className={`px-4 py-2 text-xs ${
                  bottomTab === tab ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {tab}
                <Kbd className="ml-2">
                  ⌘{tab === "shows" ? "K" : tab === "media" ? "M" : "B"}
                </Kbd>
              </button>
            ))}
          </div>

          <div className="relative flex-1 overflow-hidden">
            <Activity mode={bottomTab === "shows" ? "visible" : "hidden"}>
              <ShowsPanel ref={showsPanelRef} {...showsPanelProps} />
            </Activity>

            <Activity mode={bottomTab === "media" ? "visible" : "hidden"}>
              <MediaPanel ref={mediaPanelRef} {...mediaPanelProps} />
            </Activity>

            <Activity mode={bottomTab === "scripture" ? "visible" : "hidden"}>
              <ScripturePanel
                ref={scripturePanelRef}
                onSendToOutput={onSendScripture}
                orgId={orgId}
              />
            </Activity>
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
