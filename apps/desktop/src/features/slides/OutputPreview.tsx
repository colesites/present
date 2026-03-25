"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { AutoFitText } from "../../components/AutoFitText";
import { stripBracketsForDisplay } from "../../lib/lyrics";
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
  Repeat,
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
} from "lucide-react";
import { IoSnow } from "react-icons/io5";
import type {
  MediaFilters,
  MediaItem,
  VideoSettings,
} from "../../features/media/hooks";
import { DEFAULT_FILTERS, filtersToCSS } from "../../features/media/hooks";

const OUTPUT_WIDTH = 240;
const OUTPUT_HEIGHT = 135;

interface SlideGroup {
  label: string;
  count: number;
}

interface OutputPreviewProps {
  text: string | null;
  footer?: string | null;
  activeSlideId?: string | null;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  fontFamily?: string;
  fontSize?: number;
  scriptureFontFamily?: string;
  scriptureFontSize?: number;
  scriptureTextAlign?: "left" | "center" | "right";
  groups?: SlideGroup[];
  activeMediaItem: MediaItem | null;
  videoSettings: VideoSettings;
  onVideoSettingsChange: (settings: Partial<VideoSettings>) => void;
  showText: boolean;
  showMedia: boolean;
  onToggleText: () => void;
  onClearMedia: () => void;
  mediaFilters: MediaFilters;
  onMediaFiltersChange: (filters: Partial<MediaFilters>) => void;
  onResetFilters: () => void;
  isVideoPlaying: boolean;
  videoCurrentTime: number;
  isFrozen?: boolean;
  onToggleFreeze?: () => void;
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
    return (hours * 3600) + (minutes * 60) + seconds;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return (minutes * 60) + seconds;
  }

  return 300;
}

function parseTimeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return (hours * 60) + minutes;
}

function formatSecondsToClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getCountdownToTimeSeconds(hour: number, minute: number, meridiem: "AM" | "PM") {
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
          isDefault ? "text-muted-foreground" : "text-primary",
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
  activeSlideId,
  fontBold,
  fontItalic,
  fontUnderline,
  fontFamily,
  fontSize,
  scriptureFontFamily,
  scriptureFontSize,
  scriptureTextAlign = "center",
  groups = [],
  activeMediaItem,
  videoSettings,
  onVideoSettingsChange,
  showText,
  showMedia,
  onToggleText,
  onClearMedia,
  mediaFilters,
  onMediaFiltersChange,
  onResetFilters,
  isVideoPlaying,
  videoCurrentTime,
  isFrozen,
  onToggleFreeze,
}: OutputPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showFilters, setShowFilters] = useState(false);
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
    "pre-service",
  );

  const hasActiveFilters =
    JSON.stringify(mediaFilters) !== JSON.stringify(DEFAULT_FILTERS);
  const isScriptureSlide = activeSlideId?.startsWith("scripture:") ?? false;

  const activeTimerId = useMemo(
    () =>
      expandedTimerId && timers.some((timer) => timer.id === expandedTimerId)
        ? expandedTimerId
        : timers[0]?.id ?? null,
    [expandedTimerId, timers],
  );

  const activeTimer = useMemo(
    () => timers.find((timer) => timer.id === activeTimerId) ?? null,
    [timers, activeTimerId],
  );

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
              timer.meridiem,
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
        }),
      );
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  const filterStyle = filtersToCSS(mediaFilters);

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
          (field) => field in patch,
        );

        if (!shouldResetRuntime) {
          return nextTimer;
        }

        return {
          ...nextTimer,
          isRunning: false,
          secondsValue: getInitialTimerValue(nextTimer),
        };
      }),
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
              timer.meridiem,
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
      }),
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
          : timer,
      ),
    );
  };

  const stopAllTimers = () => {
    setTimers((previous) =>
      previous.map((timer) => ({ ...timer, isRunning: false })),
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
              targetSeconds > 0 ? Math.min(nextValue, targetSeconds) : nextValue,
            isRunning: false,
          };
        }

        const nextValue = Math.max(timer.secondsValue + delta, 0);
        return { ...timer, secondsValue: nextValue, isRunning: false };
      }),
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
              : "bg-primary",
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

      <div className="flex shrink-0 justify-center px-3">
        <div
          style={{ width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT }}
          className="relative shrink-0 overflow-hidden rounded-lg bg-black"
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

          {showText && text && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
              <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                <AutoFitText
                  text={stripBracketsForDisplay(text)}
                  className={cn(
                    "pointer-events-none select-none leading-relaxed text-white",
                    !isScriptureSlide && fontBold && "font-bold",
                    !isScriptureSlide && fontItalic && "italic",
                    !isScriptureSlide && fontUnderline && "underline",
                    "drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]",
                  )}
                  style={{
                    fontFamily: isScriptureSlide
                      ? scriptureFontFamily || fontFamily
                      : fontFamily,
                  }}
                  align={isScriptureSlide ? scriptureTextAlign : "center"}
                  maxFontSize={
                    isScriptureSlide
                      ? Math.max(24, (scriptureFontSize ?? 72) * 0.3)
                      : fontSize
                        ? fontSize * 0.18
                        : 24
                  }
                  minScale={isScriptureSlide ? 0.45 : 0.4}
                />
              </div>
              {footer && (
                <div className="mt-2 text-[8px] font-semibold uppercase tracking-wide text-white/90 drop-shadow-md sm:text-[10px]">
                  {footer}
                </div>
              )}
            </div>
          )}

          {!text && !activeMediaItem && (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-zinc-600">No content</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 shrink-0 px-3">
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              if (showText) {
                onToggleText();
              }
            }}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium transition",
              showText
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border bg-secondary/40 text-muted-foreground",
            )}
            title="Clear text from output"
          >
            <Music2 className="h-3.5 w-3.5" />
            Text
          </button>
          <button
            type="button"
            disabled
            className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/25 px-2 py-1.5 text-[11px] font-medium text-muted-foreground/70"
            title="Message layer is coming soon"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Message
          </button>
          <button
            type="button"
            onClick={onClearMedia}
            className="flex items-center justify-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/15 px-2 py-1.5 text-[11px] font-medium text-destructive transition hover:bg-destructive/25"
            title="Clear media from output"
          >
            <Image className="h-3.5 w-3.5" />
            Media
          </button>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2">
          {onToggleFreeze && (
            <button
              type="button"
              onClick={onToggleFreeze}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium transition",
                isFrozen
                  ? "border-sky-500/50 bg-sky-500/20 text-sky-300"
                  : "border-border bg-secondary/35 text-muted-foreground hover:text-foreground",
              )}
              title={isFrozen ? "Unfreeze main output" : "Freeze main output"}
            >
              <IoSnow className="h-4 w-4" />
              {isFrozen ? "Frozen" : "Freeze"}
            </button>
          )}
        </div>

        {activeMediaItem ? (
          <button
            type="button"
            onClick={() => setShowFilters((previous) => !previous)}
            className={cn(
              "mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium transition",
              showFilters || hasActiveFilters
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border bg-secondary/35 text-muted-foreground hover:text-foreground",
            )}
            title="Media filters"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Media Settings
          </button>
        ) : null}
      </div>

      {activeMediaItem?.type === "video" && (
        <div className="mt-2 flex shrink-0 items-center justify-center gap-2 px-3">
          <button
            type="button"
            onClick={() => onVideoSettingsChange({ loop: !videoSettings.loop })}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition",
              videoSettings.loop
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
            title={videoSettings.loop ? "Disable loop" : "Enable loop"}
          >
            <Repeat className="h-3 w-3" />
            Loop
          </button>
          <button
            type="button"
            onClick={() =>
              onVideoSettingsChange({ muted: !videoSettings.muted })
            }
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition",
              videoSettings.muted
                ? "bg-destructive/20 text-destructive"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
            title={videoSettings.muted ? "Unmute" : "Mute"}
          >
            {videoSettings.muted ? (
              <VolumeX className="h-3 w-3" />
            ) : (
              <Volume2 className="h-3 w-3" />
            )}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={videoSettings.volume}
            onChange={(event) =>
              onVideoSettingsChange({ volume: Number.parseFloat(event.target.value) })
            }
            className="h-1 w-16 accent-primary"
            title={`Volume: ${Math.round(videoSettings.volume * 100)}%`}
          />
        </div>
      )}

      {activeMediaItem && showFilters && (
        <div className="mx-3 mt-2 shrink-0 space-y-1.5 rounded-lg border border-border bg-card/50 p-2">
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
        </div>
      )}

      {activeMediaItem && (
        <div className="mt-2 shrink-0 px-3">
          <p className="truncate text-center text-[10px] text-muted-foreground">
            {activeMediaItem.name}
          </p>
        </div>
      )}

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

      <div className="mt-4 flex-1 border-t border-border px-3 py-2">
        <div className="mb-2 rounded-md border border-border/70 bg-secondary/25">
          <div className="px-2 pt-2">
            <input
              type="range"
              min={0}
              max={100}
              defaultValue={100}
              className="h-1.5 w-full accent-muted-foreground"
              aria-label="Timer intensity"
            />
          </div>
          <div className="flex items-center justify-center gap-1.5 px-2 py-2">
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
                if (activeTimerId) {
                  toggleTimerPlayback(activeTimerId);
                }
              }}
              disabled={!activeTimer}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-foreground transition hover:bg-accent/35 disabled:opacity-40"
              title={activeTimer?.isRunning ? "Pause timer" : "Play timer"}
            >
              {activeTimer?.isRunning ? (
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
                if (activeTimerId) {
                  resetTimer(activeTimerId);
                }
              }}
              disabled={!activeTimerId}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background/60 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
              title="Reset timer"
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
          </div>
        </div>

        <div className="mb-2 grid grid-cols-6 overflow-hidden rounded-md border border-border/70 bg-secondary/20">
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
            className="inline-flex h-7 items-center justify-center border-r border-border/70 bg-destructive/70 text-white"
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
                        current === timer.id ? null : timer.id,
                      )
                    }
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border/70 bg-background/40 text-muted-foreground"
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        isExpanded ? "rotate-180" : "-rotate-90",
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
                          : "border-border bg-background/50 text-muted-foreground hover:text-foreground",
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
                      <select
                        value={timer.type}
                        onChange={(event) =>
                          updateTimer(timer.id, {
                            type: event.target.value as TimerType,
                          })
                        }
                        className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
                      >
                        <option value="countdown">Countdown Timer</option>
                        <option value="countdownToTime">Countdown to Time</option>
                        <option value="elapsed">Elapsed Time</option>
                      </select>
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
                            updateTimer(timer.id, { duration: event.target.value })
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
                          <select
                            value={timer.hour}
                            onChange={(event) =>
                              updateTimer(timer.id, {
                                hour: Number.parseInt(event.target.value, 10),
                              })
                            }
                            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
                          >
                            {Array.from({ length: 12 }, (_, index) => index + 1).map(
                              (hourValue) => (
                                <option key={hourValue} value={hourValue}>
                                  {hourValue}
                                </option>
                              ),
                            )}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground">
                            Minute
                          </label>
                          <select
                            value={timer.minute}
                            onChange={(event) =>
                              updateTimer(timer.id, {
                                minute: Number.parseInt(event.target.value, 10),
                              })
                            }
                            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
                          >
                            {Array.from({ length: 60 }, (_, index) => index).map(
                              (minuteValue) => (
                                <option key={minuteValue} value={minuteValue}>
                                  {String(minuteValue).padStart(2, "0")}
                                </option>
                              ),
                            )}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground">
                            Period
                          </label>
                          <select
                            value={timer.meridiem}
                            onChange={(event) =>
                              updateTimer(timer.id, {
                                meridiem: event.target.value as "AM" | "PM",
                              })
                            }
                            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
                          >
                            <option value="AM">AM</option>
                            <option value="PM">PM</option>
                          </select>
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
