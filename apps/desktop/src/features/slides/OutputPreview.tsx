"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { cn } from "../../renderer/shared/lib/utils";
import { CanvasSlideLayer } from "../../renderer/shared/components/CanvasSlideLayer";
import { ScriptureTextLayer } from "../../renderer/shared/components/ScriptureTextLayer";
import {
  Camera,
  Image,
  ImageOff,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  Type,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { IoSnow } from "react-icons/io5";
import type {
  MediaFilters,
  MediaItem,
  VideoSettings,
} from "../../features/media/hooks";
import { filtersToCSS } from "../../features/media/hooks";
import type {
  CanvasSizePreset,
  SlideElement,
} from "../../shared/types";
import type { UseTimersResult } from "../../renderer/shared/hooks";
import { getTimerDisplay } from "../../renderer/shared/hooks";
import type {
  OutputTextPosition,
  PropsOverlayItem,
  ScriptureFooterPosition,
  ScriptureTextAlign,
  ScriptureVerticalAlign,
} from "../../shared/types/output-window";
import { syncMirrorVideo } from "../../shared/lib/mirror-video-sync.mjs";
import { youtubeEmbedUrl } from "../../shared/lib/youtube-embed.mjs";
import { CompositorPreviewLayer } from "./components/CompositorPreviewLayer";

interface SlideGroup {
  label: string;
  count: number;
}

export type OutputPreviewTarget = "audience" | "media" | "worship";

const OUTPUT_BASE_WIDTH = 1280;
const OUTPUT_BASE_HEIGHT = 720;

interface OutputPreviewProps {
  text: string | null;
  footer?: string | null;
  slideElements?: SlideElement[] | null;
  canvasSize?: CanvasSizePreset | null;
  backgroundColor?: string | null;
  activeSlideId?: string | null;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  fontFamily?: string;
  fontSize?: number;
  scriptureFontFamily?: string;
  scriptureFontSize?: number;
  scriptureFooterFontSize?: number;
  scriptureFontWeight?: string;
  scriptureTextAlign?: ScriptureTextAlign;
  scriptureVerticalAlign?: ScriptureVerticalAlign;
  scriptureFooterAlign?: ScriptureTextAlign;
  scriptureFooterPosition?: ScriptureFooterPosition;
  groups?: SlideGroup[];
  activeMediaItem: MediaItem | null;
  videoSettings: VideoSettings;
  onVideoSettingsChange: (settings: Partial<VideoSettings>) => void;
  onToggleVideoPlayback: () => void;
  showText: boolean;
  showMedia: boolean;
  hideBackground: boolean;
  textPosition: OutputTextPosition;
  onToggleText: () => void;
  onToggleMedia: () => void;
  onToggleHideBackground: () => void;
  onClearMedia: () => void;
  mediaFilters: MediaFilters;
  onMediaFiltersChange: (filters: Partial<MediaFilters>) => void;
  onResetFilters: () => void;
  isVideoPlaying: boolean;
  videoCurrentTime: number;
  videoTimeSampledAtMs?: number | null;
  isFrozen?: boolean;
  onToggleFreeze?: () => void;
  isTimerLayerEnabled: boolean;
  onToggleTimerLayer: () => void;
  isMessageLayerEnabled: boolean;
  onToggleMessageLayer: () => void;
  propsOverlay: PropsOverlayItem[];
  // Timer state from the shared `useTimers` hook upstream (PresentContainer).
  // OutputPreview reads `activeTimer` for its small preview overlay and
  // forwards the header-bar controls (reset/play/stop) to the hook's
  // mutators.
  timers: UseTimersResult;
  timerLayout: {
    xPercent: number;
    yPercent: number;
    clockFontPx: number;
    nameFontPx: number;
    nameBannerHeightPx: number;
    clockColor: string;
    nameColor: string;
    nameBannerEnabled: boolean;
    nameBannerColor: string;
    titlePosition: "top" | "bottom";
  };
  previewTarget?: OutputPreviewTarget;
  onPreviewTargetChange?: (target: OutputPreviewTarget) => void;
  worshipNextText?: string | null;
  worshipNextFooter?: string | null;
  worshipCurrentLabel?: string | null;
  worshipCurrentRepeat?: string | null;
  worshipCurrentInlineInstruction?: string | null;
  worshipNextLabel?: string | null;
  worshipNextRepeat?: string | null;
  worshipNextInlineInstruction?: string | null;
}

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
        aria-label={`${label} filter`}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
        className="h-1 min-w-0 flex-1 accent-primary"
      />
      <span
        className={cn(
          "w-6 shrink-0 text-right text-[9px]",
          isDefault ? "text-muted-foreground" : "text-primary",
        )}
      >
        {value}
      </span>
    </div>
  );
});

