"use client";

import { useEffect, useMemo, useState } from "react";
import { Settings2, X } from "lucide-react";
import { CompositorPreviewLayer } from "../slides/components/CompositorPreviewLayer";
import { cn } from "../../renderer/shared/lib/utils";
import { useScreens, type ScreenInfo } from "../../renderer/tauri/screens";
import { MEDIA_LAYOUT, WORSHIP_LAYOUT, useStageLayouts } from "./layouts";
import { formatClock } from "./StageLayoutView";
import { Fitted } from "./StageLayoutWindow";
import { useStageFeed } from "./useStageFeed";

/**
 * Multiview: every screen at once, live, for the media desk to watch — the
 * audience picture as the compositor draws it and each stage screen as its
 * layout shows it. Opened from the media stage screen (or the Screens menu)
 * onto the media stage's display, and closed to go back to it.
 *
 * Which screens it shows, and how many across, are chosen here and kept.
 */

type MultiviewConfig = {
  /** Screen ids left out. New screens show until they are left out. */
  hidden: string[];
  /** Tiles across; 0 for as many as fit. */
  columns: number;
};

const CONFIG_KEY = "present-multiview-v1";

function readConfig(): MultiviewConfig {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONFIG_KEY) ?? "null") as Partial<MultiviewConfig> | null;
    return {
      hidden: Array.isArray(parsed?.hidden) ? parsed.hidden.filter((id): id is string => typeof id === "string") : [],
      columns: typeof parsed?.columns === "number" ? Math.min(Math.max(Math.round(parsed.columns), 0), 6) : 0,
    };
  } catch {
    return { hidden: [], columns: 0 };
  }
}

/** Back to the stage screen under it. */
const close = () => {
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("close_window", { role: "multiview" }))
    .catch((error: unknown) => console.error("[Multiview] could not close", error));
};

export function MultiviewWindow() {
  const { screens } = useScreens();
  const { layouts } = useStageLayouts();
  const feed = useStageFeed();
  const [config, setConfig] = useState<MultiviewConfig>(readConfig);
  const [configuring, setConfiguring] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const change = (next: MultiviewConfig) => {
    setConfig(next);
    try {
      window.localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    } catch {
      // Kept for this time only.
    }
  };

  const all = useMemo(() => screens ?? [], [screens]);
  const shown = all.filter((screen) => !config.hidden.includes(screen.id));
  const columns = config.columns > 0 ? config.columns : Math.max(1, Math.ceil(Math.sqrt(shown.length)));
  const timeUp = feed.timer.timeUp;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0b0c12] text-white">
      <header className="flex flex-none items-center gap-6 border-b border-white/10 px-6 py-3">
        <h1 className="text-[20px] font-semibold tracking-tight">Multiview</h1>
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-[13px] uppercase tracking-[0.12em] text-white/50">Clock</span>
          <span className="text-[24px] font-medium">{formatClock(now, false, true)}</span>
        </div>
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-[13px] uppercase tracking-[0.12em] text-white/50">{feed.timer.label ?? "Timer"}</span>
          <span
            className={cn("text-[24px] font-medium text-[#e35f4a]", timeUp?.blink && "present-time-up-blink")}
            style={timeUp ? { color: timeUp.color } : undefined}
          >
            {feed.timer.text ?? "--:--"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfiguring((open) => !open)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] font-medium ring-1 ring-white/15 transition hover:bg-white/10",
              configuring && "bg-white/10",
            )}
          >
            <Settings2 className="h-4 w-4" aria-hidden />
            Choose screens
          </button>
          <button
            type="button"
            onClick={close}
            className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[14px] font-medium ring-1 ring-white/15 transition hover:bg-white/20"
          >
            <X className="h-4 w-4" aria-hidden />
            Back to stage
          </button>
        </div>
      </header>

      {configuring ? (
        <div className="flex flex-none flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/10 bg-white/[0.03] px-6 py-3 text-[14px]">
          {all.map((screen) => (
            <label key={screen.id} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={!config.hidden.includes(screen.id)}
                onChange={(event) =>
                  change({
                    ...config,
                    hidden: event.target.checked
                      ? config.hidden.filter((id) => id !== screen.id)
                      : [...config.hidden, screen.id],
                  })
                }
                className="h-4 w-4 accent-[var(--primary)]"
              />
              {screen.name}
              <span className="text-[12px] text-white/40">{screen.group === "audience" ? "Audience" : "Stage"}</span>
            </label>
          ))}
          <label className="ml-auto flex items-center gap-2">
            <span className="text-white/60">Across</span>
            <select
              value={config.columns}
              onChange={(event) => change({ ...config, columns: Number(event.target.value) })}
              className="rounded-md bg-white/10 px-2 py-1 text-[14px] outline-none"
            >
              <option value={0}>As many as fit</option>
              {[1, 2, 3, 4, 5, 6].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div
        className="grid min-h-0 flex-1 gap-4 p-5"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}
      >
        {shown.map((screen) => (
          <Tile key={screen.id} screen={screen}>
            {screen.group === "audience" ? (
              <CompositorPreviewLayer className="absolute inset-0" />
            ) : (
              <Fitted
                layout={
                  layouts.find((layout) => layout.id === (screen.layout ?? (screen.id === "media" ? MEDIA_LAYOUT : WORSHIP_LAYOUT))) ??
                  layouts[0]
                }
                feed={feed}
              />
            )}
          </Tile>
        ))}
        {shown.length === 0 ? (
          <div className="col-span-full flex items-center justify-center text-[16px] text-white/50">
            No screens chosen. Use Choose screens to add some.
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** One screen's tile: its picture in its own shape, and its name and state. */
function Tile({ screen, children }: { screen: ScreenInfo; children: React.ReactNode }) {
  const [width, height] = screen.canvas;
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex flex-none items-center gap-2 text-[15px]">
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            screen.open ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/70" : "bg-white/25",
          )}
        />
        <span className="truncate font-medium">{screen.name}</span>
        <span className="text-[12px] tabular-nums text-white/40">
          {width} × {height}
        </span>
        {!screen.open ? <span className="text-[12px] uppercase tracking-[0.12em] text-white/40">Off</span> : null}
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div
          className="relative max-h-full max-w-full overflow-hidden rounded-lg bg-black ring-1 ring-white/15"
          style={{ aspectRatio: `${width} / ${height}`, height: "100%" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
