import type { ReactNode } from "react";
import {
  FastForward,
  Pause,
  Play,
  Rewind,
  SkipBack,
  Square,
} from "lucide-react";

import { cn } from "../../../renderer/shared/lib/utils";
import { SmartControlsIcon } from "./DawIcons";

export type TransportState = "ready" | "recording" | "playing" | "paused";

/** Minutes and seconds separated, as GarageBand's LCD displays them. */
function clockParts(seconds: number): { minutes: string; seconds: string; tenths: string } {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 99 * 60 + 59.9) : 0;
  const minutes = Math.floor(total / 60);
  const remain = total - minutes * 60;
  const whole = Math.floor(remain);
  return {
    minutes: minutes.toString().padStart(2, "0"),
    seconds: whole.toString().padStart(2, "0"),
    tenths: Math.floor((remain - whole) * 10).toString(),
  };
}

/**
 * Top Header using our app theme:
 * 1. Smart Controls toggle (dial icon)
 * 2. Rewind (<<)
 * 3. Forward (>>)
 * 4. Stop (■)
 * 5. Play (▶)
 * 6. Record (●)
 * 7. LCD Display with mins, seconds, and status
 */
export function ControlBar({
  state,
  seconds,
  settingsOpen,
  canRecord,
  canHold,
  onToggleSettings,
  onRewind,
  onForward,
  onGoToBeginning,
  onStop,
  onPlay,
  onRecord,
}: {
  state: TransportState;
  seconds: number;
  settingsOpen: boolean;
  canRecord: boolean;
  canHold: boolean;
  onToggleSettings: () => void;
  onRewind: () => void;
  onForward: () => void;
  onGoToBeginning?: () => void;
  onStop: () => void;
  onPlay: () => void;
  onRecord: () => void;
}) {
  const clock = clockParts(seconds);

  return (
    <header className="grid h-16 shrink-0 grid-cols-[2.25rem_1fr_2.25rem] items-center gap-6 border-b border-border bg-sidebar px-4 select-none shadow-sm">
      {/* 1. Left: Smart Controls Button */}
      <div className="flex items-center">
        <button
          type="button"
          aria-label={settingsOpen ? "Hide smart controls" : "Show smart controls"}
          aria-pressed={settingsOpen}
          onClick={onToggleSettings}
          title="Smart Controls"
          className={cn(
            "flex size-9 items-center justify-center rounded-md border transition-colors shadow-sm",
            settingsOpen
              ? "border-primary bg-primary text-primary-foreground shadow-md ring-1 ring-primary/40"
              : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary",
          )}
        >
          <SmartControlsIcon className="size-5" />
        </button>
      </div>

      {/* Center: Transport Controls + LCD Display */}
      <div className="flex items-center justify-center gap-5">
        {/* Transport buttons: Rewind, Forward, Go to Beginning, Stop, Play, Record */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Transport">
          <TransportButton label="Rewind" onClick={onRewind}>
            <Rewind className="size-4 fill-current" />
          </TransportButton>

          <TransportButton label="Forward" onClick={onForward}>
            <FastForward className="size-4 fill-current" />
          </TransportButton>

          {/* Go to Beginning (shown / highlighted beside Play when not at 0) */}
          <TransportButton
            label="Go to Beginning"
            shortcut="Return"
            disabled={seconds <= 0.05}
            onClick={onGoToBeginning ?? onRewind}
            className={cn(
              seconds > 0.05 && "text-primary hover:text-primary font-bold shadow-xs",
            )}
          >
            <SkipBack className="size-4 fill-current" />
          </TransportButton>

          <TransportButton
            label={state === "playing" ? "Pause" : "Play"}
            shortcut="Space"
            pressed={state === "playing"}
            onClick={onPlay}
          >
            {state === "playing" ? (
              <Pause className="size-4 fill-current text-primary" />
            ) : (
              <Play className="size-4 fill-current" />
            )}
          </TransportButton>

          {/* Record button: Click to start, click to stop */}
          <button
            type="button"
            aria-label={state === "recording" ? "Stop Recording" : "Record"}
            aria-pressed={state === "recording"}
            title={state === "recording" ? "Stop Recording (R)" : "Record (R)"}
            disabled={state !== "recording" && !canRecord}
            onClick={state === "recording" ? onStop : onRecord}
            className={cn(
              "relative flex size-8 items-center justify-center rounded-full transition-all duration-150 shadow-md",
              state === "recording"
                ? "bg-red-600 text-white shadow-lg shadow-red-600/40 ring-2 ring-red-400 ring-offset-2 ring-offset-sidebar hover:bg-red-700"
                : "border border-red-500/80 bg-red-600/20 text-red-500 hover:bg-red-600/30",
              state !== "recording" && !canRecord && "opacity-35 pointer-events-none",
            )}
          >
            {state === "recording" ? (
              <Square className="size-3 fill-current text-white" />
            ) : (
              <span className="size-3.5 rounded-full bg-red-500" />
            )}
          </button>
        </div>

        {/* LCD Display: Mins, Seconds, Status */}
        <div
          className="flex h-11 items-stretch overflow-hidden rounded-md border border-border bg-black/60 shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)]"
          aria-live="off"
        >
          {/* Minutes & Seconds Counter */}
          <div className="flex flex-col items-center justify-center px-4 min-w-[130px]">
            <span className="font-mono text-2xl leading-none text-foreground tabular-nums tracking-tight">
              <span className={cn(clock.minutes === "00" && "text-foreground/30")}>
                {clock.minutes}
              </span>
              <span className="text-foreground/40 mx-0.5">:</span>
              {clock.seconds}
              <span className="text-foreground/40 mx-0.5">.</span>
              <span className="text-foreground/80">{clock.tenths}</span>
            </span>
            <span className="mt-0.5 flex w-full justify-between px-1 text-[8px] font-bold tracking-[0.16em] text-muted-foreground/70 uppercase">
              <span>MIN</span>
              <span>SEC</span>
            </span>
          </div>

          <div className="w-px bg-border" />

          {/* Status Display */}
          <div className="flex w-32 flex-col justify-center px-3">
            <span
              className={cn(
                "flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] uppercase",
                state === "recording"
                  ? "text-red-500"
                  : state === "playing"
                    ? "text-primary"
                    : state === "paused"
                      ? "text-amber-400"
                      : "text-emerald-400",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  state === "recording"
                    ? "animate-ping bg-red-500"
                    : state === "playing"
                      ? "animate-pulse bg-primary"
                      : state === "paused"
                        ? "bg-amber-400"
                        : "bg-emerald-400",
                )}
              />
              {state === "recording"
                ? "RECORDING"
                : state === "playing"
                  ? "PLAYING"
                  : state === "paused"
                    ? "PAUSED"
                    : "READY"}
            </span>
            <span className="mt-0.5 truncate text-[10px] font-medium text-muted-foreground">
              {state === "recording"
                ? "Live Input"
                : state === "playing"
                  ? "Playhead"
                  : state === "paused"
                    ? "Paused"
                    : "Standby"}
            </span>
          </div>
        </div>
      </div>

      <div aria-hidden />
    </header>
  );
}

function TransportButton({
  label,
  shortcut,
  pressed,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded border border-border bg-card text-foreground transition-colors hover:bg-secondary shadow-xs disabled:pointer-events-none disabled:opacity-35",
        pressed && "bg-primary text-primary-foreground border-primary",
        className,
      )}
    >
      {children}
    </button>
  );
}

