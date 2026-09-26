"use client";

import { memo, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Camera,
  Clock3,
  Copy,
  LayoutGrid,
  Play,
  Plus,
  Send,
  Trash2,
  Video,
  Presentation,
} from "lucide-react";
import { Button } from "../../renderer/shared/components/ui/button";
import { Input } from "../../renderer/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../renderer/shared/components/ui/select";
import { cn } from "../../renderer/shared/lib/utils";
import { MediaPicker } from "../../renderer/shared/components/MediaPicker";
import { useMediaLibraryStore } from "../../renderer/shared/store/mediaLibrary";
import type { MediaItem } from "../media/hooks/useMediaFolders";
import type { ScreenComposerController } from "./useScreenComposerState";
import type {
  ScreenComposerPreset,
  ScreenComposerRegion,
  ScreenComposerSource,
} from "./types";

const GRID_STEP_PERCENT = 2;
const GUIDE_SNAP_THRESHOLD = 1.2;
const REGION_MIN_SIZE_PERCENT = 8;

const SOURCE_OPTIONS: Array<{
  value: ScreenComposerSource;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { value: "slides", label: "Slides", description: "Text content", icon: Presentation },
  { value: "video", label: "Media", description: "Images & videos", icon: Video },
  { value: "camera-feed", label: "Camera feed", description: "Live camera", icon: Camera },
  { value: "countdown", label: "Countdown", description: "Timer layer", icon: Clock3 },
];

const PRESET_OPTIONS: Array<{ value: ScreenComposerPreset; label: string }> = [
  { value: "single", label: "Single" },
  { value: "split-vertical", label: "2 Vertical" },
  { value: "split-horizontal", label: "2 Horizontal" },
  { value: "grid-3", label: "3 Grid" },
  { value: "grid-4", label: "4 Grid" },
];

