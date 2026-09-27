"use client";

import { useEffect, useMemo, useState } from "react";
import { useLooksConfig } from "../../renderer/shared/hooks";
import { cn } from "../../renderer/shared/lib/utils";

type StageWindowState = {
  currentText: string | null;
  currentFooter: string | null;
  currentLabel: string | null;
  currentRepeat: string | null;
  nextText: string | null;
  nextFooter: string | null;
  nextLabel: string | null;
  nextRepeat: string | null;
  timerText: string | null;
  timerLabel: string | null;
  timerVisible: boolean;
  /** Once the timer has run out: the message's colour, and whether it blinks. */
  timerTimeUp: TimeUpStyle | null;
};

const initialState: StageWindowState = {
  currentText: null,
  currentFooter: null,
  currentLabel: null,
  currentRepeat: null,
  nextText: null,
  nextFooter: null,
  nextLabel: null,
  nextRepeat: null,
  timerText: null,
  timerLabel: null,
  timerVisible: true,
  timerTimeUp: null,
};

function formatClock(date: Date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const normalizedHour = ((hours + 11) % 12) + 1;
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${normalizedHour}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} ${suffix}`;
}

export function StageDisplayWindow() {
  const [state, setState] = useState<StageWindowState>(initialState);
  const [clockText, setClockText] = useState(() => formatClock(new Date()));
  const { liveLook } = useLooksConfig();
  const stageLooks = liveLook.targets.stage;

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockText(formatClock(new Date()));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onStageData) {
      return;
    }

    const cleanup = window.electronAPI.onStageData((data: unknown) => {
      const message = data as Record<string, unknown>;
      if (message.type === "stage-content") {
        setState((previous) => ({
          ...previous,
          currentText: asText(message.currentText),
          currentFooter: asText(message.currentFooter),
          currentLabel: asText(message.currentLabel),
          currentRepeat: asText(message.currentRepeat),
          nextText: asText(message.nextText),
          nextFooter: asText(message.nextFooter),
          nextLabel: asText(message.nextLabel),
          nextRepeat: asText(message.nextRepeat),
        }));
      } else if (message.type === "timer-update") {
        setState((previous) => ({
          ...previous,
          timerText: asText(message.timerText),
          timerLabel: asText(message.timerLabel),
          timerVisible:
            typeof message.timerVisible === "boolean"
              ? message.timerVisible
              : previous.timerVisible,
          timerTimeUp: asTimeUp(message.timerTimeUp),
        }));
      } else if (message.type === "clear") {
        setState(initialState);
      }
    });

    window.electronAPI.notifyStageReady?.();
    return cleanup;
  }, []);

  const frameStyle = useMemo(
    () => ({
      left: `${stageLooks.textPosition.xPercent}%`,
      top: `${stageLooks.textPosition.yPercent}%`,
      width: `${stageLooks.textPosition.widthPercent}%`,
      height: `${stageLooks.textPosition.heightPercent}%`,
      transform: "translate(-50%, -50%)",
      textAlign: stageLooks.textPosition.textAlign,
      alignItems:
        stageLooks.textPosition.textAlign === "left"
          ? "flex-start"
          : stageLooks.textPosition.textAlign === "right"
          ? "flex-end"
          : "center",
      justifyContent:
        stageLooks.textPosition.verticalAlign === "top"
          ? "flex-start"
          : stageLooks.textPosition.verticalAlign === "bottom"
          ? "flex-end"
          : "center",
    }),
    [stageLooks.textPosition]
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-black text-white">
      <div className="relative h-full w-full p-10">
        <div className="absolute inset-0 opacity-[0.04]" />

        <div className="absolute" style={frameStyle}>
          <div className="grid h-full w-full grid-rows-[minmax(0,1fr)_110px] gap-6">
            <div className="grid min-h-0 grid-cols-2 gap-6">
              <SlideCard
                title="Current Slide"
                text={state.currentText}
                footer={state.currentFooter}
                label={state.currentLabel}
                repeat={state.currentRepeat}
                tone="white"
              />
              <SlideCard
                title="Next Slide"
                text={state.nextText}
                footer={state.nextFooter}
                label={state.nextLabel}
                repeat={state.nextRepeat}
                tone="amber"
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <MetricCard
                label={state.timerLabel ?? "Time Remaining"}
                value={state.timerText ?? "--:--:--"}
                valueClassName={cn("text-[#e35f4a]", state.timerTimeUp?.blink && "present-time-up-blink")}
                valueColor={state.timerTimeUp?.color}
                visible={stageLooks.layers.props}
              />
              <MetricCard
                label="Clock"
                value={clockText}
                valueClassName="text-zinc-300"
                visible={stageLooks.layers.props}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type TimeUpStyle = { color: string; blink: boolean };

function asTimeUp(value: unknown): TimeUpStyle | null {
  if (!value || typeof value !== "object") return null;
  const { color, blink } = value as Partial<TimeUpStyle>;
  return { color: typeof color === "string" ? color : "#ef4444", blink: blink === true };
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function SlideCard({
  title,
  text,
  footer,
  label,
  repeat,
  tone,
}: {
  title: string;
  text: string | null;
  footer: string | null;
  label: string | null;
  repeat: string | null;
  tone: "white" | "amber";
}) {
  return (
    <div
      className={`relative min-h-0 overflow-hidden rounded-2xl border ${
        tone === "amber" ? "border-amber-300/70" : "border-zinc-400/70"
      } bg-black/80 p-5`}
    >
      <div className="flex h-full min-h-0 flex-col">
        {(label || repeat) ? (
          <div
            className={`mb-4 flex flex-wrap items-center gap-3 text-3xl font-bold uppercase tracking-[0.08em] ${
              tone === "amber" ? "text-amber-200" : "text-sky-200"
            }`}
          >
            {label ? <span>[{label}]</span> : null}
            {repeat ? <span>[{repeat}]</span> : null}
          </div>
        ) : null}
        <div
          className={`min-h-0 flex-1 overflow-hidden text-6xl leading-[1.1] ${
            tone === "amber" ? "text-amber-300" : "text-zinc-100"
          }`}
        >
          {text ?? "No slide selected"}
        </div>
        {footer ? (
          <p className="mt-3 truncate text-2xl text-zinc-300/90">{footer}</p>
        ) : null}
      </div>

      <div className="absolute inset-x-5 bottom-2 flex items-center gap-3 text-[12px] uppercase tracking-[0.12em] text-zinc-400">
        <span className="h-px flex-1 bg-current/40" />
        <span>{title}</span>
        <span className="h-px flex-1 bg-current/40" />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  valueClassName,
  valueColor,
  visible,
}: {
  label: string;
  value: string;
  valueClassName: string;
  valueColor?: string;
  visible: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-500/70 bg-black/80 px-4 py-2">
      {visible ? (
        <p
          className={`text-center text-6xl font-medium ${valueClassName}`}
          style={valueColor ? { color: valueColor } : undefined}
        >
          {value}
        </p>
      ) : (
        <p className="text-center text-4xl text-zinc-700">--:--</p>
      )}
      <div className="absolute inset-x-4 bottom-1.5 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-zinc-400">
        <span className="h-px flex-1 bg-current/35" />
        <span>{label}</span>
        <span className="h-px flex-1 bg-current/35" />
      </div>
    </div>
  );
}
