"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Search, Sparkles } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../renderer/shared/components/ui/dropdown-menu";
import { cn } from "../../renderer/shared/lib/utils";
import {
  getTransitions,
  readTransition,
  writeTransition,
  type Transition,
  type TransitionCategoryId,
  type TransitionEasing,
  type TransitionLibrary,
  type TransitionMode,
  type TransitionPreset,
} from "../../renderer/tauri/transitions";
import { TransitionTile } from "./TransitionTile";

const EASINGS: TransitionEasing[] = [
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "cubic",
  "quint",
  "exponential",
  "back",
  "elastic",
  "bounce",
];

const DURATIONS = [200, 300, 400, 600, 800, 1200];

const label = (milliseconds: number) =>
  milliseconds < 1000 ? `${milliseconds}ms` : `${milliseconds / 1000}s`;

/** One row of choices that behave like a segmented control. */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md bg-white/4 p-0.5 ring-1 ring-white/6",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-[5px] px-2 py-1 text-[11px] leading-none transition",
            option.value === value
              ? "bg-primary/85 font-medium text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-white/6 hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * How the next slide arrives.
 *
 * The library is read from the core, so this file holds no list of
 * transitions and cannot fall out of step with the engine that draws them.
 * The tiles play the real thing on hover.
 */
export function TransitionPicker({ className }: { className?: string }) {
  const [library, setLibrary] = useState<TransitionLibrary | null>(null);
  const [chosen, setChosen] = useState<Transition>(readTransition);
  const [category, setCategory] = useState<TransitionCategoryId>("basic");
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void getTransitions()
      .then(setLibrary)
      .catch(() => setFailed(true));
  }, []);

  const searching = query.trim().length > 0;
  const shown = useMemo(() => {
    const presets = library?.presets ?? [];
    if (searching) {
      const needle = query.trim().toLowerCase();
      return presets.filter((preset) => preset.name.toLowerCase().includes(needle));
    }
    return presets.filter((preset) => preset.category === category);
  }, [library, category, query, searching]);

  const current = library?.presets.find((preset) => preset.id === chosen.type);
  const counts = useMemo(() => {
    const presets = library?.presets ?? [];
    return new Map<TransitionCategoryId, number>(
      (library?.categories ?? []).map((entry) => [
        entry.id,
        presets.filter((preset) => preset.category === entry.id).length,
      ]),
    );
  }, [library]);

  const choose = (next: Partial<Transition>) => {
    const transition = { ...chosen, ...next };
    setChosen(transition);
    writeTransition(transition);
  };

  const pick = (preset: TransitionPreset) =>
    choose({
      type: preset.id,
      durationMs: preset.defaultDurationMs || chosen.durationMs,
      direction: preset.direction ?? chosen.direction,
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={`Transition: ${current?.name ?? chosen.type}`}
          aria-label="Transition"
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground ring-1 ring-white/8 transition",
            "hover:text-foreground hover:ring-white/20",
            className,
          )}
        >
          <Sparkles className="h-3.5 w-3.5 opacity-70" aria-hidden />
          <span className="max-w-28 truncate">{current?.name ?? "Transition"}</span>
          <span className="tabular-nums text-[10px] text-muted-foreground/70">
            {label(chosen.durationMs)}
          </span>
          <ChevronDown className="h-3 w-3 opacity-50" aria-hidden />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[680px] overflow-hidden rounded-xl p-0 shadow-2xl"
      >
        {failed ? (
          <p className="p-5 text-xs text-muted-foreground">
            The transition library could not be read.
          </p>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-white/6 px-3 py-2.5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
                  Transition
                </p>
                <p className="text-sm font-medium leading-tight text-foreground">
                  {current?.name ?? "None"}
                </p>
              </div>
              <div className="relative ml-auto">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60"
                  aria-hidden
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                  aria-label="Search transitions"
                  className="h-7 w-44 rounded-md bg-white/4 pl-7 pr-2 text-[11px] text-foreground ring-1 ring-white/8 outline-hidden placeholder:text-muted-foreground/60 focus:ring-primary/50"
                />
              </div>
            </header>

            <div className="flex h-[330px]">
              <nav className="w-40 shrink-0 overflow-y-auto border-r border-white/6 py-1.5">
                {library?.categories.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setCategory(entry.id);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition",
                      !searching && entry.id === category
                        ? "bg-primary/15 font-medium text-foreground"
                        : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{entry.title}</span>
                    <span className="ml-2 tabular-nums text-[10px] text-muted-foreground/50">
                      {counts.get(entry.id) ?? 0}
                    </span>
                  </button>
                ))}
              </nav>

              <div className="min-w-0 flex-1 overflow-y-auto p-2.5">
                {shown.length === 0 ? (
                  <p className="px-1 py-8 text-center text-xs text-muted-foreground">
                    Nothing matches “{query}”.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2.5">
                    {shown.map((preset) => (
                      <TransitionTile
                        key={preset.id}
                        preset={preset}
                        selected={preset.id === chosen.type}
                        onChoose={() => pick(preset)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <footer className="space-y-2 border-t border-white/6 bg-black/20 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-[11px] text-muted-foreground">Length</span>
                <Segmented
                  options={DURATIONS.map((duration) => ({
                    value: duration,
                    label: label(duration),
                  }))}
                  value={chosen.durationMs}
                  onChange={(durationMs) => choose({ durationMs })}
                />
                <span className="ml-auto text-[11px] text-muted-foreground">Easing</span>
                {/* The same control as the preview's screen picker, which is
                    the one the owner asked for: the platform's own select. */}
                <select
                  value={chosen.easing}
                  onChange={(event) => choose({ easing: event.target.value as TransitionEasing })}
                  className="h-7 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  title="Easing"
                  aria-label="Easing"
                >
                  {EASINGS.map((easing) => (
                    <option key={easing} value={easing}>
                      {easing}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-[11px] text-muted-foreground">Applies to</span>
                <Segmented
                  options={
                    [
                      { value: "changed-elements", label: "What changed" },
                      { value: "full-slide", label: "Whole slide" },
                    ] as Array<{ value: TransitionMode; label: string }>
                  }
                  value={chosen.mode}
                  onChange={(mode) => choose({ mode })}
                />
                <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
                  {chosen.mode === "changed-elements"
                    ? "Only what changed moves — a background video keeps playing."
                    : "The whole picture crosses, background and all."}
                </p>
              </div>
            </footer>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
