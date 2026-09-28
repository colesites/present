"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Settings2, X } from "lucide-react";
import { CompositorPreviewLayer } from "../slides/components/CompositorPreviewLayer";
import { cn } from "../../renderer/shared/lib/utils";
import { useScreens, type ScreenInfo } from "../../renderer/tauri/screens";
import { MEDIA_LAYOUT, WORSHIP_LAYOUT, useStageLayouts } from "./layouts";
import { formatClock } from "./StageLayoutView";
import { Fitted } from "./StageLayoutWindow";
import { useStageFeed } from "./useStageFeed";
import { TV_ASPECT, WALL_GAP, wallGrid } from "./wall";

/**
 * Multiview: every screen at once, live, as a wall of TVs for the media desk
 * to watch — the audience picture as the compositor draws it and each stage
 * screen as its layout shows it. Opened from the media stage screen (or the
 * Screens menu) onto the media stage's display, and closed to go back to it.
 *
 * The wall is a grid of same-sized TVs, as many to a page as chosen, laid out
 * across and down to make each as large as the window allows. More screens
 * than fit go on further pages.
 */

type MultiviewConfig = {
  /** Screen ids left out. New screens show until they are left out. */
  hidden: string[];
  /** Screens to a page; 0 for all of them on one. */
  perPage: number;
};

const CONFIG_KEY = "present-multiview-v1";
const PER_PAGE = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 16];