export const OutputPreview = memo(function OutputPreview({
  text,
  footer,
  slideElements,
  canvasSize,
  backgroundColor,
  activeSlideId,
  fontBold,
  fontItalic,
  fontUnderline,
  fontFamily,
  fontSize,
  scriptureFontFamily,
  scriptureFontSize,
  scriptureFooterFontSize,
  scriptureFontWeight = "400",
  scriptureTextAlign = "center",
  scriptureVerticalAlign = "middle",
  scriptureFooterAlign = "center",
  scriptureFooterPosition = "bottom",
  groups = [],
  activeMediaItem,
  videoSettings,
  onVideoSettingsChange,
  onToggleVideoPlayback,
  showText,
  showMedia,
  hideBackground,
  textPosition,
  onToggleText,
  onToggleMedia,
  onToggleHideBackground,
  onClearMedia,
  mediaFilters,
  onMediaFiltersChange,
  onResetFilters,
  isVideoPlaying,
  videoCurrentTime,
  videoTimeSampledAtMs,
  isFrozen,
  onToggleFreeze,
  isTimerLayerEnabled,
  onToggleTimerLayer,
  isMessageLayerEnabled,
  onToggleMessageLayer,
  propsOverlay,
  timers,
  timerLayout,
  previewTarget = "audience",
  onPreviewTargetChange,
  worshipNextText,
  worshipNextFooter,
  worshipCurrentLabel,
  worshipCurrentRepeat,
  worshipCurrentInlineInstruction,
  worshipNextLabel,
  worshipNextRepeat,
  worshipNextInlineInstruction,
}: OutputPreviewProps) {
  // Pull the bits of the timers hook the preview's header controls need.
  const {
    timers: timerItems,
    activeTimer,
    resetTimer,
    toggleTimerPlayback,
    stopAllTimers,
    adjustTimerSeconds,
  } = timers;
  const activeTimerId = activeTimer?.id ?? null;
  const videoRef = useRef<HTMLVideoElement>(null);

  const outputFrameRef = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [previewScale, setPreviewScale] = useState(0.35);

  const isScriptureSlide = activeSlideId?.startsWith("scripture:") ?? false;
  const shouldUseScriptureTextLayer =
    isScriptureSlide && (slideElements?.length ?? 0) === 0;
  const hasLibrarySlideLayer = Boolean(text || (slideElements?.length ?? 0) > 0);
  const hasHiddenTextLayerContent = Boolean(text) && !showText;
  const isMediaPreview = previewTarget === "media";
  const isWorshipPreview = previewTarget === "worship";
  const isAudienceLikePreview = previewTarget === "audience" || isWorshipPreview;
  const worshipPreviewText = appendInlineInstruction(
    text,
    worshipCurrentInlineInstruction,
  );
  const worshipPreviewElements = useMemo(
    () =>
      appendInlineInstructionToElements(
        slideElements ?? null,
        worshipCurrentInlineInstruction,
      ),
    [slideElements, worshipCurrentInlineInstruction],
  );
  const previewTitle =
    previewTarget === "media"
      ? "Media Stage Preview"
      : previewTarget === "worship"
        ? "Worship Stage Preview"
        : "Audience Preview";
  const libraryStyle = useMemo(
    () => ({
      fontFamily: fontFamily ?? "Inter",
      fontSize: fontSize ?? 72,
      fontBold,
      fontItalic,
      fontUnderline,
    }),
    [fontBold, fontFamily, fontItalic, fontSize, fontUnderline],
  );

  // Timer label/text are derived from the shared `useTimers` hook. Local
  // aliases preserve the existing JSX read sites in the preview thumbnail.
  const timerLabelForOutput = activeTimer?.name ?? "Timer Name";
  const timerTextForOutput = activeTimer
    ? getTimerDisplay(activeTimer)
    : "00:00:00";
  const previewTextPositionStyle = useMemo(
    () => ({
      left: `${textPosition.xPercent}%`,
      top: `${textPosition.yPercent}%`,
      width: `${textPosition.widthPercent}%`,
      height: `${textPosition.heightPercent}%`,
      transform: "translate(-50%, -50%)",
    }),
    [
      textPosition.heightPercent,
      textPosition.widthPercent,
      textPosition.xPercent,
      textPosition.yPercent,
    ]
  );

  useEffect(() => {
    const frame = outputFrameRef.current;
    if (!frame) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const relativeScale = Math.min(
        entry.contentRect.width / OUTPUT_BASE_WIDTH,
        entry.contentRect.height / OUTPUT_BASE_HEIGHT,
        1
      );
      const nextScale = Math.pow(Math.max(relativeScale, 0), 0.82);
      setPreviewScale(Math.max(nextScale, 0.28));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // The previous `onOutputReady` + `timer-update` broadcast effects lived
  // here. Both moved to PresentContainer alongside the `useTimers` hook so
  // the audience output and the new sidebar-rail Timer panel share state.

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.loop = videoSettings.loop;
    }
  }, [videoSettings]);

  useEffect(() => {
    if (videoRef.current && activeMediaItem?.type === "video") {
      if (isVideoPlaying) {
        videoRef.current.play().catch(() => {
          // Autoplay may be blocked in development.
        });
      } else {
        videoRef.current.pause();
      }
    }
  }, [isVideoPlaying, activeMediaItem, showMedia]);

  useEffect(() => {
    if (videoRef.current && activeMediaItem?.type === "video") {
      syncMirrorVideo(videoRef.current, {
        positionSeconds: videoCurrentTime,
        sampledAtMs: videoTimeSampledAtMs,
        playing: isVideoPlaying,
      });
      // A mirror WebKit paused while the window was hidden runs again.
      if (isVideoPlaying && videoRef.current.paused) {
        videoRef.current.play().catch((): void => undefined);
      }
    }
  }, [videoCurrentTime, videoTimeSampledAtMs, isVideoPlaying, activeMediaItem, showMedia]);


  const filterStyle = filtersToCSS(mediaFilters);
  const previewTextScale = useMemo(
    () => Math.min(Math.max(previewScale * 0.45, 0.1), 0.22),
    [previewScale],
  );
  const scripturePreviewFontSize = useMemo(
    () =>
      Math.max(
        10,
        Math.round((scriptureFontSize ?? 96) * previewTextScale),
      ),
    [previewTextScale, scriptureFontSize]
  );
  const scripturePreviewFooterFontSize = useMemo(
    () =>
      Math.max(
        8,
        Math.round(
          (scriptureFooterFontSize ?? Math.max(16, Math.round((scriptureFontSize ?? 96) * 0.28)))
          * previewTextScale
        ),
      ),
    [previewTextScale, scriptureFooterFontSize, scriptureFontSize]
  );
  const safeVideoVolume = Number.isFinite(videoSettings.volume)
    ? videoSettings.volume
    : 1;

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            activeMediaItem || text
              ? isFrozen
                ? "bg-sky-400 shadow-[0_0_6px] shadow-sky-400/60"
                : "bg-green-500 shadow-[0_0_6px] shadow-green-500/60"
              : "bg-muted-foreground/40"
          )}
        />
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {previewTitle}
        </p>
        {isFrozen && (
          <span className="rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-400">
            Frozen
          </span>
        )}
      </div>

      <div className="shrink-0">
        <div className="flex items-stretch gap-2">
          {/* TV Outer Box */}
          <div 
            className="flex-1 min-w-0 flex items-center justify-center rounded-md bg-secondary/10 p-1 border border-border/40"
            style={{ containerType: "size" }}
          >
            <div
              ref={outputFrameRef}
              className="relative overflow-hidden rounded-sm border border-border/60 bg-black shadow-lg ring-1 ring-black/5"
              style={{
                width: "min(100cqw, 100cqh * 16 / 9)",
                height: "min(100cqh, 100cqw * 9 / 16)",
              }}
            >
            {/* What the audience sees, drawn by the compositor from FFmpeg
                frames. There is no second player here: the media used to be
                played by the browser engine in this panel, which meant a file
                it could not open was black to the operator however well it
                played to the congregation, and a video on screen was decoded
                twice on one machine. (The scan that counts audible players
                reads comments too, so this one says it in words.) */}
            <CompositorPreviewLayer className="absolute inset-0 z-20" />

            {previewTarget === "media" ? (
              <MediaStagePreview
                currentText={text}
                currentFooter={footer}
                currentLabel={worshipCurrentLabel}
                currentRepeat={worshipCurrentRepeat}
                nextText={worshipNextText}
                nextFooter={worshipNextFooter}
                nextLabel={worshipNextLabel}
                nextRepeat={worshipNextRepeat}
                timerLabel={timerLabelForOutput}
                timerText={timerTextForOutput}
              />
            ) : null}

            {isAudienceLikePreview ? (
              <>
            {isWorshipPreview &&
            (worshipCurrentLabel || worshipCurrentRepeat) ? (
              <div className="absolute left-3 top-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-200 drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]">
                {worshipCurrentLabel ? <span>[{worshipCurrentLabel}]</span> : null}
                {worshipCurrentRepeat ? <span>[{worshipCurrentRepeat}]</span> : null}
              </div>
            ) : null}

            {!hideBackground && backgroundColor ? (
              <div
                className="absolute inset-0"
                style={{ backgroundColor }}
              />
            ) : null}

            {showText &&
              (shouldUseScriptureTextLayer
                ? Boolean(text)
                : hasLibrarySlideLayer) && (
              <div
                className="absolute z-10 overflow-hidden"
                style={previewTextPositionStyle}
              >
                {shouldUseScriptureTextLayer ? (
                  <ScriptureTextLayer
                  key={[
                    text ?? "",
                    footer ?? "",
                    scriptureFontFamily || fontFamily || "Inter",
                    scriptureFontWeight,
                    scriptureTextAlign,
                    scriptureVerticalAlign,
                    scriptureFooterAlign,
                    scriptureFooterPosition,
                    Math.round(scripturePreviewFontSize),
                    Math.round(scripturePreviewFooterFontSize),
                  ].join("|")}
                  text={isWorshipPreview ? worshipPreviewText : text}
                  footer={footer}
                  fontFamily={scriptureFontFamily || fontFamily || "Inter"}
                  fontSize={scripturePreviewFontSize}
                  fontWeight={scriptureFontWeight}
                  footerFontSize={scripturePreviewFooterFontSize}
                  footerFontFamily={scriptureFontFamily || fontFamily || "Inter"}
                  footerFontWeight={scriptureFontWeight}
                  textAlign={scriptureTextAlign}
                  verticalAlign={scriptureVerticalAlign}
                  footerAlign={scriptureFooterAlign}
                  footerPosition={scriptureFooterPosition}
                  maxFontSize={scripturePreviewFontSize}
                  minScale={0.3}
                  fitScale={1}
                  containerClassName="absolute inset-0 flex flex-col p-4"
                  bodyClassName="min-h-0 w-full flex-1"
                  textClassName="pointer-events-none select-none leading-relaxed text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                  footerClassName="mt-2 uppercase tracking-wide text-white/90 drop-shadow-md"
                />
                ) : (
                  <CanvasSlideLayer
                    text={isWorshipPreview ? worshipPreviewText : text}
                    elements={isWorshipPreview ? worshipPreviewElements : slideElements}
                    canvasSize={canvasSize}
                    libraryStyle={libraryStyle}
                    className="absolute inset-0"
                  />
                )}
              </div>
            )}

            {/*
              The timer is not drawn here. It arrives already composited, in
              the frame this preview is showing — the same picture the audience
              sees, drawn once by `compositor::overlays::draw_timer`, name
              banner and all. Drawing a second one over it put two timers on
              the preview at different sizes, and the one drawn here was the
              older design.
            */}

            {/*
              Nor is the message banner, or an image or text prop: they are in
              the compositor's frame too, message and all. A second message
              drawn here, on a banner not quite opaque, left the real one
              showing through it as a faint copy at another size, and it
              scrolled at its own pace.
            */}
            <PreviewPropsOverlay items={propsOverlay} />

            {hasHiddenTextLayerContent &&
              !activeMediaItem &&
              !isTimerLayerEnabled &&
              propsOverlay.length === 0 && (
              <div className="absolute inset-0 z-0 flex h-full items-center justify-center">
                <p className="text-xs text-zinc-500">Text layer is hidden</p>
              </div>
            )}

            {!text &&
              !activeMediaItem &&
              !isTimerLayerEnabled &&
              propsOverlay.length === 0 &&
              !hasHiddenTextLayerContent && (
              <div className="absolute inset-0 z-0 flex h-full items-center justify-center">
                <p className="text-xs text-zinc-600">No content</p>
              </div>
              )}
              </>
            ) : null}

            </div>
          </div>

          {/* Slim layer toolbar: clear action up top, layer toggles below.
              Compact, consistent icon buttons with a subtle active chip. */}
          <div className="flex w-10 shrink-0 flex-col items-center gap-0.5 py-0.5 pr-1.5">
            <button
              type="button"
              onClick={() => {
                if (showText) {
                  onToggleText();
                }
                onClearMedia();
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground focus:outline-none focus-visible:outline-none"
              title="Clear text and media"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="my-0.5 h-px w-5 bg-border/60" />

            <button
              type="button"
              onClick={onToggleText}
              aria-pressed={showText}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus-visible:outline-none",
                showText
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              title={showText ? "Hide text layer" : "Show text layer"}
            >
              <Type className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onToggleMessageLayer}
              aria-pressed={isMessageLayerEnabled}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus-visible:outline-none",
                isMessageLayerEnabled
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              title={
                isMessageLayerEnabled
                  ? "Hide message layer"
                  : "Show message layer"
              }
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onToggleMedia}
              aria-pressed={showMedia && Boolean(activeMediaItem)}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus-visible:outline-none",
                showMedia && activeMediaItem
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              title={showMedia ? "Hide media layer" : "Show media layer"}
            >
              <Image className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onToggleHideBackground}
              aria-pressed={hideBackground}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus-visible:outline-none",
                hideBackground
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              title={hideBackground ? "Show background layer" : "Hide background layer"}
            >
              <ImageOff className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowFilters((previous) => !previous)}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus-visible:outline-none",
                showFilters
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              title="Media filters"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            {onToggleFreeze && (
              <button
                type="button"
                onClick={onToggleFreeze}
                aria-pressed={isFrozen}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus-visible:outline-none",
                  isFrozen
                    ? "bg-sky-400/15 text-sky-400"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
                title={
                  isFrozen ? "Unfreeze main output" : "Freeze main output"
                }
              >
                <IoSnow className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex shrink-0 items-center px-3">
        <select
          value={previewTarget}
          onChange={(event) =>
            onPreviewTargetChange?.(
              event.target.value as OutputPreviewTarget,
            )
          }
          className="h-7 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          title="Change preview screen"
          aria-label="Preview screen"
        >
          <option value="audience">Audience</option>
          <option value="media">Media</option>
          <option value="worship">Worship</option>
        </select>
      </div>

      {showFilters && (
        <div className="mx-3 mt-2 shrink-0 space-y-1.5 rounded-lg border border-border bg-card/50 p-2">
          {activeMediaItem ? (
            <>
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
                onChange={(value) =>
                  onMediaFiltersChange({ brightness: value })
                }
              />
              <FilterSlider
                label="Contrast"
                value={mediaFilters.contrast}
                min={0}
                max={200}
                defaultValue={100}
                onChange={(value) => onMediaFiltersChange({ contrast: value })}
              />
              <FilterSlider
                label="Saturate"
                value={mediaFilters.saturation}
                min={0}
                max={200}
                defaultValue={100}
                onChange={(value) =>
                  onMediaFiltersChange({ saturation: value })
                }
              />
              <FilterSlider
                label="Blur"
                value={mediaFilters.blur}
                min={0}
                max={20}
                defaultValue={0}
                onChange={(value) => onMediaFiltersChange({ blur: value })}
              />
              <FilterSlider
                label="Gray"
                value={mediaFilters.grayscale}
                min={0}
                max={100}
                defaultValue={0}
                onChange={(value) => onMediaFiltersChange({ grayscale: value })}
              />
              <FilterSlider
                label="Sepia"
                value={mediaFilters.sepia}
                min={0}
                max={100}
                defaultValue={0}
                onChange={(value) => onMediaFiltersChange({ sepia: value })}
              />
              <FilterSlider
                label="Hue"
                value={mediaFilters.hueRotate}
                min={0}
                max={360}
                defaultValue={0}
                onChange={(value) => onMediaFiltersChange({ hueRotate: value })}
              />
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Select media to edit brightness and other filters.
            </p>
          )}
        </div>
      )}

      {activeMediaItem && (
        <div className="mt-2 shrink-0 px-3">
          <p className="truncate text-center text-[10px] text-muted-foreground">
            {activeMediaItem.name}
          </p>
        </div>
      )}

      {!isScriptureSlide && (
        <div className="mt-4 px-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Groups
          </p>
          <div className="space-y-1">
            {groups.length > 0 ? (
              groups.map((group, index) => (
                <div
                  key={`${group.label}-${index}`}
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
      )}

      <div className="mt-4 flex-1 border-t border-border px-3 py-3">
        {/* Transport bar — a clean control surface for the active video or
            timer. Borderless ghost buttons around a single filled play. */}
        <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
          {activeMediaItem?.type === "video" ? (
            <div className="mb-3 flex items-center gap-2">
              <Volume2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                key="video-volume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={safeVideoVolume}
                onChange={(event) =>
                  onVideoSettingsChange({
                    volume: Number.parseFloat(event.target.value),
                  })
                }
                className="h-1 w-full cursor-pointer accent-primary"
                aria-label="Video volume"
                title={`Volume: ${Math.round(safeVideoVolume * 100)}%`}
              />
              <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                {Math.round(safeVideoVolume * 100)}%
              </span>
            </div>
          ) : (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {activeTimer?.name ?? "Timer"}
              </span>
              <span className="ml-auto text-xs font-semibold tabular-nums text-foreground">
                {timerTextForOutput}
              </span>
            </div>
          )}

          {/* 3-column grid keeps the play/pause button dead-center while
              auxiliary controls balance on each side. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
            {/* Left cluster (right-aligned toward the play button) */}
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={stopAllTimers}
                disabled={timerItems.every((timer) => !timer.isRunning)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-background hover:text-foreground disabled:opacity-30"
                title="Stop all timers"
              >
                <Square className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activeMediaItem?.type === "video") {
                    onVideoSettingsChange({ loop: !videoSettings.loop });
                    return;
                  }
                  if (activeTimerId) {
                    resetTimer(activeTimerId);
                  }
                }}
                disabled={
                  activeMediaItem?.type === "video" ? false : !activeTimerId
                }
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-30",
                  activeMediaItem?.type === "video" && videoSettings.loop
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-background hover:text-foreground"
                )}
                title={
                  activeMediaItem?.type === "video"
                    ? videoSettings.loop
                      ? "Disable video loop"
                      : "Enable video loop"
                    : "Reset timer"
                }
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activeTimerId) {
                    adjustTimerSeconds(activeTimerId, -15);
                  }
                }}
                disabled={!activeTimerId}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-background hover:text-foreground disabled:opacity-30"
                title="Rewind 15s"
              >
                <SkipBack className="h-4 w-4" />
              </button>
            </div>

            {/* Center: primary play / pause */}
            <button
              type="button"
              onClick={() => {
                if (activeMediaItem?.type === "video") {
                  onToggleVideoPlayback();
                  return;
                }
                if (activeTimerId) {
                  toggleTimerPlayback(activeTimerId);
                }
              }}
              disabled={activeMediaItem?.type === "video" ? false : !activeTimer}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-30"
              title={
                activeMediaItem?.type === "video"
                  ? isVideoPlaying
                    ? "Pause video"
                    : "Play video"
                  : activeTimer?.isRunning
                    ? "Pause timer"
                    : "Play timer"
              }
            >
              {activeMediaItem?.type === "video" ? (
                isVideoPlaying ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5 translate-x-px" />
                )
              ) : activeTimer?.isRunning ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5 translate-x-px" />
              )}
            </button>

            {/* Right cluster (left-aligned away from the play button) */}
            <div className="flex items-center justify-start gap-1">
              <button
                type="button"
                onClick={() => {
                  if (activeTimerId) {
                    adjustTimerSeconds(activeTimerId, 15);
                  }
                }}
                disabled={!activeTimerId}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-background hover:text-foreground disabled:opacity-30"
                title="Forward 15s"
              >
                <SkipForward className="h-4 w-4" />
              </button>
              {activeMediaItem?.type === "video" ? (
                <button
                  type="button"
                  onClick={() =>
                    onVideoSettingsChange({ muted: !videoSettings.muted })
                  }
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-lg transition",
                    videoSettings.muted
                      ? "bg-destructive/15 text-destructive"
                      : "text-muted-foreground hover:bg-background hover:text-foreground"
                  )}
                  title={videoSettings.muted ? "Unmute video" : "Mute video"}
                >
                  {videoSettings.muted ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

function MediaStagePreview({
  currentText,
  currentFooter,
  currentLabel,
  currentRepeat,
  nextText,
  nextFooter,
  nextLabel,
  nextRepeat,
  timerLabel,
  timerText,
}: {
  currentText: string | null;
  currentFooter?: string | null;
  currentLabel?: string | null;
  currentRepeat?: string | null;
  nextText?: string | null;
  nextFooter?: string | null;
  nextLabel?: string | null;
  nextRepeat?: string | null;
  timerLabel: string;
  timerText: string;
}) {
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }),
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockText(
        new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className="absolute inset-0 grid grid-rows-[minmax(0,1fr)_22%] gap-2 bg-black p-3 text-white">
      <div className="grid min-h-0 grid-cols-2 gap-2">
        <MediaStageCard
          title="Current"
          text={currentText}
          footer={currentFooter}
          sectionLabel={currentLabel}
          repeat={currentRepeat}
          tone="current"
        />
        <MediaStageCard
          title="Next"
          text={nextText}
          footer={nextFooter}
          sectionLabel={nextLabel}
          repeat={nextRepeat}
          tone="next"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col justify-center rounded border border-zinc-600/70 bg-zinc-950 px-3">
          <p className="truncate text-[9px] uppercase tracking-[0.14em] text-zinc-500">
            {timerLabel}
          </p>
          <p className="truncate text-2xl font-semibold tabular-nums text-red-400">
            {timerText}
          </p>
        </div>
        <div className="flex min-w-0 flex-col justify-center rounded border border-zinc-600/70 bg-zinc-950 px-3">
          <p className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">
            Clock
          </p>
          <p className="truncate text-2xl font-semibold tabular-nums text-zinc-100">
            {clockText}
          </p>
        </div>
      </div>
    </div>
  );
}

