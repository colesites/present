"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { ColorInput, Segmented } from "../../../renderer/shared/components/style-controls";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../../renderer/shared/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../renderer/shared/components/ui/dropdown-menu";
import { areDisplayListsEqual } from "../../../renderer/shared/lib/display-list";
import { cn } from "../../../renderer/shared/lib/utils";
import {
  addOutput,
  addScreen,
  closeScreen,
  DEFAULT_COLOR,
  DEFAULT_CORNERS,
  identifyScreens,
  openScreen,
  removeOutput,
  removeScreen,
  setOutputDisplay,
  updateOutput,
  updateScreen,
  useScreens,
  type BlendCurve,
  type ColorAdjust,
  type CornerPin,
  type OutputInfo,
  type OutputKind,
  type OutputPatch,
  type ScreenGroup,
  type ScreenInfo,
  type ScreenOutput,
  type ScreenPatch,
  type ScreenType,
} from "../../../renderer/tauri/screens";
import {
  SETTINGS_FIELD,
  SettingsButton,
  SettingsGroup,
  SettingsNote,
  SettingsNumber,
  SettingsPage,
  SettingsRow,
  SettingsSelect,
  SettingsSwitch,
} from "./settings-ui";

export type ScreenRole = "audience" | "media" | "worship";

/** The menu items the operator window turns the three built-in screens on and off with. */
const BUILT_IN_COMMAND: Record<string, string> = {
  audience: "screens.output",
  media: "screens.media-stage",
  worship: "screens.worship-stage",
};

const TYPES: Array<{ value: ScreenType; label: string; description: string }> = [
  { value: "single", label: "Single", description: "One picture, on one output." },
  { value: "mirror", label: "Mirror", description: "The same picture on every output." },
  { value: "grouped", label: "Grouped", description: "One picture cut across a grid of outputs, like a wall of TVs." },
  {
    value: "edge-blend",
    label: "Edge blend",
    description: "One wide picture across projectors side by side, their edges overlapping and faded together.",
  },
];

const GROUP_DOT: Record<ScreenGroup, string> = {
  audience: "bg-primary",
  stage: "bg-amber-400",
};

const inShell = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const times = (width: number, height: number) => `${Math.round(width)} × ${Math.round(height)}`;

const displayName = (display: ScreenOutput) =>
  display.label || (display.isPrimary ? "Built-in display" : `Display ${display.id}`);

/** 16:9 rather than 1.78 for the shapes people know by name. */
const aspectText = (width: number, height: number) => {
  const ratio = width / height;
  const named: Array<[string, number]> = [
    ["16:9", 16 / 9],
    ["16:10", 16 / 10],
    ["4:3", 4 / 3],
    ["5:4", 5 / 4],
    ["21:9", 64 / 27],
    ["32:9", 32 / 9],
    ["1:1", 1],
  ];
  const match = named.find(([, value]) => Math.abs(value - ratio) < 0.01);
  return match ? `${ratio.toFixed(2)} (${match[0]})` : ratio.toFixed(2);
};

const outputName = (output: OutputInfo, index: number) =>
  output.kind === "ndi"
    ? `NDI · ${output.ndiSource ?? "Present"}`
    : output.display
      ? displayName(output.display)
      : index === 0
        ? "No display yet"
        : `Output ${index + 1}`;

const emitToOperator = (command: string) =>
  import("@tauri-apps/api/event").then(({ emitTo }) => emitTo("main", "menu:command", command));

/** The connected displays, asked again every few seconds. */
function useDisplays(): ScreenOutput[] {
  const [displays, setDisplays] = useState<Display[]>([]);
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      if (!window.electronAPI?.getDisplays) return;
      try {
        const next = await window.electronAPI.getDisplays();
        if (mounted) setDisplays((previous) => (areDisplayListsEqual(previous, next) ? previous : next));
      } catch {
        if (mounted) setDisplays((previous) => (previous.length === 0 ? previous : []));
      }
    };
    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);
  return displays;
}

/**
 * A value changed as fast as a slider moves, told to the core only once it
 * settles: every change is a write to disk and a message to every window.
 */
function useSettled<T>(value: T, commit: (next: T) => void, delay = 160) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  const timer = useRef<number | null>(null);
  if (!Object.is(shown, value) && JSON.stringify(shown) !== JSON.stringify(value)) {
    setShown(value);
    setDraft(value);
  }
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const change = (next: T) => {
    setDraft(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      commit(next);
    }, delay);
  };
  return [draft, change] as const;
}

/**
 * Where a display sits, in the units the computer's own arrangement uses. A
 * Mac arranges displays in points and reports each in pixels at its own
 * scale, so a Retina panel would otherwise be drawn twice the size of the TV
 * beside it. Windows arranges them in pixels already.
 */
const arrangedRect = (display: ScreenOutput) => {
  const scale =
    typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent) && display.scaleFactor > 0
      ? display.scaleFactor
      : 1;
  return {
    x: display.bounds.x / scale,
    y: display.bounds.y / scale,
    width: display.bounds.width / scale,
    height: display.bounds.height / scale,
  };
};

/**
 * The connected displays drawn where the computer arranges them, to scale,
 * with the screens that go to each. Clicking one sends the selected output
 * there.
 */
