"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../renderer/shared/lib/utils";
import { LibrarySlideLayer } from "../../renderer/shared/components/LibrarySlideLayer";
import { ScriptureTextLayer } from "../../renderer/shared/components/ScriptureTextLayer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../renderer/shared/components/ui/select";
import {
  ChevronDown,
  Clock3,
  Image,
  Layers3,
  MessageSquare,
  Monitor,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  Trash2,
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
import type { CanvasSizePreset, SlideElement } from "../../shared/types";
import type {
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
  onToggleText: () => void;
  onToggleMedia: () => void;
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

type TimerType = "countdown" | "countdownToTime" | "elapsed";

type TimerConfig = {
  id: string;
  name: string;
  type: TimerType;
  duration: string;
  hour: number;
  minute: number;
  meridiem: "AM" | "PM";
  elapsedStart: string;
  elapsedEnd: string;
};

type TimerItem = TimerConfig & {
  isRunning: boolean;
  secondsValue: number;
};

function parseDurationToSeconds(value: string) {
  const parts = value.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) {
    return 300;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }

  return 300;
}

function parseTimeToMinutes(value: string) {
  const [hours, minutes] = value
    .split(":")
    .map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
}

function formatSecondsToClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getCountdownToTimeSeconds(
  hour: number,
  minute: number,
  meridiem: "AM" | "PM"
) {
  const now = new Date();
  const target = new Date(now);
  const normalizedHour = hour % 12;
  const hour24 = meridiem === "PM" ? normalizedHour + 12 : normalizedHour;
  target.setHours(hour24, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return Math.floor((target.getTime() - now.getTime()) / 1000);
}

function getElapsedTargetSeconds(timer: TimerConfig) {
  const start = parseTimeToMinutes(timer.elapsedStart);
  const end = parseTimeToMinutes(timer.elapsedEnd);
  if (start === null || end === null) {
    return 0;
  }

  return Math.max((end - start) * 60, 0);
}

function getInitialTimerValue(timer: TimerConfig) {
  if (timer.type === "countdown") {
    return parseDurationToSeconds(timer.duration);
  }

  if (timer.type === "countdownToTime") {
    return getCountdownToTimeSeconds(timer.hour, timer.minute, timer.meridiem);
  }

  return 0;
}

function getTimerDisplay(timer: TimerItem) {
  if (timer.type === "countdownToTime" && !timer.isRunning) {
    return `Countdown to ${timer.hour}:${String(timer.minute).padStart(2, "0")} ${timer.meridiem}`;
  }

  if (timer.type === "elapsed" && !timer.isRunning) {
    return formatSecondsToClock(getElapsedTargetSeconds(timer));
  }

  return formatSecondsToClock(timer.secondsValue);
}

function getTimerTypeLabel(timerType: TimerType) {
  if (timerType === "countdown") {
    return "Countdown";
  }
  if (timerType === "countdownToTime") {
    return "Countdown to Time";
  }
  return "Elapsed";
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
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
        className="h-1 min-w-0 flex-1 accent-primary"
      />
      <span
        className={cn(
          "w-6 shrink-0 text-right text-[9px]",
          isDefault ? "text-muted-foreground" : "text-primary"
        )}
      >
        {value}
      </span>
    </div>
  );
});

