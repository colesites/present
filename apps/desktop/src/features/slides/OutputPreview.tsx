"use client";

import {
  createElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import { cn } from "../../renderer/shared/lib/utils";
import { CanvasSlideLayer } from "../../renderer/shared/components/CanvasSlideLayer";
import { ScriptureTextLayer } from "../../renderer/shared/components/ScriptureTextLayer";
import {
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
  MessageOverlay,
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

interface SlideGroup {
  label: string;
  count: number;
}

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
  isFrozen?: boolean;
  onToggleFreeze?: () => void;
  isTimerLayerEnabled: boolean;
  onToggleTimerLayer: () => void;
  isMessageLayerEnabled: boolean;
  onToggleMessageLayer: () => void;
  activeMessageOverlay: MessageOverlay | null;
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
    clockColor: string;
    nameColor: string;
    nameBannerEnabled: boolean;
    nameBannerColor: string;
    titlePosition: "top" | "bottom";
  };
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

function getPreviewMessageThemeStyle(themeKey: string): React.CSSProperties {
  switch (themeKey) {
    case "info":
      return { backgroundColor: "rgba(37, 99, 235, 0.94)", color: "#ffffff" };
    case "warning":
      return { backgroundColor: "rgba(245, 158, 11, 0.96)", color: "#111827" };
    case "danger":
      return { backgroundColor: "rgba(220, 38, 38, 0.96)", color: "#ffffff" };
    case "transparent":
      return {
        backgroundColor: "rgba(0, 0, 0, 0.34)",
        color: "#ffffff",
        backdropFilter: "blur(2px)",
      };
    default:
      return { backgroundColor: "rgba(31, 32, 48, 0.94)", color: "#ffffff" };
  }
}

function PreviewMessageOverlay({ overlay }: { overlay: MessageOverlay }) {
  if (!overlay.text.trim()) return null;

  const isMarquee =
    overlay.animation === "marquee-left" ||
    overlay.animation === "marquee-right";
  const positionClass = overlay.position === "top" ? "top-0" : "bottom-0";
  const direction =
    overlay.animation === "marquee-right"
      ? "previewMarqueeRight"
      : "previewMarqueeLeft";

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 z-30 overflow-hidden px-3 py-1.5",
        positionClass,
      )}
      style={getPreviewMessageThemeStyle(overlay.themeKey)}
    >
      {isMarquee ? (
        <>
          <style>
            {`
              @keyframes previewMarqueeLeft {
                0% { transform: translateX(100%); }
                100% { transform: translateX(-100%); }
              }
              @keyframes previewMarqueeRight {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
              }
            `}
          </style>
          <span
            className="block whitespace-nowrap font-semibold leading-tight"
            style={{
              fontSize: `${11 * (overlay.fontScale ?? 1)}px`,
              animation: `${direction} ${Math.max(
                2,
                overlay.speedSeconds,
              )}s linear infinite`,
              willChange: "transform",
            }}
          >
            {overlay.text}
          </span>
        </>
      ) : (
        <span
          className="block text-center font-semibold leading-tight"
          style={{ fontSize: `${11 * (overlay.fontScale ?? 1)}px` }}
        >
          {overlay.text}
        </span>
      )}
    </div>
  );
}


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
  isFrozen,
  onToggleFreeze,
  isTimerLayerEnabled,
  onToggleTimerLayer,
  isMessageLayerEnabled,
  onToggleMessageLayer,
  activeMessageOverlay,
  propsOverlay,
  timers,
  timerLayout,
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
  const timerClockFontPx = useMemo(
    () =>
      Math.max(
        6,
        Math.round(
          Math.min(Math.max(timerLayout.clockFontPx, 12), 400) * previewScale
        )
      ),
    [timerLayout.clockFontPx, previewScale]
  );
  const timerTitleFontPx = useMemo(
    () =>
      Math.max(
        5,
        Math.round(
          Math.min(Math.max(timerLayout.nameFontPx, 8), 220) * previewScale
        )
      ),
    [timerLayout.nameFontPx, previewScale]
  );
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
      if (Math.abs(videoRef.current.currentTime - videoCurrentTime) > 0.5) {
        videoRef.current.currentTime = videoCurrentTime;
      }
    }
  }, [videoCurrentTime, activeMediaItem, showMedia]);


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
          Main Output
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
            {!hideBackground &&
              showMedia &&
              activeMediaItem &&
              (activeMediaItem.type === "image" ? (
                <img
                  src={activeMediaItem.url}
                  alt={activeMediaItem.name}
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ filter: filterStyle }}
                />
              ) : (
                <video
                  aria-label={`${activeMediaItem.name} preview`}
                  ref={videoRef}
                  src={activeMediaItem.url}
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ filter: filterStyle }}
                  loop={videoSettings.loop}
                  muted
                  playsInline
                />
              ))}

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
                  text={text}
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
                    text={text}
                    elements={slideElements}
                    canvasSize={canvasSize}
                    libraryStyle={libraryStyle}
                    className="absolute inset-0"
                  />
                )}
              </div>
            )}

            {isTimerLayerEnabled &&
            timerLabelForOutput &&
            timerLayout.nameBannerEnabled ? (
              <div
                style={{
                  fontSize: `${timerTitleFontPx}px`,
                  color: timerLayout.nameColor,
                  backgroundColor: timerLayout.nameBannerColor,
                }}
                className="absolute inset-x-0 top-0 z-20 px-2 py-1 text-center font-medium uppercase tracking-wider"
              >
                {timerLabelForOutput}
              </div>
            ) : null}

            {isTimerLayerEnabled && timerTextForOutput && (
              <div
                style={{
                  left: `${timerLayout.xPercent}%`,
                  top: `${timerLayout.yPercent}%`,
                  transform: "translate(-50%, -50%)",
                }}
                className="absolute z-20 box-border rounded-md bg-black/65 px-2 py-0 text-[9px] font-semibold tracking-wide text-white"
              >
                {timerLabelForOutput &&
                !timerLayout.nameBannerEnabled &&
                timerLayout.titlePosition === "top" ? (
                  <div
                    style={{
                      fontSize: `${timerTitleFontPx}px`,
                      color: timerLayout.nameColor,
                    }}
                    className="whitespace-nowrap overflow-hidden text-ellipsis font-medium uppercase tracking-wider"
                  >
                    {timerLabelForOutput}
                  </div>
                ) : null}
                <div
                  style={{
                    fontSize: `${timerClockFontPx}px`,
                    color: timerLayout.clockColor,
                  }}
                >
                  {timerTextForOutput}
                </div>
                {timerLabelForOutput &&
                !timerLayout.nameBannerEnabled &&
                timerLayout.titlePosition !== "top" ? (
                  <div
                    style={{
                      fontSize: `${timerTitleFontPx}px`,
                      color: timerLayout.nameColor,
                    }}
                    className="whitespace-nowrap overflow-hidden text-ellipsis font-medium uppercase tracking-wider"
                  >
                    {timerLabelForOutput}
                  </div>
                ) : null}
              </div>
            )}

            {activeMessageOverlay ? (
              <PreviewMessageOverlay overlay={activeMessageOverlay} />
            ) : null}

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