function Arrangement({
  displays,
  screens,
  selected,
  onPick,
}: {
  displays: ScreenOutput[];
  screens: ScreenInfo[];
  selected: OutputInfo | null;
  onPick: (displayId: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const height = Math.round(Math.min(Math.max(width * 0.3, 120), 220));
  if (displays.length === 0) {
    return (
      <div className="flex h-[140px] items-center justify-center rounded-lg bg-black/25 text-[12.5px] text-muted-foreground">
        Looking for displays. Connect one and it appears here.
      </div>
    );
  }
  const margin = 14;
  const gap = 4;
  const rects = displays.map(arrangedRect);
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const spanWidth = Math.max(1, Math.max(...rects.map((rect) => rect.x + rect.width)) - left);
  const spanHeight = Math.max(1, Math.max(...rects.map((rect) => rect.y + rect.height)) - top);
  const scale = Math.max(0, Math.min((width - margin * 2) / spanWidth, (height - margin * 2) / spanHeight));
  const offsetX = (width - spanWidth * scale) / 2;
  const offsetY = (height - spanHeight * scale) / 2;

  return (
    <div ref={setElement} className="relative w-full rounded-lg bg-black/25" style={{ height }}>
      {width > 0
        ? displays.map((display, index) => {
            const rect = rects[index];
            const boxWidth = rect.width * scale - gap;
            const boxHeight = rect.height * scale - gap;
            const here = screens.flatMap((screen) =>
              screen.outputs
                .filter((output) => output.inUse && output.kind === "display" && output.display?.id === display.id)
                .map(() => screen),
            );
            const isSelectedHere = selected?.kind === "display" && selected.display?.id === display.id;
            const wordy = boxWidth >= 110;
            const chips = here.length === 0 ? 0 : wordy ? Math.min(here.length, 3) * 17 : 12;
            const showName = boxWidth >= 56 && boxHeight >= 22 + chips;
            const showSize = boxWidth >= 76 && boxHeight >= 36 + chips;
            return (
              <button
                key={display.id}
                type="button"
                title={`${displayName(display)} · ${times(display.bounds.width, display.bounds.height)}`}
                onClick={() => onPick(display.id)}
                className={cn(
                  "absolute flex flex-col overflow-hidden rounded-[6px] border-2 bg-gradient-to-br from-zinc-700 to-zinc-900 p-[3px] text-left transition",
                  isSelectedHere ? "border-primary ring-[3px] ring-primary/25" : "border-zinc-500/50 hover:border-zinc-300/80",
                )}
                style={{
                  left: offsetX + (rect.x - left) * scale + gap / 2,
                  top: offsetY + (rect.y - top) * scale + gap / 2,
                  width: Math.max(8, boxWidth),
                  height: Math.max(8, boxHeight),
                }}
              >
                {display.isPrimary ? <span className="mb-[2px] h-[3px] w-full flex-none rounded-full bg-white/25" /> : null}
                <span className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-center">
                  {showName ? (
                    <span className="max-w-full truncate text-[11px] font-medium leading-tight text-white/90">
                      {displayName(display)}
                    </span>
                  ) : null}
                  {showSize ? (
                    <span className="text-[10px] tabular-nums leading-tight text-white/50">
                      {times(display.bounds.width, display.bounds.height)}
                    </span>
                  ) : null}
                  {here.length > 0 ? (
                    <span className="mt-0.5 flex max-w-full flex-wrap justify-center gap-1">
                      {here.slice(0, wordy ? 3 : here.length).map((screen, at) =>
                        wordy ? (
                          <span
                            key={`${screen.id}-${at}`}
                            className="flex max-w-full items-center gap-1 truncate rounded-full bg-black/45 px-1.5 py-px text-[9.5px] font-medium text-white/85"
                          >
                            <span className={cn("h-1.5 w-1.5 flex-none rounded-full", GROUP_DOT[screen.group])} />
                            <span className="truncate">{screen.name}</span>
                          </span>
                        ) : (
                          <span
                            key={`${screen.id}-${at}`}
                            className={cn("h-2 w-2 rounded-full ring-1 ring-black/40", GROUP_DOT[screen.group])}
                          />
                        ),
                      )}
                      {wordy && here.length > 3 ? <span className="text-[9.5px] text-white/60">+{here.length - 3}</span> : null}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })
        : null}
    </div>
  );
}

/**
 * The picture over its outputs: for a grouped or blended screen, which part
 * each output shows, the overlaps shaded. Clicking a part picks its output.
 */
function PictureLayout({
  screen,
  selectedId,
  onSelect,
}: {
  screen: ScreenInfo;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [width, height] = screen.canvas;
  const used = screen.outputs.flatMap((output) =>
    output.inUse && output.geometry ? [{ output, geometry: output.geometry }] : [],
  );
  return (
    <div className="flex justify-center rounded-lg bg-black/25 p-4">
      <div
        className="relative w-full max-w-[520px] overflow-hidden rounded-md bg-zinc-800 ring-1 ring-white/10"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        {used.map(({ output, geometry }, index) => {
          const [x, y, w, h] = geometry.source;
          return (
            <button
              key={output.id}
              type="button"
              onClick={() => onSelect(output.id)}
              className={cn(
                "absolute flex items-center justify-center border text-[11px] font-medium text-white/85 transition",
                output.id === selectedId ? "z-10 border-primary bg-primary/25" : "border-white/25 bg-white/[0.04] hover:bg-white/[0.08]",
              )}
              style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
            >
              <span className="truncate px-1">
                {index + 1} · {outputName(output, index)}
              </span>
              {geometry.blendLeft > 0 ? (
                <span
                  className="pointer-events-none absolute inset-y-0 left-0 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.14)_0_4px,transparent_4px_8px)]"
                  style={{ width: `${geometry.blendLeft * 100}%` }}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One group of the list: its on/off, its name, a way to add to it, and its screens. */
function ScreenGroupList({
  group,
  title,
  screens,
  displays,
  selectedId,
  onSelect,
  onToggle,
  onAdd,
  onRemove,
}: {
  group: ScreenGroup;
  title: string;
  screens: ScreenInfo[];
  displays: ScreenOutput[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (on: boolean) => void;
  onAdd: (displayId: number | null, ndi: boolean) => void;
  onRemove: (screen: ScreenInfo) => void;
}) {
  const anyOn = screens.some((screen) => screen.open);
  const article = group === "audience" ? "an audience" : "a stage";
  return (
    <div>
      <div className="flex items-center gap-2.5 px-3 pb-1.5 pt-3">
        <button
          type="button"
          onClick={() => onToggle(!anyOn)}
          disabled={!inShell()}
          title={anyOn ? `Turn every ${group} screen off` : `Turn every ${group} screen on`}
          aria-label={anyOn ? `${title} on. Turn off` : `${title} off. Turn on`}
          className={cn(
            "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-2 transition disabled:opacity-40",
            anyOn ? "border-emerald-400 bg-emerald-400/20" : "border-muted-foreground/50 hover:border-foreground/70",
          )}
        >
          <span className={cn("h-2 w-2 rounded-full", anyOn ? "bg-emerald-400" : "bg-transparent")} />
        </button>
        <span className="flex-1 text-[14px] font-semibold text-foreground">{title}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
            aria-label={`Add ${article} screen`}
            title={`Add ${article} screen`}
          >
            <Plus className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[240px]">
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Add a screen on</DropdownMenuLabel>
            {displays.map((display) => (
              <DropdownMenuItem key={display.id} onSelect={() => onAdd(display.id, false)}>
                <span className="min-w-0 flex-1 truncate">{displayName(display)}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {times(display.bounds.width, display.bounds.height)}
                </span>
              </DropdownMenuItem>
            ))}
            {group === "audience" ? (
              <DropdownMenuItem onSelect={() => onAdd(null, true)}>
                <span className="flex-1">NDI</span>
                <span className="text-[11px] text-muted-foreground">On the network</span>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAdd(null, false)}>
              <span className="flex-1">Placeholder</span>
              <span className="text-[11px] text-muted-foreground">No output yet</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="space-y-0.5 px-2 pb-2">
        {screens.map((screen) => {
          const row = (
            <button
              type="button"
              onClick={() => onSelect(screen.id)}
              aria-current={screen.id === selectedId ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
                screen.id === selectedId ? "bg-foreground/[0.09]" : "hover:bg-foreground/[0.04]",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground">{screen.name}</span>
                <span className="block truncate text-[11.5px] tabular-nums text-muted-foreground">
                  {times(screen.canvas[0], screen.canvas[1])}
                  {screen.screenType !== "single" ? ` · ${TYPES.find((each) => each.value === screen.screenType)?.label}` : ""}
                </span>
              </span>
              <span
                title={screen.open ? "On" : "Off"}
                className={cn(
                  "h-2 w-2 flex-none rounded-full",
                  screen.open ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/60" : "bg-muted-foreground/30",
                )}
              />
            </button>
          );
          return screen.builtIn ? (
            <div key={screen.id}>{row}</div>
          ) : (
            <ContextMenu key={screen.id}>
              <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem variant="destructive" onSelect={() => onRemove(screen)}>
                  <Trash2 className="h-4 w-4" />
                  Remove {screen.name}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}

/** A number typed in, as the core keeps it. */
function NumberField({
  label,
  value,
  onChange,
  min = -16384,
  max = 16384,
  suffix = "px",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <SettingsNumber label={label} value={value} onChange={onChange} min={min} max={max} suffix={suffix} className="w-full" />
    </label>
  );
}

function HardwareTab({
  screen,
  output,
  index,
  displays,
  onOutput,
  onChange,
  onRemove,
}: {
  screen: ScreenInfo;
  output: OutputInfo;
  index: number;
  displays: ScreenOutput[];
  onOutput: (displayId: number | null) => void;
  onChange: (patch: OutputPatch) => void;
  onRemove: () => void;
}) {
  const firstOfBuiltIn = screen.builtIn && output.id === "main";
  const [name, setName] = useState(output.ndiName ?? "");
  const [named, setNamed] = useState(output.ndiName ?? "");
  if (named !== (output.ndiName ?? "")) {
    setNamed(output.ndiName ?? "");
    setName(output.ndiName ?? "");
  }
  const target = output.target;
  const display = output.display;
  const own = display ? { width: display.bounds.width, height: display.bounds.height } : { width: 1920, height: 1080 };

  return (
    <div className="divide-y divide-border/60">
      <SettingsRow
        label="Output"
        description={
          output.kind === "ndi"
            ? "Sent as an NDI source on the network, for a streaming computer or a switcher."
            : output.displayId === null && firstOfBuiltIn
              ? display
                ? `Automatic is using ${displayName(display)}, the largest display that isn't the main one.`
                : "Automatic uses the largest display that isn't the main one."
              : undefined
        }
      >
        <SettingsSelect
          label={`${screen.name} output ${index + 1}`}
          value={output.kind === "ndi" ? "ndi" : output.displayId === null ? (firstOfBuiltIn ? "auto" : "none") : String(output.displayId)}
          onChange={(value) => {
            if (value === "ndi") {
              onChange({ kind: "ndi" });
              return;
            }
            if (output.kind === "ndi") onChange({ kind: "display" });
            onOutput(value === "auto" || value === "none" ? null : Number(value));
          }}
          className="w-[270px]"
          options={[
            firstOfBuiltIn ? { value: "auto", label: "Automatic" } : { value: "none", label: "None" },
            ...displays.map((each) => ({
              value: String(each.id),
              label: `${displayName(each)} · ${times(each.bounds.width, each.bounds.height)}`,
            })),
            ...(screen.group === "audience" && !firstOfBuiltIn ? [{ value: "ndi", label: "NDI, on the network" }] : []),
          ]}
        />
      </SettingsRow>
      {output.kind === "ndi" ? (
        <SettingsRow label="Source name" description={`Receivers see it as “${output.ndiSource ?? "Present"}”.`}>
          <input
            aria-label="NDI source name"
            value={name}
            maxLength={64}
            placeholder={`Present ${screen.name}`}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const next = name.trim();
              if (next !== (output.ndiName ?? "")) onChange({ ndiName: next || null });
            }}
            onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
            className={cn(SETTINGS_FIELD, "w-[240px]")}
          />
        </SettingsRow>
      ) : null}
      <SettingsRow
        label="Output target"
        description={
          target.kind === "full"
            ? output.kind === "ndi"
              ? "Sent at 1920 × 1080."
              : "The whole output, at its own resolution."
            : "A rectangle of the output, in its pixels: an LED wall's processor, or a picture framed inside a larger signal. The rest stays black."
        }
      >
        <Segmented
          label="Output target"
          className="w-[170px]"
          value={target.kind}
          onChange={(value) =>
            onChange({
              target:
                value === "custom"
                  ? { kind: "custom", x: 0, y: 0, width: own.width, height: own.height }
                  : { kind: "full" },
            })
          }
          options={[
            { value: "full", label: "Full" },
            { value: "custom", label: "Custom" },
          ]}
        />
      </SettingsRow>
      {target.kind === "custom" ? (
        <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
          <NumberField label="X" value={target.x} onChange={(x) => onChange({ target: { ...target, x } })} />
          <NumberField label="Y" value={target.y} onChange={(y) => onChange({ target: { ...target, y } })} />
          <NumberField
            label="Width"
            value={target.width}
            min={16}
            onChange={(width) => onChange({ target: { ...target, width } })}
          />
          <NumberField
            label="Height"
            value={target.height}
            min={16}
            onChange={(height) => onChange({ target: { ...target, height } })}
          />
        </div>
      ) : null}
      {display && output.kind === "display" ? (
        <div className="grid grid-cols-2 gap-3 px-4 py-3 text-[12px] sm:grid-cols-4">
          {[
            ["Name", displayName(display)],
            ["Resolution", times(display.bounds.width, display.bounds.height)],
            ["Scale", display.scaleFactor && display.scaleFactor !== 1 ? `${display.scaleFactor}x` : "1x"],
            ["Aspect ratio", aspectText(display.bounds.width, display.bounds.height)],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <div className="text-[11px] text-muted-foreground">{label}</div>
              <div className="truncate font-medium tabular-nums text-foreground">{value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {output.id !== "main" ? (
        <div className="flex justify-end px-4 py-2.5">
          <SettingsButton variant="ghost" onClick={onRemove} className="text-red-400 hover:text-red-300">
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Remove this output
          </SettingsButton>
        </div>
      ) : null}
    </div>
  );
}

const COLOR_CONTROLS: Array<{ key: keyof ColorAdjust; label: string; min: number; max: number; scale: number; suffix: string }> = [
  { key: "brightness", label: "Brightness", min: 0, max: 200, scale: 100, suffix: "%" },
  { key: "contrast", label: "Contrast", min: 0, max: 200, scale: 100, suffix: "%" },
  { key: "saturation", label: "Saturation", min: 0, max: 200, scale: 100, suffix: "%" },
  { key: "hue", label: "Hue", min: -180, max: 180, scale: 1, suffix: "°" },
  { key: "blackLevel", label: "Black level", min: 0, max: 50, scale: 100, suffix: "%" },
];

function ColorTab({ output, onChange }: { output: OutputInfo; onChange: (color: ColorAdjust) => void }) {
  const [color, change] = useSettled(output.color, onChange);
  const changed = JSON.stringify(color) !== JSON.stringify(DEFAULT_COLOR);
  return (
    <div className="divide-y divide-border/60">
      {COLOR_CONTROLS.map((control) => (
        <SettingsRow
          key={control.key}
          label={control.label}
          description={
            control.key === "blackLevel"
              ? "Lifts black, so a projector's grey black matches the brighter overlap of blended projectors."
              : undefined
          }
          className="min-h-[52px]"
        >
          <div className="flex w-[260px] items-center gap-3">
            <input
              type="range"
              aria-label={control.label}
              min={control.min}
              max={control.max}
              value={Math.round(color[control.key] * control.scale)}
              onChange={(event) => change({ ...color, [control.key]: Number(event.target.value) / control.scale })}
              className="h-1 min-w-0 flex-1 cursor-pointer accent-primary"
            />
            <span className="w-12 text-right text-[12px] tabular-nums text-muted-foreground">
              {Math.round(color[control.key] * control.scale)}
              {control.suffix}
            </span>
          </div>
        </SettingsRow>
      ))}
      <div className="flex justify-end px-4 py-2.5">
        <SettingsButton variant="ghost" disabled={!changed} onClick={() => change(DEFAULT_COLOR)}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Reset color
        </SettingsButton>
      </div>
    </div>
  );
}

const CORNERS: Array<{ key: keyof CornerPin; label: string }> = [
  { key: "topLeft", label: "Top left" },
  { key: "topRight", label: "Top right" },
  { key: "bottomLeft", label: "Bottom left" },
  { key: "bottomRight", label: "Bottom right" },
];

function CornerPinTab({ output, onChange }: { output: OutputInfo; onChange: (corners: CornerPin) => void }) {
  const [corners, change] = useSettled(output.corners, onChange, 250);
  const changed = JSON.stringify(corners) !== JSON.stringify(DEFAULT_CORNERS);
  const size = output.display
    ? { width: output.display.bounds.width, height: output.display.bounds.height }
    : { width: 1920, height: 1080 };
  // The corners drawn over the output's shape, for seeing what the numbers do.
  const point = (key: keyof CornerPin, baseX: number, baseY: number) =>
    `${((baseX + corners[key][0]) / size.width) * 100},${((baseY + corners[key][1]) / size.height) * 100}`;
  const shape = [
    point("topLeft", 0, 0),
    point("topRight", size.width, 0),
    point("bottomRight", size.width, size.height),
    point("bottomLeft", 0, size.height),
  ].join(" ");
  return (
    <div className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_220px]">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {CORNERS.map((corner) => (
          <div key={corner.key} className="space-y-1.5">
            <div className="text-[12px] font-medium text-foreground">{corner.label}</div>
            <div className="grid grid-cols-2 gap-2">
              {[0, 1].map((axis) => (
                <NumberField
                  key={axis}
                  label={axis === 0 ? "Across" : "Down"}
                  value={Math.round(corners[corner.key][axis])}
                  onChange={(value) => {
                    const next: [number, number] = [...corners[corner.key]] as [number, number];
                    next[axis] = value;
                    change({ ...corners, [corner.key]: next });
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="rounded-lg bg-black/30 p-3">
          <svg viewBox="-10 -10 120 120" className="w-full" style={{ aspectRatio: `${size.width} / ${size.height}` }} preserveAspectRatio="none">
            <rect x="0" y="0" width="100" height="100" fill="none" stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
            <polygon points={shape} fill="rgba(99,102,241,0.25)" stroke="rgb(129,140,248)" strokeWidth="1.5" />
          </svg>
        </div>
        <p className="text-[11.5px] leading-[17px] text-muted-foreground">
          Move a corner to square the picture up on a screen the projector is not straight on to. In the output&apos;s
          pixels.
        </p>
        <SettingsButton variant="ghost" disabled={!changed} onClick={() => change(DEFAULT_CORNERS)}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Reset corners
        </SettingsButton>
      </div>
    </div>
  );
}

/** The selected screen: what it is, its outputs, and how each shows it. */
function ScreenDetail({
  screen,
  screens,
  displays,
  onScreen,
  onOutputChange,
  onOutputDisplay,
  onAddOutput,
  onRemoveOutput,
  onTurn,
  onRemove,
}: {
  screen: ScreenInfo;
  screens: ScreenInfo[];
  displays: ScreenOutput[];
  onScreen: (patch: ScreenPatch) => void;
  onOutputChange: (output: string, patch: OutputPatch) => void;
  onOutputDisplay: (output: OutputInfo, displayId: number | null) => void;
  onAddOutput: (kind: OutputKind, displayId: number | null) => void;
  onRemoveOutput: (output: string) => void;
  onTurn: (on: boolean) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(screen.name);
  const [named, setNamed] = useState(screen.name);
  if (named !== screen.name) {
    setNamed(screen.name);
    setName(screen.name);
  }
  const commitName = () => {
    const next = name.trim();
    if (next && next !== screen.name) onScreen({ name: next });
    else setName(screen.name);
  };
  const [selectedOutputId, setSelectedOutputId] = useState("main");
  const selected = screen.outputs.find((output) => output.id === selectedOutputId) ?? screen.outputs[0] ?? null;
  const selectedIndex = selected ? screen.outputs.indexOf(selected) : 0;
  const [tab, setTab] = useState<"hardware" | "color" | "corners">("hardware");
  const [overlap, setOverlap] = useSettled(screen.blend.overlap, (value) => onScreen({ blend: { ...screen.blend, overlap: value } }));

  const inUse = screen.outputs.filter((output) => output.inUse);
  const displayOutputs = inUse.filter((output) => output.kind === "display");
  const typeInfo = TYPES.find((each) => each.value === screen.screenType) ?? TYPES[0];

  const warnings: string[] = [];
  for (const [index, output] of inUse.entries()) {
    const label = inUse.length > 1 ? `Output ${index + 1}` : screen.name;
    if (output.kind === "ndi") continue;
    if (!output.display) {
      warnings.push(
        output.outputMissing
          ? `${label}: its display isn't connected. Connect it, or choose another.`
          : `${label} has no display yet. Choose one to turn it on.`,
      );
      continue;
    }
    if (displays.length === 1) {
      warnings.push(`Only one display is connected, so ${label} covers Present itself when on.`);
    } else if (output.display.isPrimary) {
      warnings.push(`${label} is on ${displayName(output.display)}, the main display. It covers Present when on.`);
    }
    const sharing = screens.flatMap((other) =>
      other.outputs
        .filter(
          (each) =>
            each.inUse &&
            each.kind === "display" &&
            each.display?.id === output.display?.id &&
            !(other.id === screen.id && each.id === output.id),
        )
        .map(() => other.name),
    );
    if (displays.length > 1 && sharing.length > 0) {
      warnings.push(`${label} shares ${displayName(output.display)} with ${[...new Set(sharing)].join(", ")}; only one can be seen there.`);
    }
  }
  if (screen.screenType !== "single" && screen.outputs.length < 2) {
    warnings.push(`A ${typeInfo.label.toLowerCase()} screen needs more than one output. Add another below.`);
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-border/60 px-5 pb-4 pt-4">
        <div className="min-w-[200px] flex-1">
          <input
            aria-label="Screen name"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              if (event.key === "Escape") {
                setName(screen.name);
                (event.target as HTMLInputElement).blur();
              }
            }}
            className="-ml-1.5 w-full rounded-md bg-transparent px-1.5 py-0.5 text-[18px] font-semibold tracking-[-0.01em] text-foreground outline-none transition hover:bg-foreground/[0.05] focus:bg-foreground/[0.07] focus:ring-2 focus:ring-primary/30"
          />
          <p className="mt-0.5 text-[12.5px] tabular-nums text-muted-foreground">
            {times(screen.canvas[0], screen.canvas[1])} · {typeInfo.label}
            {inUse.length > 1 ? ` · ${inUse.length} outputs` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 pt-1">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-foreground">
            <input
              type="checkbox"
              checked={Boolean(screen.color)}
              onChange={(event) => onScreen({ color: event.target.checked ? "#1e293b" : null })}
              className="h-3.5 w-3.5 accent-[var(--primary)]"
            />
            Screen color
          </label>
          {screen.color ? (
            <div className="w-[130px]">
              <ColorInput label="Screen color" value={screen.color} onChange={(color) => onScreen({ color })} />
            </div>
          ) : null}
          <div className="flex items-center gap-2 border-l border-border/60 pl-4">
            <span className={cn("text-[12px] font-medium", screen.open ? "text-emerald-500" : "text-muted-foreground")}>
              {screen.open ? "On" : "Off"}
            </span>
            <SettingsSwitch checked={screen.open} onChange={onTurn} label={`${screen.name} on`} disabled={!inShell()} />
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-foreground">Type</div>
            <div className="text-[12px] text-muted-foreground">{typeInfo.description}</div>
          </div>
          <Segmented
            label="Screen type"
            className="w-full max-w-[380px]"
            value={screen.screenType}
            onChange={(value) => onScreen({ screenType: value as ScreenType })}
            options={TYPES.map(({ value, label }) => ({ value, label }))}
          />
        </div>
        {screen.screenType === "grouped" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] font-medium text-foreground">Outputs across</div>
            <SettingsNumber
              label="Outputs across"
              value={screen.grid.columns}
              min={1}
              max={16}
              onChange={(columns) => onScreen({ grid: { columns } })}
            />
          </div>
        ) : null}
        {screen.screenType === "edge-blend" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] font-medium text-foreground">Overlap</div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex w-[220px] items-center gap-3">
                <input
                  type="range"
                  aria-label="Overlap"
                  min={0}
                  max={960}
                  value={overlap}
                  onChange={(event) => setOverlap(Number(event.target.value))}
                  className="h-1 min-w-0 flex-1 cursor-pointer accent-primary"
                />
                <span className="w-14 text-right text-[12px] tabular-nums text-muted-foreground">{overlap} px</span>
              </div>
              <Segmented
                label="Blend curve"
                className="w-[230px]"
                value={screen.blend.curve}
                onChange={(value) => onScreen({ blend: { ...screen.blend, curve: value as BlendCurve } })}
                options={[
                  { value: "linear", label: "Linear" },
                  { value: "cubic", label: "Cubic" },
                  { value: "quadratic", label: "Quadratic" },
                ]}
              />
            </div>
          </div>
        ) : null}
        {screen.group === "stage" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground">Layout</div>
              <div className="text-[12px] text-muted-foreground">What the stage screen shows.</div>
            </div>
            <SettingsSelect
              label="Stage layout"
              value={screen.layout ?? "worship"}
              onChange={(layout) => onScreen({ layout })}
              className="w-[230px]"
              options={[
                { value: "media", label: "Media stage" },
                { value: "worship", label: "Worship stage" },
              ]}
            />
          </div>
        ) : null}

        {screen.screenType === "grouped" || screen.screenType === "edge-blend" ? (
          <PictureLayout screen={screen} selectedId={selected?.id ?? null} onSelect={setSelectedOutputId} />
        ) : null}
        {displayOutputs.length > 0 || displays.length > 0 ? (
          <div>
            <Arrangement
              displays={displays}
              screens={screens}
              selected={selected}
              onPick={(displayId) => selected && onOutputDisplay(selected, displayId)}
            />
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Arranged as the computer has them. Click a display to send{" "}
              {screen.outputs.length > 1 ? `output ${selectedIndex + 1}` : screen.name} to it.
            </p>
          </div>
        ) : null}
      </div>

      <div className="px-5 pb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Outputs</h3>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add output
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[240px]">
              <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
                {screen.screenType === "single" ? "Mirror this screen on" : "Add an output on"}
              </DropdownMenuLabel>
              {displays.map((display) => (
                <DropdownMenuItem key={display.id} onSelect={() => onAddOutput("display", display.id)}>
                  <span className="min-w-0 flex-1 truncate">{displayName(display)}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {times(display.bounds.width, display.bounds.height)}
                  </span>
                </DropdownMenuItem>
              ))}
              {screen.group === "audience" ? (
                <DropdownMenuItem onSelect={() => onAddOutput("ndi", null)}>
                  <span className="flex-1">NDI</span>
                  <span className="text-[11px] text-muted-foreground">On the network</span>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
          {screen.outputs.length > 1 ? (
            <div className="flex flex-wrap gap-1 border-b border-border/60 p-1.5">
              {screen.outputs.map((output, index) => (
                <button
                  key={output.id}
                  type="button"
                  onClick={() => setSelectedOutputId(output.id)}
                  className={cn(
                    "flex min-w-0 max-w-[220px] items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition",
                    output.id === selected?.id ? "bg-foreground/[0.1] text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05]",
                    !output.inUse && "opacity-50",
                  )}
                  title={output.inUse ? undefined : "Not used by a single screen"}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 flex-none rounded-full",
                      output.open ? "bg-emerald-400" : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="truncate">
                    {index + 1} · {outputName(output, index)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex gap-1 border-b border-border/60 px-3 pt-2">
            {(
              [
                ["hardware", "Hardware"],
                ["color", "Color"],
                ["corners", "Corner Pin"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-[12.5px] font-medium transition",
                  tab === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {selected ? (
            tab === "hardware" ? (
              <HardwareTab
                key={selected.id}
                screen={screen}
                output={selected}
                index={selectedIndex}
                displays={displays}
                onOutput={(displayId) => onOutputDisplay(selected, displayId)}
                onChange={(patch) => onOutputChange(selected.id, patch)}
                onRemove={() => {
                  setSelectedOutputId("main");
                  onRemoveOutput(selected.id);
                }}
              />
            ) : tab === "color" ? (
              <ColorTab key={selected.id} output={selected} onChange={(color) => onOutputChange(selected.id, { color })} />
            ) : (
              <CornerPinTab
                key={selected.id}
                output={selected}
                onChange={(corners) => onOutputChange(selected.id, { corners })}
              />
            )
          ) : null}
        </div>

        {warnings.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {warnings.map((warning) => (
              <p key={warning} className="flex gap-2 text-[12px] leading-[18px] text-amber-500">
                <TriangleAlert className="mt-[2px] h-3.5 w-3.5 flex-none" aria-hidden />
                <span>{warning}</span>
              </p>
            ))}
          </div>
        ) : null}

        {screen.builtIn ? null : (
          <div className="mt-4 flex justify-end">
            <SettingsButton variant="ghost" onClick={onRemove} className="text-red-400 hover:text-red-300">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Remove screen
            </SettingsButton>
          </div>
        )}
      </div>
    </div>
  );
}

export function ScreensSettings({
  onScreenDisplayChange,
  audioOutputDeviceId,
  audioOutputDeviceLabel,
  audioOutputs,
  onAudioOutputChange,
}: {
  onScreenDisplayChange: (role: ScreenRole, displayId: number | null) => void;
  audioOutputDeviceId: string | null;
  audioOutputDeviceLabel: string;
  audioOutputs: Array<{ deviceId: string; label: string }>;
  onAudioOutputChange: (deviceId: string) => void;
}) {
  const displays = useDisplays();
  const { screens, refresh } = useScreens();
  const list = useMemo(() => screens ?? [], [screens]);
  const [selectedId, setSelectedId] = useState<string>("audience");
  const selected = list.find((screen) => screen.id === selectedId) ?? list[0] ?? null;
  const audience = list.filter((screen) => screen.group === "audience");
  const stage = list.filter((screen) => screen.group === "stage");
  const anyOn = list.some((screen) => screen.open);

  const settle = useCallback(() => {
    for (const delay of [350, 1200]) {
      window.setTimeout(() => {
        void refresh();
      }, delay);
    }
  }, [refresh]);

  const run = useCallback(
    (label: string, work: () => Promise<unknown>) => {
      void work()
        .catch((error: unknown) => console.error(`[Screens] could not ${label}`, error))
        .finally(settle);
    },
    [settle],
  );

  // The three built in are turned on and off by the operator window, as its
  // buttons and the menu do, so this page and they never disagree about how.
  const turn = useCallback(
    (screen: ScreenInfo, on: boolean) => {
      if (screen.open === on || !inShell()) return;
      if (screen.builtIn) {
        run("turn a screen on or off", () => emitToOperator(BUILT_IN_COMMAND[screen.id]));
      } else {
        run("turn a screen on or off", () => (on ? openScreen(screen.id) : closeScreen(screen.id)));
      }
    },
    [run],
  );

  const turnGroup = useCallback(
    (group: ScreenGroup, on: boolean) => {
      const members = list.filter((screen) => screen.group === group);
      const output = members.find((screen) => screen.id === "audience");
      // The Output takes the added audience screens with it.
      if (output && output.open !== on) {
        turn(output, on);
        return;
      }
      for (const screen of members) turn(screen, on);
    },
    [list, turn],
  );

  const chooseDisplay = useCallback(
    (screen: ScreenInfo, output: OutputInfo, displayId: number | null) => {
      if (screen.builtIn && output.id === "main") {
        onScreenDisplayChange(screen.id as ScreenRole, displayId);
        settle();
        return;
      }
      run("choose a display", () => setOutputDisplay(screen.id, output.id, displayId));
    },
    [onScreenDisplayChange, run, settle],
  );

  const add = useCallback(
    (group: ScreenGroup, displayId: number | null, ndi: boolean) => {
      void addScreen(group, displayId, ndi)
        .then((id) => {
          setSelectedId(id);
          return refresh();
        })
        .catch((error: unknown) => console.error("[Screens] could not add a screen", error));
    },
    [refresh],
  );

  const remove = useCallback(
    (screen: ScreenInfo) => {
      if (screen.id === selectedId) setSelectedId(screen.group === "audience" ? "audience" : "media");
      run("remove a screen", () => removeScreen(screen.id));
    },
    [run, selectedId],
  );

  const openDisplaySettings = () => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("open_display_settings"))
      .catch((error: unknown) => console.error("[Screens] could not open the display settings", error));
  };

  return (
    <SettingsPage
      wide
      title="Screens & sound"
      description="The screens the audience and the stage see, the outputs each goes to, and where the sound of videos plays."
    >
      <div>
        <SettingsGroup
          title="Screen configuration"
          description="Add a screen with + in its group. Right-click one you added to remove it."
          action={
            <SettingsButton variant="ghost" onClick={openDisplaySettings} title="The computer's own display settings">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Display settings
            </SettingsButton>
          }
        >
          <div className="@container">
            <div className="grid @3xl:grid-cols-[240px_minmax(0,1fr)]">
              <aside className="flex flex-col border-b border-border/60 bg-black/10 @3xl:border-b-0 @3xl:border-r">
                <ScreenGroupList
                  group="audience"
                  title="Audience"
                  screens={audience}
                  displays={displays}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                  onToggle={(on) => turnGroup("audience", on)}
                  onAdd={(displayId, ndi) => add("audience", displayId, ndi)}
                  onRemove={remove}
                />
                <div className="mx-3 border-t border-border/60" />
                <ScreenGroupList
                  group="stage"
                  title="Stage"
                  screens={stage}
                  displays={displays}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                  onToggle={(on) => turnGroup("stage", on)}
                  onAdd={(displayId) => add("stage", displayId, false)}
                  onRemove={remove}
                />
                <div className="mt-auto flex items-center gap-2 border-t border-border/60 px-3 py-2.5">
                  <span className="text-[12px] text-muted-foreground">Identify:</span>
                  <div className="flex rounded-md border border-border/80 bg-background/60 p-0.5">
                    {(["screens", "outputs"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={!anyOn}
                        title={
                          anyOn
                            ? mode === "screens"
                              ? "Show each screen's name on it"
                              : "Show the name of the display each screen is on"
                            : "Turn a screen on to identify it"
                        }
                        onClick={() => run("identify the screens", () => identifyScreens(mode))}
                        className="rounded px-2 py-0.5 text-[12px] font-medium capitalize text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              </aside>
              {selected ? (
                <ScreenDetail
                  key={selected.id}
                  screen={selected}
                  screens={list}
                  displays={displays}
                  onScreen={(patch) => run("change a screen", () => updateScreen(selected.id, patch))}
                  onOutputChange={(output, patch) => run("change an output", () => updateOutput(selected.id, output, patch))}
                  onOutputDisplay={(output, displayId) => chooseDisplay(selected, output, displayId)}
                  onAddOutput={(kind, displayId) => run("add an output", () => addOutput(selected.id, kind, displayId))}
                  onRemoveOutput={(output) => run("remove an output", () => removeOutput(selected.id, output))}
                  onTurn={(on) => turn(selected, on)}
                  onRemove={() => remove(selected)}
                />
              ) : (
                <div className="flex min-h-[240px] items-center justify-center text-[12.5px] text-muted-foreground">
                  {screens === null ? "Reading the screens…" : "No screens."}
                </div>
              )}
            </div>
          </div>
        </SettingsGroup>
        <SettingsNote>
          A display&apos;s own resolution and where it sits are the computer&apos;s, in Display settings. A
          splitter or a mirroring hub shows as one display, so every TV on it shows the same thing. For
          different pictures on each, give each its own port, a multi-display adapter, or a DisplayLink dock.
        </SettingsNote>
      </div>

      <SettingsGroup title="Sound">
        <SettingsRow label="Video sound" description="Plays once, from this computer, whether or not a screen is open.">
          <SettingsSelect
            label="Video sound output"
            value={audioOutputDeviceId ?? "__system_default__"}
            onChange={onAudioOutputChange}
            options={[
              { value: "__system_default__", label: "System default" },
              ...audioOutputs.map((device) => ({ value: device.deviceId, label: device.label })),
              ...(audioOutputDeviceId && !audioOutputs.some((device) => device.deviceId === audioOutputDeviceId)
                ? [{ value: audioOutputDeviceId, label: audioOutputDeviceLabel || "A device not connected" }]
                : []),
            ]}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
