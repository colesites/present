import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Headphones, Minus, Plus, Volume2, VolumeX } from "lucide-react";

import { cn } from "../../../renderer/shared/lib/utils";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../../renderer/shared/components/ui/resizable";
import type { RecordingTrack, TrackMix } from "../../../renderer/tauri/recorder";
import { trackGain } from "../hooks/useAudioPlayback";
import { InputMonitoringIcon } from "./DawIcons";
import { TrackPanKnob, TrackVolumeSlider } from "./TrackControls";

/** Track row height. Header and lane share it. */
const ROW = 104;
const RULER = 32;
/** Pixels per second: the zoom. */
const MIN_ZOOM = 4;
const MAX_ZOOM = 320;
const DEFAULT_ZOOM = 40;
const ZOOM_KEY = "present-recorder-zoom";
/** Room past the last take, so there is always somewhere to scroll to. */
const TAIL_SECONDS = 30;

function formatMark(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${remain.toString().padStart(2, "0")}`;
}

/** Seconds between numbered marks, so they sit at least 70 px apart. */
function majorStep(zoom: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  return steps.find((step) => step * zoom >= 70) ?? 3600;
}

function readZoom(): number {
  try {
    const stored = Number(window.localStorage.getItem(ZOOM_KEY));
    if (Number.isFinite(stored) && stored >= MIN_ZOOM && stored <= MAX_ZOOM) return stored;
  } catch {
    // Storage is unavailable; the default is fine.
  }
  return DEFAULT_ZOOM;
}

function gridStyle(zoom: number, step: number): CSSProperties {
  const major = step * zoom;
  const minor = major / 4;
  return {
    backgroundImage: [
      "linear-gradient(to right, hsl(238 20% 22% / 0.8) 1px, transparent 1px)",
      "linear-gradient(to right, hsl(238 20% 22% / 0.3) 1px, transparent 1px)",
    ].join(", "),
    backgroundSize: `${major}px 100%, ${minor}px 100%`,
  };
}

/** What a track's meter shows now: the input while it is monitored or
 * recorded, its own take while the transport plays. */
function trackLevel(
  track: RecordingTrack,
  armed: boolean,
  inputLevel: number,
  playing: boolean,
  playhead: number,
  anySolo: boolean,
  peaksPerSecond: number,
): number {
  if (track.recording || (armed && track.strip.monitor)) return inputLevel;
  if (!playing || track.seconds <= 0) return 0;
  const index = Math.floor((playhead - track.start) * peaksPerSecond);
  if (index < 0 || index >= track.peaks.length) return 0;
  return (track.peaks[index] / 255) * trackGain(track.mix, anySolo, false);
}

/**
 * The arrangement: track headers on the left, the timeline on the right.
 *
 * The timeline keeps its zoom while a take grows, as GarageBand's does: it
 * scrolls, and while playing or recording it turns the page when the
 * playhead reaches the edge. The zoom slider or ⌘-scroll changes it.
 */
export function TrackArea({
  tracks,
  armedId,
  selectedRegionId = null,
  level,
  playhead,
  playing = false,
  recordingActive,
  busy,
  peaksPerSecond,
  onArm,
  onSelectRegion,
  onRename,
  onAdd,
  onDeleteTrack,
  onDeleteRecording,
  onSeek,
  onMonitoring,
  onMix,
}: {
  tracks: RecordingTrack[];
  armedId: number | null;
  selectedRegionId?: number | null;
  /** The input, 0 to 1. */
  level: number;
  playhead: number;
  playing?: boolean;
  recordingActive: boolean;
  busy: boolean;
  peaksPerSecond: number;
  onArm: (id: number) => void;
  onSelectRegion?: (id: number | null) => void;
  onRename: (id: number, name: string) => void;
  onAdd: () => void;
  onDeleteTrack?: (id: number) => void;
  onDeleteRecording?: (id: number) => void;
  onSeek?: (seconds: number) => void;
  onMonitoring: (id: number) => void;
  onMix: (id: number, mix: TrackMix) => void;
}) {
  const [zoom, setZoom] = useState(readZoom);
  const [view, setView] = useState({ left: 0, width: 800 });
  const headersRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      // Not kept; nothing else depends on it.
    }
  }, [zoom]);

  const end = Math.max(playhead, ...tracks.map((track) => track.start + track.seconds));
  const width = Math.max(view.width, Math.ceil((end + TAIL_SECONDS) * zoom));
  const step = majorStep(zoom);
  const grid = gridStyle(zoom, step);
  const anySolo = tracks.some((track) => track.mix.solo);
  const following = playing || recordingActive;
  const playheadX = playhead * zoom;

  // Numbered marks, only the ones near what is on screen.
  const firstMark = Math.max(0, Math.floor((view.left - view.width) / zoom / step));
  const lastMark = Math.ceil((view.left + view.width * 2) / zoom / step);
  const marks: number[] = [];
  for (let index = firstMark; index <= lastMark && index * step * zoom <= width; index += 1) {
    marks.push(index * step);
  }

  const readView = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    setView((before) =>
      before.left === scroller.scrollLeft && before.width === scroller.clientWidth
        ? before
        : { left: scroller.scrollLeft, width: scroller.clientWidth },
    );
  };

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    readView();
    const observer = new ResizeObserver(readView);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Turn the page when the playhead reaches the edge, as GarageBand does.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !following) return;
    const margin = 24;
    if (playheadX > scroller.scrollLeft + scroller.clientWidth - margin || playheadX < scroller.scrollLeft) {
      scroller.scrollLeft = Math.max(0, playheadX - margin);
    }
  }, [following, playheadX]);

  // Keep the playhead where it was on screen when the zoom changes.
  const zoomTo = (next: number) => {
    const scroller = scrollRef.current;
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    if (scroller) {
      const onScreen = playhead * zoom - scroller.scrollLeft;
      requestAnimationFrame(() => {
        scroller.scrollLeft = Math.max(0, playhead * clamped - onScreen);
        readView();
      });
    }
    setZoom(clamped);
  };

  const onScroll = () => {
    const scroller = scrollRef.current;
    if (headersRef.current && scroller) headersRef.current.scrollTop = scroller.scrollTop;
    if (scrollFrame.current == null) {
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = null;
        readView();
      });
    }
  };

  const seekFromClientX = (clientX: number) => {
    const content = contentRef.current;
    if (!content || !onSeek) return;
    const rect = content.getBoundingClientRect();
    onSeek(Math.max(0, (clientX - rect.left) / zoom));
  };

  const handleScrubStart = (event: React.PointerEvent) => {
    event.preventDefault();
    seekFromClientX(event.clientX);
    const onMove = (move: PointerEvent) => seekFromClientX(move.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-background select-none">
      <ResizablePanelGroup direction="horizontal" className="h-full w-full" autoSaveId="present-recorder-tracks-layout-v7">
        <ResizablePanel defaultSize={24} minSize={0} maxSize={55} order={1}>
          <div className="flex h-full flex-col overflow-hidden border-r border-border bg-sidebar">
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-3" style={{ height: RULER }}>
              <button
                type="button"
                aria-label="New track"
                title="New track"
                disabled={busy || recordingActive}
                onClick={onAdd}
                className="flex h-5 items-center gap-1.5 rounded border border-border bg-secondary px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-40"
              >
                <Plus className="size-3 text-primary" />
                <span>Track</span>
              </button>
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
              </span>
            </div>

            <div
              ref={headersRef}
              onWheel={(event) => {
                if (scrollRef.current) scrollRef.current.scrollTop += event.deltaY;
              }}
              className="flex-1 overflow-hidden"
            >
              {tracks.map((track) => (
                <div key={track.id} className="border-b border-border" style={{ height: ROW }}>
                  <TrackHeader
                    track={track}
                    armed={track.id === armedId}
                    selected={track.id === armedId && selectedRegionId === null}
                    level={trackLevel(track, track.id === armedId, level, playing, playhead, anySolo, peaksPerSecond)}
                    onMonitoring={() => onMonitoring(track.id)}
                    onMix={(mix) => onMix(track.id, mix)}
                    onSelect={() => {
                      onArm(track.id);
                      onSelectRegion?.(null);
                    }}
                    onRename={(name) => onRename(track.id, name)}
                    onDelete={onDeleteTrack ? () => onDeleteTrack(track.id) : undefined}
                  />
                </div>
              ))}
              <div className="h-16" />
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel defaultSize={76} minSize={45} maxSize={100} order={2}>
          <div className="relative h-full overflow-hidden bg-background">
            <div
              ref={scrollRef}
              onScroll={onScroll}
              onWheel={(event) => {
                if (!event.metaKey && !event.ctrlKey) return;
                event.preventDefault();
                zoomTo(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
              }}
              className="h-full w-full overflow-auto"
            >
              <div ref={contentRef} className="relative min-h-full" style={{ width }}>
                {/* Ruler: click or drag to move the playhead. It stays put as tracks scroll. */}
                <div
                  onPointerDown={handleScrubStart}
                  className="sticky top-0 z-20 cursor-pointer overflow-hidden border-b border-border bg-[#232328]"
                  style={{ height: RULER, width }}
                  aria-label="Timeline ruler (click or drag to move the playhead)"
                >
                  <div
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-3"
                    style={{
                      backgroundImage: [
                        "linear-gradient(to right, hsl(0 0% 70% / 0.7) 1px, transparent 1px)",
                        "linear-gradient(to right, hsl(0 0% 70% / 0.25) 1px, transparent 1px)",
                      ].join(", "),
                      backgroundSize: `${step * zoom}px 100%, ${(step * zoom) / 4}px 40%`,
                      backgroundRepeat: "repeat-x",
                      backgroundPosition: "0 0, 0 100%",
                    }}
                  />
                  {marks.map((mark) => (
                    <span
                      key={mark}
                      className="pointer-events-none absolute top-1 pl-1 font-mono text-[9px] font-semibold text-muted-foreground/90 tabular-nums"
                      style={{ left: mark * zoom }}
                    >
                      {formatMark(mark)}
                    </span>
                  ))}
                  <div
                    className="absolute top-0 -translate-x-1/2 cursor-ew-resize"
                    style={{ left: playheadX }}
                    title={`Playhead: ${formatMark(playhead)} (drag to move)`}
                  >
                    <svg width="15" height="18" viewBox="0 0 15 18" fill="none" className="drop-shadow-md">
                      <path
                        d="M1 1 H14 V11 L7.5 17 L1 11 Z"
                        fill={recordingActive ? "#ef4444" : "#f1f5f9"}
                        stroke={recordingActive ? "#b91c1c" : "#64748b"}
                        strokeWidth="1.2"
                      />
                    </svg>
                  </div>
                </div>

                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className={cn(
                      "relative cursor-pointer border-b border-border",
                      track.id === armedId ? "bg-primary/[0.04]" : "bg-background",
                    )}
                    style={{ ...grid, height: ROW }}
                    onClick={(event) => {
                      onArm(track.id);
                      onSelectRegion?.(null);
                      if (!following) seekFromClientX(event.clientX);
                    }}
                  >
                    {track.seconds > 0 || track.recording ? (
                      <Region
                        track={track}
                        zoom={zoom}
                        selected={selectedRegionId === track.id}
                        dimmed={!track.recording && (track.mix.mute || (anySolo && !track.mix.solo))}
                        onSelect={() => {
                          onArm(track.id);
                          onSelectRegion?.(track.id);
                        }}
                        onDelete={onDeleteRecording ? () => onDeleteRecording(track.id) : undefined}
                      />
                    ) : track.id === armedId && !recordingActive && !playing && playhead < 0.05 ? (
                      <span
                        className="pointer-events-none sticky left-4 flex h-full items-center text-xs text-muted-foreground/60 italic"
                        style={{ width: "max-content" }}
                      >
                        Press Space to play, or R to record on this track.
                      </span>
                    ) : null}
                  </div>
                ))}

                {/* The playhead's line, through every track. */}
                <div
                  className={cn(
                    "pointer-events-none absolute bottom-0 z-10 w-px -translate-x-1/2",
                    recordingActive
                      ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]"
                      : "bg-white/90 shadow-[0_0_2px_rgba(0,0,0,0.6)]",
                  )}
                  style={{ left: playheadX, top: RULER }}
                  aria-hidden
                />
              </div>
            </div>

            {/* Zoom, over the ruler's right end. */}
            <div className="absolute top-1 right-3 z-30 flex items-center gap-1 rounded bg-[#232328]/90 px-1.5 py-0.5">
              <button
                type="button"
                aria-label="Zoom out"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => zoomTo(zoom / 1.5)}
              >
                <Minus className="size-3" />
              </button>
              <input
                type="range"
                aria-label="Zoom"
                min={Math.log(MIN_ZOOM)}
                max={Math.log(MAX_ZOOM)}
                step={0.01}
                value={Math.log(zoom)}
                onChange={(event) => zoomTo(Math.exp(Number(event.target.value)))}
                className="h-1 w-20 cursor-pointer accent-primary"
              />
              <button
                type="button"
                aria-label="Zoom in"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => zoomTo(zoom * 1.5)}
              >
                <Plus className="size-3" />
              </button>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/** One take, where it was recorded on the timeline. */
function Region({
  track,
  zoom,
  selected,
  dimmed,
  onSelect,
  onDelete,
}: {
  track: RecordingTrack;
  zoom: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const hot = track.recording;
  return (
    <div
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if ((event.key === "Delete" || event.key === "Backspace") && onDelete) {
          event.preventDefault();
          event.stopPropagation();
          onDelete();
        }
      }}
      className={cn(
        "group absolute inset-y-2 flex cursor-pointer flex-col overflow-hidden rounded-md border shadow-md select-none",
        hot ? "border-destructive bg-destructive/70 shadow-destructive/20" : "border-primary bg-primary/60 shadow-black/30",
        selected && "border-white ring-2 ring-primary ring-offset-2 ring-offset-background",
        dimmed && "opacity-40",
      )}
      style={{ left: track.start * zoom, width: Math.max(track.seconds * zoom, 4) }}
    >
      <div
        className={cn(
          "flex h-4.5 shrink-0 items-center justify-between px-2 text-[10px] font-bold tracking-wide text-white shadow-sm",
          hot ? "bg-destructive" : "bg-primary",
        )}
      >
        <span className="sticky left-2 truncate">{track.name}</span>
        <span className="font-mono text-[9px] tabular-nums opacity-80">{formatMark(track.seconds)}</span>
      </div>
      <div className="min-h-0 flex-1 py-1">
        <Waveform peaks={track.peaks} />
      </div>
    </div>
  );
}

const samePeaks = (before: { peaks: number[] }, after: { peaks: number[] }) =>
  before.peaks.length === after.peaks.length && before.peaks.every((peak, index) => peak === after.peaks[index]);

/** Peaks (0 to 255) mirrored about the middle. Drawn again only when they change. */
const Waveform = memo(function Waveform({ peaks }: { peaks: number[] }) {
  if (peaks.length === 0) return null;
  const height = 80;
  const mid = height / 2;
  const amp = (peak: number) => Math.max(0.6, Math.min(1, peak / 255) * (mid - 4));
  const top = peaks.map((peak, index) => `${index + 0.5},${(mid - amp(peak)).toFixed(1)}`);
  const bottom = peaks.map((peak, index) => `${index + 0.5},${(mid + amp(peak)).toFixed(1)}`).reverse();
  return (
    <svg viewBox={`0 0 ${peaks.length} ${height}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      <polygon points={[...top, ...bottom].join(" ")} fill="white" fillOpacity={0.92} />
    </svg>
  );
}, samePeaks);

