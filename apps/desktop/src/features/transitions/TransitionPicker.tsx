"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

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

/**
 * How the next slide arrives.
 *
 * The library is read from the core, so this file has no list of transitions
 * in it and cannot fall out of step with the one that draws them. The tiles
 * play the real thing on hover.
 */
export function TransitionPicker({ className }: { className?: string }) {
  const [library, setLibrary] = useState<TransitionLibrary | null>(null);
  const [chosen, setChosen] = useState<Transition>(readTransition);
  const [category, setCategory] = useState<TransitionCategoryId>("basic");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void getTransitions()
      .then(setLibrary)
      .catch(() => setFailed(true));
  }, []);

  const shown = useMemo(
    () => library?.presets.filter((preset) => preset.category === category) ?? [],
    [library, category],
  );
  const current = library?.presets.find((preset) => preset.id === chosen.type);

  const choose = (next: Partial<Transition>) => {
    const transition = { ...chosen, ...next };
    setChosen(transition);
    writeTransition(transition);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={`Transition: ${current?.name ?? chosen.type}`}
          aria-label="Transition"
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground",
            className,
          )}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          <span className="max-w-24 truncate">{current?.name ?? "Transition"}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[520px] p-0">
        {failed ? (
          <p className="p-4 text-xs text-muted-foreground">
            The transition library could not be read.
          </p>
        ) : (
          <div className="flex h-[360px]">
            <nav className="w-36 shrink-0 overflow-y-auto border-r border-border/60 py-1">
              {library?.categories.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setCategory(entry.id)}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-xs transition",
                    entry.id === category
                      ? "bg-primary/15 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {entry.title}
                </button>
              ))}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="grid flex-1 grid-cols-3 content-start gap-2 overflow-y-auto p-2">
                {shown.map((preset) => (
                  <TransitionTile
                    key={preset.id}
                    preset={preset}
                    selected={preset.id === chosen.type}
                    onChoose={() =>
                      choose({
                        type: preset.id,
                        durationMs: preset.defaultDurationMs || chosen.durationMs,
                        direction: preset.direction ?? chosen.direction,
                      })
                    }
                  />
                ))}
              </div>

              <div className="space-y-2 border-t border-border/60 p-2">
                <div className="flex items-center gap-2">
                  <label className="w-14 shrink-0 text-[11px] text-muted-foreground">Length</label>
                  <div className="flex flex-wrap gap-1">
                    {DURATIONS.map((duration) => (
                      <button
                        key={duration}
                        type="button"
                        onClick={() => choose({ durationMs: duration })}
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[11px] transition",
                          chosen.durationMs === duration
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-border/60 text-muted-foreground hover:border-primary/40",
                        )}
                      >
                        {duration < 1000 ? `${duration}ms` : `${duration / 1000}s`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label
                    className="w-14 shrink-0 text-[11px] text-muted-foreground"
                    htmlFor="transition-easing"
                  >
                    Easing
                  </label>
                  <select
                    id="transition-easing"
                    value={chosen.easing}
                    onChange={(event) =>
                      choose({ easing: event.target.value as TransitionEasing })
                    }
                    className="rounded border border-border/60 bg-transparent px-1.5 py-0.5 text-[11px]"
                  >
                    {EASINGS.map((easing) => (
                      <option key={easing} value={easing}>
                        {easing}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[11px] text-muted-foreground">Applies to</span>
                  {(
                    [
                      ["changed-elements", "What changed"],
                      ["full-slide", "Whole slide"],
                    ] as Array<[TransitionMode, string]>
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => choose({ mode })}
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[11px] transition",
                        chosen.mode === mode
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border/60 text-muted-foreground hover:border-primary/40",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] leading-snug text-muted-foreground">
                  {chosen.mode === "changed-elements"
                    ? "Only what changed moves — a background video keeps playing through a change of words."
                    : "The whole picture transitions, background and all."}
                </p>
              </div>
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
