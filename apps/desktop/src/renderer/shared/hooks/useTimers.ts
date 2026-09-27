"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  /**
   * It ran to its end and stopped there, rather than being paused or reset.
   * What the screens show as "time up". Not kept across a restart.
   */
  finished?: boolean;
};

/** What the screens show once the live timer has run out (Settings, Timer). */
export type TimeUpSettings = {
  /** Show the message rather than the finished clock's 00:00:00. */
  enabled: boolean;
  text: string;
  color: string;
  blink: boolean;
};

export const DEFAULT_TIME_UP: TimeUpSettings = {
  enabled: true,
  text: "TIME UP",
  color: "#ef4444",
  blink: true,
};

export function normalizeTimeUp(value: unknown): TimeUpSettings {
  if (!value || typeof value !== "object") return DEFAULT_TIME_UP;
  const candidate = value as Partial<TimeUpSettings>;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : DEFAULT_TIME_UP.enabled,
    text: typeof candidate.text === "string" ? candidate.text.slice(0, 40) : DEFAULT_TIME_UP.text,
    color:
      typeof candidate.color === "string" && candidate.color.trim()
        ? candidate.color.trim()
        : DEFAULT_TIME_UP.color,
    blink: typeof candidate.blink === "boolean" ? candidate.blink : DEFAULT_TIME_UP.blink,
  };
}

/** Whether the screens show the time-up message for this timer now. */
export function isTimeUpShowing(timer: TimerItem | null, timeUp: TimeUpSettings): boolean {
  return Boolean(timer?.finished && !timer.isRunning && timeUp.enabled);
}

/** The words the screens show for the live timer, "time up" included. */
export function getLiveTimerText(timer: TimerItem | null, timeUp: TimeUpSettings): string {
  if (!timer) return "00:00:00";
  if (isTimeUpShowing(timer, timeUp)) return timeUp.text.trim() || DEFAULT_TIME_UP.text;
  return getTimerDisplay(timer);
}

