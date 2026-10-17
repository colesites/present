"use client";

import { userMessage } from "../../renderer/shared/lib/user-error";
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
import { RustVideo } from "../../renderer/shared/components/RustVideo";
import { ScriptureTextLayer } from "../../renderer/shared/components/ScriptureTextLayer";
import {
  Camera,
  Image,
  ImageOff,
  MessageSquare,
  Pause,
  Play,
  Presentation as PresentationIcon,
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
  MediaFit,
  MediaItem,
  VideoSettings,
} from "../../features/media/hooks";
import { filtersToCSS } from "../../features/media/hooks";
import { VIDEO_SPEEDS } from "../../features/media/speeds";
import type {
  CanvasSizePreset,
  SlideElement,
} from "../../shared/types";
import type { TimeUpSettings, UseTimersResult } from "../../renderer/shared/hooks";
import { DEFAULT_TIME_UP, getLiveTimerText, isTimeUpShowing } from "../../renderer/shared/hooks";
import type {
  OutputTextPosition,
  PropsOverlayItem,
  ScriptureFooterPosition,
  ScriptureTextAlign,
  ScriptureVerticalAlign,
} from "../../shared/types/output-window";
import { youtubeEmbedUrl } from "../../shared/lib/youtube-embed.mjs";
import { CompositorPreviewLayer } from "./components/CompositorPreviewLayer";
import { StageScreenPreview } from "../stage/StageScreenPreview";
import { useScreens } from "../../renderer/tauri/screens";

interface SlideGroup {
  label: string;
  count: number;
}

/** A screen's id from Screen Configuration: an audience screen or a stage. */
export type OutputPreviewTarget = string;

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
  /** How fast the live video plays: 1 as recorded. */
  videoRate?: number;
  /** Play the live video at `rate` — the speed the center pane sets too. */
  onSetVideoRate?: (rate: number) => void;
  onToggleVideoPlayback: () => void;
  showText: boolean;
  /** The Slide layer: a presentation's slides (PDF, PowerPoint). */
  showSlide: boolean;
  /** The slide live is a presentation's, so it shows as the Slide layer says. */
  isPresentationSlide: boolean;
  showMedia: boolean;
  hideBackground: boolean;
  textPosition: OutputTextPosition;
  onToggleText: () => void;
  onToggleSlide: () => void;
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
    timeUp?: TimeUpSettings;
  };
  previewTarget?: OutputPreviewTarget;
  onPreviewTargetChange?: (target: OutputPreviewTarget) => void;
}

/** How media can meet a screen of another shape, as the settings offer it. */
const FITS: { value: MediaFit; label: string; title: string }[] = [
  { value: "fit", label: "Fit", title: "All of it, with bars where its shape and the screen's differ" },
  { value: "fill", label: "Fill", title: "The whole screen, cropping its edges" },
  { value: "stretch", label: "Stretch", title: "Pulled to the screen's shape" },
];