/**
 * A track's header: name, mute, solo, input monitoring, volume and pan. Each
 * of these is the track's own and is heard: mute, solo, volume and pan in
 * playback and export, monitoring through this track's settings.
 */
function TrackHeader({
  track,
  armed,
  selected,
  level,
  onMonitoring,
  onMix,
  onSelect,
  onRename,
  onDelete,
}: {
  track: RecordingTrack;
  armed: boolean;
  selected: boolean;
  level: number;
  onMonitoring: () => void;
  onMix: (mix: TrackMix) => void;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? track.name;
  const { mix } = track;
  const monitoring = track.strip.monitor;

  const commit = () => {
    const next = name.trim();
    setDraft(null);
    if (next && next !== track.name) onRename(next);
  };

  return (
    <div
      className={cn(
        "group/header flex h-full w-full cursor-default items-center gap-3 bg-sidebar px-3.5 transition-colors select-none",
        selected && "border-l-4 border-l-primary bg-card",
      )}
      onClick={onSelect}
    >
      <div
        className={cn(
          "flex h-9 w-10 shrink-0 items-center justify-center rounded-lg text-primary-foreground shadow-xs",
          track.recording ? "bg-destructive" : "bg-primary",
        )}
        title={armed ? "Recording goes onto this track" : undefined}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="currentColor">
          <rect x="3" y="9" width="2" height="6" rx="1" />
          <rect x="7" y="6" width="2" height="12" rx="1" />
          <rect x="11" y="3" width="2" height="18" rx="1" />
          <rect x="15" y="6" width="2" height="12" rx="1" />
          <rect x="19" y="9" width="2" height="6" rx="1" />
        </svg>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        <div className="flex items-center justify-between gap-1">
          <input
            value={name}
            aria-label="Track name"
            className="h-5 min-w-0 flex-1 truncate rounded bg-transparent px-0.5 text-xs font-semibold text-foreground outline-none transition-colors focus:bg-card focus:ring-1 focus:ring-primary"
            onChange={(event) => setDraft(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setDraft(null);
                event.currentTarget.blur();
              }
            }}
          />
          {onDelete ? (
            <button
              type="button"
              aria-label="Delete track"
              title="Delete track"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              className="hidden size-4 items-center justify-center rounded text-muted-foreground group-hover/header:flex hover:text-destructive"
            >
              <Minus className="size-3" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex h-6 items-stretch overflow-hidden rounded border border-border bg-card shadow-2xs">
            <button
              type="button"
              aria-label={mix.mute ? "Unmute" : "Mute"}
              aria-pressed={mix.mute}
              title={mix.mute ? "Unmute" : "Mute"}
              onClick={(event) => {
                event.stopPropagation();
                onMix({ ...mix, mute: !mix.mute });
              }}
              className={cn(
                "flex w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                mix.mute && "bg-secondary text-destructive",
              )}
            >
              {mix.mute ? <VolumeX className="size-3 text-destructive" /> : <Volume2 className="size-3" />}
            </button>
            <div className="w-px bg-border" />
            <button
              type="button"
              aria-label={mix.solo ? "Unsolo" : "Solo"}
              aria-pressed={mix.solo}
              title={mix.solo ? "Unsolo" : "Solo"}
              onClick={(event) => {
                event.stopPropagation();
                onMix({ ...mix, solo: !mix.solo });
              }}
              className={cn(
                "flex w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                mix.solo && "bg-secondary text-amber-400",
              )}
            >
              <Headphones className={cn("size-3", mix.solo && "text-amber-400")} />
            </button>
          </div>

          <button
            type="button"
            aria-label={monitoring ? "Turn off input monitoring" : "Turn on input monitoring"}
            aria-pressed={monitoring}
            title="Input Monitoring"
            onClick={(event) => {
              event.stopPropagation();
              onMonitoring();
            }}
            className={cn(
              "flex size-6 items-center justify-center rounded border border-border bg-card text-muted-foreground shadow-2xs transition-colors hover:bg-secondary hover:text-foreground",
              monitoring && "border-primary/60 bg-secondary text-primary",
            )}
          >
            <InputMonitoringIcon className={cn("size-3.5", monitoring && "text-primary")} />
          </button>

          <TrackVolumeSlider
            volumeDb={mix.volumeDb}
            level={level}
            active={level > 0}
            onChange={(volumeDb) => onMix({ ...mix, volumeDb })}
            className="w-24 shrink-0"
          />

          <TrackPanKnob pan={mix.pan} onChange={(pan) => onMix({ ...mix, pan })} className="shrink-0" />
        </div>
      </div>
    </div>
  );
}