const RESIZE_HANDLES: Array<{
  kind: ResizeKind;
  className: string;
}> = [
  { kind: "nw", className: "-left-1.5 -top-1.5 cursor-nwse-resize" },
  { kind: "n", className: "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize" },
  { kind: "ne", className: "-right-1.5 -top-1.5 cursor-nesw-resize" },
  { kind: "e", className: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
  { kind: "se", className: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
  { kind: "s", className: "bottom-[-6px] left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { kind: "sw", className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
  { kind: "w", className: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
];

type ResizeKind = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SnapGuides = {
  x: number | null;
  y: number | null;
};

type InteractionState = {
  pointerId: number;
  regionId: string;
  kind: ResizeKind;
  startClientX: number;
  startClientY: number;
  startRect: Rect;
};

type ScreenComposerWorkspaceProps = {
  composer: ScreenComposerController;
  showProgramPreview?: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function snapToGrid(value: number) {
  return roundToTwo(Math.round(value / GRID_STEP_PERCENT) * GRID_STEP_PERCENT);
}

function asRect(region: ScreenComposerRegion): Rect {
  return {
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  };
}

function normalizeRect(rect: Rect): Rect {
  const width = clamp(rect.width, REGION_MIN_SIZE_PERCENT, 100);
  const height = clamp(rect.height, REGION_MIN_SIZE_PERCENT, 100);
  const x = clamp(rect.x, 0, 100 - width);
  const y = clamp(rect.y, 0, 100 - height);
  return {
    x: roundToTwo(x),
    y: roundToTwo(y),
    width: roundToTwo(width),
    height: roundToTwo(height),
  };
}

function intersectsRect(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function buildSnapLines(regions: ScreenComposerRegion[], activeRegionId: string) {
  const linesX = [0, 25, 50, 75, 100];
  const linesY = [0, 25, 50, 75, 100];

  for (const region of regions) {
    if (region.id === activeRegionId) {
      continue;
    }
    linesX.push(region.x, region.x + region.width / 2, region.x + region.width);
    linesY.push(region.y, region.y + region.height / 2, region.y + region.height);
  }

  return { linesX, linesY };
}

function applyGuideSnap(rect: Rect, linesX: number[], linesY: number[]): { rect: Rect; guides: SnapGuides } {
  let next = { ...rect };
  let guideX: number | null = null;
  let guideY: number | null = null;

  const xCandidates: Array<{ value: number; apply: (line: number) => void }> = [
    { value: next.x, apply: (line) => { next.x = line; } },
    { value: next.x + next.width / 2, apply: (line) => { next.x = line - next.width / 2; } },
    { value: next.x + next.width, apply: (line) => { next.x = line - next.width; } },
  ];

  const yCandidates: Array<{ value: number; apply: (line: number) => void }> = [
    { value: next.y, apply: (line) => { next.y = line; } },
    { value: next.y + next.height / 2, apply: (line) => { next.y = line - next.height / 2; } },
    { value: next.y + next.height, apply: (line) => { next.y = line - next.height; } },
  ];

  let closestX: { distance: number; line: number; apply: (line: number) => void } | null = null;
  let closestY: { distance: number; line: number; apply: (line: number) => void } | null = null;

  for (const candidate of xCandidates) {
    for (const line of linesX) {
      const distance = Math.abs(candidate.value - line);
      if (distance > GUIDE_SNAP_THRESHOLD) {
        continue;
      }
      if (!closestX || distance < closestX.distance) {
        closestX = { distance, line, apply: candidate.apply };
      }
    }
  }

  for (const candidate of yCandidates) {
    for (const line of linesY) {
      const distance = Math.abs(candidate.value - line);
      if (distance > GUIDE_SNAP_THRESHOLD) {
        continue;
      }
      if (!closestY || distance < closestY.distance) {
        closestY = { distance, line, apply: candidate.apply };
      }
    }
  }

  if (closestX) {
    closestX.apply(closestX.line);
    guideX = roundToTwo(closestX.line);
  }
  if (closestY) {
    closestY.apply(closestY.line);
    guideY = roundToTwo(closestY.line);
  }

  next = normalizeRect(next);
  return { rect: next, guides: { x: guideX, y: guideY } };
}

function sourceDefaults(source: ScreenComposerSource) {
  if (source === "video") {
    return { showMediaLayer: true, showTextLayer: false };
  }
  if (source === "slides") {
    return { showMediaLayer: false, showTextLayer: true };
  }
  if (source === "camera-feed") {
    return { showMediaLayer: false, showTextLayer: false };
  }
  return { showMediaLayer: false, showTextLayer: true };
}

function fitModeClass(mode: ScreenComposerRegion["fitMode"]) {
  if (mode === "contain") {
    return "object-contain";
  }
  if (mode === "fill") {
    return "object-fill";
  }
  if (mode === "scale-down") {
    return "object-scale-down";
  }
  return "object-cover";
}

const SourceCard = memo(function SourceCard({
  source,
}: {
  source: (typeof SOURCE_OPTIONS)[number];
}) {
  const Icon = source.icon;
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-present-source", source.value);
        event.dataTransfer.effectAllowed = "copy";
      }}
      className="group w-full rounded-lg border border-border/80 bg-card/70 p-3 text-left transition hover:border-primary/60 hover:bg-primary/10"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded-md border border-border/70 bg-background/60 p-1.5 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-foreground">{source.label}</p>
          <p className="text-[10px] text-muted-foreground">{source.description}</p>
        </div>
      </div>
    </button>
  );
});

const RegionPreviewContent = memo(function RegionPreviewContent({
  region,
  compact = false,
}: {
  region: ScreenComposerRegion;
  compact?: boolean;
}) {
  const textSizeClass = compact
    ? "text-[min(1.6vw,13px)]"
    : "text-[min(1.8vw,16px)]";

  return (
    <div className="relative h-full w-full">
      {region.backgroundMediaUrl ? (
        region.backgroundMediaType === "video" ? (
          <video
            src={region.backgroundMediaUrl}
            muted
            playsInline
            autoPlay
            loop
            className={cn("h-full w-full", fitModeClass(region.fitMode))}
          />
        ) : (
          <img
            src={region.backgroundMediaUrl}
            alt=""
            className={cn("h-full w-full", fitModeClass(region.fitMode))}
          />
        )
      ) : null}
      {region.source === "camera-feed" ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black/45 text-center">
          <span className="rounded-full border border-border/70 bg-background/70 p-2 text-muted-foreground">
            <Camera className="h-4 w-4" />
          </span>
          <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Camera feed
          </p>
        </div>
      ) : null}

      {region.source === "countdown" ? (
        <div className="absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-1 bg-black/35 px-2 text-center">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Countdown
          </p>
          <p className={cn("font-semibold text-foreground", textSizeClass)}>
            00:00:00
          </p>
        </div>
      ) : null}

      {region.source === "slides" ? (
        <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-black/20 p-3 text-center">
          {region.slideText?.trim() ? (
            <p className={cn("line-clamp-6 whitespace-pre-line font-medium leading-tight text-foreground", textSizeClass)}>
              {region.slideText}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">Shows the slide on screen</p>
          )}
        </div>
      ) : null}

      {region.source === "video" ? (
        region.mediaUrl ? (
          region.mediaType === "video" ? (
            <video
              src={region.mediaUrl}
              muted
              playsInline
              autoPlay
              loop
              className={cn("absolute inset-0 h-full w-full", fitModeClass(region.fitMode))}
            />
          ) : (
            <img
              src={region.mediaUrl}
              alt=""
              className={cn("absolute inset-0 h-full w-full", fitModeClass(region.fitMode))}
            />
          )
        ) : (
          <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-black/25 p-3 text-center">
            <p className="text-[11px] text-muted-foreground">No media chosen</p>
          </div>
        )
      ) : null}
    </div>
  );
});

/**
 * What a region shows from the media library, chosen here. The choice goes to
 * the screen at once if the region is on it.
 */
function RegionMediaField({
  label,
  url,
  name,
  onChoose,
}: {
  label: string;
  url: string | null;
  name: string | null;
  onChoose: (item: MediaItem | null) => void;
}) {
  const items = useMediaLibraryStore((state) => state.items);
  const chosen = url ? items.find((item) => item.url === url) ?? null : null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-[11px] text-muted-foreground">{label}</label>
        {url ? (
          <button
            type="button"
            onClick={() => onChoose(null)}
            className="text-[11px] text-muted-foreground transition hover:text-foreground"
          >
            Clear
          </button>
        ) : null}
      </div>
      <p className="truncate text-[12px] text-foreground">{chosen?.name ?? name ?? "Nothing chosen"}</p>
      <MediaPicker value={chosen?.id ?? null} onChoose={(item) => onChoose(item)} />
    </div>
  );
}

const ProgramPreview = memo(function ProgramPreview({
  regions,
}: {
  regions: ScreenComposerRegion[];
}) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
      {regions.map((region) => (
        <div
          key={region.id}
          className="absolute overflow-hidden"
          style={{
            left: `${region.x}%`,
            top: `${region.y}%`,
            width: `${region.width}%`,
            height: `${region.height}%`,
            padding: `${region.padding}px`,
          }}
        >
          <div
            className="h-full w-full overflow-hidden border border-white/10 bg-black"
            style={{
              borderRadius: `${region.borderRadius}px`,
              backgroundColor: region.backgroundColor,
            }}
          >
            <RegionPreviewContent region={region} compact />
          </div>
        </div>
      ))}
    </div>
  );
});

