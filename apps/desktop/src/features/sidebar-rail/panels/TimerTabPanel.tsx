"use client";

import {
  ChevronDown,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { cn } from "../../../renderer/shared/lib/utils";
import {
  getTimerDisplay,
  getTimerTypeLabel,
  type TimerType,
  type UseTimersResult,
} from "../../../renderer/shared/hooks";

interface TimerTabPanelProps {
  isEnabled: boolean;
  onToggle: () => void;
  timers: UseTimersResult;
}

// Full Timer UI moved from the old `OutputPreview` embedded panel. The
// state itself is owned by `useTimers` higher up the tree so the audience
// output broadcast effect reads from the same source — no more duplicate
// in-tree timers state.
export function TimerTabPanel({
  isEnabled,
  onToggle,
  timers,
}: TimerTabPanelProps) {
  const {
    timers: items,
    expandedTimerId,
    setExpandedTimerId,
    createTimer,
    updateTimer,
    toggleTimerPlayback,
    resetTimer,
    removeTimer,
  } = timers;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header: section title + on/off toggle + add button */}
      <header className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Timers
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={isEnabled}
            className={cn(
              "rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition",
              isEnabled
                ? "bg-primary text-primary-foreground"
                : "bg-foreground/10 text-muted-foreground hover:text-foreground",
            )}
            title={isEnabled ? "Hide timer on output" : "Show timer on output"}
          >
            {isEnabled ? "On" : "Off"}
          </button>
          <button
            type="button"
            onClick={createTimer}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-border bg-secondary/30 text-muted-foreground transition hover:text-foreground"
            title="Add timer"
            aria-label="Add timer"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {/* List */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain p-2">
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
            No timers yet. Click + to add one.
          </p>
        ) : (
          items.map((timer) => {
            const isExpanded = expandedTimerId === timer.id;
            return (
              <div
                key={timer.id}
                className={cn(
                  "overflow-hidden rounded-md border bg-secondary/15 transition",
                  isExpanded ? "border-primary/50" : "border-border/80",
                )}
              >
                {/* Row header */}
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedTimerId(isExpanded ? null : timer.id)
                    }
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border/70 bg-background/40 text-muted-foreground"
                    title={isExpanded ? "Collapse" : "Expand"}
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                  >
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        isExpanded ? "rotate-180" : "-rotate-90",
                      )}
                    />
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-foreground">
                      {timer.name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground tabular-nums">
                      {getTimerDisplay(timer)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => resetTimer(timer.id)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background/50 text-muted-foreground transition hover:text-foreground"
                      title="Reset timer"
                      aria-label="Reset timer"
                    >
                      <RotateCcw className="h-3 w-3" strokeWidth={1.8} />
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
                      aria-label={timer.isRunning ? "Pause timer" : "Play timer"}
                    >
                      {timer.isRunning ? (
                        <Pause className="h-3 w-3" strokeWidth={2} />
                      ) : (
                        <Play className="h-3 w-3" strokeWidth={2} />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded editor */}
                {isExpanded && (
                  <div className="space-y-2 border-t border-border/70 px-2 py-2">
                    <Field label="Name">
                      <input
                        aria-label="Timer name"
                        value={timer.name}
                        onChange={(event) =>
                          updateTimer(timer.id, { name: event.target.value })
                        }
                        className="h-7 w-full rounded-sm border border-border/70 bg-background/40 px-2 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
                      />
                    </Field>

                    <Field label="Type">
                      <select
                        aria-label="Timer type"
                        value={timer.type}
                        onChange={(event) =>
                          updateTimer(timer.id, {
                            type: event.target.value as TimerType,
                          })
                        }
                        className="h-7 w-full rounded-sm border border-border/70 bg-background/40 px-1.5 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
                      >
                        <option value="countdown">Countdown Timer</option>
                        <option value="countdownToTime">
                          Countdown to Time
                        </option>
                        <option value="elapsed">Elapsed Time</option>
                      </select>
                      <p className="text-[10px] text-muted-foreground">
                        {getTimerTypeLabel(timer.type)}
                      </p>
                    </Field>

                    {timer.type === "countdown" && (
                      <Field label="Duration (HH:MM:SS)">
                        <input
                          aria-label="Timer duration"
                          value={timer.duration}
                          onChange={(event) =>
                            updateTimer(timer.id, {
                              duration: event.target.value,
                            })
                          }
                          className="h-7 w-full rounded-sm border border-border/70 bg-background/40 px-2 text-[11px] text-foreground tabular-nums focus:border-primary/60 focus:outline-hidden"
                        />
                      </Field>
                    )}

                    {timer.type === "countdownToTime" && (
                      <div className="grid grid-cols-3 gap-1.5">
                        <Field label="Hour">
                          <select
                            aria-label="Timer hour"
                            value={String(timer.hour)}
                            onChange={(event) =>
                              updateTimer(timer.id, {
                                hour: Number.parseInt(event.target.value, 10),
                              })
                            }
                            className="h-7 w-full rounded-sm border border-border/70 bg-background/40 px-1.5 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
                          >
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(
                              (h) => (
                                <option key={h} value={String(h)}>
                                  {h}
                                </option>
                              ),
                            )}
                          </select>
                        </Field>
                        <Field label="Minute">
                          <select
                            aria-label="Timer minute"
                            value={String(timer.minute)}
                            onChange={(event) =>
                              updateTimer(timer.id, {
                                minute: Number.parseInt(event.target.value, 10),
                              })
                            }
                            className="h-7 w-full rounded-sm border border-border/70 bg-background/40 px-1.5 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
                          >
                            {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                              <option key={m} value={String(m)}>
                                {String(m).padStart(2, "0")}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Period">
                          <select
                            aria-label="Timer period"
                            value={timer.meridiem}
                            onChange={(event) =>
                              updateTimer(timer.id, {
                                meridiem: event.target.value as "AM" | "PM",
                              })
                            }
                            className="h-7 w-full rounded-sm border border-border/70 bg-background/40 px-1.5 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
                          >
                            <option value="AM">AM</option>
                            <option value="PM">PM</option>
                          </select>
                        </Field>
                      </div>
                    )}

                    {timer.type === "elapsed" && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <Field label="Start">
                          <input
                            type="time"
                            aria-label="Timer elapsed start"
                            value={timer.elapsedStart}
                            onChange={(event) =>
                              updateTimer(timer.id, {
                                elapsedStart: event.target.value,
                              })
                            }
                            className="h-7 w-full rounded-sm border border-border/70 bg-background/40 px-2 text-[11px] text-foreground tabular-nums focus:border-primary/60 focus:outline-hidden"
                          />
                        </Field>
                        <Field label="End">
                          <input
                            type="time"
                            aria-label="Timer elapsed end"
                            value={timer.elapsedEnd}
                            onChange={(event) =>
                              updateTimer(timer.id, {
                                elapsedEnd: event.target.value,
                              })
                            }
                            className="h-7 w-full rounded-sm border border-border/70 bg-background/40 px-2 text-[11px] text-foreground tabular-nums focus:border-primary/60 focus:outline-hidden"
                          />
                        </Field>
                      </div>
                    )}

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => removeTimer(timer.id)}
                        className="inline-flex items-center gap-1 rounded-sm border border-destructive/40 bg-destructive/15 px-2 py-1 text-[10px] font-medium text-destructive transition hover:bg-destructive/25"
                      >
                        <Trash2 className="h-3 w-3" strokeWidth={1.6} />
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
