"use client";

import { useEffect, useState } from "react";
import type { CanvasSizePreset, SlideElement } from "../../shared/types";
import type {
  LibraryStyle,
  OutputTextPosition,
  ScriptureStyle,
  VideoSettings,
} from "../../shared/types/output-window";

/**
 * Everything a stage screen can show, from the two feeds the operator window
 * sends the stage (`commands/stage.rs`): the slide words, next words and
 * sections from the media stage's, the slide as the room sees it and its media
 * from the worship stage's, and the live timer from both. A layout takes what
 * its objects need from it.
 */

export type StageSlideState = {
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


export type TimeUpStyle = { color: string; blink: boolean };

export type StageWords = {
  text: string | null;
  footer: string | null;
  label: string | null;
  repeat: string | null;
  instruction: string | null;
};

export type StageFeed = {
  current: StageWords;
  next: StageWords;
  timer: {
    text: string | null;
    label: string | null;
    visible: boolean;
    timeUp: TimeUpStyle | null;
  };
  slide: StageSlideState;
};

const noWords: StageWords = { text: null, footer: null, label: null, repeat: null, instruction: null };

export const initialSlideState: StageSlideState = {
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


export const initialFeed: StageFeed = {
  current: noWords,
  next: noWords,
  timer: { text: null, label: null, visible: true, timeUp: null },
  slide: initialSlideState,
};

const hasSlideContent = (input: {
  slideText: string | null;
  slideElements: SlideElement[] | null;
  slideBackgroundColor: string | null;
}) =>
  Boolean(input.slideText?.trim()) ||
  Boolean(input.slideElements?.length) ||
  Boolean(input.slideBackgroundColor);

export function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asTimeUp(value: unknown): TimeUpStyle | null {
  if (!value || typeof value !== "object") return null;
  const { color, blink } = value as Partial<TimeUpStyle>;
  return { color: typeof color === "string" ? color : "#ef4444", blink: blink === true };
}

/** The slide's side of the worship stage's feed, as the worship stage read it. */
function readSlideMessage(
  message: Record<string, unknown>,
  setState: (update: (previous: StageSlideState) => StageSlideState) => void,
) {
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
    setState(() => initialSlideState);
  }
}

/** Everything the stage is being sent, kept current. */
export function useStageFeed(): StageFeed {
  const [feed, setFeed] = useState<StageFeed>(initialFeed);

  useEffect(() => {
    const bridge = window.electronAPI;
    if (!bridge?.onStageData) return;
    const stopMedia = bridge.onStageData((data: unknown) => {
      const message = data as Record<string, unknown>;
      if (message.type === "stage-content") {
        setFeed((previous) => ({
          ...previous,
          current: {
            text: asText(message.currentText),
            footer: asText(message.currentFooter),
            label: asText(message.currentLabel),
            repeat: asText(message.currentRepeat),
            instruction: asText(message.currentInlineInstruction),
          },
          next: {
            text: asText(message.nextText),
            footer: asText(message.nextFooter),
            label: asText(message.nextLabel),
            repeat: asText(message.nextRepeat),
            instruction: asText(message.nextInlineInstruction),
          },
        }));
      } else if (message.type === "timer-update") {
        setFeed((previous) => ({
          ...previous,
          timer: {
            text: asText(message.timerText),
            label: asText(message.timerLabel),
            visible: typeof message.timerVisible === "boolean" ? message.timerVisible : previous.timer.visible,
            timeUp: asTimeUp(message.timerTimeUp),
          },
        }));
      } else if (message.type === "clear") {
        setFeed((previous) => ({ ...initialFeed, slide: previous.slide }));
      }
    });
    const stopWorship = bridge.onWorshipStageData?.((data: unknown) => {
      const message = data as Record<string, unknown>;
      if (message.type === "timer-update") return;
      readSlideMessage(message, (update) => setFeed((previous) => ({ ...previous, slide: update(previous.slide) })));
    });
    bridge.notifyStageReady?.();
    bridge.notifyWorshipStageReady?.();
    return () => {
      stopMedia?.();
      stopWorship?.();
    };
  }, []);

  return feed;
}

export function appendInlineInstruction(
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

export function appendInlineInstructionToElements(
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
