"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Camera } from "lucide-react";
import type { OutputState } from "../../shared/types/output-window";
import type {
  ScreenComposerLayout,
  ScreenComposerRegion,
} from "../../shared/types/screen-composer";
import { ensureFontCatalogLoaded } from "../shared/hooks/useFontCatalog";
import { useOwnScreen } from "../tauri/screens";
import { ScreenCanvas } from "../shared/components/ScreenCanvas";
import { CanvasSlideLayer } from "../shared/components/CanvasSlideLayer";
import { ScriptureTextLayer } from "../shared/components/ScriptureTextLayer";
import { syncMirrorVideo } from "../../shared/lib/mirror-video-sync.mjs";
import { youtubeEmbedUrl } from "../../shared/lib/youtube-embed.mjs";

const DEFAULT_SCREEN_LAYOUT: ScreenComposerLayout = {
  id: "live-default",
  name: "Main Output",
  allowOverlap: false,
  updatedAt: 0,
  regions: [
    {
      id: "live-default-region",
      name: "Main",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      source: "slides",
      fitMode: "cover",
      backgroundColor: "rgba(10, 13, 28, 0.7)",
      padding: 0,
      borderRadius: 0,
      textContent: "",
      footerText: "",
      mediaUrl: null,
      mediaType: null,
      mediaLabel: null,
      showTextLayer: true,
      showMediaLayer: false,
      backgroundMediaUrl: null,
      backgroundMediaType: null,
      backgroundMediaLabel: null,
      slideId: null,
      slideText: null,
      slideFooter: null,
      slideElements: null,
      slideCanvasSize: null,
      slideBackgroundColor: null,
    },
  ],
};


