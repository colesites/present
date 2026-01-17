"use client";

import { memo, useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AutoFitText } from "@/components/ui/AutoFitText";
import { stripBracketsForDisplay } from "@/lib/lyrics";
import {
  Type,
  Image,
  X,
  Volume2,
  VolumeX,
  Repeat,
  SlidersHorizontal,
  RotateCcw,
} from "lucide-react";
import type {
  MediaItem,
  VideoSettings,
  MediaFilters,
} from "@/hooks/useMediaFolders";
import { filtersToCSS, DEFAULT_FILTERS } from "@/hooks/useMediaFolders";

// Fixed output preview dimensions (16:9 aspect ratio)
const OUTPUT_WIDTH = 240;
const OUTPUT_HEIGHT = 135;

interface SlideGroup {
  label: string;
  count: number;
}

interface OutputPreviewProps {
  text: string | null;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  groups?: SlideGroup[];
  activeMediaItem: MediaItem | null;
  videoSettings: VideoSettings;
  onVideoSettingsChange: (settings: Partial<VideoSettings>) => void;
  showText: boolean;
  showMedia: boolean;
  onToggleText: () => void;
  onToggleMedia: () => void;
  onClearMedia: () => void;
  mediaFilters: MediaFilters;
  onMediaFiltersChange: (filters: Partial<MediaFilters>) => void;
  onResetFilters: () => void;
}

// Filter slider component - compact version
const FilterSlider = memo(function FilterSlider({
  label,
  value,
  min,
  max,
  defaultValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (value: number) => void;
}) {
  const isDefault = value === defaultValue;
  return (
    <div className="flex items-center gap-1">
      <span className="w-12 shrink-0 truncate text-[9px] text-muted-foreground">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="h-1 min-w-0 flex-1 accent-primary"
      />
      <span
        className={cn(
          "w-6 shrink-0 text-right text-[9px]",
          isDefault ? "text-muted-foreground" : "text-primary"
        )}
      >
        {value}
      </span>
    </div>
  );
});