function SettingsHeading({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

/** One choice of a few, shown pressed when it is the one. */
function Choice({
  selected,
  onClick,
  title,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      className={cn(
        "h-6 min-w-0 flex-1 rounded px-1 text-[10px] font-medium tabular-nums transition",
        selected
          ? "bg-primary/15 text-primary ring-1 ring-primary/40"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
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
  videoRate = 1,
  onSetVideoRate,
  onToggleVideoPlayback,
  showText,
  showSlide,
  isPresentationSlide,
  showMedia,
  hideBackground,
  textPosition,
  onToggleText,
  onToggleSlide,
  onToggleMedia,
  onToggleHideBackground,
  onClearMedia,
  mediaFilters,
  onMediaFiltersChange,
  onResetFilters,
  isVideoPlaying,
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

  const outputFrameRef = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [previewScale, setPreviewScale] = useState(0.35);

  const isScriptureSlide = activeSlideId?.startsWith("scripture:") ?? false;
  const shouldUseScriptureTextLayer =
    isScriptureSlide && (slideElements?.length ?? 0) === 0;
  const hasLibrarySlideLayer = Boolean(text || (slideElements?.length ?? 0) > 0);
  // The slide shows as its layer says: Slide for a presentation's, Text for
  // any other.
  const slideShows = isPresentationSlide ? showSlide : showText;
  const hasHiddenTextLayerContent = hasLibrarySlideLayer && !slideShows;
  // The screens as Screen Configuration has them, by the names given there.
  // The Screen until they have loaded, or if the one chosen has been removed.
  const { screens } = useScreens();
  const audienceScreens = screens?.filter((screen) => screen.group === "audience") ?? [];
  const stageScreens = screens?.filter((screen) => screen.group === "stage") ?? [];
  const previewScreen =
    screens?.find((screen) => screen.id === previewTarget) ??
    screens?.find((screen) => screen.id === "audience") ??
    null;
  const isStagePreview = previewScreen?.group === "stage";
  const previewTitle = `${previewScreen?.name ?? "Screen"} Preview`;
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
  const timeUp = timerLayout.timeUp ?? DEFAULT_TIME_UP;
  const timerTextForOutput = getLiveTimerText(activeTimer, timeUp);
  const timeUpShowing = isTimeUpShowing(activeTimer, timeUp);
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
            {/* A stage screen shows its stage layout, as its own window does. */}
            {isStagePreview && previewScreen ? (
              <StageScreenPreview screen={previewScreen} className="absolute inset-0 z-30" />
            ) : (
              <CompositorPreviewLayer
                className="absolute inset-0 z-20"
                screen={previewScreen?.id ?? "audience"}
              />
            )}

            {!isStagePreview ? (
              <>

            {/* Under the compositor's picture: hidden while the app draws it
                under the page (`useNativePanel`), where it would show over it. */}
            {!hideBackground && backgroundColor ? (
              <div
                className="absolute inset-0"
                style={{ backgroundColor }}
                data-under-native=""
              />
            ) : null}

            {slideShows &&
              (shouldUseScriptureTextLayer
                ? Boolean(text)
                : hasLibrarySlideLayer) && (
              <div
                className="absolute z-10 overflow-hidden"
                style={previewTextPositionStyle}
                data-under-native=""
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
              <div className="absolute inset-0 z-0 flex h-full items-center justify-center" data-under-native="">
                <p className="text-xs text-zinc-500">
                  {isPresentationSlide ? "Slide layer is hidden" : "Text layer is hidden"}
                </p>
              </div>
            )}

            {!text &&
              !activeMediaItem &&
              !isTimerLayerEnabled &&
              propsOverlay.length === 0 &&
              !hasHiddenTextLayerContent && (
              <div className="absolute inset-0 z-0 flex h-full items-center justify-center" data-under-native="">
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
                if (showSlide) {
                  onToggleSlide();
                }
                onClearMedia();
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground focus:outline-none focus-visible:outline-none"
              title="Clear text, slide and media"
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
              onClick={onToggleSlide}
              aria-pressed={showSlide}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus-visible:outline-none",
                showSlide
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              title={
                showSlide
                  ? "Hide slide layer (PDF and PowerPoint)"
                  : "Show slide layer (PDF and PowerPoint)"
              }
            >
              <PresentationIcon className="h-4 w-4" />
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
              title="Media settings"
              aria-pressed={showFilters}
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
          value={previewScreen?.id ?? "audience"}
          onChange={(event) =>
            onPreviewTargetChange?.(
              event.target.value as OutputPreviewTarget,
            )
          }
          className="h-7 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          title="Change preview screen"
          aria-label="Preview screen"
        >
          {audienceScreens.length === 0 && stageScreens.length === 0 ? (
            <option value="audience">Screen</option>
          ) : null}
          {audienceScreens.length > 0 ? (
            <optgroup label="Audience">
              {audienceScreens.map((screen) => (
                <option key={screen.id} value={screen.id}>
                  {screen.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {stageScreens.length > 0 ? (
            <optgroup label="Stage">
              {stageScreens.map((screen) => (
                <option key={screen.id} value={screen.id}>
                  {screen.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </div>

      {showFilters && (
        <div className="mx-3 mt-2 shrink-0 space-y-3 rounded-lg border border-border bg-card/50 p-2">
          {activeMediaItem ? (
            <>
              {activeMediaItem.type === "video" ? (
                <section aria-label="Playback" className="space-y-1.5">
                  <SettingsHeading>Playback</SettingsHeading>
                  <div className="flex items-center gap-1">
                    <span className="w-12 shrink-0 text-[9px] text-muted-foreground">Speed</span>
                    <div className="flex min-w-0 flex-1 gap-0.5">
                      {VIDEO_SPEEDS.map((speed) => (
                        <Choice
                          key={speed}
                          selected={videoRate === speed}
                          onClick={() => onSetVideoRate?.(speed)}
                          title={`Play at ${speed}×`}
                        >
                          {speed}×
                        </Choice>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-1">
                    <span className="w-12 shrink-0 text-[9px] text-muted-foreground">Loop</span>
                    <input
                      type="checkbox"
                      checked={videoSettings.loop}
                      onChange={(event) => onVideoSettingsChange({ loop: event.target.checked })}
                      className="accent-primary"
                    />
                  </label>
                </section>
              ) : null}
              <section aria-label="Fit" className="space-y-1.5">
                <SettingsHeading>Fit</SettingsHeading>
                <div className="flex gap-0.5">
                  {FITS.map(({ value, label, title }) => (
                    <Choice
                      key={value}
                      selected={(mediaFilters.fit ?? "fit") === value}
                      onClick={() => onMediaFiltersChange({ fit: value })}
                      title={title}
                    >
                      {label}
                    </Choice>
                  ))}
                </div>
              </section>
              <section aria-label="Filters" className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <SettingsHeading>Filters</SettingsHeading>
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
                  onChange={(value) => onMediaFiltersChange({ brightness: value })}
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
                  onChange={(value) => onMediaFiltersChange({ saturation: value })}
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
              </section>
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Select media to change how it plays and looks.
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
              <span
                className={cn(
                  "ml-auto text-xs font-semibold tabular-nums text-foreground",
                  timeUpShowing && timeUp.blink && "present-time-up-blink",
                )}
                style={timeUpShowing ? { color: timeUp.color } : undefined}
              >
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

        // Images and text are drawn by the compositor, into the frame under
        // this (`overlays::is_composited`). Only what it leaves to the
        // webview is drawn here.
        if (item.kind === "video" && item.mediaUrl) {
          return (
            <RustVideo
              key={item.id}
              label="Video prop preview"
              url={item.mediaUrl}
              clock={{ mode: "loop" }}
              className="pointer-events-none absolute z-30 aspect-video"
              style={style}
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
        setError(userMessage(captureError, "The capture input couldn't be started.", "Preview: capture"));
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