function PreviewPropsOverlay({ items }: { items: PropsOverlayItem[] }) {
  if (items.length === 0) return null;

  return (
    <>
      {items.map((item) => {
        const style: CSSProperties = {
          ...getPreviewPropSlotStyle(item.position, item.sizePercent),
          opacity: item.opacity,
        };

        if (item.kind === "image" && item.imageUrl) {
          return (
            <img
              key={item.id}
              src={item.imageUrl}
              alt=""
              className="pointer-events-none absolute z-30 h-auto object-contain"
              style={style}
            />
          );
        }

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

        if (item.kind === "text" && item.text) {
          return (
            <div
              key={item.id}
              className="pointer-events-none absolute z-30 flex items-center justify-center text-center"
              style={style}
            >
              <span
                className="font-semibold leading-tight"
                style={{
                  color: item.color ?? "white",
                  fontSize: `${Math.max(8, (item.fontSize ?? 48) * 0.2)}px`,
                  textShadow: "0 1px 5px rgba(0,0,0,0.7)",
                }}
              >
                {item.text}
              </span>
            </div>
          );
        }

        if (item.kind === "youtube" && item.youtubeUrl) {
          const embedUrl = getPreviewYouTubeEmbedUrl(item.youtubeUrl);
          if (!embedUrl) return null;
          return (
            <PreviewYouTubeLayer
              key={item.id}
              src={embedUrl}
              style={style}
            />
          );
        }

        if (item.kind === "ndi") {
          return (
            <div
              key={item.id}
              className="pointer-events-none absolute z-30 flex items-center justify-center rounded-sm border border-white/20 bg-black/70 px-2 py-1 text-center text-[9px] font-medium text-white"
              style={style}
            >
              <span className="line-clamp-2 break-all">
                {item.ndiSourceName || "NDI source"}
              </span>
            </div>
          );
        }

        return null;
      })}
    </>
  );
}

function PreviewYouTubeLayer({
  src,
  style,
}: {
  src: string;
  style: CSSProperties;
}) {
  type WebviewProps = HTMLAttributes<HTMLElement> & {
    allow?: string;
    allowpopups?: string;
    partition?: string;
    src: string;
  };

  return createElement("webview", {
    src,
    className: "pointer-events-none absolute z-30 border-0 bg-black",
    style: { ...style, aspectRatio: "16 / 9" },
    partition: "persist:present-youtube-props",
    allow: "autoplay; encrypted-media; picture-in-picture",
    allowpopups: "false",
  } satisfies WebviewProps);
}

function getPreviewYouTubeEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    let videoId: string | null = null;
    if (url.hostname === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v");
      } else {
        const parts = url.pathname.split("/").filter(Boolean);
        if (["embed", "shorts", "live"].includes(parts[0] ?? "")) {
          videoId = parts[1] ?? null;
        }
      }
    }

    if (!videoId) return null;
    const params = new URLSearchParams({
      autoplay: "1",
      controls: "0",
      disablekb: "1",
      fs: "0",
      iv_load_policy: "3",
      loop: "1",
      modestbranding: "1",
      mute: "1",
      origin: "https://www.youtube-nocookie.com",
      playsinline: "1",
      playlist: videoId,
      rel: "0",
    });
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
  } catch {
    return null;
  }
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
