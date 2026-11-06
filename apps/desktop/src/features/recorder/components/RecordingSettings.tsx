import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  Share,
} from "lucide-react";

import { cn } from "../../../renderer/shared/lib/utils";
import type { ChannelStrip } from "../../../renderer/tauri/recorder";
import type { AudioDevice } from "../../../renderer/tauri/sound";
import { InputMonitoringIcon } from "./DawIcons";
import { Knob, PowerLamp, ToggleSwitch } from "./Knob";

/**
 * The bottom Smart Controls inspector panel:
 * - Generous panel height
 * - Top tab strip (Track, Controls / EQ)
 * - Left section: Recording Settings (Record Level slider, Automatic Level Control, Input selector, Monitoring, Noise Gate, Export)
 * - Right section: Analog Console Rack (Compressor, Parametric EQ, Sends) with tactile knobs
 * - Strictly styled using Present's theme tokens
 */
export function RecordingSettings({
  trackName,
  inputId,
  inputs,
  level,
  recording,
  inputLocked,
  canExport,
  strip,
  onInput,
  onExport,
  onStrip,
  onMonitoring,
}: {
  trackName: string | null;
  inputId: string | null;
  inputs: AudioDevice[];
  level: number;
  recording: boolean;
  inputLocked: boolean;
  canExport: boolean;
  strip: ChannelStrip;
  onInput: (deviceId: string | null) => void;
  onExport: () => void;
  onStrip: (strip: ChannelStrip) => void;
  /** Monitoring goes through the window, which checks for feedback first. */
  onMonitoring: () => void;
}) {
  const [subTab, setSubTab] = useState<"controls" | "eq">("controls");
  const patch = (next: Partial<ChannelStrip>) => onStrip({ ...strip, ...next });

  const known = inputId == null || inputs.some((device) => device.id === inputId);

  return (
    <section
      aria-label="Smart controls"
      className="flex h-full w-full flex-col border-t border-border bg-sidebar text-foreground shadow-2xl select-none overflow-hidden"
    >
      {/* Top Tab Bar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center">
          <span className="rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm">
            Track
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab("controls")}
            className={cn(
              "h-6.5 rounded px-3 text-xs font-semibold transition-colors",
              subTab === "controls"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary",
            )}
          >
            Controls
          </button>
          <button
            type="button"
            onClick={() => setSubTab("eq")}
            className={cn(
              "h-6.5 rounded px-3 text-xs font-semibold transition-colors",
              subTab === "eq"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary",
            )}
          >
            EQ
          </button>
        </div>
      </div>

      {/* Main Inspector Body */}
      <div className="grid min-h-0 flex-1 grid-cols-[330px_1fr] divide-x divide-border overflow-hidden">
        {/* Left Pane: Smart Controls Section */}
        <div className="flex min-h-0 flex-col justify-between space-y-3.5 overflow-y-auto bg-sidebar p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">
                Recording Settings
              </span>
              {trackName ? (
                <span className="rounded bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-foreground">
                  {trackName}
                </span>
              ) : null}
            </div>

            {/* Record Level Slider (matching GarageBand spec) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Record Level:</span>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {recordLevelDb(strip.recordLevel)} dB
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={strip.recordLevel}
                aria-label="Record level"
                title="How loud the take is recorded. The track's volume, in its header, is how loud it plays."
                onChange={(e) => patch({ recordLevel: Number(e.target.value) })}
                onDoubleClick={() => patch({ recordLevel: 50 })}
                className="h-2 w-full cursor-pointer rounded-lg bg-card accent-primary"
              />
            </div>

            {/* Automatic Level Control Checkbox */}
            <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              <input
                type="checkbox"
                checked={strip.autoLevel}
                onChange={(e) => patch({ autoLevel: e.target.checked })}
                className="size-3.5 rounded border-border accent-primary"
              />
              <span title="Turns the record level down on loud moments so the take does not clip">
                Automatic Level Control
              </span>
            </label>

            {/* Input Selection. The ring is the input channel, same place GarageBand puts it. */}
            <div className="flex items-center gap-2 pt-1">
              <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Input:</span>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  title="Input channel"
                  className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground"
                >
                  <span className="size-3 rounded-full border-2 border-current" />
                </span>
                <div className="relative min-w-0 flex-1">
                  <select
                    aria-label="Microphone"
                    className="h-7.5 w-full appearance-none truncate rounded border border-border bg-card pr-7 pl-2.5 text-xs text-foreground disabled:opacity-50 focus:border-primary focus:outline-none"
                    value={inputId ?? ""}
                    disabled={inputLocked}
                    onChange={(event) => onInput(event.target.value || null)}
                  >
                    <option value="">No Input</option>
                    {!known && inputId ? <option value={inputId}>Previous microphone</option> : null}
                    {inputs.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.label}
                        {device.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>
            </div>

            {/* Monitoring sits on its own row. Headphones mean solo, not monitoring. */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Monitoring:</span>
                <button
                  type="button"
                  aria-label={strip.monitor ? "Disable input monitoring" : "Enable input monitoring"}
                  aria-pressed={strip.monitor}
                  title="Input Monitoring"
                  onClick={onMonitoring}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md border border-border transition-colors",
                    strip.monitor
                      ? "border-primary bg-primary/20 text-foreground"
                      : "bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <InputMonitoringIcon className="size-4" />
                </button>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={strip.feedbackProtection}
                  onChange={(e) => patch({ feedbackProtection: e.target.checked })}
                  className="size-3.5 rounded border-border accent-primary"
                />
                <span>Feedback Protection</span>
              </label>
            </div>

            {/* Noise gate is its own block. The threshold slider spans the column. */}
            <div className="space-y-2 border-t border-border pt-3">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={strip.noiseGate}
                  onChange={(e) => patch({ noiseGate: e.target.checked })}
                  className="size-3.5 rounded border-border accent-primary"
                />
                <span>Noise Gate</span>
                <span className="ml-auto font-mono text-[10px] tabular-nums">
                  {Math.round(-80 + strip.noiseGateAmount * 0.6)} dB
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={strip.noiseGateAmount}
                aria-label="Noise gate"
                disabled={!strip.noiseGate}
                onChange={(e) => patch({ noiseGateAmount: Number(e.target.value) })}
                className="h-2 w-full cursor-pointer rounded-lg bg-card accent-primary disabled:cursor-default disabled:opacity-40"
              />
            </div>
          </div>

          {/* Export Action Strip */}
          <div className="pt-3 border-t border-border flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Ready to export takes
            </span>
            <button
              type="button"
              disabled={!canExport}
              onClick={onExport}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40",
              )}
            >
              <Share className="size-3.5" />
              Export…
            </button>
          </div>
        </div>

        {/* One console, edge to edge. Each section is a column of that console. */}
        <div className="flex h-full min-h-0 min-w-0 p-3">
          {subTab === "eq" ? (
            <div className="flex h-full min-h-0 w-full overflow-hidden rounded-xl border border-border bg-card/30">
              <RackColumn title="Equalizer">
                <EqKnobs strip={strip} onStrip={patch} />
              </RackColumn>
            </div>
          ) : (
            <div className="grid h-full min-h-0 w-full grid-cols-3 overflow-hidden rounded-xl border border-border bg-card/30 divide-x divide-border">
              <RackColumn title="Compressor">
                <div className="flex h-full w-full items-center justify-center gap-[5%] px-[4%]">
                  <div className="min-w-0" style={{ width: "min(62cqw, calc(100cqh - 2.75rem))" }}>
                    <Knob
                      label="Amount"
                      value={strip.compressorAmount}
                      onChange={(compressorAmount) => patch({ compressorAmount })}
                    />
                  </div>
                  <div className="flex h-full w-11 shrink-0 flex-col items-center gap-3 py-[2%]">
                    <GainMeter
                      level={level}
                      active={recording || strip.monitor}
                      className="min-h-0 w-3.5 flex-1"
                    />
                    <ToggleSwitch
                      active={strip.compressor}
                      onChange={(compressor) => patch({ compressor })}
                    />
                  </div>
                </div>
              </RackColumn>
              <RackColumn title="EQ">
                <EqKnobs strip={strip} onStrip={patch} />
              </RackColumn>
              <RackColumn title="Sends">
                <div className="flex h-full w-full items-center justify-center gap-[10%] px-[8%]">
                  <div className="min-w-0" style={{ width: "min(40cqw, calc(100cqh - 2.75rem))" }}>
                    <Knob
                      label="Ambience"
                      value={strip.ambience}
                      onChange={(ambience) => patch({ ambience })}
                    />
                  </div>
                  <div className="min-w-0" style={{ width: "min(40cqw, calc(100cqh - 2.75rem))" }}>
                    <Knob
                      label="Reverb"
                      value={strip.reverb}
                      onChange={(reverb) => patch({ reverb })}
                    />
                  </div>
                </div>
              </RackColumn>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** The record level slider (0 to 100, 50 is unity) in dB. */
function recordLevelDb(level: number): string {
  if (level <= 0) return "-∞";
  const db = 20 * Math.log10(level / 50);
  return `${db > 0.05 ? "+" : ""}${db.toFixed(1)}`;
}

function RackColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col px-[4%] pt-3 pb-2">
      <h2 className="shrink-0 text-center text-xs font-bold tracking-[0.22em] text-primary uppercase">
        {title}
      </h2>
      <div
        className="flex min-h-0 w-full flex-1 items-center justify-center"
        style={{ containerType: "size" }}
      >
        {children}
      </div>
    </section>
  );
}

function EqKnobs({
  strip,
  onStrip,
}: {
  strip: ChannelStrip;
  onStrip: (next: Partial<ChannelStrip>) => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-full max-w-full" style={{ width: "min(100cqw, calc(100cqh * 1.45))" }}>
        <div
          className="grid h-full w-full grid-cols-3 grid-rows-2 items-center justify-items-center"
          style={{ containerType: "size" }}
        >
          <EqSlot>
            <Knob label="Low" value={strip.eqLow} onChange={(eqLow) => onStrip({ eqLow })} />
          </EqSlot>
          <EqSlot>
            <Knob label="Mid" value={strip.eqMid} onChange={(eqMid) => onStrip({ eqMid })} />
          </EqSlot>
          <EqSlot>
            <Knob label="High" value={strip.eqHigh} onChange={(eqHigh) => onStrip({ eqHigh })} />
          </EqSlot>
          <EqSlot>
            <div className="flex aspect-square w-full items-end justify-center pb-[18%]">
              <PowerLamp active={strip.eq} onChange={(eq) => onStrip({ eq })} className="!h-[42%] !w-auto" />
            </div>
          </EqSlot>
          <EqSlot>
            <Knob label="Mid Freq" value={strip.eqMidFreq} onChange={(eqMidFreq) => onStrip({ eqMidFreq })} />
          </EqSlot>
          <EqSlot>
            <Knob label="Low Cut" value={strip.eqLowCut} onChange={(eqLowCut) => onStrip({ eqLowCut })} />
          </EqSlot>
        </div>
      </div>
    </div>
  );
}

function EqSlot({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div style={{ width: "min(28cqw, calc(42cqh - 1.7rem))" }}>{children}</div>
    </div>
  );
}

function GainMeter({
  level,
  active,
  className,
}: {
  level: number;
  active: boolean;
  className?: string;
}) {
  const lit = active ? Math.min(12, Math.max(level > 0.01 ? 1 : 0, Math.round(level * 12))) : 0;
  return (
    <div className={cn("flex w-3.5 flex-col-reverse justify-between", className)} aria-hidden>
      {Array.from({ length: 12 }, (_, index) => (
        <span
          key={index}
          className={cn(
            "aspect-square w-full rounded-full",
            index < lit
              ? index > 9
                ? "bg-destructive"
                : "bg-primary"
              : "bg-foreground/15",
          )}
        />
      ))}
    </div>
  );
}