export function OutputWindow() {
  const [state, setState] = useState<OutputState>({
    mediaUrl: null,
    mediaType: null,
    mediaId: null,
    showText: false,
    showMedia: true,
    hideBackground: false,
    textPosition: {
      xPercent: 50,
      yPercent: 50,
      widthPercent: 92,
      heightPercent: 84,
      textAlign: "center",
      verticalAlign: "middle",
    },
    videoSettings: { loop: true, muted: true },
    mediaFilterCSS: "",
    isVideoPlaying: false,
    videoCurrentTime: 0,
    shouldSyncTime: false,
    activeSlideId: null,
    slideText: null,
    slideFooter: null,
    slideElements: null,
    slideCanvasSize: null,
    slideBackgroundColor: null,
    timerLabel: null,
    timerText: null,
    timerRunning: false,
    timerVisible: false,
    timerLayout: {
      xPercent: 82,
      yPercent: 8,
      clockFontPx: 24,
      nameFontPx: 14,
      nameBannerHeightPx: 48,
      clockColor: "#ffffff",
      nameColor: "#ffffff",
      nameBannerEnabled: false,
      nameBannerColor: "#ffffff",
      titlePosition: "bottom",
    },
    scriptureStyle: {
      fontSize: 96,
      footerFontSize: 70,
      fontFamily: "Inter",
      fontWeight: "400",
      textAlign: "left",
      verticalAlign: "middle",
      footerAlign: "center",
      footerPosition: "bottom",
    },
    libraryStyle: {
      fontFamily: "Inter",
      fontSize: 72,
      fontBold: false,
      fontItalic: false,
      fontUnderline: false,
    },
    screenComposerEnabled: false,
    screenComposerLayout: DEFAULT_SCREEN_LAYOUT,
  });

  // The whole scene comes from Rust and this window renders it. The merge
  // below only exists to keep the styles this window seeds its own defaults with.
  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;

    void (async () => {
      const core = await import("../tauri/output");
      const unlisten = await core.onOutputSceneChanged((scene) => {
        if (!cancelled) setState((prev) => core.mergeScene(prev, scene));
      });
      if (cancelled) {
        unlisten();
        return;
      }
      detach = unlisten;

      // Late join, without a handshake: whatever is on screen right now.
      const scene = await core.getOutputScene();
      if (!cancelled) setState((prev) => core.mergeScene(prev, scene));
    })().catch((error: unknown) => {
      console.error("[Output] could not reach the Rust core", error);
    });

    return () => {
      cancelled = true;
      const stop = detach;
      detach = null;
      stop?.();
    };
  }, []);

  // With the operator's opt-in, the compositor draws this window
  // onto a native view below the page. Only while it reports frames on screen
  // does this page step back to the props it cannot draw; any other moment,
  // including a native view that failed, this page draws everything as usual.
  const [nativeSurface, setNativeSurface] = useState(false);
  // What is under the picture when this page draws it: the screen's colour
  // (Screen Configuration), as the compositor draws it.
  const ownScreen = useOwnScreen();
  const screenBackground = useMemo<CSSProperties>(
    () => ({ backgroundColor: ownScreen?.color || "#000000" }),
    [ownScreen?.color],
  );
  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;

    void (async () => {
      const core = await import("../tauri/output");
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      // Every audience window has a native view of its own, and hears about
      // all of them.
      const label = getCurrentWebviewWindow().label;
      const unlisten = await core.onOutputSurfaceChanged((surface) => {
        if (surface.label && surface.label !== label) return;
        if (!cancelled) setNativeSurface(surface.presenting);
      });
      if (cancelled) {
        unlisten();
        return;
      }
      detach = unlisten;
      const surface = await core.getOutputSurface();
      if (!cancelled) setNativeSurface(surface.presenting);
    })().catch((error: unknown) => {
      console.error("[Output] could not read the native surface", error);
    });

    return () => {
      cancelled = true;
      const stop = detach;
      detach = null;
      stop?.();
    };
  }, []);

  // The page is black in `output.html` so it never flashes white. With the
  // native view drawing underneath, black would cover it.
  useEffect(() => {
    if (!nativeSurface) return;
    const { documentElement: html, body } = document;
    const previous = [html.style.backgroundColor, body.style.backgroundColor];
    html.style.backgroundColor = "transparent";
    body.style.backgroundColor = "transparent";
    return () => {
      html.style.backgroundColor = previous[0];
      body.style.backgroundColor = previous[1];
    };
  }, [nativeSurface]);

  useEffect(() => {
    void ensureFontCatalogLoaded(document, { force: true });
  }, [state.libraryStyle.fontFamily, state.scriptureStyle.fontFamily]);

  const legacyVideoRef = useRef<HTMLVideoElement | null>(null);

  const followOperator = (video: HTMLVideoElement) => {
    syncMirrorVideo(video, {
      positionSeconds: state.videoCurrentTime,
      sampledAtMs: state.videoTimeSampledAtMs,
      playing: state.isVideoPlaying,
    });

    if (state.isVideoPlaying) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((): void => undefined);
      }
    } else {
      video.pause();
    }
  };

  // The element exists only while media is shown, and a new or remounted one
  // starts paused, so showing media again is part of what this follows; a
  // newly loaded video also catches up in `onLoadedData` (the worship stage
  // stayed on a still frame for want of both).
  useEffect(() => {
    const video = legacyVideoRef.current;
    if (!video || state.mediaType !== "video") {
      return;
    }
    followOperator(video);
    // `followOperator` reads the same state listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.hideBackground,
    state.mediaType,
    state.mediaUrl,
    state.showMedia,
    state.videoCurrentTime,
    state.videoTimeSampledAtMs,
    state.isVideoPlaying,
  ]);

  const regions = useMemo(() => {
    return state.screenComposerLayout?.regions?.length
      ? state.screenComposerLayout.regions
      : DEFAULT_SCREEN_LAYOUT.regions;
  }, [state.screenComposerLayout]);
  const hasCountdownRegion = regions.some((region) => region.source === "countdown");

  const renderRegionContent = (region: ScreenComposerRegion) => {
    if (region.source === "camera-feed") {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black/55 text-center">
          <span className="rounded-full border border-zinc-500/70 bg-zinc-800/80 p-3 text-zinc-300">
            <Camera className="h-5 w-5" />
          </span>
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">
            Camera feed
          </p>
        </div>
      );
    }

    if (region.source === "countdown") {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
          {state.timerLabel ? (
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-300">
              {state.timerLabel}
            </p>
          ) : null}
          <p
            className={cn(
              "text-[clamp(24px,4cqw,88px)] font-semibold text-white",
              state.timerTimeUp?.blink && "present-time-up-blink",
            )}
            style={state.timerTimeUp ? { color: state.timerTimeUp.color } : undefined}
          >
            {state.timerText || "00:00:00"}
          </p>
        </div>
      );
    }

    if (region.source === "slides") {
      const regionSlideId = region.slideId ?? state.activeSlideId;
      const regionSlideText = region.slideText ?? state.slideText;
      const regionSlideFooter = region.slideFooter ?? state.slideFooter;
      const regionSlideElements = region.slideElements ?? state.slideElements;
      const regionRenderableElements =
        Array.isArray(regionSlideElements) && regionSlideElements.length > 0
          ? regionSlideElements
          : null;
      const regionSlideCanvasSize =
        region.slideCanvasSize ?? state.slideCanvasSize;
      const regionSlideBackgroundColor =
        region.slideBackgroundColor ?? state.slideBackgroundColor;
      const hasSlides =
        Boolean(regionSlideText) || regionRenderableElements !== null;
      const shouldUseScriptureTextLayer =
        Boolean(regionSlideId?.startsWith("scripture:")) &&
        regionRenderableElements === null &&
        Boolean(regionSlideText?.trim());
      return (
        <div className="relative h-full w-full">
          {region.backgroundMediaUrl ? (
            region.backgroundMediaType === "video" ? (
              <video
                aria-label="Region background video"
                src={region.backgroundMediaUrl}
                className={cn(
                  "absolute inset-0 h-full w-full",
                  region.fitMode === "contain"
                    ? "object-contain"
                    : region.fitMode === "fill"
                      ? "object-fill"
                      : region.fitMode === "scale-down"
                        ? "object-scale-down"
                        : "object-cover"
                )}
                loop
                muted
                autoPlay
                playsInline
                style={{ filter: state.mediaFilterCSS }}
              >
                <track kind="captions" />
              </video>
            ) : (
              <OutputImageLayer
                url={region.backgroundMediaUrl}
                fitMode={region.fitMode}
                className="absolute inset-0"
                filter={state.mediaFilterCSS}
              />
            )
          ) : null}

          {regionSlideBackgroundColor ? (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: regionSlideBackgroundColor }}
            />
          ) : null}

          {state.showText && hasSlides ? (
            shouldUseScriptureTextLayer ? (
              <ScriptureTextLayer
                text={regionSlideText}
                footer={regionSlideFooter}
                fontFamily={state.scriptureStyle.fontFamily}
                fontSize={state.scriptureStyle.fontSize}
                fontWeight={state.scriptureStyle.fontWeight}
                footerFontSize={state.scriptureStyle.footerFontSize}
                footerFontFamily={state.scriptureStyle.fontFamily}
                footerFontWeight={state.scriptureStyle.fontWeight}
                textAlign={state.scriptureStyle.textAlign}
                verticalAlign={state.scriptureStyle.verticalAlign}
                footerAlign={state.scriptureStyle.footerAlign}
                footerPosition={state.scriptureStyle.footerPosition}
                maxFontSize={state.scriptureStyle.fontSize}
                minScale={0.3}
                fitScale={1}
                containerClassName="absolute inset-0 z-10 flex flex-col p-8"
                bodyClassName="min-h-0 w-full flex-1"
                textClassName="pointer-events-none select-none leading-relaxed text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                footerClassName="mt-2 uppercase tracking-wide text-white/90 drop-shadow-md"
              />
            ) : (
              <CanvasSlideLayer
                text={regionSlideText}
                elements={regionRenderableElements}
                canvasSize={regionSlideCanvasSize}
                libraryStyle={state.libraryStyle}
                className="absolute inset-0 z-10"
              />
            )
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
              No slide selected
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="relative h-full w-full">
        {region.mediaUrl ? (
          region.mediaType === "video" ? (
            <video
              aria-label="Region media video"
              src={region.mediaUrl}
              className={cn(
                "h-full w-full",
                region.fitMode === "contain"
                  ? "object-contain"
                  : region.fitMode === "fill"
                    ? "object-fill"
                    : region.fitMode === "scale-down"
                      ? "object-scale-down"
                      : "object-cover"
              )}
              loop
              muted
              autoPlay
              playsInline
              style={{ filter: state.mediaFilterCSS }}
            >
              <track kind="captions" />
            </video>
          ) : (
            <OutputImageLayer
              url={region.mediaUrl}
              fitMode={region.fitMode}
              className="h-full w-full"
              filter={state.mediaFilterCSS}
            />
          )
        ) : null}

        {!region.mediaUrl ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
            No media selected
          </div>
        ) : null}
      </div>
    );
  };

  const isComposerEnabled = Boolean(state.screenComposerEnabled);
  const renderableSlideElements =
    Array.isArray(state.slideElements) && state.slideElements.length > 0
      ? state.slideElements
      : null;
  const shouldUseScriptureTextLayer =
    Boolean(state.activeSlideId?.startsWith("scripture:")) &&
    renderableSlideElements === null &&
    Boolean(state.slideText?.trim());

  if (nativeSurface) {
    // Everything the compositor draws is on the view below this page. What it
    // leaves here is a browser and a camera: YouTube, NDI and capture props,
    // video props, and camera regions in the composer (ADR-001's amendment).
    const webOnlyProps = (state.propsOverlay ?? []).filter(
      (item) =>
        item.kind === "youtube" ||
        item.kind === "ndi" ||
        item.kind === "capture" ||
        item.kind === "video",
    );
    return (
      <ScreenCanvas effects={!nativeSurface}>
        <div className="relative h-full w-full overflow-hidden bg-transparent">
          {isComposerEnabled
            ? regions
                .filter((region) => region.source === "camera-feed")
                .map((region) => (
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
                      className="relative h-full w-full overflow-hidden"
                      style={{ borderRadius: `${region.borderRadius}px` }}
                    >
                      {renderRegionContent(region)}
                    </div>
                  </div>
                ))
            : null}
          <PropsOverlayLayer items={webOnlyProps} />
        </div>
      </ScreenCanvas>
    );
  }

  if (!isComposerEnabled) {
    return (
      <ScreenCanvas effects={!nativeSurface}>
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden" style={screenBackground}>
          {state.showMedia && state.mediaUrl && !state.hideBackground ? (
            state.mediaType === "video" ? (
              <video
                ref={legacyVideoRef}
                aria-label="Output media video"
                src={state.mediaUrl}
                className="absolute inset-0 h-full w-full object-contain"
                loop={state.videoSettings.loop}
                muted
                playsInline
                onLoadedData={(event) => followOperator(event.currentTarget)}
                style={{ filter: state.mediaFilterCSS }}
              >
                <track kind="captions" />
              </video>
            ) : (
              <OutputImageLayer
                url={state.mediaUrl}
                fitMode="contain"
                className="absolute inset-0"
                filter={state.mediaFilterCSS}
              />
            )
          ) : null}

          {state.slideBackgroundColor ? (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: state.slideBackgroundColor }}
            />
          ) : null}

          {state.showText ? (
            shouldUseScriptureTextLayer ? (
              <ScriptureTextLayer
                text={state.slideText}
                footer={state.slideFooter}
                fontFamily={state.scriptureStyle.fontFamily}
                fontSize={state.scriptureStyle.fontSize}
                fontWeight={state.scriptureStyle.fontWeight}
                footerFontSize={state.scriptureStyle.footerFontSize}
                footerFontFamily={state.scriptureStyle.fontFamily}
                footerFontWeight={state.scriptureStyle.fontWeight}
                textAlign={state.scriptureStyle.textAlign}
                verticalAlign={state.scriptureStyle.verticalAlign}
                footerAlign={state.scriptureStyle.footerAlign}
                footerPosition={state.scriptureStyle.footerPosition}
                maxFontSize={state.scriptureStyle.fontSize}
                minScale={0.3}
                fitScale={1}
                containerClassName="absolute inset-0 z-10 flex flex-col p-12"
                bodyClassName="min-h-0 w-full flex-1"
                textClassName="pointer-events-none select-none leading-relaxed text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                footerClassName="mt-4 uppercase tracking-wide text-white/90 drop-shadow-md"
              />
            ) : (
              <CanvasSlideLayer
                text={state.slideText}
                elements={renderableSlideElements}
                canvasSize={state.slideCanvasSize}
                libraryStyle={state.libraryStyle}
                className="absolute inset-0 z-10"
              />
            )
          ) : null}

          {/* Overlays must render in the default (non-composer) path too —
              this is the common output mode. */}
          <TimerOverlayLayer state={state} />
          <PropsOverlayLayer items={state.propsOverlay ?? null} />
          <MessageOverlayLayer overlay={state.messageOverlay ?? null} />
        </div>
      </ScreenCanvas>
    );
  }

  return (
    <ScreenCanvas effects={!nativeSurface}>
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden" style={screenBackground}>
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
              className="relative h-full w-full overflow-hidden border border-white/10 bg-black"
              style={{
                borderRadius: `${region.borderRadius}px`,
                backgroundColor: region.backgroundColor,
              }}
            >
              {renderRegionContent(region)}
            </div>
          </div>
        ))}
        {!hasCountdownRegion ? <TimerOverlayLayer state={state} /> : null}
        <PropsOverlayLayer items={state.propsOverlay ?? null} />
        <MessageOverlayLayer overlay={state.messageOverlay ?? null} />
      </div>
    </ScreenCanvas>
  );
}