export function ScreenComposerWorkspace({
  composer,
  showProgramPreview = true,
}: ScreenComposerWorkspaceProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const activeLayoutRef = useRef(composer.activeLayout);
  const [interaction, setInteraction] = useState<InteractionState | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuides>({ x: null, y: null });
  const [hoverDropRegionId, setHoverDropRegionId] = useState<string | null>(null);
  const selectedRegionId = composer.selectedRegionId;
  const duplicateRegion = composer.duplicateRegion;
  const removeRegion = composer.removeRegion;
  const updateRegion = composer.updateRegion;
  const setSelectedRegionId = composer.setSelectedRegionId;

  useEffect(() => {
    activeLayoutRef.current = composer.activeLayout;
  }, [composer.activeLayout]);

  const isLiveDirty = useMemo(
    () => JSON.stringify(composer.activeLayout) !== JSON.stringify(composer.liveLayout),
    [composer.activeLayout, composer.liveLayout],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedRegionId) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        removeRegion(selectedRegionId);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateRegion(selectedRegionId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [duplicateRegion, removeRegion, selectedRegionId]);

  useEffect(() => {
    if (!interaction) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) {
        return;
      }

      const canvasRect = canvasRef.current?.getBoundingClientRect();
      const layout = activeLayoutRef.current;
      if (!canvasRect || !layout) {
        return;
      }

      const deltaX = ((event.clientX - interaction.startClientX) / canvasRect.width) * 100;
      const deltaY = ((event.clientY - interaction.startClientY) / canvasRect.height) * 100;

      let nextRect: Rect = { ...interaction.startRect };
      if (interaction.kind === "move") {
        nextRect.x = interaction.startRect.x + deltaX;
        nextRect.y = interaction.startRect.y + deltaY;
      } else {
        if (interaction.kind.includes("e")) {
          nextRect.width = interaction.startRect.width + deltaX;
        }
        if (interaction.kind.includes("s")) {
          nextRect.height = interaction.startRect.height + deltaY;
        }
        if (interaction.kind.includes("w")) {
          nextRect.x = interaction.startRect.x + deltaX;
          nextRect.width = interaction.startRect.width - deltaX;
        }
        if (interaction.kind.includes("n")) {
          nextRect.y = interaction.startRect.y + deltaY;
          nextRect.height = interaction.startRect.height - deltaY;
        }
      }

      nextRect = normalizeRect({
        x: snapToGrid(nextRect.x),
        y: snapToGrid(nextRect.y),
        width: snapToGrid(nextRect.width),
        height: snapToGrid(nextRect.height),
      });

      const { linesX, linesY } = buildSnapLines(layout.regions, interaction.regionId);
      const snapped = applyGuideSnap(nextRect, linesX, linesY);

      if (!layout.allowOverlap) {
        const blocks = layout.regions.filter((region) => region.id !== interaction.regionId);
        const hasOverlap = blocks.some((region) => intersectsRect(snapped.rect, asRect(region)));
        if (hasOverlap) {
          return;
        }
      }

      setSnapGuides(snapped.guides);
      updateRegion(interaction.regionId, snapped.rect);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) {
        return;
      }
      setInteraction(null);
      setSnapGuides({ x: null, y: null });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [interaction, updateRegion]);

  const beginInteraction = (
    event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>,
    region: ScreenComposerRegion,
    kind: ResizeKind,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedRegionId(region.id);
    setInteraction({
      pointerId: event.pointerId,
      regionId: region.id,
      kind,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: asRect(region),
    });
  };

  const selectedRegion = composer.selectedRegion;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/65 px-3 py-2">
        <div className="flex items-center gap-1 rounded-md border border-border bg-background/70 p-1">
          <button
            type="button"
            onClick={() => composer.setMode("edit")}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium transition",
              composer.mode === "edit"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Edit Mode
          </button>
          <button
            type="button"
            onClick={() => composer.setMode("live")}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium transition",
              composer.mode === "live"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Live Mode
          </button>
        </div>
        {composer.enabled ? (
          <div className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              On screen
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-[11px]"
              onClick={() => {
                composer.setEnabled(false);
                composer.setMode("edit");
              }}
            >
              Take off screen
            </Button>
          </div>
        ) : (
          <span className="rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
            Not on screen. Go Live shows it.
          </span>
        )}

        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-[11px]"
          onClick={composer.addRegion}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Region
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-[11px]"
            disabled={!isLiveDirty}
            onClick={composer.applyActiveLayoutToLive}
          >
            <Send className="h-3.5 w-3.5" />
            Apply
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-[11px]"
            onClick={() => {
              composer.goLiveLayout(composer.activeLayout.id);
              composer.setMode("live");
            }}
          >
            <Play className="h-3.5 w-3.5" />
            Go Live
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-[220px_minmax(0,1fr)_340px]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card/70">
          <div className="border-b border-border px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Sources
            </p>
          </div>
          <div className="space-y-2 overflow-auto p-3">
            {SOURCE_OPTIONS.map((source) => (
              <SourceCard key={source.value} source={source} />
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card/60">
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
              <LayoutGrid className="h-3.5 w-3.5" />
              Presets
            </span>
            {PRESET_OPTIONS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => composer.applyPresetToActiveLayout(preset.value)}
                className="rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] text-foreground transition hover:border-primary/60 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {preset.label}
              </button>
            ))}
            <label className="ml-auto inline-flex items-center gap-2 rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-primary"
                checked={composer.activeLayout.allowOverlap}
                onChange={(event) => composer.setAllowOverlap(event.target.checked)}
              />
              Allow overlap
            </label>
          </div>

          <div className="relative min-h-0 flex-1 overflow-auto p-4">
            <div className="mx-auto w-full max-w-[1180px]">
              <div
                ref={canvasRef}
                className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-[#090b14]"
                onPointerDown={() => composer.setSelectedRegionId(null)}
              >
                <div
                  className="pointer-events-none absolute inset-0 opacity-40"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, rgba(140,160,255,0.13) 1px, transparent 1px), linear-gradient(to bottom, rgba(140,160,255,0.13) 1px, transparent 1px)",
                    backgroundSize: `${GRID_STEP_PERCENT}% ${GRID_STEP_PERCENT}%`,
                  }}
                />

                {snapGuides.x !== null ? (
                  <div
                    className="pointer-events-none absolute inset-y-0 z-40 w-px bg-primary/80"
                    style={{ left: `${snapGuides.x}%` }}
                  />
                ) : null}
                {snapGuides.y !== null ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-40 h-px bg-primary/80"
                    style={{ top: `${snapGuides.y}%` }}
                  />
                ) : null}

                {composer.activeLayout.regions.map((region) => {
                  const sourceConfig =
                    SOURCE_OPTIONS.find((item) => item.value === region.source) ?? SOURCE_OPTIONS[0];
                  const Icon = sourceConfig.icon;
                  const isSelected = composer.selectedRegionId === region.id;
                  const isHoveredDrop = hoverDropRegionId === region.id;

                  return (
                    <div
                      key={region.id}
                      className={cn(
                        "group absolute overflow-visible rounded-md border backdrop-blur-sm transition-[left,top,width,height,border-color,box-shadow] duration-150",
                        isSelected
                          ? "z-30 border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.35)]"
                          : "z-20 border-border/90 hover:border-primary/55",
                        isHoveredDrop && "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.35)]",
                        "cursor-move",
                      )}
                      style={{
                        left: `${region.x}%`,
                        top: `${region.y}%`,
                        width: `${region.width}%`,
                        height: `${region.height}%`,
                        backgroundColor: region.backgroundColor,
                        borderRadius: `${region.borderRadius}px`,
                        padding: `${region.padding}px`,
                      }}
                      onPointerDown={(event) => beginInteraction(event, region, "move")}
                      onClick={(event) => {
                        event.stopPropagation();
                        composer.setSelectedRegionId(region.id);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setHoverDropRegionId(region.id);
                      }}
                      onDragLeave={() => {
                        setHoverDropRegionId((current) => (current === region.id ? null : current));
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const dropped = event.dataTransfer.getData("application/x-present-source");
                        if (
                          dropped === "video" ||
                          dropped === "camera-feed" ||
                          dropped === "countdown" ||
                          dropped === "slides"
                        ) {
                          composer.updateRegion(region.id, {
                            source: dropped,
                            ...sourceDefaults(dropped),
                          });
                        }
                        setHoverDropRegionId(null);
                      }}
                    >
                      <div className="absolute left-1.5 top-1.5 z-40 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.13em] text-white">
                        <Icon className="h-3 w-3" />
                        {region.name}
                      </div>

                      <div className="h-full w-full overflow-hidden rounded-[inherit] bg-black/35">
                        <RegionPreviewContent region={region} />
                      </div>

                      {isSelected
                        ? RESIZE_HANDLES.map((handle) => (
                            <button
                              key={handle.kind}
                              type="button"
                              aria-label={`Resize ${handle.kind}`}
                              className={cn(
                                "absolute z-50 h-3 w-3 rounded-full border border-white/90 bg-primary shadow-[0_0_0_1px_rgba(0,0,0,0.4)]",
                                handle.className,
                              )}
                              onPointerDown={(event) => beginInteraction(event, region, handle.kind)}
                            />
                          ))
                        : null}
                    </div>
                  );
                })}

                {composer.mode === "live" ? (
                  <div className="pointer-events-none absolute right-3 top-3 z-50 rounded-md border border-emerald-300/30 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
                    Live
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card/70">
          <div className="border-b border-border px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Region Settings
            </p>
          </div>

          {selectedRegion ? (
            <div className="space-y-3 overflow-auto p-3">
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Region name</label>
                <Input
                  value={selectedRegion.name}
                  className="h-8 text-xs"
                  onChange={(event) => composer.updateRegion(selectedRegion.id, { name: event.target.value })}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Source</label>
                <Select
                  value={selectedRegion.source}
                  onValueChange={(value) =>
                    composer.updateRegion(selectedRegion.id, {
                      source: value as ScreenComposerSource,
                      ...sourceDefaults(value as ScreenComposerSource),
                    })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_OPTIONS.map((source) => (
                      <SelectItem key={source.value} value={source.value}>
                        {source.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedRegion.source === "video" ? (
                <RegionMediaField
                  label="Media"
                  url={selectedRegion.mediaUrl}
                  name={selectedRegion.mediaLabel}
                  onChoose={(item) =>
                    composer.updateRegion(
                      selectedRegion.id,
                      {
                        mediaUrl: item?.url ?? null,
                        mediaType: item?.type ?? null,
                        mediaLabel: item?.name ?? null,
                      },
                      { live: true },
                    )
                  }
                />
              ) : null}

              {selectedRegion.source === "slides" ? (
                <RegionMediaField
                  label="Background behind the slide"
                  url={selectedRegion.backgroundMediaUrl ?? null}
                  name={selectedRegion.backgroundMediaLabel ?? null}
                  onChoose={(item) =>
                    composer.updateRegion(
                      selectedRegion.id,
                      {
                        backgroundMediaUrl: item?.url ?? null,
                        backgroundMediaType: item?.type ?? null,
                        backgroundMediaLabel: item?.name ?? null,
                      },
                      { live: true },
                    )
                  }
                />
              ) : null}

              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Fit mode</label>
                <Select
                  value={selectedRegion.fitMode}
                  onValueChange={(value) =>
                    composer.updateRegion(selectedRegion.id, { fitMode: value as ScreenComposerRegion["fitMode"] })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Fit mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cover">Cover</SelectItem>
                    <SelectItem value="contain">Contain</SelectItem>
                    <SelectItem value="fill">Fill</SelectItem>
                    <SelectItem value="scale-down">Scale down</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="X %"
                  value={selectedRegion.x}
                  onValue={(value) => composer.updateRegion(selectedRegion.id, { x: value })}
                />
                <NumberField
                  label="Y %"
                  value={selectedRegion.y}
                  onValue={(value) => composer.updateRegion(selectedRegion.id, { y: value })}
                />
                <NumberField
                  label="Width %"
                  value={selectedRegion.width}
                  onValue={(value) => composer.updateRegion(selectedRegion.id, { width: value })}
                />
                <NumberField
                  label="Height %"
                  value={selectedRegion.height}
                  onValue={(value) => composer.updateRegion(selectedRegion.id, { height: value })}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Background color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    className="h-8 w-12 cursor-pointer rounded border border-border bg-background"
                    value={hexFromAnyColor(selectedRegion.backgroundColor)}
                    onChange={(event) =>
                      composer.updateRegion(selectedRegion.id, {
                        backgroundColor: event.target.value,
                      })
                    }
                  />
                  <Input
                    value={selectedRegion.backgroundColor}
                    className="h-8 text-xs"
                    onChange={(event) =>
                      composer.updateRegion(selectedRegion.id, {
                        backgroundColor: event.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <RangeField
                label="Padding"
                value={selectedRegion.padding}
                min={0}
                max={40}
                onValue={(value) => composer.updateRegion(selectedRegion.id, { padding: value })}
              />
              <RangeField
                label="Border radius"
                value={selectedRegion.borderRadius}
                min={0}
                max={80}
                onValue={(value) => composer.updateRegion(selectedRegion.id, { borderRadius: value })}
              />

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 flex-1 gap-1.5 text-[11px]"
                  onClick={() => composer.duplicateRegion(selectedRegion.id)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Duplicate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 flex-1 gap-1.5 text-[11px]"
                  disabled={composer.activeLayout.regions.length <= 1}
                  onClick={() => composer.removeRegion(selectedRegion.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
              Select a region to edit source and styling.
            </div>
          )}

          {showProgramPreview ? (
            <div className="border-t border-border p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Program Preview
              </p>
              <ProgramPreview regions={composer.liveLayout.regions} />
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

const NumberField = memo(function NumberField({
  label,
  value,
  disabled,
  onValue,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onValue: (value: number) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-muted-foreground">{label}</label>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        className="h-8 text-xs"
        disabled={disabled}
        step={0.5}
        onChange={(event) => {
          const next = Number.parseFloat(event.target.value);
          if (!Number.isFinite(next)) {
            return;
          }
          onValue(next);
        }}
      />
    </div>
  );
});

const RangeField = memo(function RangeField({
  label,
  value,
  min,
  max,
  disabled,
  onValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onValue: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{Math.round(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        className="h-1.5 w-full accent-primary disabled:cursor-not-allowed"
        onChange={(event) => onValue(Number.parseFloat(event.target.value))}
      />
    </div>
  );
});

function hexFromAnyColor(input: string) {
  if (input.startsWith("#")) {
    if (input.length === 4) {
      const [, r, g, b] = input;
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    return input.slice(0, 7);
  }

  const rgbMatch = input.match(/rgba?\(([^)]+)\)/i);
  if (!rgbMatch) {
    return "#111827";
  }

  const values = rgbMatch[1]
    .split(",")
    .slice(0, 3)
    .map((entry) => clamp(Number.parseInt(entry.trim(), 10), 0, 255));

  if (values.length < 3 || values.some((entry) => Number.isNaN(entry))) {
    return "#111827";
  }

  return `#${values.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