const timerAffectsClockFields: (keyof TimerConfig)[] = [
  "type",
  "duration",
  "hour",
  "minute",
  "meridiem",
  "elapsedStart",
  "elapsedEnd",
];

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
  onToggleText,
  onToggleMedia,
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
  timerLayout,
}: OutputPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const outputFrameRef = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [previewScale, setPreviewScale] = useState(0.35);
  const [timerSyncTrigger, setTimerSyncTrigger] = useState(0);
  const [timers, setTimers] = useState<TimerItem[]>(() => {
    const defaults: TimerConfig[] = [
      {
        id: "pre-service",
        name: "Pre-Service",
        type: "countdown",
        duration: "00:15:00",
        hour: 9,
        minute: 0,
        meridiem: "AM",
        elapsedStart: "00:00",
        elapsedEnd: "00:15",
      },
      {
        id: "opening-prayer",
        name: "Opening Prayer",
        type: "countdown",
        duration: "00:05:00",
        hour: 9,
        minute: 0,
        meridiem: "AM",
        elapsedStart: "00:00",
        elapsedEnd: "00:05",
      },
      {
        id: "praise-worship",
        name: "Praise & Worship",
        type: "elapsed",
        duration: "00:20:00",
        hour: 9,
        minute: 0,
        meridiem: "AM",
        elapsedStart: "00:00",
        elapsedEnd: "00:20",
      },
    ];

    return defaults.map((timer) => ({
      ...timer,
      isRunning: false,
      secondsValue: getInitialTimerValue(timer),
    }));
  });
  const [expandedTimerId, setExpandedTimerId] = useState<string | null>(
    "pre-service"
  );

  const isScriptureSlide = activeSlideId?.startsWith("scripture:") ?? false;
  const shouldUseScriptureTextLayer =
    isScriptureSlide && (slideElements?.length ?? 0) === 0;
  const hasLibrarySlideLayer = Boolean(text || (slideElements?.length ?? 0) > 0);
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

  const activeTimerId = useMemo(
    () =>
      expandedTimerId && timers.some((timer) => timer.id === expandedTimerId)
        ? expandedTimerId
        : (timers[0]?.id ?? null),
    [expandedTimerId, timers]
  );

  const activeTimer = useMemo(
    () => timers.find((timer) => timer.id === activeTimerId) ?? null,
    [timers, activeTimerId]
  );
  const activeTimerDisplay = useMemo(
    () => (activeTimer ? getTimerDisplay(activeTimer) : null),
    [activeTimer]
  );
  const timerLabelForOutput = activeTimer?.name ?? "Timer Name";
  const timerTextForOutput = activeTimerDisplay ?? "00:00:00";
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

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }
    window.electronAPI.onOutputReady(() => {
      setTimerSyncTrigger((current) => current + 1);
    });
  }, []);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }
    window.electronAPI.sendToOutput({
      type: "timer-update",
      timerLabel: timerLabelForOutput,
      timerText: timerTextForOutput,
      timerRunning: activeTimer?.isRunning ?? false,
      timerVisible: isTimerLayerEnabled,
    });
  }, [
    activeTimer?.isRunning,
    isTimerLayerEnabled,
    timerLabelForOutput,
    timerTextForOutput,
    timerSyncTrigger,
  ]);

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

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTimers((previous) =>
        previous.map((timer) => {
          if (!timer.isRunning) {
            return timer;
          }

          if (timer.type === "countdownToTime") {
            const remaining = getCountdownToTimeSeconds(
              timer.hour,
              timer.minute,
              timer.meridiem
            );
            if (remaining <= 0) {
              return { ...timer, isRunning: false, secondsValue: 0 };
            }
            return { ...timer, secondsValue: remaining };
          }

          if (timer.type === "elapsed") {
            const targetSeconds = getElapsedTargetSeconds(timer);
            const nextElapsed = timer.secondsValue + 1;
            if (targetSeconds > 0 && nextElapsed >= targetSeconds) {
              return {
                ...timer,
                isRunning: false,
                secondsValue: targetSeconds,
              };
            }

            return { ...timer, secondsValue: nextElapsed };
          }

          const nextRemaining = Math.max(timer.secondsValue - 1, 0);
          return {
            ...timer,
            isRunning: nextRemaining > 0,
            secondsValue: nextRemaining,
          };
        })
      );
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

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

  const createTimer = () => {
    const timerConfig: TimerConfig = {
      id: crypto.randomUUID(),
      name: `Timer ${timers.length + 1}`,
      type: "countdown",
      duration: "00:05:00",
      hour: 5,
      minute: 0,
      meridiem: "PM",
      elapsedStart: "00:00",
      elapsedEnd: "00:15",
    };

    const timer: TimerItem = {
      ...timerConfig,
      isRunning: false,
      secondsValue: getInitialTimerValue(timerConfig),
    };

    setTimers((previous) => [...previous, timer]);
    setExpandedTimerId(timer.id);
  };

  const updateTimer = (id: string, patch: Partial<TimerConfig>) => {
    setTimers((previous) =>
      previous.map((timer) => {
        if (timer.id !== id) {
          return timer;
        }

        const nextTimer = { ...timer, ...patch };
        const shouldResetRuntime = timerAffectsClockFields.some(
          (field) => field in patch
        );

        if (!shouldResetRuntime) {
          return nextTimer;
        }

        return {
          ...nextTimer,
          isRunning: false,
          secondsValue: getInitialTimerValue(nextTimer),
        };
      })
    );
  };

  const toggleTimerPlayback = (id: string) => {
    setTimers((previous) =>
      previous.map((timer) => {
        if (timer.id !== id) {
          return timer;
        }

        if (timer.isRunning) {
          return { ...timer, isRunning: false };
        }

        if (timer.type === "countdownToTime") {
          return {
            ...timer,
            isRunning: true,
            secondsValue: getCountdownToTimeSeconds(
              timer.hour,
              timer.minute,
              timer.meridiem
            ),
          };
        }

        if (timer.type === "elapsed") {
          const targetSeconds = getElapsedTargetSeconds(timer);
          const startAt =
            targetSeconds > 0 && timer.secondsValue >= targetSeconds
              ? 0
              : timer.secondsValue;
          return { ...timer, isRunning: true, secondsValue: startAt };
        }

        return {
          ...timer,
          isRunning: true,
          secondsValue:
            timer.secondsValue > 0
              ? timer.secondsValue
              : getInitialTimerValue(timer),
        };
      })
    );
  };

  const resetTimer = (id: string) => {
    setTimers((previous) =>
      previous.map((timer) =>
        timer.id === id
          ? {
              ...timer,
              isRunning: false,
              secondsValue: getInitialTimerValue(timer),
            }
          : timer
      )
    );
  };

  const stopAllTimers = () => {
    setTimers((previous) =>
      previous.map((timer) => ({ ...timer, isRunning: false }))
    );
  };

  const adjustTimerSeconds = (id: string, delta: number) => {
    setTimers((previous) =>
      previous.map((timer) => {
        if (timer.id !== id) {
          return timer;
        }

        if (timer.type === "elapsed") {
          const targetSeconds = getElapsedTargetSeconds(timer);
          const nextValue = Math.max(timer.secondsValue + delta, 0);
          return {
            ...timer,
            secondsValue:
              targetSeconds > 0
                ? Math.min(nextValue, targetSeconds)
                : nextValue,
            isRunning: false,
          };
        }

        const nextValue = Math.max(timer.secondsValue + delta, 0);
        return { ...timer, secondsValue: nextValue, isRunning: false };
      })
    );
  };

  const removeTimer = (id: string) => {
    setTimers((previous) => previous.filter((timer) => timer.id !== id));
    setExpandedTimerId((current) => (current === id ? null : current));
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            activeMediaItem || text
              ? isFrozen
                ? "bg-sky-400"
                : "bg-green-500"
              : "bg-primary"
          )}
        />
        <p className="text-xs font-medium text-muted-foreground">
          Main Output
          {isFrozen && (
            <span className="ml-2 text-[10px] uppercase tracking-wide text-sky-400">
              Frozen
            </span>
          )}
        </p>
      </div>

      <div className="shrink-0">
        <div className="flex items-stretch gap-2">
          <div
            ref={outputFrameRef}
            className="relative min-w-0 flex-1 aspect-video overflow-hidden rounded-sm border border-border/60 bg-black"
          >
            {showMedia &&
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
                  ref={videoRef}
                  src={activeMediaItem.url}
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ filter: filterStyle }}
                  loop={videoSettings.loop}
                  muted
                  playsInline
                />
              ))}

            {backgroundColor ? (
              <div
                className="absolute inset-0"
                style={{ backgroundColor }}
              />
            ) : null}

            {showText &&
              (shouldUseScriptureTextLayer
                ? Boolean(text)
                : hasLibrarySlideLayer) && (
              shouldUseScriptureTextLayer ? (
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
                  containerClassName="absolute inset-0 z-10 flex flex-col p-4"
                  bodyClassName="min-h-0 w-full flex-1"
                  textClassName="pointer-events-none select-none leading-relaxed text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                  footerClassName="mt-2 uppercase tracking-wide text-white/90 drop-shadow-md"
                />
              ) : (
                <LibrarySlideLayer
                  text={text}
                  elements={slideElements}
                  canvasSize={canvasSize}
                  libraryStyle={libraryStyle}
                  className="absolute inset-0 z-10"
                  textClassName="drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                  minScale={0.4}
                  fontSizeScale={previewTextScale}
                  fitScale={1}
                />
              )
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

            {!text && !activeMediaItem && !isTimerLayerEnabled && (
              <div className="absolute inset-0 z-0 flex h-full items-center justify-center">
                <p className="text-xs text-zinc-600">No content</p>
              </div>
            )}
          </div>

          <div className="grid w-24 shrink-0 grid-cols-[2.8rem_1fr] text-muted-foreground pr-2">
            <div className="flex items-center justify-center border-r border-border/70">
              <button
                type="button"
                onClick={() => {
                  if (showText) {
                    onToggleText();
                  }
                  onClearMedia();
                }}
                className="inline-flex h-10 w-10 items-center justify-center transition hover:text-foreground"
                title="Clear text and media"
              >
                <X className="h-7 w-7" />
              </button>
            </div>
            <div className="flex flex-col items-center justify-between py-1">
              <button
                type="button"
                onClick={onToggleText}
                aria-pressed={showText}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center transition hover:text-foreground",
                  showText ? "text-primary" : "text-muted-foreground"
                )}
                title={showText ? "Hide text layer" : "Show text layer"}
              >
                <Type className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={onToggleMessageLayer}
                aria-pressed={isMessageLayerEnabled}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center transition hover:text-foreground",
                  isMessageLayerEnabled ? "text-primary" : "text-muted-foreground"
                )}
                title={
                  isMessageLayerEnabled
                    ? "Hide message layer"
                    : "Show message layer"
                }
              >
                <MessageSquare className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={onToggleMedia}
                aria-pressed={showMedia && Boolean(activeMediaItem)}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center transition hover:text-foreground",
                  showMedia && activeMediaItem
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
                title={showMedia ? "Hide media layer" : "Show media layer"}
              >
                <Image className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={() => setShowFilters((previous) => !previous)}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center transition hover:text-foreground",
                  showFilters
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
                title="Media filters"
              >
                <SlidersHorizontal className="h-6 w-6" />
              </button>
              {onToggleFreeze && (
                <button
                  type="button"
                  onClick={onToggleFreeze}
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center transition hover:text-foreground",
                    isFrozen ? "text-sky-400" : "text-muted-foreground"
                  )}
                  title={
                    isFrozen ? "Unfreeze main output" : "Freeze main output"
                  }
                >
                  <IoSnow className="h-6 w-6" />
                </button>
              )}
            </div>
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

      <div className="mt-4 flex-1 border-t border-border px-3 py-2">
        <div className="mb-2 rounded-md border border-border/70 bg-secondary/25">
          <div className="px-2 pt-2">
            {activeMediaItem?.type === "video" ? (
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={videoSettings.volume}
                onChange={(event) =>
                  onVideoSettingsChange({
                    volume: Number.parseFloat(event.target.value),
                  })
                }
                className="h-1.5 w-full accent-muted-foreground"
                aria-label="Video volume"
                title={`Volume: ${Math.round(videoSettings.volume * 100)}%`}
              />
            ) : (
              <input
                type="range"
                min={0}
                max={100}
                defaultValue={100}
                className="h-1.5 w-full accent-muted-foreground"
                aria-label="Timer intensity"
              />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5 px-2 py-2">
            <button
              type="button"
              onClick={() => {
                if (activeTimerId) {
                  adjustTimerSeconds(activeTimerId, -15);
                }
              }}
              disabled={!activeTimerId}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background/60 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
              title="Rewind 15s"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>
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
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-foreground transition hover:bg-accent/35 disabled:opacity-40"
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
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )
              ) : activeTimer?.isRunning ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeTimerId) {
                  adjustTimerSeconds(activeTimerId, 15);
                }
              }}
              disabled={!activeTimerId}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background/60 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
              title="Forward 15s"
            >
              <SkipForward className="h-3.5 w-3.5" />
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
                "inline-flex h-7 w-7 items-center justify-center rounded border transition disabled:opacity-40",
                activeMediaItem?.type === "video"
                  ? videoSettings.loop
                    ? "border-primary/60 bg-primary/20 text-primary"
                    : "border-border bg-background/60 text-muted-foreground hover:text-foreground"
                  : "border-border bg-background/60 text-muted-foreground hover:text-foreground"
              )}
              title={
                activeMediaItem?.type === "video"
                  ? videoSettings.loop
                    ? "Disable video loop"
                    : "Enable video loop"
                  : "Reset timer"
              }
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={stopAllTimers}
              disabled={timers.every((timer) => !timer.isRunning)}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background/60 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
              title="Stop all timers"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
            {activeMediaItem?.type === "video" ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    onVideoSettingsChange({ muted: !videoSettings.muted })
                  }
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded border transition",
                    videoSettings.muted
                      ? "border-destructive/50 bg-destructive/15 text-destructive"
                      : "border-border bg-background/60 text-muted-foreground hover:text-foreground"
                  )}
                  title={videoSettings.muted ? "Unmute video" : "Mute video"}
                >
                  {videoSettings.muted ? (
                    <VolumeX className="h-3.5 w-3.5" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="mb-2 grid grid-cols-6 overflow-hidden rounded-md border border-border/70 bg-secondary/20 mr-1.5 font-bold uppercase tracking-widest text-muted-foreground">
          <button
            type="button"
            className="inline-flex h-7 items-center justify-center border-r border-border/70 text-muted-foreground"
            title="Audio"
          >
            <Music2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center justify-center border-r border-border/70 text-muted-foreground"
            title="Text"
          >
            <Type className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggleTimerLayer}
            aria-pressed={isTimerLayerEnabled}
            className={cn(
              "inline-flex h-7 items-center justify-center border-r border-border/70 transition",
              isTimerLayerEnabled
                ? "bg-destructive/70 text-white"
                : "text-muted-foreground hover:text-foreground"
            )}
            title="Timers"
          >
            <Clock3 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center justify-center border-r border-border/70 text-muted-foreground"
            title="Messages"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center justify-center border-r border-border/70 text-muted-foreground"
            title="Layers"
          >
            <Layers3 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center justify-center text-muted-foreground"
            title="Media"
          >
            <Monitor className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Timers
          </p>
          <button
            type="button"
            onClick={createTimer}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-secondary/30 text-muted-foreground transition hover:text-foreground"
            title="Add timer"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-1.5 overflow-y-auto pr-1">
          {timers.map((timer) => {
            const isExpanded = expandedTimerId === timer.id;

            return (
              <div
                key={timer.id}
                className="overflow-hidden rounded-md border border-border/80 bg-secondary/15"
              >
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedTimerId((current) =>
                        current === timer.id ? null : timer.id
                      )
                    }
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border/70 bg-background/40 text-muted-foreground"
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        isExpanded ? "rotate-180" : "-rotate-90"
                      )}
                    />
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {timer.name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {getTimerDisplay(timer)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => resetTimer(timer.id)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background/50 text-muted-foreground transition hover:text-foreground"
                      title="Reset timer"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleTimerPlayback(timer.id)}
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded border transition",
                        timer.isRunning
                          ? "border-primary/60 bg-primary/20 text-primary"
                          : "border-border bg-background/50 text-muted-foreground hover:text-foreground"
                      )}
                      title={timer.isRunning ? "Pause timer" : "Play timer"}
                    >
                      {timer.isRunning ? (
                        <Pause className="h-3 w-3" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="space-y-2 border-t border-border/70 px-2 py-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground">
                        Name
                      </label>
                      <input
                        value={timer.name}
                        onChange={(event) =>
                          updateTimer(timer.id, { name: event.target.value })
                        }
                        className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground">
                        Type
                      </label>
                      <Select
                        value={timer.type}
                        onValueChange={(value) =>
                          updateTimer(timer.id, { type: value as TimerType })
                        }
                      >
                        <SelectTrigger className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-primary/60 focus-visible:ring-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="countdown">Countdown Timer</SelectItem>
                          <SelectItem value="countdownToTime">
                            Countdown to Time
                          </SelectItem>
                          <SelectItem value="elapsed">Elapsed Time</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">
                        {getTimerTypeLabel(timer.type)}
                      </p>
                    </div>

                    {timer.type === "countdown" ? (
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground">
                          Duration (HH:MM:SS)
                        </label>
                        <input
                          value={timer.duration}
                          onChange={(event) =>
                            updateTimer(timer.id, {
                              duration: event.target.value,
                            })
                          }
                          className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
                        />
                      </div>
                    ) : null}

                    {timer.type === "countdownToTime" ? (
                      <div className="grid grid-cols-3 gap-1.5">
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground">
                            Hour
                          </label>
                          <Select
                            value={String(timer.hour)}
                            onValueChange={(value) =>
                              updateTimer(timer.id, {
                                hour: Number.parseInt(value, 10),
                              })
                            }
                          >
                            <SelectTrigger className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-primary/60 focus-visible:ring-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from(
                                { length: 12 },
                                (_, index) => index + 1,
                              ).map((hourValue) => (
                                <SelectItem key={hourValue} value={String(hourValue)}>
                                  {hourValue}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground">
                            Minute
                          </label>
                          <Select
                            value={String(timer.minute)}
                            onValueChange={(value) =>
                              updateTimer(timer.id, {
                                minute: Number.parseInt(value, 10),
                              })
                            }
                          >
                            <SelectTrigger className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-primary/60 focus-visible:ring-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from(
                                { length: 60 },
                                (_, index) => index,
                              ).map((minuteValue) => (
                                <SelectItem
                                  key={minuteValue}
                                  value={String(minuteValue)}
                                >
                                  {String(minuteValue).padStart(2, "0")}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground">
                            Period
                          </label>
                          <Select
                            value={timer.meridiem}
                            onValueChange={(value) =>
                              updateTimer(timer.id, {
                                meridiem: value as "AM" | "PM",
                              })
                            }
                          >
                            <SelectTrigger className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-primary/60 focus-visible:ring-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="AM">AM</SelectItem>
                              <SelectItem value="PM">PM</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ) : null}

                    {timer.type === "elapsed" ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground">
                            Start
                          </label>
                          <input
                            type="time"
                            value={timer.elapsedStart}
                            onChange={(event) =>
                              updateTimer(timer.id, {
                                elapsedStart: event.target.value,
                              })
                            }
                            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground">
                            End
                          </label>
                          <input
                            type="time"
                            value={timer.elapsedEnd}
                            onChange={(event) =>
                              updateTimer(timer.id, {
                                elapsedEnd: event.target.value,
                              })
                            }
                            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
                          />
                        </div>
                      </div>
                    ) : null}

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeTimer(timer.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/15 px-2 py-1 text-[10px] font-medium text-destructive transition hover:bg-destructive/25"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
