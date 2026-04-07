"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LibrarySlideLayer } from "../shared/components/LibrarySlideLayer";
import { ScriptureTextLayer } from "../shared/components/ScriptureTextLayer";
import type {
  VideoSettings,
  LibraryStyle,
  OutputState,
} from "../../shared/types/output-window";
import { ensureFontCatalogLoaded } from "../shared/hooks/useFontCatalog";

export function OutputWindow() {
  const [state, setState] = useState<OutputState>({
    mediaUrl: null,
    mediaType: null,
    mediaId: null,
    showText: false,
    showMedia: true,
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
      footerFontSize: 28,
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
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const wasShowingMediaRef = useRef(false);

  // Listen to IPC messages from main window (relayed through main process)
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
        }));
      } else if (msg.type === "active-slide") {
        setState((prev) => ({
          ...prev,
          activeSlideId: msg.slideId as string | null,
          slideText: (msg.slideText as string) || null,
          slideFooter: (msg.slideFooter as string) || null,
          slideElements: (msg.slideElements as OutputState["slideElements"]) ?? null,
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

    // Tell the main window we're ready to receive state
    window.electronAPI.notifyOutputReady();
  }, []);

  useEffect(() => {
    void ensureFontCatalogLoaded(document, { force: true });
  }, [state.libraryStyle.fontFamily, state.scriptureStyle.fontFamily]);

  // Sync video playback
  useEffect(() => {
    const wasShowingMedia = wasShowingMediaRef.current;
    wasShowingMediaRef.current = state.showMedia;

    if (!videoRef.current || state.mediaType !== "video" || !state.showMedia) {
      return;
    }

    if (state.shouldSyncTime || !wasShowingMedia) {
      if (Math.abs(videoRef.current.currentTime - state.videoCurrentTime) > 0.5) {
        videoRef.current.currentTime = state.videoCurrentTime;
      }
    }

    if (state.isVideoPlaying) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  }, [
    state.showMedia,
    state.isVideoPlaying,
    state.videoCurrentTime,
    state.shouldSyncTime,
    state.mediaType,
    state.mediaUrl,
  ]);

  // Determine if this is a scripture slide
  const isScripture = state.activeSlideId?.startsWith("scripture:") ?? false;
  const shouldUseScriptureTextLayer =
    isScripture && (state.slideElements?.length ?? 0) === 0;

  const timerClockFont = useMemo(
    () =>
      `${Math.min(Math.max(state.timerLayout?.clockFontPx ?? 24, 12), 400)}px`,
    [state.timerLayout?.clockFontPx]
  );
  const timerTitleFont = useMemo(
    () =>
      `${Math.min(Math.max(state.timerLayout?.nameFontPx ?? 14, 8), 220)}px`,
    [state.timerLayout?.nameFontPx]
  );

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black flex flex-col items-center justify-center">
      {/* Media Layer (Background) */}
      {state.showMedia && state.mediaUrl && (
        <div className="absolute inset-0 z-0">
          {state.mediaType === "image" ? (
            <img
              src={state.mediaUrl}
              alt="Background"
              className="w-full h-full object-cover"
              style={{ filter: state.mediaFilterCSS }}
            />
          ) : state.mediaType === "video" ? (
            <video
              ref={videoRef}
              src={state.mediaUrl}
              className="w-full h-full object-cover"
              style={{ filter: state.mediaFilterCSS }}
              loop={state.videoSettings.loop}
              muted={state.videoSettings.muted}
              playsInline
            />
          ) : null}
        </div>
      )}

      {state.slideBackgroundColor ? (
        <div
          className="absolute inset-0 z-[1]"
          style={{ backgroundColor: state.slideBackgroundColor }}
        />
      ) : null}

      {/* Text Layer (Foreground) */}
      {state.showText &&
        (shouldUseScriptureTextLayer
          ? Boolean(state.slideText)
          : Boolean(state.slideText || state.slideElements?.length)) && (
        shouldUseScriptureTextLayer ? (
          <ScriptureTextLayer
            key={[
              state.activeSlideId ?? "",
              state.slideText ?? "",
              state.slideFooter ?? "",
              state.scriptureStyle.fontFamily,
              state.scriptureStyle.fontSize,
              state.scriptureStyle.fontWeight,
              state.scriptureStyle.textAlign,
              state.scriptureStyle.verticalAlign,
              state.scriptureStyle.footerAlign,
              state.scriptureStyle.footerPosition,
            ].join("|")}
            text={state.slideText}
            footer={state.slideFooter}
            fontFamily={state.scriptureStyle.fontFamily}
            fontSize={state.scriptureStyle.fontSize}
            fontWeight={state.scriptureStyle.fontWeight}
            textAlign={state.scriptureStyle.textAlign}
            verticalAlign={state.scriptureStyle.verticalAlign}
            footerAlign={state.scriptureStyle.footerAlign}
            footerPosition={state.scriptureStyle.footerPosition}
            footerFontSize={state.scriptureStyle.footerFontSize}
            footerFontFamily={state.scriptureStyle.fontFamily}
            footerFontWeight={state.scriptureStyle.fontWeight}
            maxFontSize={state.scriptureStyle.fontSize}
            minScale={0.3}
            containerClassName="absolute inset-0 z-10 flex flex-col p-[4vw]"
            bodyClassName="flex h-full min-h-0 w-full flex-1"
            textClassName="text-white leading-relaxed drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] pointer-events-none select-none"
            footerClassName="mt-4 tracking-wide text-white/90 drop-shadow-md uppercase"
          />
        ) : (
          <LibrarySlideLayer
            text={state.slideText}
            elements={state.slideElements}
            canvasSize={state.slideCanvasSize}
            libraryStyle={state.libraryStyle}
            className="absolute inset-0 z-10"
            textClassName="drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]"
            minScale={0.1}
          />
        )
      )}

      {(state.timerVisible ?? true) && state.timerText && (
        <>
          {state.timerLabel && state.timerLayout?.nameBannerEnabled ? (
            <div
              style={{
                fontSize: timerTitleFont,
                color: state.timerLayout?.nameColor ?? "#ffffff",
                backgroundColor:
                  state.timerLayout?.nameBannerColor ?? "#ffffff",
              }}
              className="absolute inset-x-0 top-0 z-20 px-4 py-2 text-center font-medium uppercase tracking-wider"
            >
              {state.timerLabel}
            </div>
          ) : null}
          <div
            style={{
              left: `${state.timerLayout?.xPercent ?? 82}%`,
              top: `${state.timerLayout?.yPercent ?? 8}%`,
              transform: "translate(-50%, -50%)",
            }}
            className="absolute z-20 box-border rounded-md bg-black/65 px-3 py-0 text-white"
          >
            {state.timerLabel &&
              !state.timerLayout?.nameBannerEnabled &&
              state.timerLayout?.titlePosition === "top" && (
                <div
                  style={{
                    fontSize: timerTitleFont,
                    color: state.timerLayout?.nameColor ?? "#ffffff",
                  }}
                  className="mt-1 whitespace-nowrap uppercase tracking-wide"
                >
                  {state.timerLabel}
                </div>
              )}
            <div
              style={{
                fontSize: timerClockFont,
                color: state.timerLayout?.clockColor ?? "#ffffff",
              }}
              className="font-semibold leading-none"
            >
              {state.timerText}
            </div>
            {state.timerLabel &&
              !state.timerLayout?.nameBannerEnabled &&
              state.timerLayout?.titlePosition !== "top" && (
                <div
                  style={{
                    fontSize: timerTitleFont,
                    color: state.timerLayout?.nameColor ?? "#ffffff",
                  }}
                  className="mt-1 whitespace-nowrap uppercase tracking-wide"
                >
                  {state.timerLabel}
                </div>
              )}
          </div>
        </>
      )}
    </div>
  );
}
