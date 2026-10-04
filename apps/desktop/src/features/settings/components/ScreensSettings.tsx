"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, ExternalLink, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../renderer/shared/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../renderer/shared/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../../../renderer/shared/components/ui/select";
import { areDisplayListsEqual } from "../../../renderer/shared/lib/display-list";
import { askEditorFor, useStageLayouts } from "../../stage/layouts";
import { cn } from "../../../renderer/shared/lib/utils";
import {
  addOutput,
  addScreen,
  closeScreen,
  DEFAULT_COLOR,
  DEFAULT_CORNERS,
  identifyScreens,
  isStream,
  openScreen,
  outputSize,
  removeOutput,
  removeScreen,
  setOutputDisplay,
  updateOutput,
  updateScreen,
  useScreens,
  useStreamOutputs,
  type BlendCurve,
  type ColorAdjust,
  type CornerPin,
  type OutputInfo,
  type OutputKind,
  type OutputPatch,
  type OutputTarget,
  type StreamOutputs,
  type VideoMode,
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

const isMac = () => typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

/** What an audience screen can be sent as besides a display. Syphon and SDI are on a Mac. */
const STREAM_KINDS: Array<{ kind: OutputKind; label: string; note: string; choice: string }> = [
  { kind: "ndi", label: "NDI", note: "On the network", choice: "NDI, on the network" },
  { kind: "syphon", label: "Syphon", note: "To apps on this Mac", choice: "Syphon, to apps on this Mac" },
  { kind: "sdi", label: "SDI", note: "Blackmagic DeckLink", choice: "SDI, out of a DeckLink" },
];
const streamKinds = () => STREAM_KINDS.filter((each) => each.kind === "ndi" || isMac());

const outputName = (output: OutputInfo, index: number) =>
  output.kind === "ndi"
    ? `NDI · ${output.source ?? "Present"}`
    : output.kind === "syphon"
      ? `Syphon · ${output.source ?? "Present"}`
      : output.kind === "sdi"
        ? "SDI"
        : output.kind === "placeholder"
          ? `Placeholder · ${times(...(output.size ?? [1920, 1080]))}`
          : output.display
      ? displayName(output.display)
      : index === 0
        ? "No display yet"
        : `Output ${index + 1}`;

/** The Stage Layouts window, open on `layout`. */
const openStageEditor = (layout: string) => {
  askEditorFor(layout);
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("open_window", { role: "stage-editor", options: null }))
    .catch((error: unknown) => console.error("[Screens] could not open the stage layouts", error));
};

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
  onAdd: (displayId: number | null, kind: OutputKind) => void;
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
              <DropdownMenuItem key={display.id} onSelect={() => onAdd(display.id, "display")}>
                <span className="min-w-0 flex-1 truncate">{displayName(display)}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {times(display.bounds.width, display.bounds.height)}
                </span>
              </DropdownMenuItem>
            ))}
            {group === "audience"
              ? streamKinds().map((each) => (
                  <DropdownMenuItem key={each.kind} onSelect={() => onAdd(null, each.kind)}>
                    <span className="flex-1">{each.label}</span>
                    <span className="text-[11px] text-muted-foreground">{each.note}</span>
                  </DropdownMenuItem>
                ))
              : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAdd(null, "placeholder")}>
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

/** Sizes a Syphon server or a placeholder is made at, as ProPresenter offers them. */
const STREAM_SIZES: Array<[number, number]> = [
  [1280, 720],
  [1920, 1080],
  [3840, 2160],
];

/** Parts an output can be cut into, across × down. */
const SPLITS: Array<[number, number]> = [
  [2, 1],
  [1, 2],
  [2, 2],
  [3, 1],
  [3, 3],
];

/** Picture sizes an output target can be, at the top left of the output. */
const TARGET_SIZES: Array<[number, number]> = [
  [3840, 2160],
  [2560, 1440],
  [1920, 1200],
  [1920, 1080],
  [1680, 1050],
  [1600, 900],
  [1440, 900],
  [1366, 768],
  [1280, 1024],
  [1280, 800],
  [1280, 720],
  [1024, 768],
  [800, 600],
  [640, 480],
];

const sizeLabel = ([width, height]: [number, number]) => times(width, height);