function clampNumber(value: number | undefined, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function getBackgroundSize(fitMode: ScreenComposerRegion["fitMode"] | "cover") {
  if (fitMode === "fill") return "100% 100%";
  if (fitMode === "contain" || fitMode === "scale-down") return "contain";
  return "cover";
}

function OutputImageLayer({
  url,
  fitMode,
  className,
  filter,
  style,
}: {
  url: string;
  fitMode: ScreenComposerRegion["fitMode"] | "cover";
  className?: string;
  filter?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn("block bg-center bg-no-repeat", className)}
      style={{
        ...style,
        backgroundImage: `url("${url}")`,
        backgroundSize: getBackgroundSize(fitMode),
        filter,
      }}
      aria-hidden="true"
    />
  );
}

function TimerOverlayLayer({ state }: { state: OutputState }) {
  if (!state.timerVisible || !state.timerText) {
    return null;
  }

  const layout = state.timerLayout;
  const xPercent = clampNumber(layout?.xPercent, 0, 100);
  const yPercent = clampNumber(layout?.yPercent, 0, 100);
  const clockFontPx = clampNumber(layout?.clockFontPx, 12, 400);
  const nameFontPx = clampNumber(layout?.nameFontPx, 10, 180);
  const nameBannerHeightPx = clampNumber(
    layout?.nameBannerHeightPx ?? 48,
    32,
    160,
  );
  const timeUp = state.timerTimeUp ?? null;
  const clockColor = timeUp?.color || layout?.clockColor || "#ffffff";
  const nameColor = layout?.nameColor || "#ffffff";
  const nameBannerEnabled = Boolean(layout?.nameBannerEnabled);
  const titlePosition = layout?.titlePosition === "top" ? "top" : "bottom";
  const label = state.timerLabel?.trim() || null;

  return (
    <>
      {label && nameBannerEnabled ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 z-50 flex items-center justify-center px-6 text-center font-medium uppercase tracking-wider",
            titlePosition === "top" ? "top-0" : "bottom-0",
          )}
          style={{
            backgroundColor: layout?.nameBannerColor || "rgba(0,0,0,0.65)",
            color: nameColor,
            fontSize: `${nameFontPx}px`,
            height: `${nameBannerHeightPx}px`,
          }}
        >
          {label}
        </div>
      ) : null}

      <div
        className="pointer-events-none absolute z-50 box-border text-center font-semibold tracking-wide text-white"
        style={{
          left: `${xPercent}%`,
          top: `${yPercent}%`,
          transform: "translate(-50%, -50%)",
          // As the compositor draws it: nothing behind the clock unless a
          // background is chosen (Settings, Timer).
          backgroundColor: layout?.boxColor?.trim() || "transparent",
          padding: `${clockFontPx * 0.12}px ${clockFontPx * 0.25}px`,
          borderRadius: clockFontPx * 0.12,
        }}
      >
        {label && !nameBannerEnabled && titlePosition === "top" ? (
          <div
            className="max-w-[40cqw] overflow-hidden text-ellipsis whitespace-nowrap font-medium uppercase tracking-wider"
            style={{ color: nameColor, fontSize: `${nameFontPx}px` }}
          >
            {label}
          </div>
        ) : null}
        <div
          className={cn("whitespace-nowrap leading-none", timeUp?.blink && "present-time-up-blink")}
          style={{ color: clockColor, fontSize: `${clockFontPx}px` }}
        >
          {state.timerText}
        </div>
        {label && !nameBannerEnabled && titlePosition !== "top" ? (
          <div
            className="max-w-[40cqw] overflow-hidden text-ellipsis whitespace-nowrap font-medium uppercase tracking-wider"
            style={{ color: nameColor, fontSize: `${nameFontPx}px` }}
          >
            {label}
          </div>
        ) : null}
      </div>
    </>
  );
}

