"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { syncMirrorVideo } from "../../shared/lib/mirror-video-sync.mjs";

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
  videoTimeSampledAtMs: number | null;
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
  currentInlineInstruction: string | null;
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
  videoTimeSampledAtMs: null,
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
  currentInlineInstruction: null,
};

const hasSlideContent = (input: {
  slideText: string | null;
  slideElements: SlideElement[] | null;
  slideBackgroundColor: string | null;
}) =>
  Boolean(input.slideText?.trim()) ||
  Boolean(input.slideElements?.length) ||
  Boolean(input.slideBackgroundColor);

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
          videoTimeSampledAtMs:
            typeof message.videoTimeSampledAtMs === "number"
              ? message.videoTimeSampledAtMs
              : null,
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
          ...(() => {
            const nextSlide = {
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
            };
            if (
              previous.showText &&
              !hasSlideContent(nextSlide) &&
              hasSlideContent(previous)
            ) {
              return {};
            }
            return nextSlide;
          })(),
        }));
      } else if (message.type === "stage-content") {
        setState((previous) => ({
          ...previous,
          currentLabel: asText(message.currentLabel),
          currentRepeat: asText(message.currentRepeat),
          currentInlineInstruction: asText(message.currentInlineInstruction),
        }));
      } else if (message.type === "clear") {
        setState(initialState);
      }
    });
  }, []);

  useEffect(() => {
    window.electronAPI?.notifyWorshipStageReady?.();
  }, []);

  // Where the operator's video is, and whether it is running, for the
  // mirror to follow. A ref as well as state, so the element can catch up
  // from its own events with the latest values.
  const playbackRef = useRef({
    positionSeconds: state.videoCurrentTime,
    sampledAtMs: state.videoTimeSampledAtMs,
    playing: state.isVideoPlaying,
  });
  useEffect(() => {
    playbackRef.current = {
      positionSeconds: state.videoCurrentTime,
      sampledAtMs: state.videoTimeSampledAtMs,
      playing: state.isVideoPlaying,
    };
  }, [state.isVideoPlaying, state.videoCurrentTime, state.videoTimeSampledAtMs]);

  const followOperator = useCallback((video: HTMLVideoElement) => {
    const playback = playbackRef.current;
    syncMirrorVideo(video, playback);
    if (playback.playing) {
      void video.play().catch((): void => undefined);
    } else {
      video.pause();
    }
  }, []);

  // Loading a new source leaves a video element paused, and so does mounting
  // one: switching from one video to another, or showing media again, used
  // to leave the stage on a still frame, because nothing here had changed
  // but the URL. The URL and what is shown are part of what this follows,
  // and a newly loaded video catches up in `onLoadedData` below.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || state.mediaType !== "video") {
      return;
    }
    followOperator(video);
  }, [
    followOperator,
    state.hideBackground,
    state.isVideoPlaying,
    state.mediaType,
    state.mediaUrl,
    state.showMedia,
    state.videoCurrentTime,
    state.videoTimeSampledAtMs,
  ]);

  const renderableElements =
    Array.isArray(state.slideElements) && state.slideElements.length > 0
      ? state.slideElements
      : null;
  const shouldUseScriptureTextLayer =
    Boolean(state.activeSlideId?.startsWith("scripture:")) &&
    renderableElements === null &&
    Boolean(state.slideText?.trim());
  const worshipText = appendInlineInstruction(
    state.slideText,
    state.currentInlineInstruction,
  );
  const worshipElements = useMemo(
    () =>
      appendInlineInstructionToElements(
        renderableElements,
        state.currentInlineInstruction,
      ),
    [renderableElements, state.currentInlineInstruction],
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      {state.showMedia && state.mediaUrl && !state.hideBackground ? (
        state.mediaType === "video" ? (
          <video
            ref={videoRef}
            aria-label="Worship stage media"
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
          <img
            src={state.mediaUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
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

      {state.currentLabel || state.currentRepeat ? (
        <div className="absolute left-10 top-10 z-20 flex max-w-[calc(100vw-5rem)] flex-wrap gap-5 text-6xl font-black uppercase leading-none tracking-[0.08em] text-sky-100 drop-shadow-[0_3px_10px_rgba(0,0,0,0.9)]">
          {state.currentLabel ? (
            <span className="rounded-md bg-black/55 px-4 py-3 ring-2 ring-sky-200/30">
              [{state.currentLabel}]
            </span>
          ) : null}
          {state.currentRepeat ? (
            <span className="rounded-md bg-black/55 px-4 py-3 ring-2 ring-sky-200/30">
              [{state.currentRepeat}]
            </span>
          ) : null}
        </div>
      ) : null}

      {state.showText ? (
        shouldUseScriptureTextLayer ? (
          <ScriptureTextLayer
            text={worshipText}
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
            text={worshipText}
            elements={worshipElements}
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

function appendInlineInstruction(
  text: string | null,
  instruction: string | null,
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
  instruction: string | null,
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
