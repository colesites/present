"use client";

import { useEffect, useState } from "react";
import type { DesktopBillingSnapshot } from "../store/desktopSession";
import { cn } from "../lib/utils";

interface SpeechUsageIndicatorProps {
  billing: DesktopBillingSnapshot | null | undefined;
  isListening?: boolean;
  isStarting?: boolean;
  activeSessionStartedAtMs?: number | null;
  className?: string;
}

const formatUsageDuration = (seconds: number): string => {
  const normalizedSeconds = Math.max(0, Math.round(seconds));
  if (normalizedSeconds === 0) {
    return "0 min";
  }
  const totalMinutes = Math.floor(normalizedSeconds / 60);

  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)} min`;
  }

  const hours = totalMinutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
};

const resolveEffectiveUsage = (
  billing: DesktopBillingSnapshot,
  isListening: boolean,
  activeSessionStartedAtMs: number | null,
  nowMs: number,
) => {
  if (!isListening || !activeSessionStartedAtMs) {
    return billing.usedSeconds;
  }

  const liveSeconds = Math.max(
    0,
    Math.ceil((nowMs - activeSessionStartedAtMs) / 1000),
  );

  return Math.min(billing.quotaSeconds, billing.usedSeconds + liveSeconds);
};

export function SpeechUsageIndicator({
  billing,
  isListening = false,
  isStarting = false,
  activeSessionStartedAtMs = null,
  className,
}: SpeechUsageIndicatorProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isListening || !activeSessionStartedAtMs) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeSessionStartedAtMs, isListening]);

  if (!billing || billing.quotaSeconds <= 0) {
    return null;
  }

  const usedSeconds = resolveEffectiveUsage(
    billing,
    isListening,
    activeSessionStartedAtMs,
    nowMs,
  );
  const remainingSeconds = Math.max(0, billing.quotaSeconds - usedSeconds);
  const usagePercent = Math.min(100, (usedSeconds / billing.quotaSeconds) * 100);
  const isExhausted = remainingSeconds <= 0;

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 shadow-sm",
        isExhausted
          ? "border-destructive/30 bg-destructive/5"
          : "border-border/70 bg-background/80",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              {billing.planLabel}
            </span>
            {isListening ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                Live
              </span>
            ) : isStarting ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                Connecting
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs font-semibold text-foreground">
            {formatUsageDuration(usedSeconds)} / {formatUsageDuration(billing.quotaSeconds)} used
          </p>
          <p className="text-[10px] text-muted-foreground">
            {isExhausted
              ? "Speech search limit reached for this billing period."
              : `${formatUsageDuration(remainingSeconds)} left this month`}
          </p>
        </div>

        <div className="w-20 shrink-0">
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                isExhausted ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${usagePercent > 0 ? Math.max(6, usagePercent) : 0}%` }}
            />
          </div>
          <p className="mt-1 text-right text-[10px] text-muted-foreground">
            {Math.round(usagePercent)}%
          </p>
        </div>
      </div>
    </div>
  );
}
