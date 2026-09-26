"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";

import {
  transitionSampleUrl,
  type TransitionMode,
  type TransitionPreset,
} from "../../renderer/tauri/transitions";
import { cn } from "../../renderer/shared/lib/utils";

/** Frames in one play. Enough to read the movement, few enough to preload. */
const STEPS = 16;
/** How long one play takes. */
const PLAY_MS = 850;
/** The still shown at rest: part way in, so the movement is legible. */
const RESTING_STEP = 6;

/** What a tile is drawn at, in device pixels. Sharp on a Retina panel. */
const SAMPLE_WIDTH = 320;
const SAMPLE_HEIGHT = 180;

/**
 * One transition in the picker: a still that plays while the pointer is on it.
 *
 * The frames come from the engine that runs the transition for real
 * (`transition-sample://`), so nothing here can look like one thing in the
 * menu and behave like another on screen. They are real lyrics over a moving
 * background, drawn as `mode` would draw them.
 */
export function TransitionTile({
  preset,
  mode,
  selected,
  onChoose,
}: {
  preset: TransitionPreset;
  mode: TransitionMode;
  selected: boolean;
  onChoose: () => void;
}) {
  const [step, setStep] = useState(RESTING_STEP);
  const playing = useRef<number | null>(null);

  const frames = useMemo(
    () =>
      Array.from({ length: STEPS + 1 }, (_, index) =>
        transitionSampleUrl(preset.id, index / STEPS, SAMPLE_WIDTH, SAMPLE_HEIGHT, mode),
      ),
    [mode, preset.id],
  );

  useEffect(
    () => () => {
      if (playing.current !== null) {
        window.clearInterval(playing.current);
      }
    },
    [],
  );

  const play = () => {
    if (playing.current !== null) {
      return;
    }
    let frame = 0;
    setStep(0);
    playing.current = window.setInterval(() => {
      frame = (frame + 1) % (STEPS + 1);
      setStep(frame);
    }, PLAY_MS / STEPS);
  };

  const rest = () => {
    if (playing.current !== null) {
      window.clearInterval(playing.current);
      playing.current = null;
    }
    setStep(RESTING_STEP);
  };

  return (
    <button
      type="button"
      onClick={onChoose}
      onMouseEnter={play}
      onMouseLeave={rest}
      onFocus={play}
      onBlur={rest}
      title={
        preset.available
          ? preset.name
          : `${preset.name} — plays as a fade until the GPU path lands`
      }
      className={cn(
        "group relative w-full overflow-hidden rounded-lg border text-left outline-hidden transition",
        "focus-visible:ring-2 focus-visible:ring-primary/70",
        selected
          ? "border-primary/80 ring-1 ring-primary/50"
          : "border-white/8 hover:border-white/25",
      )}
    >
      <div className="relative aspect-video w-full bg-black/60">
        {/* Every frame is in the page, so a play is an opacity change rather
            than a fetch. */}
        {frames.map((src, index) => (
          <img
            key={src}
            src={src}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity: index === step ? 1 : 0 }}
          />
        ))}

        {selected ? (
          <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
          </span>
        ) : null}
        {preset.available ? null : (
          <span className="absolute left-1.5 top-1.5 rounded-sm bg-black/65 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-amber-300/90">
            soon
          </span>
        )}
      </div>

      <span
        className={cn(
          "block truncate border-t px-2 py-1.5 text-[11px] leading-none transition",
          selected
            ? "border-primary/30 bg-primary/12 font-medium text-foreground"
            : "border-white/6 bg-white/2 text-muted-foreground group-hover:text-foreground",
        )}
      >
        {preset.name}
      </span>
    </button>
  );
}
