"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera } from "lucide-react";
import type {
  VideoSettings,
  LibraryStyle,
  OutputState,
} from "../../shared/types/output-window";
import type {
  ScreenComposerLayout,
  ScreenComposerRegion,
} from "../../shared/types/screen-composer";
import { ensureFontCatalogLoaded } from "../shared/hooks/useFontCatalog";
import { CanvasSlideLayer } from "../shared/components/CanvasSlideLayer";
import { ScriptureTextLayer } from "../shared/components/ScriptureTextLayer";

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

function parseScreenComposerLayout(
  incoming: unknown
): ScreenComposerLayout | null {
  if (!incoming || typeof incoming !== "object") {
    return null;
  }

  const candidate = incoming as Partial<ScreenComposerLayout>;
  if (!Array.isArray(candidate.regions) || candidate.regions.length === 0) {
    return null;
  }

  const regions = candidate.regions
    .filter((region): region is ScreenComposerRegion => {
      return (
        region &&
        typeof region.id === "string" &&
        typeof region.name === "string" &&
        typeof region.x === "number" &&
        typeof region.y === "number" &&
        typeof region.width === "number" &&
        typeof region.height === "number" &&
        typeof region.source === "string"
      );
    })
    .map(
      (region): ScreenComposerRegion => ({
        id: region.id,
        name: region.name,
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        source: region.source,
        fitMode:
          region.fitMode === "contain" ||
          region.fitMode === "fill" ||
          region.fitMode === "scale-down"
            ? region.fitMode
            : "cover",
        backgroundColor:
          typeof region.backgroundColor === "string"
            ? region.backgroundColor
            : "rgba(10, 13, 28, 0.7)",
        padding: Number.isFinite(region.padding) ? region.padding : 0,
        borderRadius: Number.isFinite(region.borderRadius)
          ? region.borderRadius
          : 0,
        textContent:
          typeof region.textContent === "string" ? region.textContent : "",
        footerText:
          typeof region.footerText === "string" ? region.footerText : "",
        mediaUrl:
          typeof region.mediaUrl === "string" &&
          region.mediaUrl.trim().length > 0
            ? region.mediaUrl
            : null,
        mediaType:
          region.mediaType === "video" || region.mediaType === "image"
            ? region.mediaType
            : null,
        mediaLabel:
          typeof region.mediaLabel === "string" &&
          region.mediaLabel.trim().length > 0
            ? region.mediaLabel
            : null,
        backgroundMediaUrl:
          typeof region.backgroundMediaUrl === "string" &&
          region.backgroundMediaUrl.trim().length > 0
            ? region.backgroundMediaUrl
            : null,
        backgroundMediaType:
          region.backgroundMediaType === "video" ||
          region.backgroundMediaType === "image"
            ? region.backgroundMediaType
            : null,
        backgroundMediaLabel:
          typeof region.backgroundMediaLabel === "string" &&
          region.backgroundMediaLabel.trim().length > 0
            ? region.backgroundMediaLabel
            : null,
        showTextLayer:
          typeof region.showTextLayer === "boolean"
            ? region.showTextLayer
            : true,
        showMediaLayer:
          typeof region.showMediaLayer === "boolean"
            ? region.showMediaLayer
            : false,
        slideId: typeof region.slideId === "string" ? region.slideId : null,
        slideText:
          typeof region.slideText === "string" ? region.slideText : null,
        slideFooter:
          typeof region.slideFooter === "string" ? region.slideFooter : null,
        slideElements:
          Array.isArray(region.slideElements) && region.slideElements.length > 0
            ? region.slideElements
            : null,
        slideCanvasSize:
          typeof region.slideCanvasSize === "string"
            ? region.slideCanvasSize
            : null,
        slideBackgroundColor:
          typeof region.slideBackgroundColor === "string"
            ? region.slideBackgroundColor
            : null,
      })
    );

  if (regions.length === 0) {
    return null;
  }

  return {
    id: typeof candidate.id === "string" ? candidate.id : "live-default",
    name:
      typeof candidate.name === "string" && candidate.name.trim().length > 0
        ? candidate.name
        : "Main Output",
    allowOverlap: Boolean(candidate.allowOverlap),
    updatedAt:
      typeof candidate.updatedAt === "number"
        ? candidate.updatedAt
        : Date.now(),
    regions,
  };
}

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

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onOutputData((data: unknown) => {
      const msg = data as Record<string, unknown>;

      if (msg.type === "media-update") {
        setState((prev) => ({
          ...prev,
          mediaUrl:
            msg.mediaUrl !== undefined
              ? (msg.mediaUrl as string | null)
              : prev.mediaUrl,
          mediaType:
            msg.mediaType !== undefined
              ? (msg.mediaType as "image" | "video" | null)
              : prev.mediaType,
          mediaId:
            msg.mediaId !== undefined
              ? (msg.mediaId as string | null)
              : prev.mediaId,
          showText: msg.showText as boolean,
          showMedia: msg.showMedia as boolean,
          hideBackground:
            typeof msg.hideBackground === "boolean"
              ? msg.hideBackground
              : prev.hideBackground,
          textPosition: msg.textPosition
            ? (msg.textPosition as OutputState["textPosition"])
            : prev.textPosition,
          videoSettings: msg.videoSettings as VideoSettings,
          mediaFilterCSS: msg.mediaFilterCSS as string,
          isVideoPlaying: msg.isVideoPlaying as boolean,
          videoCurrentTime: msg.videoCurrentTime as number,
          shouldSyncTime: msg.shouldSyncTime as boolean,
          scriptureStyle: msg.scriptureStyle as OutputState["scriptureStyle"],
          libraryStyle: msg.libraryStyle
            ? (msg.libraryStyle as LibraryStyle)
            : prev.libraryStyle,
          timerLayout: msg.timerLayout
            ? (msg.timerLayout as NonNullable<OutputState["timerLayout"]>)
            : prev.timerLayout,
          screenComposerEnabled:
            typeof msg.screenComposerEnabled === "boolean"
              ? msg.screenComposerEnabled
              : (prev.screenComposerEnabled ?? false),
          screenComposerLayout:
            parseScreenComposerLayout(msg.screenComposerLayout) ??
            prev.screenComposerLayout ??
            DEFAULT_SCREEN_LAYOUT,
        }));
      } else if (msg.type === "active-slide") {
        setState((prev) => ({
          ...prev,
          activeSlideId: msg.slideId as string | null,
          slideText: (msg.slideText as string) || null,
          slideFooter: (msg.slideFooter as string) || null,
          slideElements:
            (msg.slideElements as OutputState["slideElements"]) ?? null,
          slideCanvasSize:
            (msg.slideCanvasSize as OutputState["slideCanvasSize"]) ?? null,
          slideBackgroundColor:
            (msg.slideBackgroundColor as string | null) || null,
        }));
      } else if (msg.type === "timer-update") {
        setState((prev) => ({
          ...prev,
          timerLabel: (msg.timerLabel as string) || null,
          timerText: (msg.timerText as string) || null,
          timerRunning: Boolean(msg.timerRunning),
          timerVisible:
            typeof msg.timerVisible === "boolean"
              ? msg.timerVisible
              : prev.timerVisible,
        }));
      } else if (msg.type === "clear") {
        setState((prev) => ({
          ...prev,
          activeSlideId: null,
          slideText: null,
          slideFooter: null,
          slideElements: null,
          slideCanvasSize: null,
          mediaUrl: null,
          mediaType: null,
          mediaId: null,
        }));
      }
    });

    window.electronAPI.notifyOutputReady();
  }, []);

  useEffect(() => {
    void ensureFontCatalogLoaded(document, { force: true });
  }, [state.libraryStyle.fontFamily, state.scriptureStyle.fontFamily]);

  const legacyVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = legacyVideoRef.current;
    if (!video || state.mediaType !== "video") {
      return;
    }

    if (state.shouldSyncTime && Number.isFinite(state.videoCurrentTime)) {
      try {
        video.currentTime = state.videoCurrentTime;
      } catch {
        // Ignore seek errors.
      }
    }

    if (state.isVideoPlaying) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((): void => undefined);
      }
    } else {
      video.pause();
    }
  }, [
    state.mediaType,
    state.mediaUrl,
    state.shouldSyncTime,
    state.videoCurrentTime,
    state.isVideoPlaying,
  ]);

  const regions = useMemo(() => {
    return state.screenComposerLayout?.regions?.length
      ? state.screenComposerLayout.regions
      : DEFAULT_SCREEN_LAYOUT.regions;
  }, [state.screenComposerLayout]);

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
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black/50 p-4 text-center">
          {state.timerLabel ? (
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-300">
              {state.timerLabel}
            </p>
          ) : null}
          <p className="text-[clamp(24px,4vw,88px)] font-semibold text-white">
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
              />
            ) : (
              <img
                src={region.backgroundMediaUrl}
                alt=""
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
                style={{ filter: state.mediaFilterCSS }}
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
            />
          ) : (
            <img
              src={region.mediaUrl}
              alt=""
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
              style={{ filter: state.mediaFilterCSS }}
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

  if (!isComposerEnabled) {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-black">
        {state.showMedia && state.mediaUrl && !state.hideBackground ? (
          state.mediaType === "video" ? (
            <video
              ref={legacyVideoRef}
              src={state.mediaUrl}
              className="absolute inset-0 h-full w-full object-cover"
              loop={state.videoSettings.loop}
              muted={state.videoSettings.muted}
              playsInline
              style={{ filter: state.mediaFilterCSS }}
            />
          ) : (
            <img
              src={state.mediaUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              style={{ filter: state.mediaFilterCSS }}
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
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-black">
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
    </div>
  );
}

function cn(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(" ");
}
