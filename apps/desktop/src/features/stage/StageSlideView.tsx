"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { CanvasSlideLayer } from "../../renderer/shared/components/CanvasSlideLayer";
import { ScriptureTextLayer } from "../../renderer/shared/components/ScriptureTextLayer";
import { syncMirrorVideo } from "../../shared/lib/mirror-video-sync.mjs";
import { appendInlineInstruction, appendInlineInstructionToElements, type StageSlideState } from "./useStageFeed";

/**
 * The slide as the room sees it, over its media, following the operator's
 * video: what the worship stage always showed, now a stage layout's Current
 * Slide object.
 */
export function StageSlideView({ slide: state, showSections = true }: { slide: StageSlideState; showSections?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

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
    <div
      className="relative h-full w-full overflow-hidden text-white"
      style={{ backgroundColor: "transparent" }}
    >
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

      {showSections && (state.currentLabel || state.currentRepeat) ? (
        <div className="absolute left-10 top-10 z-20 flex max-w-[calc(100%-5rem)] flex-wrap gap-5 text-6xl font-black uppercase leading-none tracking-[0.08em] text-sky-100 drop-shadow-[0_3px_10px_rgba(0,0,0,0.9)]">
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