/** What an output is, in the Output menu's button. */
function outputChoice(output: OutputInfo, streams: StreamOutputs, firstOfBuiltIn: boolean) {
  const size = sizeLabel(outputSize(output, streams));
  const mode = (modes: VideoMode[], fallback: string) =>
    modes.find((each) => each.code === (output.videoMode ?? fallback))?.label ?? size;
  switch (output.kind) {
    case "ndi":
      return `NDI · ${output.source ?? "Present"} · ${output.size ? size : mode(streams.ndiModes, "Hp30")}`;
    case "syphon":
      return `Syphon · ${output.source ?? "Present"} · ${size}`;
    case "sdi": {
      const device = streams.sdiDevices.find((each) => each.id === output.device)?.name ?? "DeckLink";
      return `SDI · ${device} · ${mode(streams.sdiModes, "Hp29")}`;
    }
    case "placeholder":
      return `Placeholder · ${size}`;
    default:
      return output.display
        ? `${output.displayId === null && firstOfBuiltIn ? "Automatic: " : ""}${displayName(output.display)} (${times(output.display.bounds.width, output.display.bounds.height)})`
        : firstOfBuiltIn
          ? "Automatic"
          : "None";
  }
}

/** A small picture of what an output is, in the screen's colour, as ProPresenter shows it. */
function OutputSwatch({ color, kind }: { color: string | null; kind: OutputKind }) {
  return (
    <span
      className={cn(
        "flex h-4 w-6 flex-none items-center justify-center rounded-[3px] text-[8px] font-bold uppercase text-white/80 ring-1 ring-white/15",
        kind === "display" ? "" : "bg-zinc-700",
      )}
      style={kind === "display" ? { backgroundColor: color ?? "#e35f5f" } : undefined}
    >
      {kind === "ndi" ? "N" : kind === "syphon" ? "S" : kind === "sdi" ? "SDI" : kind === "placeholder" ? "P" : ""}
    </span>
  );
}

/**
 * Where the output goes, grouped as ProPresenter groups it: the displays
 * connected, then an NDI source, a Syphon server, an SDI card or a
 * placeholder, each at a size or mode picked from its list, or a size of
 * your own.
 */