export const OutputPreview = memo(function OutputPreview({
  text,
  fontBold,
  fontItalic,
  fontUnderline,
  groups = [],
  activeMediaItem,
  videoSettings,
  onVideoSettingsChange,
  showText,
  showMedia,
  onToggleText,
  onToggleMedia,
  onClearMedia,
  mediaFilters,
  onMediaFiltersChange,
  onResetFilters,
}: OutputPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Check if any filter is not default
  const hasActiveFilters =
    JSON.stringify(mediaFilters) !== JSON.stringify(DEFAULT_FILTERS);

  // Apply video settings to video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.loop = videoSettings.loop;
      videoRef.current.muted = videoSettings.muted;
      videoRef.current.volume = videoSettings.volume;
    }
  }, [videoSettings]);

  // Auto-play video when active
  useEffect(() => {
    if (videoRef.current && activeMediaItem?.type === "video") {
      videoRef.current.play().catch(() => {
        // Autoplay might be blocked by browser, ignore
      });
    }
  }, [activeMediaItem]);

  const filterStyle = filtersToCSS(mediaFilters);

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* Main Output label with status indicator */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            activeMediaItem || text ? "bg-green-500" : "bg-primary"
          )}
        />
        <p className="text-xs font-medium text-muted-foreground">Main Output</p>
      </div>

      {/* Preview box - fixed size rectangle (16:9) */}
      <div className="flex shrink-0 justify-center px-3">
        <div
          style={{ width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT }}
          className="relative shrink-0 overflow-hidden rounded-lg bg-black"
        >
          {/* Media layer (background) with filters */}
          {showMedia &&
            activeMediaItem &&
            (activeMediaItem.type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeMediaItem.url}
                alt={activeMediaItem.name}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ filter: filterStyle }}
              />
            ) : (
              <video
                ref={videoRef}
                src={activeMediaItem.url}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ filter: filterStyle }}
                autoPlay
                loop={videoSettings.loop}
                muted={videoSettings.muted}
                playsInline
              />
            ))}

          {/* Text layer (foreground, on top of media) */}
          {showText && text && (
            <div className="absolute inset-0 flex items-center justify-center p-2">
              <AutoFitText
                text={stripBracketsForDisplay(text)}
                className={cn(
                  "pointer-events-none select-none text-sm leading-relaxed text-white",
                  fontBold && "font-bold",
                  fontItalic && "italic",
                  fontUnderline && "underline",
                  // Add text shadow for better readability over media
                  activeMediaItem && "drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                )}
                minScale={0.4}
              />
            </div>
          )}

          {/* Empty state */}
          {!text && !activeMediaItem && (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-zinc-600">No content</p>
            </div>
          )}
        </div>
      </div>

      {/* Toggle controls */}
      <div className="mt-3 flex shrink-0 items-center justify-center gap-2 px-3">
        <button
          type="button"
          onClick={onToggleText}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition",
            showText
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          )}
          title={showText ? "Hide text" : "Show text"}
        >
          <Type className="h-3 w-3" />
          Text
        </button>
        <button
          type="button"
          onClick={onToggleMedia}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition",
            showMedia
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          )}
          title={showMedia ? "Hide media" : "Show media"}
        >
          <Image className="h-3 w-3" />
          Media
        </button>
        {activeMediaItem && (
          <>
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition",
                showFilters || hasActiveFilters
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
              title="Media filters"
            >
              <SlidersHorizontal className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onClearMedia}
              className="flex items-center gap-1.5 rounded-md bg-destructive/20 px-2 py-1 text-xs text-destructive transition hover:bg-destructive/30"
              title="Clear media"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        )}
      </div>

      {/* Video controls (only show when video is active) */}
      {activeMediaItem?.type === "video" && (
        <div className="mt-2 flex shrink-0 items-center justify-center gap-2 px-3">
          <button
            type="button"
            onClick={() => onVideoSettingsChange({ loop: !videoSettings.loop })}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition",
              videoSettings.loop
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
            title={videoSettings.loop ? "Disable loop" : "Enable loop"}
          >
            <Repeat className="h-3 w-3" />
            Loop
          </button>
          <button
            type="button"
            onClick={() =>
              onVideoSettingsChange({ muted: !videoSettings.muted })
            }
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition",
              videoSettings.muted
                ? "bg-destructive/20 text-destructive"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
            title={videoSettings.muted ? "Unmute" : "Mute"}
          >
            {videoSettings.muted ? (
              <VolumeX className="h-3 w-3" />
            ) : (
              <Volume2 className="h-3 w-3" />
            )}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={videoSettings.volume}
            onChange={(e) =>
              onVideoSettingsChange({ volume: parseFloat(e.target.value) })
            }
            className="h-1 w-16 accent-primary"
            title={`Volume: ${Math.round(videoSettings.volume * 100)}%`}
          />
        </div>
      )}

      {/* Filter controls - compact layout */}
      {activeMediaItem && showFilters && (
        <div className="mx-3 mt-2 shrink-0 space-y-1.5 rounded-lg border border-border bg-card/50 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              Filters
            </span>
            <button
              type="button"
              onClick={onResetFilters}
              className="flex items-center gap-0.5 text-[9px] text-muted-foreground transition hover:text-foreground"
              title="Reset all filters"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              Reset
            </button>
          </div>
          <FilterSlider
            label="Bright"
            value={mediaFilters.brightness}
            min={0}
            max={200}
            defaultValue={100}
            onChange={(v) => onMediaFiltersChange({ brightness: v })}
          />
          <FilterSlider
            label="Contrast"
            value={mediaFilters.contrast}
            min={0}
            max={200}
            defaultValue={100}
            onChange={(v) => onMediaFiltersChange({ contrast: v })}
          />
          <FilterSlider
            label="Saturate"
            value={mediaFilters.saturation}
            min={0}
            max={200}
            defaultValue={100}
            onChange={(v) => onMediaFiltersChange({ saturation: v })}
          />
          <FilterSlider
            label="Blur"
            value={mediaFilters.blur}
            min={0}
            max={20}
            defaultValue={0}
            onChange={(v) => onMediaFiltersChange({ blur: v })}
          />
          <FilterSlider
            label="Gray"
            value={mediaFilters.grayscale}
            min={0}
            max={100}
            defaultValue={0}
            onChange={(v) => onMediaFiltersChange({ grayscale: v })}
          />
          <FilterSlider
            label="Sepia"
            value={mediaFilters.sepia}
            min={0}
            max={100}
            defaultValue={0}
            onChange={(v) => onMediaFiltersChange({ sepia: v })}
          />
          <FilterSlider
            label="Hue"
            value={mediaFilters.hueRotate}
            min={0}
            max={360}
            defaultValue={0}
            onChange={(v) => onMediaFiltersChange({ hueRotate: v })}
          />
        </div>
      )}

      {/* Active media info */}
      {activeMediaItem && (
        <div className="mt-2 shrink-0 px-3">
          <p className="truncate text-center text-[10px] text-muted-foreground">
            {activeMediaItem.name}
          </p>
        </div>
      )}

      {/* Groups section */}
      <div className="mt-4 flex-1 px-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Groups
        </p>
        <div className="space-y-1">
          {groups.length > 0 ? (
            groups.map((group) => (
              <div
                key={group.label}
                className="flex items-center justify-between py-1 text-sm"
              >
                <span className="text-foreground">{group.label}</span>
                <span className="text-muted-foreground">{group.count}</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No groups</p>
          )}
        </div>
      </div>
    </div>
  );
});