type StoredTimerState = {
  timers: TimerItem[];
  expandedTimerId: string | null;
  activeTimerId: string | null;
  autoAdvanceEnabled: boolean;
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

const TIMER_STATE_STORAGE_KEY = "present-timer-state-v1";

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

const createDefaultTimerItems = (): TimerItem[] =>
  DEFAULT_TIMERS.map((timer) => ({
    ...timer,
    isRunning: false,
    secondsValue: getInitialTimerValue(timer),
  }));

function normalizeTimerType(value: unknown): TimerType {
  return value === "countdownToTime" || value === "elapsed" ? value : "countdown";
}

function normalizeMeridiem(value: unknown): "AM" | "PM" {
  return value === "PM" ? "PM" : "AM";
}

function normalizeTimerItem(candidate: unknown, index: number): TimerItem | null {
  if (!candidate || typeof candidate !== "object") return null;
  const timer = candidate as Partial<TimerItem>;
  const config: TimerConfig = {
    id:
      typeof timer.id === "string" && timer.id.trim()
        ? timer.id
        : `timer-${index + 1}`,
    name:
      typeof timer.name === "string" && timer.name.trim()
        ? timer.name
        : `Timer ${index + 1}`,
    type: normalizeTimerType(timer.type),
    duration:
      typeof timer.duration === "string" && timer.duration.trim()
        ? timer.duration
        : "00:05:00",
    hour:
      typeof timer.hour === "number" && Number.isFinite(timer.hour)
        ? Math.min(Math.max(Math.floor(timer.hour), 1), 12)
        : 5,
    minute:
      typeof timer.minute === "number" && Number.isFinite(timer.minute)
        ? Math.min(Math.max(Math.floor(timer.minute), 0), 59)
        : 0,
    meridiem: normalizeMeridiem(timer.meridiem),
    elapsedStart:
      typeof timer.elapsedStart === "string" && timer.elapsedStart.trim()
        ? timer.elapsedStart
        : "00:00",
    elapsedEnd:
      typeof timer.elapsedEnd === "string" && timer.elapsedEnd.trim()
        ? timer.elapsedEnd
        : "00:15",
  };
  return {
    ...config,
    isRunning: false,
    secondsValue:
      typeof timer.secondsValue === "number" && Number.isFinite(timer.secondsValue)
        ? Math.max(0, Math.floor(timer.secondsValue))
        : getInitialTimerValue(config),
  };
}

function loadTimerState(): StoredTimerState {
  const fallbackTimers = createDefaultTimerItems();
  const fallback: StoredTimerState = {
    timers: fallbackTimers,
    expandedTimerId: fallbackTimers[0]?.id ?? null,
    activeTimerId: fallbackTimers[0]?.id ?? null,
    autoAdvanceEnabled: false,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(TIMER_STATE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredTimerState>;
    const timers = Array.isArray(parsed.timers)
      ? parsed.timers
          .map((timer, index) => normalizeTimerItem(timer, index))
          .filter((timer): timer is TimerItem => timer !== null)
      : [];
    if (timers.length === 0) return fallback;
    // Older saved sessions could contain more than one running timer. Keep
    // the first one and pause the rest before the operator sees the panel.
    let hasRunningTimer = false;
    const normalizedTimers = timers.map((timer) => {
      if (!timer.isRunning || !hasRunningTimer) {
        hasRunningTimer ||= timer.isRunning;
        return timer;
      }
      return { ...timer, isRunning: false };
    });
    const timerIds = new Set(normalizedTimers.map((timer) => timer.id));
    return {
      timers: normalizedTimers,
      expandedTimerId:
        typeof parsed.expandedTimerId === "string" &&
        timerIds.has(parsed.expandedTimerId)
          ? parsed.expandedTimerId
          : null,
      activeTimerId:
        typeof parsed.activeTimerId === "string" && timerIds.has(parsed.activeTimerId)
          ? parsed.activeTimerId
          : timers[0]?.id ?? null,
      autoAdvanceEnabled: Boolean(parsed.autoAdvanceEnabled),
    };
  } catch {
    return fallback;
  }
}

function saveTimerState(state: StoredTimerState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TIMER_STATE_STORAGE_KEY, JSON.stringify(state));
}

export interface UseTimersResult {
  timers: TimerItem[];
  activeTimer: TimerItem | null;
  autoAdvanceEnabled: boolean;
  expandedTimerId: string | null;
  setExpandedTimerId: (id: string | null) => void;
  setAutoAdvanceEnabled: (enabled: boolean) => void;
  createTimer: () => void;
  updateTimer: (id: string, patch: Partial<TimerConfig>) => void;
  reorderTimers: (fromIndex: number, toIndex: number) => void;
  toggleTimerPlayback: (id: string) => void;
  resetTimer: (id: string) => void;
  removeTimer: (id: string) => void;
  stopAllTimers: () => void;
  adjustTimerSeconds: (id: string, delta: number) => void;
}

export function useTimers(): UseTimersResult {
  const [initialTimerState] = useState<StoredTimerState>(() => loadTimerState());
  const [timers, setTimers] = useState<TimerItem[]>(initialTimerState.timers);
  const [expandedTimerId, setExpandedTimerIdState] = useState<string | null>(
    initialTimerState.expandedTimerId,
  );
  const [selectedTimerId, setSelectedTimerId] = useState<string | null>(
    initialTimerState.activeTimerId,
  );
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(
    initialTimerState.autoAdvanceEnabled,
  );

  const activeTimerId = useMemo(
    () =>
      selectedTimerId && timers.some((timer) => timer.id === selectedTimerId)
        ? selectedTimerId
        : (timers.find((timer) => timer.isRunning)?.id ?? timers[0]?.id ?? null),
    [selectedTimerId, timers],
  );

  const activeTimer = useMemo(
    () => timers.find((timer) => timer.id === activeTimerId) ?? null,
    [timers, activeTimerId],
  );

  const setExpandedTimerId: UseTimersResult["setExpandedTimerId"] =
    setExpandedTimerIdState;

  useEffect(() => {
    saveTimerState({
      timers,
      expandedTimerId,
      activeTimerId,
      autoAdvanceEnabled,
    });
  }, [activeTimerId, autoAdvanceEnabled, expandedTimerId, timers]);

  const getNextTimerToStart = useCallback(
    (timerList: TimerItem[], finishedIndex: number): TimerItem | null => {
      if (!autoAdvanceEnabled) return null;
      return timerList[finishedIndex + 1] ?? null;
    },
    [autoAdvanceEnabled],
  );

  const startTimerValue = useCallback((timer: TimerItem): number => {
    if (timer.type === "countdownToTime") {
      return getCountdownToTimeSeconds(timer.hour, timer.minute, timer.meridiem);
    }
    if (timer.type === "elapsed") {
      return 0;
    }
    return getInitialTimerValue(timer);
  }, []);

  // The tick reads timers through a ref so the interval is created once for the
  // lifetime of the hook. Depending on `timers` directly would tear down and
  // re-arm the interval on every tick.
  const timersRef = useRef(timers);
  useEffect(() => {
    timersRef.current = timers;
  }, [timers]);

  // 1Hz tick for any running timer.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const currentTimers = timersRef.current;
      // Idle is the common case. Writing an equivalent-but-new array here would
      // re-render every timer consumer and re-persist state once a second for
      // as long as the app stays open.
      if (!currentTimers.some((timer) => timer.isRunning)) return;

      let nextExpandedTimerId: string | null = null;
      const nextTimers = currentTimers
        .map((timer, index) => {
          if (!timer.isRunning) return timer;

          const nextTimer = getNextTimerToStart(currentTimers, index);
          const completeTimer = (secondsValue: number) => {
            if (nextTimer) {
              nextExpandedTimerId = nextTimer.id;
            }
            return { ...timer, isRunning: false, secondsValue, finished: true };
          };

          if (timer.type === "countdownToTime") {
            const remaining = getCountdownToTimeSeconds(
              timer.hour,
              timer.minute,
              timer.meridiem,
            );
            if (remaining <= 0) {
              return completeTimer(0);
            }
            return { ...timer, secondsValue: remaining };
          }

          if (timer.type === "elapsed") {
            const targetSeconds = getElapsedTargetSeconds(timer);
            const nextElapsed = timer.secondsValue + 1;
            if (targetSeconds > 0 && nextElapsed >= targetSeconds) {
              return completeTimer(targetSeconds);
            }
            return { ...timer, secondsValue: nextElapsed };
          }

          const nextRemaining = Math.max(timer.secondsValue - 1, 0);
          if (nextRemaining <= 0) {
            return completeTimer(0);
          }
          return {
            ...timer,
            isRunning: true,
            secondsValue: nextRemaining,
          };
        })
        .map((timer) => {
          if (!nextExpandedTimerId || timer.id !== nextExpandedTimerId) {
            return timer;
          }
          return {
            ...timer,
            isRunning: true,
            secondsValue: startTimerValue(timer),
            finished: false,
          };
        });
      setTimers(nextTimers);
      if (nextExpandedTimerId) {
        setExpandedTimerId(nextExpandedTimerId);
        // Advancing is an intentional change to the live timer. Merely
        // expanding a timer in the operator panel must never change output.
        setSelectedTimerId(nextExpandedTimerId);
      }
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [getNextTimerToStart, startTimerValue]);

  const createTimer = useCallback(() => {
    const config: TimerConfig = {
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
      ...config,
      isRunning: false,
      secondsValue: getInitialTimerValue(config),
    };
    setTimers((previous) => [...previous, timer]);
    setExpandedTimerId(timer.id);
  }, [timers.length]);

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
            finished: false,
          };
        }),
      );
    },
    [],
  );

  const reorderTimers = useCallback((fromIndex: number, toIndex: number) => {
    setTimers((previous) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= previous.length ||
        toIndex >= previous.length ||
        fromIndex === toIndex
      ) {
        return previous;
      }

      const next = [...previous];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const toggleTimerPlayback = useCallback((id: string) => {
    setExpandedTimerId(id);
    setSelectedTimerId(id);
    setTimers((previous) =>
      previous.map((candidate) => {
        // A new live timer replaces any current one, so two timers can never
        // run at once (and compete for the audience output).
        if (candidate.id !== id) {
          return candidate.isRunning ? { ...candidate, isRunning: false } : candidate;
        }
        // Played again, or paused, it is no longer the one that ran out.
        const timer = { ...candidate, finished: false };
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
              finished: false,
            }
          : timer,
      ),
    );
  }, []);

  const removeTimer = useCallback((id: string) => {
    setTimers((previous) => previous.filter((timer) => timer.id !== id));
    setExpandedTimerIdState((current) => (current === id ? null : current));
    setSelectedTimerId((current) => (current === id ? null : current));
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
            finished: false,
          };
        }
        const nextValue = Math.max(timer.secondsValue + delta, 0);
        return { ...timer, secondsValue: nextValue, isRunning: false, finished: false };
      }),
    );
  }, []);

  return {
    timers,
    activeTimer,
    autoAdvanceEnabled,
    expandedTimerId,
    setExpandedTimerId,
    setAutoAdvanceEnabled,
    createTimer,
    updateTimer,
    reorderTimers,
    toggleTimerPlayback,
    resetTimer,
    removeTimer,
    stopAllTimers,
    adjustTimerSeconds,
  };
}
