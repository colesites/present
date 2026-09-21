"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { transitionSampleUrl, type TransitionPreset } from "../../renderer/tauri/transitions";
import { cn } from "../../renderer/shared/lib/utils";

/** How many steps a hover plays through. Enough to read the movement. */
const STEPS = 18;
/** How long one play takes, in milliseconds. */
const PLAY_MS = 900;

/** The still shown when nothing is hovering: the middle of the movement. */
const RESTING = 0.5;

/**
 * One transition in the picker: a still that plays when the pointer is on it.
 *
 * The frames come from the engine that runs the transition for real
 * (`transition-sample://`), so nothing here can look like one thing in the
 * menu and behave like another on the screen.
 */
export function TransitionTile({
  preset,
  selected,
  onChoose,
  width = 132,
  height = 74,
}: {
  preset: TransitionPreset;
  selected: boolean;
  onChoose: () => void;
  width?: number;
  height?: number;
}) {
  const [progress, setProgress] = useState(RESTING);
  const playing = useRef<number | null>(null);

  // The frames of one play, built up front so a hover does not wait for them
  // one at a time.
  const frames = useMemo(
    () =>
      Array.from({ length: STEPS + 1 }, (_, step) =>
        transitionSampleUrl(preset.id, step / STEPS, width, height),
      ),
    [preset.id, width, height],
  );

  useEffect(() => {
    return () => {
      if (playing.current !== null) {
        window.clearInterval(playing.current);
      }
    };
  }, []);

  const play = () => {
    if (playing.current !== null) {
      return;
    }
    let step = 0;
    playing.current = window.setInterval(() => {
      step += 1;
      setProgress((step % (STEPS + 1)) / STEPS);
    }, PLAY_MS / STEPS);
  };

  const rest = () => {
    if (playing.current !== null) {
      window.clearInterval(playing.current);
      playing.current = null;
    }
    setProgress(RESTING);
  };

  return (
    <button
      type="button"
      onClick={onChoose}
      onMouseEnter={play}
      onMouseLeave={rest}
      onFocus={play}
      onBlur={rest}
      title={preset.available ? preset.name : `${preset.name} — shown as a fade until the GPU path`}
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-black text-left transition",
        selected
          ? "border-primary ring-2 ring-primary/60"
          : "border-border/60 hover:border-primary/50",
      )}
      style={{ width, height }}
    >
      {/* Every frame is in the page; only the one at `progress` is shown, so a
          play is a class change rather than a fetch. */}
      {frames.map((src, step) => (
        <img
          key={src}
          src={src}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: Math.abs(step / STEPS - progress) < 1 / (STEPS * 2) ? 1 : 0 }}
        />
      ))}
      <span className="absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-black/85 to-transparent px-1.5 pb-1 pt-3 text-[10px] font-medium text-white">
        {preset.name}
      </span>
      {preset.available ? null : (
        <span className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[9px] text-amber-300">
          soon
        </span>
      )}
    </button>
  );
}