// Banner-style overlay rendered above the slide regions. Positioned top or
// bottom; styled by themeKey. Supports static and marquee animations.
// Auto-dismiss timing is handled by the operator's renderer (which clears
// the overlay broadcast); the audience output is purely presentational.
function MessageOverlayLayer({
  overlay,
}: {
  overlay: OutputState["messageOverlay"];
}) {
  if (!overlay || !overlay.text.trim()) {
    return null;
  }

  const positionStyle: React.CSSProperties =
    overlay.position === "top"
      ? { top: 0, left: 0, right: 0 }
      : { bottom: 0, left: 0, right: 0 };
  const themeStyle = getOverlayThemeStyle(overlay.themeKey);

  const isMarquee =
    overlay.animation === "marquee-left" ||
    overlay.animation === "marquee-right";

  if (isMarquee) {
    const direction =
      overlay.animation === "marquee-left"
        ? "presentMarqueeLeft"
        : "presentMarqueeRight";
    const duration = Math.max(2, overlay.speedSeconds || 12);

    return (
      <div
        className="pointer-events-none absolute z-50 overflow-hidden whitespace-nowrap py-4"
        style={{ ...positionStyle, ...themeStyle }}
      >
        <style>
          {`
            @keyframes presentMarqueeLeft {
              0%   { transform: translateX(100%); }
              100% { transform: translateX(-100%); }
            }
            @keyframes presentMarqueeRight {
              0%   { transform: translateX(-100%); }
              100% { transform: translateX(100%); }
            }
          `}
        </style>
        <span
          className="block whitespace-nowrap font-semibold leading-tight"
          style={{
            fontSize: `calc(min(5cqw, 56px) * ${overlay.fontScale ?? 1})`,
            animation: `${direction} ${duration}s linear infinite`,
            animationDelay: "0s",
          }}
        >
          {overlay.text}
        </span>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute z-50 flex items-center justify-center px-12 py-6"
      style={{ ...positionStyle, ...themeStyle }}
    >
      <span
        className="text-center font-semibold leading-tight"
        style={{ fontSize: `calc(min(6cqw, 64px) * ${overlay.fontScale ?? 1})` }}
      >
        {overlay.text}
      </span>
    </div>
  );
}

// Image / text props composited above the live slide. Each prop is
// positioned by preset slot (corners, center, or full screen).
function PropsOverlayLayer({
  items,
}: {
  items: OutputState["propsOverlay"];
}) {
  if (!items || items.length === 0) return null;
  return (
    <>
      {items.map((item) => {
        const slotStyle = getPropSlotStyle(item.position, item.sizePercent);
        const baseStyle: React.CSSProperties = {
          ...slotStyle,
          opacity: item.opacity,
        };
        if (item.kind === "image" && item.imageUrl) {
          return (
            <OutputImageLayer
              key={item.id}
              url={item.imageUrl}
              fitMode="contain"
              className="pointer-events-none absolute z-40"
              style={baseStyle}
            />
          );
        }
        if (item.kind === "video" && item.mediaUrl) {
          return (
            <video
              key={item.id}
              src={item.mediaUrl}
              className="pointer-events-none absolute z-40 h-auto object-contain"
              style={baseStyle}
              aria-label="Video prop"
              autoPlay
              loop
              muted
              playsInline
            />
          );
        }
        if (item.kind === "youtube" && item.youtubeUrl) {
          return (
            <YouTubePropLayer
              key={item.id}
              youtubeUrl={item.youtubeUrl}
              shownAtMs={item.shownAtMs}
              style={baseStyle}
            />
          );
        }
        if (item.kind === "ndi" && item.ndiSourceName) {
          return (
            <NdiPropLayer
              key={item.id}
              sourceName={item.ndiSourceName}
              style={baseStyle}
            />
          );
        }
        if (item.kind === "capture") {
          return (
            <CapturePropLayer
              key={item.id}
              deviceId={item.captureDeviceId}
              deviceLabel={item.captureDeviceLabel}
              style={baseStyle}
            />
          );
        }
        if (item.kind === "text" && item.text) {
          return (
            <div
              key={item.id}
              className="pointer-events-none absolute z-40 flex items-center justify-center text-center"
              style={baseStyle}
            >
              <span
                className="font-semibold leading-tight"
                style={{
                  color: item.color ?? "white",
                  fontSize: `${item.fontSize ?? 48}px`,
                  textShadow: "0 2px 8px rgba(0,0,0,0.6)",
                }}
              >
                {item.text}
              </span>
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

function YouTubePropLayer({
  youtubeUrl,
  shownAtMs,
  style,
}: {
  youtubeUrl: string;
  shownAtMs?: number;
  style: React.CSSProperties;
}) {
  const src = useMemo(
    () => youtubeEmbedUrl(youtubeUrl, { startSeconds: getElapsedSeconds(shownAtMs) }),
    [shownAtMs, youtubeUrl],
  );

  if (!src) return null;

  // An `<iframe>`, not Electron's `<webview>`. The `<webview>` tag exists only
  // in Electron; under this shell it is an unknown element that renders
  // nothing, which is why a YouTube prop that worked before the migration went
  // blank on every screen. Its Electron-only attributes — `partition`,
  // `allowpopups`, `httpreferrer` — went with it. What `httpreferrer` did,
  // giving YouTube a referrer to accept, the website's wrapper page now does
  // (`shared/lib/youtube-embed.mjs`).
  return (
    <iframe
      src={src}
      title="YouTube"
      className="pointer-events-none absolute z-40 border-0"
      style={{ ...style, aspectRatio: "16 / 9" }}
      allow="autoplay; encrypted-media; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

function NdiPropLayer({
  sourceName,
  style,
}: {
  sourceName: string;
  style: React.CSSProperties;
}) {
  const [frameTick, setFrameTick] = useState(0);
  const [clientId] = useState(
    () => `output-${Math.random().toString(36).slice(2)}`,
  );
  const encodedSourceName = encodeURIComponent(sourceName);

  useEffect(() => {
    if (!window.electronAPI?.startNdiInput || !window.electronAPI?.stopNdiInput) {
      return undefined;
    }

    let cancelled = false;
    void window.electronAPI.startNdiInput(sourceName, undefined, clientId).then((result) => {
      if (!cancelled && !result.ok && result.error) {
        console.error("[NDI Prop] failed to start input", result.error);
      }
    });
    const interval = window.setInterval(() => {
      setFrameTick(Date.now());
    }, 125);

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
      className="pointer-events-none absolute z-40 h-auto object-contain"
      style={style}
    />
  );
}

function CapturePropLayer({
  deviceId,
  deviceLabel,
  style,
}: {
  deviceId?: string;
  deviceLabel?: string;
  style: React.CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    const videoElement = videoRef.current;

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
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
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

      return await navigator.mediaDevices.getUserMedia({
        video: baseConstraints,
        audio: false,
      });
    };

    void getCaptureStream()
      .then((nextStream) => {
        if (cancelled) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = nextStream;
        setError(null);
        if (videoElement) {
          videoElement.srcObject = nextStream;
          void videoElement.play().catch(() => {
            // Browser autoplay can reject while the window is being moved.
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
      if (videoElement) {
        videoElement.srcObject = null;
      }
    };
  }, [deviceId, deviceLabel]);

  if (error) {
    return (
      <div
        className="pointer-events-none absolute z-40 flex items-center justify-center bg-black text-center text-white"
        style={style}
      >
        <div className="flex max-w-[80%] flex-col items-center gap-2 text-[18px] font-semibold">
          <Camera className="h-9 w-9 text-white/70" strokeWidth={1.6} />
          <span>Capture input unavailable</span>
        </div>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      className="pointer-events-none absolute z-40 h-auto bg-black object-contain"
      style={style}
      aria-label="HDMI capture prop"
      autoPlay
      muted
      playsInline
    >
      <track kind="captions" />
    </video>
  );
}

function getElapsedSeconds(startedAtMs?: number): number {
  if (!startedAtMs || !Number.isFinite(startedAtMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
}

function getPropSlotStyle(
  position: NonNullable<OutputState["propsOverlay"]>[number]["position"],
  sizePercent: number,
): React.CSSProperties {
  const sz = `${Math.max(5, Math.min(100, sizePercent))}%`;
  const inset = "3%";
  switch (position) {
    case "top-left":
      return { top: inset, left: inset, width: sz };
    case "top-right":
      return { top: inset, right: inset, width: sz };
    case "bottom-left":
      return { bottom: inset, left: inset, width: sz };
    case "bottom-right":
      return { bottom: inset, right: inset, width: sz };
    case "center":
      return {
        top: "50%",
        left: "50%",
        width: sz,
        transform: "translate(-50%, -50%)",
      };
    case "full":
    default:
      return { top: 0, left: 0, right: 0, bottom: 0 };
  }
}

function getOverlayThemeStyle(themeKey: string): React.CSSProperties {
  switch (themeKey) {
    case "warning":
      return { background: "rgba(245, 158, 11, 0.92)", color: "#111" };
    case "info":
      return { background: "rgba(37, 99, 235, 0.92)", color: "white" };
    case "danger":
      return { background: "rgba(220, 38, 38, 0.92)", color: "white" };
    case "transparent":
      return {
        background: "transparent",
        color: "white",
        textShadow: "0 2px 12px rgba(0,0,0,0.85)",
      };
    case "default":
    default:
      return { background: "rgba(15, 15, 18, 0.85)", color: "white" };
  }
}

function cn(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(" ");
}