function MediaStageCard({
  title,
  text,
  footer,
  sectionLabel,
  repeat,
  tone,
}: {
  title: string;
  text?: string | null;
  footer?: string | null;
  sectionLabel?: string | null;
  repeat?: string | null;
  tone: "current" | "next";
}) {
  return (
    <div
      className={cn(
        "relative min-h-0 overflow-hidden rounded border bg-zinc-950 p-3",
        tone === "next" ? "border-amber-300/70" : "border-zinc-500/80",
      )}
    >
      {(sectionLabel || repeat) ? (
        <div
          className={cn(
            "mb-2 flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em]",
            tone === "next" ? "text-amber-200" : "text-sky-200",
          )}
        >
          {sectionLabel ? <span>[{sectionLabel}]</span> : null}
          {repeat ? <span>[{repeat}]</span> : null}
        </div>
      ) : null}
      <p
        className={cn(
          "line-clamp-5 text-xl font-semibold leading-tight",
          tone === "next" ? "text-amber-300" : "text-zinc-50",
        )}
      >
        {text?.trim() || "No slide selected"}
      </p>
      {footer ? (
        <p className="mt-2 truncate text-[10px] uppercase tracking-wide text-zinc-400">
          {footer}
        </p>
      ) : null}
      <p className="absolute bottom-2 right-3 text-[9px] uppercase tracking-[0.16em] text-zinc-500">
        {title}
      </p>
    </div>
  );
}

