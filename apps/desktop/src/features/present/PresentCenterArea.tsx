"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import { Gauge, Loader2, Pause, Play, Presentation, Repeat, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import type { BottomTab, ViewMode } from "../../shared/types";
import type { SlideData } from "../../features/slides";

import { SlidesGrid } from "../../features/slides";
import { LyricsEditor } from "../../features/editor";
import { LibrariesPanel, type LibrariesPanelRef } from "../../features/shows";
import { ScripturePanel, type ScripturePanelRef } from "../../features/scripture";
import type { ScriptureSlide } from "../../features/scripture/lib/slides";
import { MediaItem, VideoSettings } from "../media/hooks/useMediaFolders";
import { cn } from "../../renderer/shared/lib/utils";
import { RustVideo } from "../../renderer/shared/components/RustVideo";
import { WorkspaceFooter } from "../../renderer/shared/components/WorkspaceFooter";
import { SongAgentControl } from "../song-agent/SongAgentControl";
import type { BibleAgentSettings } from "../scripture/components/ScripturePanel";

/* ---------------- TYPES (DERIVED, NOT INVENTED) ---------------- */

type EditorProps = ComponentProps<typeof LyricsEditor>;
type ShowsProps = ComponentProps<typeof LibrariesPanel>;
type ScriptureProps = ComponentProps<typeof ScripturePanel>;

type Props = {
  viewMode: ViewMode;
  bottomTab: BottomTab;
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
  videoSettings: VideoSettings;
  onOutputPreviewMedia: () => void;
  /** The live video, which the preview of it follows and controls. */
  liveVideo: LiveVideo;
  /** The video's loop, mute and level (`useMediaFolders`). */
  onVideoSettingsChange?: (settings: Partial<VideoSettings>) => void | Promise<void>;

  // top panels
  showsPanelRef: React.RefObject<LibrariesPanelRef | null>;
  scripturePanelRef: React.RefObject<ScripturePanelRef | null>;
  showsPanelProps: ShowsProps;
  speechLang: string;
  bibleAgent: BibleAgentSettings;
  speechInputDeviceId: string | null;

  onSendScripture: (slides: ScriptureSlide[]) => void;
  selectedServiceId: ScriptureProps["selectedServiceId"];
  onAddScriptureToService: ScriptureProps["onAddScriptureToService"];
};

/** The live video: where it is, and the controls that move it. */
export type LiveVideo = {
  id: string | null;
  playing: boolean;
  positionSeconds: number;
  sampledAtMs: number | null;
  /** How fast it plays: 1 as recorded. */
  rate: number;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  setRate: (rate: number) => void;
};

const formatTime = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
};

/** The speeds a video can play at. */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** A slider whose track shows how far along it is. */
function TrackSlider({
  value,
  max,
  onChange,
  label,
  disabled,
  className,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <input
      type="range"
      min={0}
      max={max > 0 ? max : 1}
      step={max > 10 ? 0.1 : 0.01}
      value={Math.min(value, max > 0 ? max : 1)}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(Number(event.target.value))}
      style={{
        background: `linear-gradient(to right, var(--primary) ${percent}%, color-mix(in oklab, var(--foreground) 22%, transparent) ${percent}%)`,
      }}
      className={cn(
        "h-1.5 cursor-pointer appearance-none rounded-full outline-none disabled:cursor-default disabled:opacity-40",
        "[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_var(--primary)]",
        className,
      )}
    />
  );
}

