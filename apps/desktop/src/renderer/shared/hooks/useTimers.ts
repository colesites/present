"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Timer state + helpers, lifted out of OutputPreview so the new sidebar-rail
// Timer panel and the audience-output broadcast effect can share a single
// source of truth.

export type TimerType = "countdown" | "countdownToTime" | "elapsed";

export type TimerConfig = {
  id: string;
  name: string;
  type: TimerType;
  duration: string; // HH:MM:SS for countdown
  hour: number;
  minute: number;
  meridiem: "AM" | "PM";
  elapsedStart: string; // HH:MM
  elapsedEnd: string; // HH:MM
};

export type TimerItem = TimerConfig & {
  isRunning: boolean;
  secondsValue: number;
};

const TIMER_AFFECTS_RUNTIME_FIELDS: (keyof TimerConfig)[] = [
  "type",
  "duration",
  "hour",
  "minute",
  "meridiem",
  "elapsedStart",
  "elapsedEnd",
];

export function parseDurationToSeconds(value: string): number {
  const parts = value.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return 300;
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

function parseTimeToMinutes(value: string): number | null {
  const [hours, minutes] = value
    .split(":")
    .map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function formatSecondsToClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getCountdownToTimeSeconds(
  hour: number,
  minute: number,
  meridiem: "AM" | "PM",
): number {
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

export function getElapsedTargetSeconds(timer: TimerConfig): number {
  const start = parseTimeToMinutes(timer.elapsedStart);
  const end = parseTimeToMinutes(timer.elapsedEnd);
  if (start === null || end === null) return 0;
  return Math.max((end - start) * 60, 0);
}

export function getInitialTimerValue(timer: TimerConfig): number {
  if (timer.type === "countdown") return parseDurationToSeconds(timer.duration);
  if (timer.type === "countdownToTime")
    return getCountdownToTimeSeconds(timer.hour, timer.minute, timer.meridiem);
  return 0;
}

export function getTimerDisplay(timer: TimerItem): string {
  if (timer.type === "countdownToTime" && !timer.isRunning) {
    return `Countdown to ${timer.hour}:${String(timer.minute).padStart(2, "0")} ${timer.meridiem}`;
  }
  if (timer.type === "elapsed" && !timer.isRunning) {
    return formatSecondsToClock(getElapsedTargetSeconds(timer));
  }
  return formatSecondsToClock(timer.secondsValue);
}

export function getTimerTypeLabel(timerType: TimerType): string {
  if (timerType === "countdown") return "Countdown";
  if (timerType === "countdownToTime") return "Countdown to Time";
  return "Elapsed";
}

const DEFAULT_TIMERS: TimerConfig[] = [
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

export interface UseTimersResult {
  timers: TimerItem[];
  activeTimer: TimerItem | null;
  expandedTimerId: string | null;
  setExpandedTimerId: (id: string | null) => void;
  createTimer: () => void;
  updateTimer: (id: string, patch: Partial<TimerConfig>) => void;
  toggleTimerPlayback: (id: string) => void;
  resetTimer: (id: string) => void;
  removeTimer: (id: string) => void;
  stopAllTimers: () => void;
  adjustTimerSeconds: (id: string, delta: number) => void;
}

export function useTimers(): UseTimersResult {
  const [timers, setTimers] = useState<TimerItem[]>(() =>
    DEFAULT_TIMERS.map((timer) => ({
      ...timer,
      isRunning: false,
      secondsValue: getInitialTimerValue(timer),
    })),
  );
  const [expandedTimerId, setExpandedTimerId] = useState<string | null>(
    "pre-service",
  );

  const activeTimerId = useMemo(
    () =>
      expandedTimerId && timers.some((t) => t.id === expandedTimerId)
        ? expandedTimerId
        : (timers[0]?.id ?? null),
    [expandedTimerId, timers],
  );

  const activeTimer = useMemo(
    () => timers.find((t) => t.id === activeTimerId) ?? null,
    [timers, activeTimerId],
  );

  // 1Hz tick for any running timer.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTimers((previous) =>
        previous.map((timer) => {
          if (!timer.isRunning) return timer;

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
              return { ...timer, isRunning: false, secondsValue: targetSeconds };
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

  const createTimer = useCallback(() => {
    setTimers((previous) => {
      const config: TimerConfig = {
        id: crypto.randomUUID(),
        name: `Timer ${previous.length + 1}`,
        type: "countdown",
        duration: "00:05:00",
        hour: 5,
        minute: 0,
        meridiem: "PM",
        elapsedStart: "00:00",
        elapsedEnd: "00:15",
      };
      const timer: TimerItem = {
        ...config,
        isRunning: false,
        secondsValue: getInitialTimerValue(config),
      };
      setExpandedTimerId(timer.id);
      return [...previous, timer];
    });
  }, []);

  const updateTimer = useCallback(
    (id: string, patch: Partial<TimerConfig>) => {
      setTimers((previous) =>
        previous.map((timer) => {
          if (timer.id !== id) return timer;
          const next = { ...timer, ...patch };
          const shouldReset = TIMER_AFFECTS_RUNTIME_FIELDS.some(
            (field) => field in patch,
          );
          if (!shouldReset) return next;
          return {
            ...next,
            isRunning: false,
            secondsValue: getInitialTimerValue(next),
          };
        }),
      );
    },
    [],
  );

  const toggleTimerPlayback = useCallback((id: string) => {
    setTimers((previous) =>
      previous.map((timer) => {
        if (timer.id !== id) return timer;
        if (timer.isRunning) return { ...timer, isRunning: false };

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
  }, []);

  const resetTimer = useCallback((id: string) => {
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
  }, []);

  const removeTimer = useCallback((id: string) => {
    setTimers((previous) => previous.filter((timer) => timer.id !== id));
    setExpandedTimerId((current) => (current === id ? null : current));
  }, []);

  const stopAllTimers = useCallback(() => {
    setTimers((previous) =>
      previous.map((timer) => ({ ...timer, isRunning: false })),
    );
  }, []);

  const adjustTimerSeconds = useCallback((id: string, delta: number) => {
    setTimers((previous) =>
      previous.map((timer) => {
        if (timer.id !== id) return timer;
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
  }, []);

  return {
    timers,
    activeTimer,
    expandedTimerId,
    setExpandedTimerId,
    createTimer,
    updateTimer,
    toggleTimerPlayback,
    resetTimer,
    removeTimer,
    stopAllTimers,
    adjustTimerSeconds,
  };
}