function appendInlineInstruction(
  text: string | null,
  instruction: string | null | undefined,
): string {
  const cleanInstruction = instruction?.trim();
  if (!cleanInstruction) {
    return text ?? "";
  }
  const marker = `[${cleanInstruction}]`;
  const lines = (text ?? "").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.trim()) {
      if (lines[index]?.includes(marker)) {
        return lines.join("\n");
      }
      lines[index] = `${lines[index]} ${marker}`;
      return lines.join("\n");
    }
  }
  return marker;
}

function appendInlineInstructionToElements(
  elements: SlideElement[] | null,
  instruction: string | null | undefined,
): SlideElement[] | null {
  const cleanInstruction = instruction?.trim();
  if (!elements || !cleanInstruction) {
    return elements;
  }
  const marker = `[${cleanInstruction}]`;
  let hasApplied = false;

  return elements.map((element) => {
    if (hasApplied || element.type !== "text" || element.isPlaceholder) {
      return element;
    }

    const content = element.content ?? "";
    if (!content.trim()) {
      return element;
    }

    hasApplied = true;
    return {
      ...element,
      content: content.includes(marker) ? content : `${content} ${marker}`,
    };
  });
}

function PreviewPropsOverlay({ items }: { items: PropsOverlayItem[] }) {
  if (items.length === 0) return null;

  return (
    <>
      {items.map((item) => {
        const style: CSSProperties = {
          ...getPreviewPropSlotStyle(item.position, item.sizePercent),
          opacity: item.opacity,
        };

        // Images and text are drawn by the compositor, into the frame under
        // this (`overlays::is_composited`). Only what it leaves to the
        // webview is drawn here.
        if (item.kind === "video" && item.mediaUrl) {
          return (
            <video
              key={item.id}
              aria-label="Video prop preview"
              src={item.mediaUrl}
              className="pointer-events-none absolute z-30 h-auto object-contain"
              style={style}
              autoPlay
              loop
              muted
              playsInline
            />
          );
        }

        if (item.kind === "youtube" && item.youtubeUrl) {
          return (
            <PreviewYouTubeLayer
              key={item.id}
              youtubeUrl={item.youtubeUrl}
              shownAtMs={item.shownAtMs}
              style={style}
            />
          );
        }

        if (item.kind === "ndi" && item.ndiSourceName) {
          return (
            <PreviewNdiLayer
              key={item.id}
              sourceName={item.ndiSourceName}
              style={style}
            />
          );
        }

        if (item.kind === "capture") {
          return (
            <PreviewCaptureLayer
              key={item.id}
              deviceId={item.captureDeviceId}
              deviceLabel={item.captureDeviceLabel}
              style={style}
            />
          );
        }

        return null;
      })}
    </>
  );
}