function OutputMenu({
  screen,
  output,
  index,
  displays,
  streams,
  onDisplay,
  onChange,
}: {
  screen: ScreenInfo;
  output: OutputInfo;
  index: number;
  displays: ScreenOutput[];
  streams: StreamOutputs;
  onDisplay: (displayId: number | null) => void;
  onChange: (patch: OutputPatch) => void;
}) {
  const firstOfBuiltIn = screen.builtIn && output.id === "main";
  const sends = screen.group === "audience" && !firstOfBuiltIn;
  const [asking, setAsking] = useState<OutputKind | null>(null);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [ownWidth, ownHeight] = outputSize(output, streams);

  const toDisplay = (displayId: number | null) => {
    if (output.kind !== "display") onChange({ kind: "display" });
    onDisplay(displayId);
  };
  const ask = (kind: OutputKind) => {
    setWidth(output.kind === kind ? ownWidth : 1920);
    setHeight(output.kind === kind ? ownHeight : 1080);
    setAsking(kind);
  };
  const isCurrent = (patch: OutputPatch) =>
    output.kind === patch.kind &&
    (patch.videoMode === undefined || (output.videoMode ?? null) === patch.videoMode) &&
    (patch.size === undefined ||
      JSON.stringify(output.size ?? null) === JSON.stringify(patch.size ?? null)) &&
    (patch.device === undefined || (output.device ?? null) === patch.device);
  const item = (key: string, label: string, patch: OutputPatch, note?: string) => (
    <DropdownMenuItem key={key} onSelect={() => onChange(patch)}>
      <Check className={cn("h-3.5 w-3.5 flex-none", isCurrent(patch) ? "opacity-100" : "opacity-0")} aria-hidden />
      <span className="flex-1">{label}</span>
      {note ? <span className="text-[11px] tabular-nums text-muted-foreground">{note}</span> : null}
    </DropdownMenuItem>
  );
  const custom = (kind: OutputKind) => (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => ask(kind)}>
        <Check
          className={cn("h-3.5 w-3.5 flex-none", output.kind === kind && output.size ? "opacity-100" : "opacity-0")}
          aria-hidden
        />
        Custom Size…
      </DropdownMenuItem>
    </>
  );
  const sizes = (kind: OutputKind) => (
    <>
      {STREAM_SIZES.map((size) => item(`${kind}-${size.join("x")}`, sizeLabel(size), { kind, size, videoMode: null }))}
      {custom(kind)}
    </>
  );
  const heading = (label: string) => (
    <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      {label}
    </DropdownMenuLabel>
  );

  return (
    <>
      {/* Not modal, so Custom Size's dialog can take the focus from it. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={`${screen.name} output ${index + 1}`}
          className={cn(SETTINGS_FIELD, "flex w-[320px] max-w-full items-center gap-2 text-left")}
        >
          <OutputSwatch color={screen.color} kind={output.kind} />
          <span className="min-w-0 flex-1 truncate">{outputChoice(output, streams, firstOfBuiltIn)}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[300px] overflow-y-auto"
        >
          {heading("Displays")}
          <DropdownMenuItem onSelect={() => toDisplay(null)}>
            <Check
              className={cn(
                "h-3.5 w-3.5 flex-none",
                output.kind === "display" && output.displayId === null ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
            <span className="flex-1">{firstOfBuiltIn ? "Automatic" : "None"}</span>
          </DropdownMenuItem>
          {displays.map((each) => (
            <DropdownMenuItem key={each.id} onSelect={() => toDisplay(each.id)}>
              <Check
                className={cn(
                  "h-3.5 w-3.5 flex-none",
                  output.kind === "display" && output.displayId === each.id ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
              <OutputSwatch color={screen.color} kind="display" />
              <span className="min-w-0 flex-1 truncate">{displayName(each)}</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {times(each.bounds.width, each.bounds.height)}
              </span>
            </DropdownMenuItem>
          ))}
          {sends ? (
            <>
              <DropdownMenuSeparator />
              {heading("NDI")}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Check className={cn("h-3.5 w-3.5", output.kind === "ndi" ? "opacity-100" : "opacity-0")} aria-hidden />
                  {output.kind === "ndi" ? "NDI" : "New NDI"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[180px]">
                  {streams.ndiModes.map((mode) =>
                    item(`ndi-${mode.code}`, mode.label, { kind: "ndi", videoMode: mode.code, size: null }),
                  )}
                  {custom("ndi")}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {isMac() ? (
                <>
                  <DropdownMenuSeparator />
                  {heading("Syphon")}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Check className={cn("h-3.5 w-3.5", output.kind === "syphon" ? "opacity-100" : "opacity-0")} aria-hidden />
                      {output.kind === "syphon" ? "Syphon" : "New Syphon"}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-[180px]">{sizes("syphon")}</DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  {heading("SDI")}
                  {!streams.sdi ? (
                    <DropdownMenuItem disabled>
                      <span className="w-3.5" />
                      Needs Blackmagic Desktop Video
                    </DropdownMenuItem>
                  ) : null}
                  {(streams.sdiDevices.length > 0
                    ? streams.sdiDevices
                    : [{ id: "", name: streams.sdi ? "No DeckLink connected" : "DeckLink" }]
                  ).map((device) => (
                    <DropdownMenuSub key={device.id || "first"}>
                      <DropdownMenuSubTrigger>
                        <Check
                          className={cn(
                            "h-3.5 w-3.5",
                            output.kind === "sdi" && (output.device ?? "") === device.id ? "opacity-100" : "opacity-0",
                          )}
                          aria-hidden
                        />
                        {device.name}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[180px] overflow-y-auto">
                        {streams.sdiModes.map((mode) =>
                          item(`sdi-${device.id}-${mode.code}`, mode.label, {
                            kind: "sdi",
                            device: device.id || null,
                            videoMode: mode.code,
                          }),
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ))}
                </>
              ) : null}
            </>
          ) : null}
          {!firstOfBuiltIn ? (
            <>
              <DropdownMenuSeparator />
              {heading("Placeholder")}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Check
                    className={cn("h-3.5 w-3.5", output.kind === "placeholder" ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  {output.kind === "placeholder" ? "Placeholder" : "New Placeholder"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[180px]">{sizes("placeholder")}</DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <AlertDialogContent className="max-w-[360px]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Custom size
              {asking === "ndi" ? " for NDI" : asking === "syphon" ? " for Syphon" : asking === "placeholder" ? " for the placeholder" : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {asking === "ndi" ? "Sent at 30 frames a second." : "In pixels."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Width" value={width} min={16} max={16384} onChange={setWidth} />
            <NumberField label="Height" value={height} min={16} max={16384} onChange={setHeight} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (asking) onChange({ kind: asking, size: [width, height], videoMode: null });
                setAsking(null);
              }}
            >
              Use this size
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The Output Target list's value for a target. */
function targetValue(target: OutputTarget, sizes: Array<[number, number]>) {
  if (target.kind === "full") return "full";
  if (target.kind === "split") return `split:${target.columns}x${target.rows}`;
  if (target.x === 0 && target.y === 0 && sizes.some(([width, height]) => width === target.width && height === target.height)) {
    return `size:${target.width}x${target.height}`;
  }
  return "custom";
}

/**
 * Where on its output the screen's picture goes: all of it, one part of it
 * cut into equal parts, a picture of a common size at its top left, or any
 * rectangle at all.
 */
function TargetMenu({
  target,
  own,
  onChange,
}: {
  target: OutputTarget;
  own: [number, number];
  onChange: (target: OutputTarget) => void;
}) {
  const [ownWidth, ownHeight] = own;
  const sizes = TARGET_SIZES.filter(
    ([width, height]) => width <= ownWidth && height <= ownHeight && !(width === ownWidth && height === ownHeight),
  );
  const choose = (value: string) => {
    if (value === "full") return onChange({ kind: "full" });
    if (value === "custom") {
      return onChange(
        target.kind === "custom" ? target : { kind: "custom", x: 0, y: 0, width: ownWidth, height: ownHeight },
      );
    }
    const [kind, dims] = value.split(":");
    const [a, b] = dims.split("x").map(Number);
    if (kind === "split") {
      const cell = target.kind === "split" && target.columns === a && target.rows === b ? target.cell : 0;
      return onChange({ kind: "split", columns: a, rows: b, cell });
    }
    onChange({ kind: "custom", x: 0, y: 0, width: a, height: b });
  };
  return (
    <Select value={targetValue(target, sizes)} onValueChange={choose}>
      <SelectTrigger aria-label="Output target" className={cn(SETTINGS_FIELD, "w-[200px] justify-between")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-[min(26rem,var(--radix-select-content-available-height))]">
        <SelectItem value="full">Full</SelectItem>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Split</SelectLabel>
          {SPLITS.map(([columns, rows]) => (
            <SelectItem key={`${columns}x${rows}`} value={`split:${columns}x${rows}`}>
              {columns} × {rows}
            </SelectItem>
          ))}
        </SelectGroup>
        {sizes.length > 0 ? (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Size</SelectLabel>
              {sizes.map(([width, height]) => (
                <SelectItem key={`${width}x${height}`} value={`size:${width}x${height}`}>
                  {times(width, height)}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        ) : null}
        <SelectSeparator />
        <SelectItem value="custom">Custom…</SelectItem>
      </SelectContent>
    </Select>
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
  const streams = useStreamOutputs();
  const stream = isStream(output.kind);
  const [name, setName] = useState(output.sourceName ?? "");
  const [named, setNamed] = useState(output.sourceName ?? "");
  if (named !== (output.sourceName ?? "")) {
    setNamed(output.sourceName ?? "");
    setName(output.sourceName ?? "");
  }
  const target = output.target;
  const display = output.display;
  const own = outputSize(output, streams);
  const [ownWidth, ownHeight] = own;
  const mode =
    output.kind === "sdi"
      ? streams.sdiModes.find((each) => each.code === (output.videoMode ?? "Hp29"))
      : output.kind === "ndi" && !output.size
        ? streams.ndiModes.find((each) => each.code === (output.videoMode ?? "Hp30"))
        : undefined;
  const facts: Array<[string, string]> =
    output.kind === "display"
      ? display
        ? [
            ["Name", displayName(display)],
            ["Size", times(display.bounds.width, display.bounds.height)],
            ["Scale", display.scaleFactor && display.scaleFactor !== 1 ? `${display.scaleFactor}x` : "1x"],
            ["Aspect ratio", aspectText(display.bounds.width, display.bounds.height)],
          ]
        : []
      : [
          ["Name", output.source ?? (output.kind === "placeholder" ? `Placeholder ${index + 1}` : screen.name)],
          ["Size", times(ownWidth, ownHeight)],
          ...(mode ? ([["Mode", mode.label]] as Array<[string, string]>) : []),
          ["Aspect ratio", aspectText(ownWidth, ownHeight)],
        ];

  return (
    <div className="divide-y divide-border/60">
      <SettingsRow
        label="Output"
        description={
          output.kind === "ndi"
            ? "Sent as an NDI source on the network, for a streaming computer or a switcher."
            : output.kind === "syphon"
              ? "Shared as a Syphon server, for OBS, Resolume or another app on this Mac."
              : output.kind === "sdi"
                ? streams.sdi || output.error
                  ? "Played out of a Blackmagic DeckLink or UltraStudio device, to a switcher or down a long cable."
                  : "Needs Blackmagic Desktop Video, the driver for DeckLink and UltraStudio devices, installed on this Mac."
                : output.kind === "placeholder"
                  ? "Nowhere yet. The screen is laid out at this size until it has a display or a stream."
                  : output.displayId === null && firstOfBuiltIn
                    ? display
                      ? `Automatic is using ${displayName(display)}, the largest display that isn't the main one.`
                      : "Automatic uses the largest display that isn't the main one."
                    : undefined
        }
      >
        <OutputMenu
          screen={screen}
          output={output}
          index={index}
          displays={displays}
          streams={streams}
          onDisplay={onOutput}
          onChange={onChange}
        />
      </SettingsRow>
      {output.error && stream ? (
        <div className="flex items-start gap-2 bg-red-500/10 px-4 py-2.5 text-[12.5px] text-red-300">
          <TriangleAlert className="mt-px h-4 w-4 flex-none" aria-hidden />
          <span>{output.error}</span>
        </div>
      ) : null}
      {output.kind === "ndi" || output.kind === "syphon" ? (
        <SettingsRow
          label="Source name"
          description={
            output.kind === "ndi"
              ? `Receivers see it as “${output.source ?? "Present"}”.`
              : `Other apps list it under Present as “${output.source ?? screen.name}”.`
          }
        >
          <input
            aria-label={output.kind === "ndi" ? "NDI source name" : "Syphon server name"}
            value={name}
            maxLength={64}
            placeholder={output.kind === "ndi" ? `Present ${screen.name}` : screen.name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const next = name.trim();
              if (next !== (output.sourceName ?? "")) onChange({ sourceName: next || null });
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
            ? `Present's picture fills the whole output, at ${times(ownWidth, ownHeight)}.`
            : target.kind === "split"
              ? `One of ${target.columns * target.rows} equal parts of the output, ${times(ownWidth / target.columns, ownHeight / target.rows)} each.`
              : targetValue(target, TARGET_SIZES) !== "custom"
                ? `A ${times(target.width, target.height)} picture at the top left of the output. The rest stays black.`
                : "A rectangle of the output, in its pixels: an LED wall's processor, or a picture framed inside a larger signal. The rest stays black."
        }
      >
        <TargetMenu target={target} own={own} onChange={(next) => onChange({ target: next })} />
      </SettingsRow>
      {target.kind === "split" ? (
        <SettingsRow label="Part" description="Which part this screen goes to, across then down.">
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${target.columns}, 34px)` }}
            role="radiogroup"
            aria-label="Part of the output"
          >
            {Array.from({ length: target.columns * target.rows }, (_, cell) => (
              <button
                key={cell}
                type="button"
                role="radio"
                aria-checked={target.cell === cell}
                onClick={() => onChange({ target: { ...target, cell } })}
                className={cn(
                  "h-[22px] rounded-[4px] text-[11px] font-medium tabular-nums ring-1 transition",
                  target.cell === cell
                    ? "bg-primary text-primary-foreground ring-primary"
                    : "bg-background/60 text-muted-foreground ring-border/80 hover:text-foreground",
                )}
              >
                {cell + 1}
              </button>
            ))}
          </div>
        </SettingsRow>
      ) : null}
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
      {facts.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 px-4 py-3 text-[12px] sm:grid-cols-4">
          {facts.map(([label, value]) => (
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
  const { layouts: stageLayouts } = useStageLayouts();
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
    if (output.kind !== "display") continue;
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
            <div className="flex items-center gap-2">
              <SettingsSelect
                label="Stage layout"
                value={screen.layout ?? (screen.id === "media" ? "media" : "worship")}
                onChange={(layout) => onScreen({ layout })}
                className="w-[230px]"
                options={stageLayouts.map((layout) => ({ value: layout.id, label: layout.name }))}
              />
              <SettingsButton
                onClick={() => openStageEditor(screen.layout ?? (screen.id === "media" ? "media" : "worship"))}
              >
                Edit layouts…
              </SettingsButton>
            </div>
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
              {screen.group === "audience"
                ? streamKinds().map((each) => (
                    <DropdownMenuItem key={each.kind} onSelect={() => onAddOutput(each.kind, null)}>
                      <span className="flex-1">{each.label}</span>
                      <span className="text-[11px] text-muted-foreground">{each.note}</span>
                    </DropdownMenuItem>
                  ))
                : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onAddOutput("placeholder", null)}>
                <span className="flex-1">Placeholder</span>
                <span className="text-[11px] text-muted-foreground">No output yet</span>
              </DropdownMenuItem>
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
}: {
  onScreenDisplayChange: (role: ScreenRole, displayId: number | null) => void;
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
    (group: ScreenGroup, displayId: number | null, kind: OutputKind) => {
      void addScreen(group, displayId, kind)
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
      title="Screens"
      description="The screens the audience and the stage see, and the outputs each goes to. Sound is in Audio."
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
                  onAdd={(displayId, kind) => add("audience", displayId, kind)}
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
                  onAdd={(displayId, kind) => add("stage", displayId, kind)}
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

    </SettingsPage>
  );
}
