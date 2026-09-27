"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, ScanEye, TriangleAlert } from "lucide-react";
import { IDENTIFY_EVENT } from "../../../renderer/shared/components/ScreenIdentify";
import { areDisplayListsEqual } from "../../../renderer/shared/lib/display-list";
import { cn } from "../../../renderer/shared/lib/utils";
import {
  SettingsButton,
  SettingsGroup,
  SettingsNote,
  SettingsPage,
  SettingsRow,
  SettingsSelect,
  SettingsSwitch,
} from "./settings-ui";

export type ScreenRole = "audience" | "media" | "worship";

type Screen = {
  key: ScreenRole;
  label: string;
  description: string;
  /** Its window's label, as `list_open_windows` reports it. */
  window: "output" | "media-stage" | "worship-stage";
  /** The menu item that turns it on and off, carried out by the operator window. */
  command: string;
  dot: string;
};

const AUDIENCE: Screen[] = [
  {
    key: "audience",
    label: "Audience",
    description: "What the congregation sees.",
    window: "output",
    command: "screens.output",
    dot: "bg-primary",
  },
];

const STAGE: Screen[] = [
  {
    key: "media",
    label: "Media stage",
    description: "For the media desk, or backstage.",
    window: "media-stage",
    command: "screens.media-stage",
    dot: "bg-amber-400",
  },
  {
    key: "worship",
    label: "Worship stage",
    description: "Words and what is next, for the band.",
    window: "worship-stage",
    command: "screens.worship-stage",
    dot: "bg-sky-400",
  },
];

const SCREENS = [...AUDIENCE, ...STAGE];

const RESOLUTIONS = [
  "3840x2160",
  "2560x1440",
  "1920x1080",
  "1600x900",
  "1366x768",
  "1280x720",
  "1024x768",
  "800x600",
];

const inShell = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const displayName = (display: Display) =>
  display.label || (display.isPrimary ? "Built-in display" : `Screen ${display.id}`);

const displaySize = (display: Display) => `${display.bounds.width} × ${display.bounds.height}`;

const pickerName = (display: Display, displays: Display[]) => {
  const twins = displays.filter((other) => displayName(other) === displayName(display));
  if (twins.length === 1) return displayName(display);
  const sameSize = twins.filter((other) => displaySize(other) === displaySize(display));
  return sameSize.length === 1
    ? `${displayName(display)} · ${displaySize(display)}`
    : `${displayName(display)} ${twins.indexOf(display) + 1}`;
};

const listFormat = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** The screens the operating system reports, asked again every few seconds. */
function useDisplays() {
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
 * Which screens are on, asked of the windows themselves rather than
 * remembered: one closed from the operator window, the menu or the keyboard
 * shows as off here too.
 */
function useScreensOn() {
  const [on, setOn] = useState<Set<string>>(() => new Set());
  const refresh = useCallback(async () => {
    if (!inShell()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const windows = await invoke<Array<{ label: string }>>("list_open_windows");
      const next = new Set(windows.map((each) => each.label));
      setOn((previous) =>
        previous.size === next.size && [...next].every((label) => previous.has(label)) ? previous : next,
      );
    } catch {
      // Stays as it was; the next look corrects it.
    }
  }, []);
  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 1500);
    return () => window.clearInterval(intervalId);
  }, [refresh]);
  return { on, refresh };
}

/**
 * The display each screen goes to now, Automatic worked out as the core
 * works it out, so the page can say where Automatic is putting it.
 */