function PreviewNdiLayer({
  sourceName,
  style,
}: {
  sourceName: string;
  style: CSSProperties;
}) {
  const [frameTick, setFrameTick] = useState(0);
  const [clientId] = useState(
    () => `preview-${Math.random().toString(36).slice(2)}`,
  );
  const encodedSourceName = encodeURIComponent(sourceName);

  useEffect(() => {
    if (!window.electronAPI?.startNdiInput || !window.electronAPI?.stopNdiInput) {
      return undefined;
    }

    let cancelled = false;
    void window.electronAPI
      .startNdiInput(sourceName, undefined, clientId)
      .then((result) => {
        if (!cancelled && !result.ok && result.error) {
          console.error("[NDI Preview] failed to start input", result.error);
        }
      });

    const interval = window.setInterval(() => {
      setFrameTick(Date.now());
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void window.electronAPI.stopNdiInput(clientId);
    };
  }, [clientId, sourceName]);

  return (
    <img
      src={`ndi-frame://frame/${encodedSourceName}?t=${frameTick}`}
      alt=""
      className="pointer-events-none absolute z-30 h-auto object-contain"
      style={style}
    />
  );
}

function PreviewCaptureLayer({
  deviceId,
  deviceLabel,
  style,
}: {
  deviceId?: string;
  deviceLabel?: string;
  style: CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    const stopStream = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const getCaptureStream = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Video capture is not available.");
      }
      if (!deviceId && !deviceLabel) {
        throw new Error("Select an HDMI/capture input.");
      }

      const baseConstraints: MediaTrackConstraints = {
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 15, max: 15 },
      };

      if (deviceId) {
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: {
              ...baseConstraints,
              deviceId: { exact: deviceId },
            },
            audio: false,
          });
        } catch (initialError) {
          if (!deviceLabel || !navigator.mediaDevices.enumerateDevices) {
            throw initialError;
          }
        }
      }

      if (deviceLabel && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const matchedDevice = devices.find(
          (device) =>
            device.kind === "videoinput" &&
            device.label.trim() === deviceLabel.trim(),
        );
        if (matchedDevice?.deviceId) {
          return await navigator.mediaDevices.getUserMedia({
            video: {
              ...baseConstraints,
              deviceId: { exact: matchedDevice.deviceId },
            },
            audio: false,
          });
        }
      }

      throw new Error("Selected capture input was not found.");
    };

    void getCaptureStream()
      .then((nextStream) => {
        if (cancelled) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = nextStream;
        setError(null);
        if (videoRef.current) {
          videoRef.current.srcObject = nextStream;
          void videoRef.current.play().catch(() => {
            // Preview playback can reject while the panel is resizing.
          });
        }
      })
      .catch((captureError: unknown) => {
        if (cancelled) return;
        setError(
          captureError instanceof Error
            ? captureError.message
            : "Could not start capture input.",
        );
      });

    return () => {
      cancelled = true;
      stopStream();
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [deviceId, deviceLabel]);

  if (error) {
    return (
      <div
        className="pointer-events-none absolute z-30 flex items-center justify-center rounded-sm border border-white/20 bg-black/75 px-2 py-1 text-center text-[9px] font-medium text-white"
        style={style}
      >
        <span className="flex items-center gap-1">
          <Camera className="h-3 w-3 text-white/70" strokeWidth={1.6} />
          {deviceLabel || "HDMI capture"}
        </span>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      className="pointer-events-none absolute z-30 h-auto bg-black object-contain"
      style={style}
      aria-label="HDMI capture preview"
      autoPlay
      muted
      playsInline
    >
      <track kind="captions" />
    </video>
  );
}

