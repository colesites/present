"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, Trash2, TriangleAlert } from "lucide-react";
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
  addScreen,
  closeScreen,
  identifyScreens,
  openScreen,
  ownSize,
  removeScreen,
  setScreenDisplay,
  updateScreen,
  useScreens,
  type ScreenGroup,
  type ScreenInfo,
  type ScreenOutput,
  type ScreenPatch,
} from "../../../renderer/tauri/screens";
import {
  SETTINGS_FIELD,
  SettingsButton,
  SettingsGroup,
  SettingsNote,
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

/** Sizes offered, as ProPresenter offers them: the common ones for projectors and TVs. */
const SIZES = [
  "3840x2160",
  "2560x1440",
  "1920x1200",
  "1920x1080",
  "1680x1050",
  "1600x900",
  "1440x900",
  "1366x768",
  "1280x800",
  "1280x720",
  "1024x768",
  "800x600",
];

const GROUP_DOT: Record<ScreenGroup, string> = {
  audience: "bg-primary",
  stage: "bg-amber-400",
};

const inShell = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const times = (width: number, height: number) => `${width} × ${height}`;

const displayName = (display: ScreenOutput) =>
  display.label || (display.isPrimary ? "Built-in display" : `Screen ${display.id}`);

/** How the operator knows a screen's picture: its own size, or its output's. */
const sizeText = (screen: ScreenInfo) => {
  if (screen.size) return times(screen.size.width, screen.size.height);
  if (screen.output) {
    const own = ownSize(screen.output);
    return times(own.width, own.height);
  }
  return "No output";
};

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

const DRAWING_RATIO = 0.4;
const DRAWING_MARGIN = 16;
const GAP = 4;

/**
 * The connected displays drawn where the computer arranges them, to scale,
 * with the screens that go to each. Clicking one sends the selected screen
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
  selected: ScreenInfo;
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

  if (displays.length === 0) {
    return (
      <div className="flex h-[168px] items-center justify-center rounded-lg bg-black/25 text-[12.5px] text-muted-foreground">
        Looking for outputs. Connect one and it appears here.
      </div>
    );
  }

  const height = Math.round(width * DRAWING_RATIO);
  const rects = displays.map(arrangedRect);
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const spanWidth = Math.max(1, Math.max(...rects.map((rect) => rect.x + rect.width)) - left);
  const spanHeight = Math.max(1, Math.max(...rects.map((rect) => rect.y + rect.height)) - top);
  const scale = Math.max(
    0,
    Math.min((width - DRAWING_MARGIN * 2) / spanWidth, (height - DRAWING_MARGIN * 2) / spanHeight),
  );
  const offsetX = (width - spanWidth * scale) / 2;
  const offsetY = (height - spanHeight * scale) / 2;

  return (
    <div ref={setElement} className="relative w-full rounded-lg bg-black/25" style={{ height: height || 168 }}>
      {width > 0
        ? displays.map((display, index) => {
            const rect = rects[index];
            const boxWidth = rect.width * scale - GAP;
            const boxHeight = rect.height * scale - GAP;
            const here = screens.filter((screen) => screen.output?.id === display.id);
            const isSelectedHere = selected.output?.id === display.id;
            const wordy = boxWidth >= 110;
            const chipsHeight = here.length === 0 ? 0 : wordy ? Math.min(here.length, 3) * 17 : 12;
            const showName = boxWidth >= 56 && boxHeight >= 22 + chipsHeight;
            const showSize = boxWidth >= 76 && boxHeight >= 36 + chipsHeight;
            return (
              <button
                key={display.id}
                type="button"
                title={`${displayName(display)} · ${times(display.bounds.width, display.bounds.height)}${isSelectedHere ? ` · ${selected.name} is here` : ` · Send ${selected.name} here`}`}
                onClick={() => onPick(display.id)}
                className={cn(
                  "absolute flex flex-col overflow-hidden rounded-[6px] border-2 bg-gradient-to-br from-zinc-700 to-zinc-900 p-[3px] text-left transition",
                  isSelectedHere ? "border-primary ring-[3px] ring-primary/25" : "border-zinc-500/50 hover:border-zinc-300/80",
                )}
                style={{
                  left: offsetX + (rect.x - left) * scale + GAP / 2,
                  top: offsetY + (rect.y - top) * scale + GAP / 2,
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
                      {here.slice(0, wordy ? 3 : here.length).map((screen) =>
                        wordy ? (
                          <span
                            key={screen.id}
                            className="flex max-w-full items-center gap-1 truncate rounded-full bg-black/45 px-1.5 py-px text-[9.5px] font-medium text-white/85"
                          >
                            <span className={cn("h-1.5 w-1.5 flex-none rounded-full", GROUP_DOT[screen.group])} />
                            <span className="truncate">{screen.name}</span>
                          </span>
                        ) : (
                          <span
                            key={screen.id}
                            className={cn("h-2 w-2 rounded-full ring-1 ring-black/40", GROUP_DOT[screen.group])}
                          />
                        ),
                      )}
                      {wordy && here.length > 3 ? (
                        <span className="text-[9.5px] text-white/60">+{here.length - 3}</span>
                      ) : null}
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
  onAdd: (displayId: number | null) => void;
  onRemove: (screen: ScreenInfo) => void;
}) {
  const anyOn = screens.some((screen) => screen.open);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
            aria-label={`Add ${group === "audience" ? "an audience" : "a stage"} screen`}
            title={`Add ${group === "audience" ? "an audience" : "a stage"} screen`}
          >
            <Plus className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[230px]">
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
              Add a screen on
            </DropdownMenuLabel>
            {displays.map((display) => (
              <DropdownMenuItem key={display.id} onSelect={() => onAdd(display.id)}>
                <span className="min-w-0 flex-1 truncate">{displayName(display)}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {times(display.bounds.width, display.bounds.height)}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAdd(null)}>
              <span className="flex-1">No output yet</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
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
                  {sizeText(screen)}
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

/** A screen's size: its output's own, one of the usual ones, or one typed in. */
function SizeControl({
  screen,
  onChange,
}: {
  screen: ScreenInfo;
  onChange: (size: { width: number; height: number } | null) => void;
}) {
  // Drawn afresh (`key`) whenever the size changes, here or elsewhere.
  const current = screen.size ? `${screen.size.width}x${screen.size.height}` : "own";
  const [custom, setCustom] = useState(() => !SIZES.includes(current) && current !== "own");
  const [width, setWidth] = useState(String(screen.size?.width ?? 1920));
  const [height, setHeight] = useState(String(screen.size?.height ?? 1080));

  const own = screen.output ? ownSize(screen.output) : null;
  const commit = () => {
    const w = Math.round(Number(width));
    const h = Math.round(Number(height));
    if (w >= 320 && h >= 240 && w <= 7680 && h <= 4320) onChange({ width: w, height: h });
  };

  return (
    <div className="flex items-center gap-2">
      <SettingsSelect
        label={`${screen.name} size`}
        value={custom ? "custom" : current}
        onChange={(value) => {
          if (value === "custom") {
            setCustom(true);
            return;
          }
          setCustom(false);
          if (value === "own") {
            onChange(null);
            return;
          }
          const [w, h] = value.split("x").map(Number);
          onChange({ width: w, height: h });
        }}
        className="w-[210px]"
        options={[
          { value: "own", label: own ? `Output's own · ${times(own.width, own.height)}` : "Output's own" },
          ...SIZES.map((size) => ({ value: size, label: size.replace("x", " × ") })),
          { value: "custom", label: "Custom…" },
        ]}
      />
      {custom ? (
        <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
          <input
            aria-label="Width"
            inputMode="numeric"
            value={width}
            onChange={(event) => setWidth(event.target.value.replace(/\D/g, ""))}
            onBlur={commit}
            onKeyDown={(event) => event.key === "Enter" && commit()}
            className={cn(SETTINGS_FIELD, "w-[70px] text-center tabular-nums")}
          />
          ×
          <input
            aria-label="Height"
            inputMode="numeric"
            value={height}
            onChange={(event) => setHeight(event.target.value.replace(/\D/g, ""))}
            onBlur={commit}
            onKeyDown={(event) => event.key === "Enter" && commit()}
            className={cn(SETTINGS_FIELD, "w-[70px] text-center tabular-nums")}
          />
        </span>
      ) : null}
    </div>
  );
}

/** The selected screen: what it is, where it goes, and how. */
function ScreenDetail({
  screen,
  screens,
  displays,
  onChange,
  onOutput,
  onTurn,
  onRemove,
}: {
  screen: ScreenInfo;
  screens: ScreenInfo[];
  displays: ScreenOutput[];
  onChange: (patch: ScreenPatch) => void;
  onOutput: (displayId: number | null) => void;
  onTurn: (on: boolean) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(screen.name);
  // Renamed elsewhere (another window, or undone): show the new name.
  const [named, setNamed] = useState(screen.name);
  if (named !== screen.name) {
    setNamed(screen.name);
    setName(screen.name);
  }
  const commitName = () => {
    const next = name.trim();
    if (next && next !== screen.name) onChange({ name: next });
    else setName(screen.name);
  };

  const output = screen.output;
  const sharing = output
    ? screens.filter((other) => other.id !== screen.id && other.output?.id === output.id)
    : [];
  const warnings: string[] = [];
  if (!output) {
    warnings.push(
      screen.outputMissing
        ? "Its output isn't connected. Connect it, or choose another."
        : "It has no output yet. Choose one to turn it on.",
    );
  } else if (displays.length === 1) {
    warnings.push(`Only one display is connected, so turning ${screen.name} on covers Present itself.`);
  } else if (output.isPrimary) {
    warnings.push(`${displayName(output)} is the main display. ${screen.name} on it covers Present.`);
  }
  if (output && displays.length > 1 && sharing.length > 0) {
    const names = sharing.map((other) => other.name);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    warnings.push(
      `${list} ${names.length === 1 ? "goes" : "go"} to ${displayName(output)} too, and only one can be seen there.`,
    );
  }

  const chosen = screen.displayId;
  const outputOptions = [
    screen.builtIn
      ? { value: "auto", label: "Automatic" }
      : { value: "none", label: "None" },
    ...displays.map((display) => ({
      value: String(display.id),
      label: `${displayName(display)} · ${times(display.bounds.width, display.bounds.height)}`,
    })),
  ];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-start gap-4 border-b border-border/60 px-5 pb-4 pt-4">
        <div className="min-w-0 flex-1">
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
            {sizeText(screen)}
            {output ? ` · ${displayName(output)}` : ""}
            {screen.builtIn ? "" : screen.group === "stage" ? " · Added stage screen" : " · Added audience screen"}
          </p>
        </div>
        <div className="flex flex-none items-center gap-4 pt-1">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-foreground">
            <input
              type="checkbox"
              checked={Boolean(screen.color)}
              onChange={(event) => onChange({ color: event.target.checked ? "#1e293b" : null })}
              className="h-3.5 w-3.5 accent-[var(--primary)]"
            />
            Screen color
          </label>
          {screen.color ? (
            <div className="w-[130px]">
              <ColorInput label="Screen color" value={screen.color} onChange={(color) => onChange({ color })} />
            </div>
          ) : null}
          <div className="flex items-center gap-2 border-l border-border/60 pl-4">
            <span className={cn("text-[12px] font-medium", screen.open ? "text-emerald-500" : "text-muted-foreground")}>
              {screen.open ? "On" : "Off"}
            </span>
            <SettingsSwitch
              checked={screen.open}
              onChange={onTurn}
              label={`${screen.name} on`}
              disabled={!inShell() || (!output && !screen.open)}
            />
          </div>
        </div>
      </div>

      <div className="px-5 pb-2 pt-4">
        <Arrangement displays={displays} screens={screens} selected={screen} onPick={onOutput} />
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Arranged as the computer has them. Click a display to send {screen.name} to it.
        </p>
      </div>

      <div className="px-5 pb-5 pt-2">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Hardware</h3>
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
          <div className="divide-y divide-border/60">
            <SettingsRow
              label="Output"
              description={
                chosen === null && screen.builtIn
                  ? output
                    ? `Automatic is using ${displayName(output)}, the largest display that isn't the main one.`
                    : "Automatic uses the largest display that isn't the main one."
                  : undefined
              }
            >
              <SettingsSelect
                label={`${screen.name} output`}
                value={chosen === null ? (screen.builtIn ? "auto" : "none") : String(chosen)}
                onChange={(value) => onOutput(value === "auto" || value === "none" ? null : Number(value))}
                className="w-[260px]"
                options={outputOptions}
              />
            </SettingsRow>
            <SettingsRow
              label="Output target"
              description={
                screen.target === "fit"
                  ? "Its own shape, inside the output, black at the edges."
                  : "Stretched to fill the whole output."
              }
            >
              <Segmented
                label="Output target"
                className="w-[160px]"
                value={screen.target}
                onChange={(value) => onChange({ target: value === "fit" ? "fit" : "full" })}
                options={[
                  { value: "full", label: "Full" },
                  { value: "fit", label: "Fit" },
                ]}
              />
            </SettingsRow>
            <SettingsRow
              label="Size"
              description="The resolution the picture is drawn at. A smaller one than the output's is lighter to draw, and is scaled up to it."
            >
              <SizeControl
                key={screen.size ? `${screen.size.width}x${screen.size.height}` : "own"}
                screen={screen}
                onChange={(size) => onChange({ size })}
              />
            </SettingsRow>
            {screen.group === "stage" ? (
              <SettingsRow
                label="Shows"
                description={
                  screen.builtIn
                    ? "Each built-in stage screen has its own layout."
                    : "The media desk's view, or the words large for the band."
                }
                disabled={screen.builtIn}
              >
                <Segmented
                  label="Stage layout"
                  className="w-[230px]"
                  disabled={screen.builtIn}
                  value={screen.layout ?? "worship"}
                  onChange={(value) => onChange({ layout: value === "media" ? "media" : "worship" })}
                  options={[
                    { value: "media", label: "Media stage" },
                    { value: "worship", label: "Worship stage" },
                  ]}
                />
              </SettingsRow>
            ) : null}
            {output ? (
              <div className="grid grid-cols-4 gap-3 px-4 py-3 text-[12px]">
                {[
                  ["Name", displayName(output)],
                  ["Resolution", times(output.bounds.width, output.bounds.height)],
                  ["Scale", output.scaleFactor && output.scaleFactor !== 1 ? `${output.scaleFactor}x` : "1x"],
                  ["Aspect ratio", aspectText(output.bounds.width, output.bounds.height)],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                    <div className="truncate font-medium tabular-nums text-foreground">{value}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {warnings.map((warning) => (
              <p key={warning} className="flex gap-2 px-4 py-3 text-[12px] leading-[18px] text-amber-500">
                <TriangleAlert className="mt-[2px] h-3.5 w-3.5 flex-none" aria-hidden />
                <span>{warning}</span>
              </p>
            ))}
          </div>
        </div>
        {screen.builtIn ? null : (
          <div className="mt-3 flex justify-end">
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

  const chooseOutput = useCallback(
    (screen: ScreenInfo, displayId: number | null) => {
      if (screen.builtIn) {
        onScreenDisplayChange(screen.id as ScreenRole, displayId);
        settle();
        return;
      }
      run("choose an output", () => setScreenDisplay(screen.id, displayId));
    },
    [onScreenDisplayChange, run, settle],
  );

  const add = useCallback(
    (group: ScreenGroup, displayId: number | null) => {
      void addScreen(group, displayId)
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
      description="The screens the audience and the stage see, what each goes to and at what size, and where the sound of videos plays."
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
          <div className="flex h-[640px]">
            <aside className="flex w-[244px] flex-none flex-col border-r border-border/60 bg-black/10">
              <ScreenGroupList
                group="audience"
                title="Audience"
                screens={audience}
                displays={displays}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
                onToggle={(on) => turnGroup("audience", on)}
                onAdd={(displayId) => add("audience", displayId)}
                onRemove={remove}
              />
              <div className="border-t border-border/60" />
              <ScreenGroupList
                group="stage"
                title="Stage"
                screens={stage}
                displays={displays}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
                onToggle={(on) => turnGroup("stage", on)}
                onAdd={(displayId) => add("stage", displayId)}
                onRemove={remove}
              />
              <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2.5">
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
                            : "Show the name of the output each screen is on"
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
              <div className="min-w-0 flex-1 overflow-y-auto">
                <ScreenDetail
                  key={selected.id}
                  screen={selected}
                  screens={list}
                  displays={displays}
                  onChange={(patch) => run("change a screen", () => updateScreen(selected.id, patch))}
                  onOutput={(displayId) => chooseOutput(selected, displayId)}
                  onTurn={(on) => turn(selected, on)}
                  onRemove={() => remove(selected)}
                />
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-[12.5px] text-muted-foreground">
                {screens === null ? "Reading the screens…" : "No screens."}
              </div>
            )}
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