function usePlacements(displays: Display[], chosen: Record<ScreenRole, number | null>) {
  const [placed, setPlaced] = useState<Record<ScreenRole, number | null>>(chosen);
  const key = `${JSON.stringify(chosen)}|${displays.map((display) => display.id).join(",")}`;
  useEffect(() => {
    if (!inShell()) {
      setPlaced(chosen);
      return;
    }
    let cancelled = false;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        Promise.all(
          SCREENS.map((screen) =>
            invoke<{ display: { id: number } } | null>("get_preferred_display", { role: screen.key })
              .then((resolved) => [screen.key, resolved?.display.id ?? null] as const)
              .catch(() => [screen.key, chosen[screen.key]] as const),
          ),
        ),
      )
      .then((entries) => {
        if (!cancelled) setPlaced(Object.fromEntries(entries) as Record<ScreenRole, number | null>);
      })
      .catch((): void => undefined);
    return () => {
      cancelled = true;
    };
    // `key` is `chosen` and the displays, compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return placed;
}

/**
 * Where a display sits, in the units the computer's own arrangement uses. A
 * Mac arranges displays in points, and reports each in pixels at its own
 * scale, so a Retina panel would otherwise be drawn twice the size of the TV
 * beside it. Windows arranges them in pixels already.
 */
const arrangedRect = (display: Display) => {
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

/** The drawing's height against its width. */
const DRAWING_RATIO = 0.36;
const DRAWING_MARGIN = 14;
const GAP = 4;

/**
 * The connected displays drawn where the operating system has them, to
 * scale, with the screens on each. Choosing one sends the selected screen to
 * it.
 */
function Arrangement({
  displays,
  placed,
  selected,
  onPick,
}: {
  displays: Display[];
  placed: Record<ScreenRole, number | null>;
  selected: Screen;
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
      <div className="flex h-[150px] items-center justify-center rounded-lg bg-background/40 text-[12.5px] text-muted-foreground">
        Looking for screens. Connect one and it appears here.
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
    <div ref={setElement} className="relative w-full rounded-lg bg-background/40" style={{ height: height || 150 }}>
      {width > 0
        ? displays.map((display, index) => {
            const rect = rects[index];
            const boxWidth = rect.width * scale - GAP;
            const boxHeight = rect.height * scale - GAP;
            const screensHere = SCREENS.filter((screen) => placed[screen.key] === display.id);
            const isSelectedHere = placed[selected.key] === display.id;
            // What fits: the screens on it first, then its name, then its
            // size. A small display says the rest when pointed at.
            const wordy = boxWidth >= 110;
            const chipsHeight = screensHere.length === 0 ? 0 : wordy ? screensHere.length * 17 : 12;
            const showName = boxWidth >= 56 && boxHeight >= 22 + chipsHeight;
            const showSize = boxWidth >= 76 && boxHeight >= 36 + chipsHeight;
            return (
              <button
                key={display.id}
                type="button"
                title={`${displayName(display)} · ${displaySize(display)}${isSelectedHere ? ` · ${selected.label} is here` : ` · Send ${selected.label} here`}`}
                onClick={() => onPick(display.id)}
                className={cn(
                  "absolute flex flex-col overflow-hidden rounded-[6px] border-2 bg-gradient-to-br from-zinc-700 to-zinc-900 p-[3px] text-left transition",
                  isSelectedHere
                    ? "border-primary ring-[3px] ring-primary/25"
                    : "border-zinc-500/50 hover:border-zinc-300/80",
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
                    <span className="text-[10px] tabular-nums leading-tight text-white/50">{displaySize(display)}</span>
                  ) : null}
                  {screensHere.length > 0 ? (
                    <span className="mt-0.5 flex max-w-full flex-wrap justify-center gap-1">
                      {screensHere.map((screen) =>
                        wordy ? (
                          <span
                            key={screen.key}
                            className="flex items-center gap-1 rounded-full bg-black/45 px-1.5 py-px text-[9.5px] font-medium text-white/85"
                          >
                            <span className={cn("h-1.5 w-1.5 rounded-full", screen.dot)} />
                            {screen.label}
                          </span>
                        ) : (
                          <span key={screen.key} className={cn("h-2 w-2 rounded-full ring-1 ring-black/40", screen.dot)} />
                        ),
                      )}
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

function ScreenListItem({
  screen,
  on,
  where,
  selected,
  onSelect,
}: {
  screen: Screen;
  on: boolean;
  where: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
        selected ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]",
      )}
    >
      <span className={cn("h-2 w-2 flex-none rounded-full", screen.dot, !on && "opacity-40")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">{screen.label}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{where}</span>
      </span>
      <span className={cn("text-[11px] font-medium", on ? "text-emerald-500" : "text-muted-foreground/70")}>
        {on ? "On" : "Off"}
      </span>
    </button>
  );
}

export function ScreensSettings({
  screenDisplayIds,
  onScreenDisplayChange,
  screenResolutions,
  onScreenResolutionChange,
  audioOutputDeviceId,
  audioOutputDeviceLabel,
  audioOutputs,
  onAudioOutputChange,
}: {
  screenDisplayIds: Record<ScreenRole, number | null>;
  onScreenDisplayChange: (role: ScreenRole, displayId: number | null) => void;
  screenResolutions: Record<ScreenRole, string>;
  onScreenResolutionChange: (role: ScreenRole, resolution: string) => void;
  audioOutputDeviceId: string | null;
  audioOutputDeviceLabel: string;
  audioOutputs: Array<{ deviceId: string; label: string }>;
  onAudioOutputChange: (deviceId: string) => void;
}) {
  const displays = useDisplays();
  const { on, refresh } = useScreensOn();
  const placed = usePlacements(displays, screenDisplayIds);
  const [selectedKey, setSelectedKey] = useState<ScreenRole>("audience");
  const selected = SCREENS.find((screen) => screen.key === selectedKey) ?? SCREENS[0];
  const isOn = (screen: Screen) => on.has(screen.window);
  const anyOn = SCREENS.some(isOn);

  const displayOf = (screen: Screen) => displays.find((display) => display.id === placed[screen.key]) ?? null;
  const whereText = (screen: Screen) => {
    const display = displayOf(screen);
    if (!display) return "No screen";
    return screenDisplayIds[screen.key] === null ? `Automatic · ${displayName(display)}` : displayName(display);
  };

  // The operator window turns screens on and off, as its buttons and the
  // menu do, so this page and they can never disagree about how.
  const turn = (screen: Screen, next: boolean) => {
    if (isOn(screen) === next || !inShell()) return;
    void import("@tauri-apps/api/event")
      .then(({ emitTo }) => emitTo("main", "menu:command", screen.command))
      .then(() => {
        for (const delay of [350, 1200]) {
          window.setTimeout(() => {
            void refresh();
          }, delay);
        }
      })
      .catch((error: unknown) => console.error("[Screens] could not turn", screen.label, error));
  };

  const identify = () => {
    void import("@tauri-apps/api/event")
      .then(({ emit }) => emit(IDENTIFY_EVENT))
      .catch((): void => undefined);
  };

  const openDisplaySettings = () => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("open_display_settings"))
      .catch((error: unknown) => console.error("[Screens] could not open the display settings", error));
  };

  const selectedDisplay = displayOf(selected);
  const sharing = selectedDisplay
    ? SCREENS.filter((screen) => screen.key !== selected.key && placed[screen.key] === selectedDisplay.id)
    : [];
  const warnings: string[] = [];
  if (displays.length === 1) {
    warnings.push(`Only one screen is connected, so turning ${selected.label} on covers Present itself.`);
  } else if (selectedDisplay?.isPrimary) {
    warnings.push(`${displayName(selectedDisplay)} is the main screen. ${selected.label} on it covers Present.`);
  }
  if (displays.length > 1 && sharing.length > 0 && selectedDisplay) {
    warnings.push(
      `${listFormat(sharing.map((screen) => screen.label))} ${sharing.length === 1 ? "goes" : "go"} to ${displayName(selectedDisplay)} too, and only one can be seen there. Send each to its own screen.`,
    );
  }

  const displayChosen = screenDisplayIds[selected.key];

  return (
    <SettingsPage
      title="Screens & sound"
      description="Where each screen goes, which are on, and where the sound of videos plays."
    >
      <div>
        <SettingsGroup
          title="Screens"
          description="The audience screen, and the two for the stage."
          action={
            <>
              <SettingsButton
                variant="ghost"
                onClick={identify}
                disabled={!anyOn}
                title={anyOn ? "Show each screen's name on it" : "Turn a screen on to identify it"}
              >
                <ScanEye className="h-3.5 w-3.5" aria-hidden />
                Identify
              </SettingsButton>
              <SettingsButton variant="ghost" onClick={openDisplaySettings} title="The computer's own display settings">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                Display settings
              </SettingsButton>
            </>
          }
        >
          <div className="grid grid-cols-[204px_minmax(0,1fr)]">
            <nav aria-label="Screens" className="border-r border-border/60 p-2">
              {[
                { title: "Audience", screens: AUDIENCE },
                { title: "Stage", screens: STAGE },
              ].map((group) => (
                <div key={group.title} className="mb-1 last:mb-0">
                  <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
                    {group.title}
                  </p>
                  {group.screens.map((screen) => (
                    <ScreenListItem
                      key={screen.key}
                      screen={screen}
                      on={isOn(screen)}
                      where={whereText(screen)}
                      selected={screen.key === selected.key}
                      onSelect={() => setSelectedKey(screen.key)}
                    />
                  ))}
                </div>
              ))}
            </nav>

            <div className="min-w-0">
              <div className="flex items-start justify-between gap-4 px-4 pb-3 pt-4">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
                    <span className={cn("h-2.5 w-2.5 rounded-full", selected.dot)} />
                    {selected.label}
                  </h3>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">{selected.description}</p>
                </div>
                <div className="flex flex-none items-center gap-2.5 pt-0.5">
                  <span className={cn("text-[12px] font-medium", isOn(selected) ? "text-emerald-500" : "text-muted-foreground")}>
                    {isOn(selected) ? "On" : "Off"}
                  </span>
                  <SettingsSwitch
                    checked={isOn(selected)}
                    onChange={(next) => turn(selected, next)}
                    label={`${selected.label} on`}
                    disabled={!inShell()}
                  />
                </div>
              </div>

              <div className="px-4 pb-3.5">
                <Arrangement
                  displays={displays}
                  placed={placed}
                  selected={selected}
                  onPick={(displayId) => onScreenDisplayChange(selected.key, displayId)}
                />
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  Arranged as the computer has them. Click a screen to send {selected.label} to it.
                </p>
              </div>

              <div className="divide-y divide-border/60 border-t border-border/60">
                <SettingsRow
                  label="Output"
                  description={
                    displayChosen === null
                      ? selectedDisplay
                        ? `Automatic is using ${displayName(selectedDisplay)}, the largest screen that isn't the main one.`
                        : "Automatic uses the largest screen that isn't the main one."
                      : selectedDisplay
                        ? `${displaySize(selectedDisplay)}${selectedDisplay.scaleFactor && selectedDisplay.scaleFactor !== 1 ? ` at ${selectedDisplay.scaleFactor}x` : ""}. It fills the whole screen.`
                        : undefined
                  }
                >
                  <SettingsSelect
                    label={`${selected.label} screen`}
                    value={displayChosen === null ? "auto" : String(displayChosen)}
                    onChange={(value) => onScreenDisplayChange(selected.key, value === "auto" ? null : Number(value))}
                    className="w-[220px]"
                    options={[
                      { value: "auto", label: "Automatic" },
                      ...displays.map((display) => ({
                        value: String(display.id),
                        // Two of the same TV are told apart by their size, or
                        // by their number when that is the same too.
                        label: pickerName(display, displays),
                      })),
                      // A screen chosen before and not connected now is still the
                      // choice; say so rather than showing nothing chosen.
                      ...(displayChosen !== null && !displays.some((display) => display.id === displayChosen)
                        ? [{ value: String(displayChosen), label: "A screen not connected" }]
                        : []),
                    ]}
                  />
                </SettingsRow>
                {selected.key === "audience" ? (
                  <SettingsRow
                    label="NDI size"
                    description="The picture's size when it goes out over the network. On a screen it always fills the screen at the screen's own resolution."
                  >
                    <SettingsSelect
                      label="NDI size"
                      value={screenResolutions.audience}
                      onChange={(value) => onScreenResolutionChange("audience", value)}
                      className="w-[124px]"
                      options={RESOLUTIONS.map((resolution) => ({
                        value: resolution,
                        label: resolution.replace("x", " × "),
                      }))}
                    />
                  </SettingsRow>
                ) : null}
                {warnings.map((warning) => (
                  <p key={warning} className="flex gap-2 px-4 py-3 text-[12px] leading-[18px] text-amber-500">
                    <TriangleAlert className="mt-[2px] h-3.5 w-3.5 flex-none" aria-hidden />
                    <span>{warning}</span>
                  </p>
                ))}
              </div>
            </div>
          </div>
        </SettingsGroup>
        <SettingsNote>
          A screen&apos;s own resolution and where it sits are the computer&apos;s, in Display settings. A
          splitter or a mirroring hub shows as one screen, so every TV on it shows the same thing. For
          different pictures on each, give each output its own port, a multi-display adapter, or a
          DisplayLink dock.
        </SettingsNote>
      </div>

      <SettingsGroup title="Sound">
        <SettingsRow
          label="Video sound"
          description="Plays once, from this computer, whether or not a screen is open."
        >
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