function PreviewYouTubeLayer({
  youtubeUrl,
  shownAtMs,
  style,
}: {
  youtubeUrl: string;
  shownAtMs?: number;
  style: CSSProperties;
}) {
  const src = useMemo(
    () =>
      youtubeEmbedUrl(youtubeUrl, {
        startSeconds: getElapsedSeconds(shownAtMs),
        controls: true,
      }),
    [shownAtMs, youtubeUrl],
  );

  if (!src) return null;

  // See `OutputWindow`: `<webview>` is Electron's, and renders nothing here.
  return (
    <iframe
      src={src}
      title="YouTube"
      className="absolute z-30 border-0 bg-black"
      style={{ ...style, aspectRatio: "16 / 9" }}
      allow="autoplay; encrypted-media; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

function getElapsedSeconds(startedAtMs?: number): number {
  if (!startedAtMs || !Number.isFinite(startedAtMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
}

function getPreviewPropSlotStyle(
  position: PropsOverlayItem["position"],
  sizePercent: number,
): CSSProperties {
  const width = `${Math.max(5, Math.min(100, sizePercent))}%`;
  const inset = "3%";
  switch (position) {
    case "top-left":
      return { top: inset, left: inset, width };
    case "top-right":
      return { top: inset, right: inset, width };
    case "bottom-left":
      return { bottom: inset, left: inset, width };
    case "bottom-right":
      return { bottom: inset, right: inset, width };
    case "center":
      return {
        top: "50%",
        left: "50%",
        width,
        transform: "translate(-50%, -50%)",
      };
    case "full":
    default:
      return { inset: 0 };
  }
}
