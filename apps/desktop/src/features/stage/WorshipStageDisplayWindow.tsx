"use client";

import { useEffect, useRef, useState } from "react";
import { CanvasSlideLayer } from "../../renderer/shared/components/CanvasSlideLayer";
import { ScriptureTextLayer } from "../../renderer/shared/components/ScriptureTextLayer";
import type {
  CanvasSizePreset,
  SlideElement,
} from "../../shared/types";
import type {
  LibraryStyle,
  OutputTextPosition,
  ScriptureStyle,
  VideoSettings,
} from "../../shared/types/output-window";

type WorshipStageState = {
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  showText: boolean;
  showMedia: boolean;
  hideBackground: boolean;
  textPosition: OutputTextPosition;
  videoSettings: VideoSettings;
  mediaFilterCSS: string;
  isVideoPlaying: boolean;
  videoCurrentTime: number;
  shouldSyncTime: boolean;
  activeSlideId: string | null;
  slideText: string | null;
  slideFooter: string | null;
  slideElements: SlideElement[] | null;
  slideCanvasSize: CanvasSizePreset | null;
  slideBackgroundColor: string | null;
  scriptureStyle: ScriptureStyle;
  libraryStyle: LibraryStyle;
  currentLabel: string | null;
  currentRepeat: string | null;
};

const initialState: WorshipStageState = {
  mediaUrl: null,
  mediaType: null,
  showText: true,
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
  mediaFilterCSS: "none",
  isVideoPlaying: false,
  videoCurrentTime: 0,
  shouldSyncTime: false,
  activeSlideId: null,
  slideText: null,
  slideFooter: null,
  slideElements: null,
  slideCanvasSize: null,
  slideBackgroundColor: null,
  scriptureStyle: {
    fontSize: 96,
    footerFontSize: 70,
    fontFamily: "Inter",
    fontWeight: "400",
    textAlign: "center",
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
  currentLabel: null,
  currentRepeat: null,
};

export function WorshipStageDisplayWindow() {
  const [state, setState] = useState<WorshipStageState>(initialState);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!window.electronAPI?.onWorshipStageData) {
      return;
    }

    return window.electronAPI.onWorshipStageData((data: unknown) => {
      const message = data as Record<string, unknown>;
      if (message.type === "media-update") {
        setState((previous) => ({
          ...previous,
          mediaUrl:
            typeof message.mediaUrl === "string" ? message.mediaUrl : null,
          mediaType:
            message.mediaType === "image" || message.mediaType === "video"
              ? message.mediaType
              : null,
          showText:
            typeof message.showText === "boolean"
              ? message.showText
              : previous.showText,
          showMedia:
            typeof message.showMedia === "boolean"
              ? message.showMedia
              : previous.showMedia,
          hideBackground:
            typeof message.hideBackground === "boolean"
              ? message.hideBackground
              : previous.hideBackground,
          textPosition: message.textPosition
            ? (message.textPosition as OutputTextPosition)
            : previous.textPosition,
          videoSettings: message.videoSettings
            ? (message.videoSettings as VideoSettings)
            : previous.videoSettings,
          mediaFilterCSS:
            typeof message.mediaFilterCSS === "string"
              ? message.mediaFilterCSS
              : previous.mediaFilterCSS,
          isVideoPlaying:
            typeof message.isVideoPlaying === "boolean"
              ? message.isVideoPlaying
              : previous.isVideoPlaying,
          videoCurrentTime:
            typeof message.videoCurrentTime === "number"
              ? message.videoCurrentTime
              : previous.videoCurrentTime,
          shouldSyncTime:
            typeof message.shouldSyncTime === "boolean"
              ? message.shouldSyncTime
              : false,
          scriptureStyle: message.scriptureStyle
            ? (message.scriptureStyle as ScriptureStyle)
            : previous.scriptureStyle,
          libraryStyle: message.libraryStyle
            ? (message.libraryStyle as LibraryStyle)
            : previous.libraryStyle,
        }));
      } else if (message.type === "active-slide") {
        setState((previous) => ({
          ...previous,
          activeSlideId:
            typeof message.slideId === "string" ? message.slideId : null,
          slideText:
            typeof message.slideText === "string" ? message.slideText : null,
          slideFooter:
            typeof message.slideFooter === "string"
              ? message.slideFooter
              : null,
          slideElements: Array.isArray(message.slideElements)
            ? (message.slideElements as SlideElement[])
            : null,
          slideCanvasSize:
            typeof message.slideCanvasSize === "string"
              ? (message.slideCanvasSize as CanvasSizePreset)
              : null,
          slideBackgroundColor:
            typeof message.slideBackgroundColor === "string"
              ? message.slideBackgroundColor
              : null,
        }));
      } else if (message.type === "stage-content") {
        setState((previous) => ({
          ...previous,
          currentLabel: asText(message.currentLabel),
          currentRepeat: asText(message.currentRepeat),
        }));
      } else if (message.type === "clear") {
        setState(initialState);
      }
    });
  }, []);

  useEffect(() => {
    window.electronAPI?.notifyWorshipStageReady?.();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || state.mediaType !== "video") {
      return;
    }

    if (
      state.shouldSyncTime &&
      Math.abs(video.currentTime - state.videoCurrentTime) > 0.5
    ) {
      video.currentTime = state.videoCurrentTime;
    }

    if (state.isVideoPlaying) {
      void video.play().catch((): void => undefined);
    } else {
      video.pause();
    }
  }, [
    state.isVideoPlaying,
    state.mediaType,
    state.shouldSyncTime,
    state.videoCurrentTime,
  ]);

  const renderableElements =
    Array.isArray(state.slideElements) && state.slideElements.length > 0
      ? state.slideElements
      : null;
  const shouldUseScriptureTextLayer =
    Boolean(state.activeSlideId?.startsWith("scripture:")) &&
    renderableElements === null &&
    Boolean(state.slideText?.trim());

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      {state.showMedia && state.mediaUrl && !state.hideBackground ? (
        state.mediaType === "video" ? (
          <video
            ref={videoRef}
            aria-label="Worship stage media"
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

      {(state.currentLabel || state.currentRepeat) ? (
        <div className="absolute left-8 top-8 z-20 flex flex-wrap gap-3 text-3xl font-bold uppercase tracking-[0.08em] text-sky-200 drop-shadow-[0_2px_6px_rgba(0,0,0,0.85)]">
          {state.currentLabel ? <span>[{state.currentLabel}]</span> : null}
          {state.currentRepeat ? <span>[{state.currentRepeat}]</span> : null}
        </div>
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
            containerClassName="absolute inset-0 z-10 flex flex-col p-12 pt-28"
            bodyClassName="min-h-0 w-full flex-1"
            textClassName="pointer-events-none select-none leading-relaxed text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
            footerClassName="mt-4 uppercase tracking-wide text-white/90 drop-shadow-md"
          />
        ) : (
          <CanvasSlideLayer
            text={state.slideText}
            elements={renderableElements}
            canvasSize={state.slideCanvasSize}
            libraryStyle={state.libraryStyle}
            className="absolute inset-0 z-10"
          />
        )
      ) : null}
    </div>
  );
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
