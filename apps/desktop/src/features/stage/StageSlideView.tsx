"use client";

import { useMemo } from "react";
import { CanvasSlideLayer } from "../../renderer/shared/components/CanvasSlideLayer";
import { ScriptureTextLayer } from "../../renderer/shared/components/ScriptureTextLayer";
import { RustVideo } from "../../renderer/shared/components/RustVideo";
import { appendInlineInstruction, appendInlineInstructionToElements, type StageSlideState } from "./useStageFeed";

/**
 * The slide as the room sees it, over its media — the operator's video,
 * decoded by Rust where the screens have it: what the worship stage always
 * showed, now a stage layout's Current Slide object.
 */
export function StageSlideView({ slide: state, showSections = true }: { slide: StageSlideState; showSections?: boolean }) {
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
          // Decoded by Rust, where the operator has the video.
          <RustVideo
            label="Worship stage media"
            url={state.mediaUrl}
            clock={{ mode: "scene" }}
            className="absolute inset-0 h-full w-full"
            style={{ filter: state.mediaFilterCSS }}
          />
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