function readConfig(): MultiviewConfig {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONFIG_KEY) ?? "null") as Partial<MultiviewConfig> | null;
    return {
      hidden: Array.isArray(parsed?.hidden) ? parsed.hidden.filter((id): id is string => typeof id === "string") : [],
      perPage: typeof parsed?.perPage === "number" && PER_PAGE.includes(parsed.perPage) ? parsed.perPage : 0,
    };
  } catch {
    return { hidden: [], perPage: 0 };
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
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [area, setArea] = useState({ width: 0, height: 0 });
  const wall = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const node = wall.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setArea({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const change = (next: MultiviewConfig) => {
    setConfig(next);
    setPage(0);
    try {
      window.localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    } catch {
      // Kept for this time only.
    }
  };

  const all = useMemo(() => screens ?? [], [screens]);
  const shown = all.filter((screen) => !config.hidden.includes(screen.id));
  const perPage = config.perPage > 0 ? config.perPage : Math.max(1, shown.length);
  const pages = Math.max(1, Math.ceil(shown.length / perPage));
  const current = Math.min(page, pages - 1);
  const onPage = shown.slice(current * perPage, current * perPage + perPage);
  // The wall chosen, on every page: 16 is four by four, the TVs with no
  // screen dark. All screens makes the wall fit them.
  const slots = config.perPage > 0 ? config.perPage : Math.max(1, shown.length);
  const grid = wallGrid(slots, area.width, area.height);
  const tvs = grid.columns * grid.rows;
  const timeUp = feed.timer.timeUp;

  const turn = (by: number) => setPage((at) => Math.min(Math.max(Math.min(at, pages - 1) + by, 0), pages - 1));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        setPage((at) => Math.min(at + 1, pages - 1));
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        setPage((at) => Math.max(Math.min(at, pages - 1) - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages]);

  const layoutFor = (screen: ScreenInfo) =>
    layouts.find((layout) => layout.id === (screen.layout ?? (screen.id === "media" ? MEDIA_LAYOUT : WORSHIP_LAYOUT))) ??
    layouts[0];

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0b0c12] text-white">
      <header className="flex flex-none flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/10 px-6 py-3">
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
            <span className="text-white/60">On a page</span>
            <select
              value={config.perPage}
              onChange={(event) => change({ ...config, perPage: Number(event.target.value) })}
              className="rounded-md bg-white/10 px-2 py-1 text-[14px] outline-none"
            >
              {PER_PAGE.map((count) => (
                <option key={count} value={count}>
                  {count === 0 ? "All screens" : count === 1 ? "1 screen" : `${count} screens`}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div ref={wall} className="relative min-h-0 flex-1 overflow-hidden p-5">
        {shown.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[16px] text-white/50">
            No screens chosen. Use Choose screens to add some.
          </div>
        ) : grid.tileWidth > 0 ? (
          <div
            className="grid h-full content-center justify-center"
            style={{
              gap: WALL_GAP,
              gridTemplateColumns: `repeat(${grid.columns}, ${grid.tileWidth}px)`,
              gridAutoRows: `${grid.tileHeight}px`,
            }}
          >
            {Array.from({ length: tvs }, (_, index) => {
              const screen = onPage[index];
              if (!screen) {
                return <div key={`empty-${index}`} className="rounded-lg bg-black/40 ring-1 ring-white/[0.06]" />;
              }
              return (
                <Tv key={screen.id} screen={screen} width={grid.tileWidth} height={grid.tileHeight}>
                  {screen.group === "audience" ? (
                    <CompositorPreviewLayer className="absolute inset-0" />
                  ) : (
                    <Fitted layout={layoutFor(screen)} feed={feed} />
                  )}
                </Tv>
              );
            })}
          </div>
        ) : null}
      </div>

      {pages > 1 ? (
        <footer className="flex flex-none items-center justify-center gap-2 border-t border-white/10 px-6 py-2.5 text-[14px]">
          <button
            type="button"
            onClick={() => turn(-1)}
            disabled={current === 0}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 font-medium ring-1 ring-white/15 transition hover:bg-white/10 disabled:pointer-events-none disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Prev
          </button>
          {Array.from({ length: pages }, (_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setPage(index)}
              aria-current={index === current ? "page" : undefined}
              className={cn(
                "h-8 min-w-8 rounded-md px-2 font-medium tabular-nums transition",
                index === current ? "bg-white text-black" : "text-white/70 ring-1 ring-white/15 hover:bg-white/10",
              )}
            >
              {index + 1}
            </button>
          ))}
          <button
            type="button"
            onClick={() => turn(1)}
            disabled={current === pages - 1}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 font-medium ring-1 ring-white/15 transition hover:bg-white/10 disabled:pointer-events-none disabled:opacity-35"
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          <span className="ml-3 text-[13px] tabular-nums text-white/45">
            {current * perPage + 1}–{current * perPage + onPage.length} of {shown.length}
          </span>
        </footer>
      ) : null}
    </div>
  );
}

/**
 * One TV of the wall: the screen's picture in its own shape, centred above its
 * name, as a multiviewer labels it, with a green edge while it is on. The
 * name has its own strip, so it never covers the picture.
 */
function Tv({
  screen,
  width,
  height,
  children,
}: {
  screen: ScreenInfo;
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  const [canvasWidth, canvasHeight] = screen.canvas;
  const aspect = canvasWidth > 0 && canvasHeight > 0 ? canvasWidth / canvasHeight : TV_ASPECT;
  const compact = width < 320;
  const label = compact ? 22 : 30;
  const pictureWidth = Math.min(width, (height - label) * aspect);
  const pictureHeight = pictureWidth / aspect;
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg bg-black",
        screen.open ? "ring-2 ring-emerald-400/80" : "ring-1 ring-white/15",
      )}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="relative overflow-hidden" style={{ width: pictureWidth, height: pictureHeight }}>
          {children}
        </div>
      </div>
      <div
        className={cn(
          "flex flex-none items-center gap-2 border-t border-white/10 bg-white/[0.04]",
          compact ? "px-2 text-[11px]" : "px-3 text-[13px]",
        )}
        style={{ height: label }}
      >
        <span
          className={cn(
            "h-2 w-2 flex-none rounded-full",
            screen.open ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/70" : "bg-white/25",
          )}
        />
        <span className="min-w-0 truncate font-medium">{screen.name}</span>
        {!compact ? (
          <span className="ml-auto flex-none tabular-nums text-white/45">
            {canvasWidth} × {canvasHeight}
            {screen.open ? "" : " · Off"}
          </span>
        ) : null}
      </div>
    </div>
  );
}
