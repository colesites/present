"use client";

import { useEffect, useMemo, useState } from "react";
import { useLooksConfig } from "../../renderer/shared/hooks";

type StageWindowState = {
  currentText: string | null;
  currentFooter: string | null;
  nextText: string | null;
  nextFooter: string | null;
  timerText: string | null;
  timerLabel: string | null;
  timerVisible: boolean;
};

const initialState: StageWindowState = {
  currentText: null,
  currentFooter: null,
  nextText: null,
  nextFooter: null,
  timerText: null,
  timerLabel: null,
  timerVisible: true,
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

    window.electronAPI.onStageData((data: unknown) => {
      const message = data as Record<string, unknown>;
      if (message.type === "stage-content") {
        setState((previous) => ({
          ...previous,
          currentText: asText(message.currentText),
          currentFooter: asText(message.currentFooter),
          nextText: asText(message.nextText),
          nextFooter: asText(message.nextFooter),
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
        }));
      } else if (message.type === "clear") {
        setState(initialState);
      }
    });

    window.electronAPI.notifyStageReady?.();
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
                tone="white"
                visible={stageLooks.layers.slide || stageLooks.layers.presentation}
              />
              <SlideCard
                title="Next Slide"
                text={state.nextText}
                footer={state.nextFooter}
                tone="amber"
                visible={stageLooks.layers.slide || stageLooks.layers.presentation}
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <MetricCard
                label={state.timerLabel ?? "Time Remaining"}
                value={state.timerText ?? "--:--:--"}
                valueClassName="text-[#e35f4a]"
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

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function SlideCard({
  title,
  text,
  footer,
  tone,
  visible,
}: {
  title: string;
  text: string | null;
  footer: string | null;
  tone: "white" | "amber";
  visible: boolean;
}) {
  return (
    <div
      className={`relative min-h-0 overflow-hidden rounded-2xl border ${
        tone === "amber" ? "border-amber-300/70" : "border-zinc-400/70"
      } bg-black/80 p-5`}
    >
      {visible ? (
        <div className="flex h-full min-h-0 flex-col">
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
      ) : (
        <div className="flex h-full items-center justify-center text-xl text-zinc-600">
          Hidden by look
        </div>
      )}

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
  visible,
}: {
  label: string;
  value: string;
  valueClassName: string;
  visible: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-500/70 bg-black/80 px-4 py-2">
      {visible ? (
        <p className={`text-center text-6xl font-medium ${valueClassName}`}>{value}</p>
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