function ControlButton({
  onClick,
  label,
  active,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md transition",
        active
          ? "bg-primary/15 text-primary"
          : "text-foreground/85 hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A video in the center pane, decoded by Rust (`RustVideo`). While it is the
 * live video it shows what the screens show at the same moment, and its
 * controls move the live video — its sound and every screen; any other video
 * plays here on its own, silently, for the operator to look at, and clicking
 * it sends it to the screens.
 */
function PreviewVideo({
  item,
  videoSettings,
  onVideoSettingsChange,
  liveVideo,
  onSend,
}: {
  item: MediaItem;
  videoSettings: VideoSettings;
  onVideoSettingsChange?: (settings: Partial<VideoSettings>) => void | Promise<void>;
  liveVideo: LiveVideo;
  onSend?: () => void;
}) {
  const isLive = liveVideo.id === item.id;
  const loop = videoSettings.loop;
  const [duration, setDuration] = useState<number | null>(null);
  // A video that is not live keeps its own time: where it was, since when,
  // and how fast.
  const [local, setLocal] = useState({ playing: false, position: 0, at: 0, rate: 1 });
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDuration(null);
    void import("../../renderer/tauri/media-frames")
      .then((core) => core.mediaDuration(item.url))
      .then((seconds) => {
        if (!cancelled) setDuration(seconds);
      })
      .catch((): void => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.url]);

  const playing = isLive ? liveVideo.playing : local.playing;
  const rate = isLive ? liveVideo.rate : local.rate;
  // The time shown moves while the video runs.
  useEffect(() => {
    if (!playing) return;
    const intervalId = window.setInterval(() => setTick((tick) => tick + 1), 200);
    return () => window.clearInterval(intervalId);
  }, [playing]);

  const wrap = (seconds: number) =>
    duration && duration > 0 ? (loop ? seconds % duration : Math.min(seconds, duration)) : seconds;
  const position = wrap(
    isLive
      ? liveVideo.positionSeconds +
          (liveVideo.playing && liveVideo.sampledAtMs !== null
            ? (Math.max(0, Date.now() - liveVideo.sampledAtMs) / 1000) * liveVideo.rate
            : 0)
      : local.position + (local.playing ? (Math.max(0, Date.now() - local.at) / 1000) * local.rate : 0),
  );

  const togglePlaying = () => {
    if (isLive) {
      if (liveVideo.playing) liveVideo.pause();
      else liveVideo.play();
      return;
    }
    setLocal({ ...local, playing: !local.playing, position, at: Date.now() });
  };
  const seek = (seconds: number) => {
    const target = Math.max(0, duration ? Math.min(seconds, duration) : seconds);
    if (isLive) liveVideo.seek(target);
    else setLocal({ ...local, position: target, at: Date.now() });
  };
  const changeRate = (next: number) => {
    if (isLive) liveVideo.setRate(next);
    else setLocal({ ...local, position, at: Date.now(), rate: next });
  };
  const volume = Number.isFinite(videoSettings.volume) ? videoSettings.volume : 1;

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <RustVideo
        url={item.url}
        clock={
          isLive
            ? { mode: "scene" }
            : { mode: "local", playing: local.playing, positionSeconds: local.position, loop, rate: local.rate }
        }
        label={`${item.name} service preview`}
        // The operator's preview's size: sharp in a panel, and each frame
        // small enough to reach the screen as soon as the projector's.
        largest={1280}
        className="aspect-video w-full cursor-pointer bg-black"
        onClick={() => {
          if (!isLive) onSend?.();
        }}
      />
      <div className="space-y-2 border-t border-border bg-card px-3 pb-2.5 pt-3">
        <TrackSlider
          value={position}
          max={duration ?? 0}
          disabled={!duration}
          onChange={seek}
          label="Position"
          className="w-full"
        />
        <div className="flex items-center gap-1 text-foreground">
          <ControlButton onClick={() => seek(position - 10)} label="Back 10 seconds">
            <RotateCcw className="h-4 w-4" />
          </ControlButton>
          <ControlButton onClick={togglePlaying} label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-[18px] w-[18px]" /> : <Play className="h-[18px] w-[18px]" />}
          </ControlButton>
          <ControlButton onClick={() => seek(position + 10)} label="Forward 10 seconds">
            <RotateCw className="h-4 w-4" />
          </ControlButton>
          <span className="ml-1.5 text-[12px] font-medium tabular-nums text-foreground/90">
            {formatTime(position)}
            <span className="text-muted-foreground"> / {duration ? formatTime(duration) : "--:--"}</span>
          </span>
          {isLive ? (
            <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
              Live
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <ControlButton
              onClick={() => void onVideoSettingsChange?.({ loop: !loop })}
              label={loop ? "Loop on" : "Loop off"}
              active={loop}
            >
              <Repeat className="h-4 w-4" />
            </ControlButton>
            <label className="flex h-8 items-center gap-1 rounded-md px-1.5 text-[12px] text-foreground/85 hover:bg-foreground/10">
              <Gauge className="h-4 w-4" aria-hidden />
              <select
                aria-label="Speed"
                value={String(rate)}
                onChange={(event) => changeRate(Number(event.target.value))}
                className="cursor-pointer bg-transparent text-[12px] font-medium tabular-nums text-foreground outline-none"
              >
                {SPEEDS.map((speed) => (
                  <option key={speed} value={String(speed)}>
                    {speed}×
                  </option>
                ))}
              </select>
            </label>
            <ControlButton
              onClick={() => void onVideoSettingsChange?.({ muted: !videoSettings.muted })}
              label={videoSettings.muted ? "Unmute" : "Mute"}
              active={videoSettings.muted}
            >
              {videoSettings.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </ControlButton>
            <TrackSlider
              value={videoSettings.muted ? 0 : volume}
              max={1}
              onChange={(next) => void onVideoSettingsChange?.({ volume: next, muted: next === 0 })}
              label="Volume"
              className="w-20"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

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
  videoSettings,
  onOutputPreviewMedia,
  liveVideo,
  onVideoSettingsChange,
  showsPanelRef,
  scripturePanelRef,
  showsPanelProps,
  speechLang,
  speechInputDeviceId,
  bibleAgent,
  onSendScripture,
  selectedServiceId,
  onAddScriptureToService,
  importOverlay,
}: Props) {
  // Footer state
  const [scale, setScale] = useState(60);

  // The slides, memoised on their own: the media preview beside them follows
  // the live video ten times a second, and the grid must not redraw with it.
  const slidesGrid = useMemo(
    () => (
      <SlidesGrid
        slides={slidesForGrid}
        activeSlideId={activeSlideId}
        selectedIndex={selectedIndex}
        onSelectSlide={onSelectSlide}
        onEditSlide={onEditSlide}
        onOpenMiniEditor={onOpenMiniEditor}
        onReorderSlides={selectedLibraryItem ? onReorderSlides : undefined}
        externalScale={scale}
        isGridView={isGridView}
        {...editorProps}
      />
    ),
    [
      activeSlideId,
      editorProps,
      isGridView,
      scale,
      onEditSlide,
      onOpenMiniEditor,
      onReorderSlides,
      onSelectSlide,
      selectedIndex,
      selectedLibraryItem,
      slidesForGrid,
    ],
  );

  const mediaPane = (
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
              <PreviewVideo
                item={showViewMedia}
                videoSettings={videoSettings}
                onVideoSettingsChange={onVideoSettingsChange}
                liveVideo={liveVideo}
                onSend={isPreviewOutputting ? undefined : onOutputPreviewMedia}
              />
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium text-foreground">
              {showViewMedia.name}
            </p>
          </div>
        </div>
      ) : (
        slidesGrid
      )}
    </div>
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
          bibleAgent={bibleAgent}
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
      bibleAgent,
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
          isGridView={isGridView}
          onViewModeChange={onGridViewChange}
          scale={scale}
          onScaleChange={setScale}
        />
      )}
    </div>
  );
}
