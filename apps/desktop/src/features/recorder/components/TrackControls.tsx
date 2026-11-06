import { useRef, useState } from "react";
import { cn } from "../../../renderer/shared/lib/utils";
import { MAX_DB, SILENT_DB } from "../../../renderer/tauri/recorder";
import { meterFraction } from "./LevelMeter";

/** Where 0 dB sits on the fader, as on GarageBand's: three quarters along. */
const UNITY = 0.75;
/** The quietest step above off. */
const FLOOR_DB = -60;

/** A fader position (0 to 1) as dB. The very bottom is off. */
export function faderDb(position: number): number {
  const at = Math.max(0, Math.min(1, position));
  if (at <= 0.005) return SILENT_DB;
  if (at >= UNITY) return ((at - UNITY) / (1 - UNITY)) * MAX_DB;
  return FLOOR_DB * ((UNITY - at) / UNITY) ** 1.6;
}

/** dB as a fader position, the inverse of `faderDb`. */
export function faderPosition(db: number): number {
  if (db <= SILENT_DB) return 0;
  if (db >= 0) return UNITY + (Math.min(db, MAX_DB) / MAX_DB) * (1 - UNITY);
  const below = Math.min(1, -db / -FLOOR_DB);
  return UNITY - UNITY * below ** (1 / 1.6);
}

export function formatDb(db: number): string {
  if (db <= SILENT_DB) return "-∞";
  const rounded = Math.round(db * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

/**
 * The track's volume fader, in dB. This is the track's level in the mix —
 * playback, monitoring and export — not the record level, which is in the
 * smart controls and sets how loud the take is printed.
 *
 * The groove carries the track's meter. Double-click puts it back at 0 dB.
 */
export function TrackVolumeSlider({
  volumeDb,
  level = 0,
  active = false,
  onChange,
  className,
}: {
  volumeDb: number;
  level?: number;
  active?: boolean;
  onChange: (db: number) => void;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const position = faderPosition(volumeDb);

  const updateFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const db = faderDb((clientX - rect.left) / rect.width);
    // Snaps to 0 dB near it, so unity is easy to find again.
    onChange(Math.abs(db) < 0.4 ? 0 : Math.round(db * 10) / 10);
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    event.stopPropagation();
    if (event.detail >= 2) {
      onChange(0);
      return;
    }
    setDragging(true);
    updateFromPointer(event.clientX);
    const onMove = (move: PointerEvent) => updateFromPointer(move.clientX);
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const fraction = active ? meterFraction(level) : 0;
  const barColor =
    fraction > 0.9
      ? "from-emerald-500 via-amber-400 to-red-500"
      : fraction > 0.7
        ? "from-emerald-500 to-amber-400"
        : "from-emerald-500 to-emerald-400";
  const meterWidth = `${Math.min(100, Math.round(fraction * 100))}%`;
  const label = `${formatDb(volumeDb)} dB`;

  return (
    <div
      ref={trackRef}
      className={cn("relative flex h-5 w-24 cursor-pointer items-center select-none", className)}
      onPointerDown={handlePointerDown}
      onClick={(event) => event.stopPropagation()}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onKeyDown={(event) => {
        const nudge = event.key === "ArrowRight" ? 0.5 : event.key === "ArrowLeft" ? -0.5 : 0;
        if (!nudge) return;
        event.preventDefault();
        event.stopPropagation();
        const from = volumeDb <= SILENT_DB ? FLOOR_DB : volumeDb;
        onChange(Math.max(SILENT_DB, Math.min(MAX_DB, from + nudge)));
      }}
      tabIndex={0}
      role="slider"
      aria-label="Track volume"
      aria-valuenow={Math.round(volumeDb * 10) / 10}
      aria-valuetext={label}
      aria-valuemin={SILENT_DB}
      aria-valuemax={MAX_DB}
      title="Volume (double-click for 0 dB)"
    >
      <div className="relative h-3.5 w-full overflow-hidden rounded-full border border-border bg-card shadow-inner">
        <div className="pointer-events-none absolute inset-y-0.5 right-1 left-1 flex flex-col justify-center gap-0.5">
          <div className={cn("h-0.5 rounded-xs bg-gradient-to-r", barColor)} style={{ width: meterWidth }} />
          <div className={cn("h-0.5 rounded-xs bg-gradient-to-r", barColor)} style={{ width: meterWidth }} />
        </div>
        {/* 0 dB mark */}
        <div
          className="pointer-events-none absolute inset-y-0.5 w-px bg-foreground/25"
          style={{ left: `${UNITY * 100}%` }}
        />
      </div>

      <div
        className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-foreground/85 shadow-md"
        style={{ left: `${position * 100}%` }}
      />

      {dragging || hovering ? (
        <div
          className="pointer-events-none absolute -bottom-9 z-40 flex -translate-x-1/2 items-center gap-2 rounded border border-border bg-popover px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-popover-foreground shadow-xl"
          style={{ left: `${position * 100}%` }}
        >
          <span className="text-muted-foreground">Volume:</span>
          <span className="font-mono tabular-nums">{label}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Pan as GarageBand shows it: -64 (left) to +63 (right). */
export function panLabel(pan: number): string {
  const steps = Math.round(pan * 64);
  if (steps === 0) return "0";
  return steps < 0 ? `${steps}` : `+${Math.min(63, steps)}`;
}

/**
 * The track's pan. Drag up or right to go right, down or left to go left.
 * Double-click centers it.
 */
export function TrackPanKnob({
  pan,
  onChange,
  className,
}: {
  pan: number;
  onChange: (pan: number) => void;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const angle = pan * 135;

  const handlePointerDown = (event: React.PointerEvent) => {
    event.stopPropagation();
    if (event.detail >= 2) {
      onChange(0);
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const startPan = pan;
    setDragging(true);
    const onMove = (move: PointerEvent) => {
      const delta = startY - move.clientY + (move.clientX - startX);
      const next = Math.max(-1, Math.min(1, startPan + delta / 100));
      onChange(Math.abs(next) < 0.02 ? 0 : Math.round(next * 64) / 64);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const text = panLabel(pan);

  return (
    <div
      className={cn("relative flex cursor-ns-resize items-center justify-center select-none", className)}
      onPointerDown={handlePointerDown}
      onClick={(event) => event.stopPropagation()}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onKeyDown={(event) => {
        const nudge = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
        if (!nudge) return;
        event.preventDefault();
        event.stopPropagation();
        onChange(Math.max(-1, Math.min(1, Math.round(pan * 64 + nudge) / 64)));
      }}
      tabIndex={0}
      role="slider"
      aria-label="Track pan"
      aria-valuenow={Math.round(pan * 64)}
      aria-valuetext={text}
      aria-valuemin={-64}
      aria-valuemax={63}
      title="Pan (double-click to center)"
    >
      <div className="relative flex size-6.5 items-center justify-center rounded-full border border-border bg-card p-0.5 shadow-sm">
        <div className="relative size-full rounded-full bg-secondary shadow-inner" style={{ transform: `rotate(${angle}deg)` }}>
          <div className="absolute top-0.5 left-1/2 h-1.5 w-0.5 -translate-x-1/2 rounded-full bg-emerald-400" />
        </div>
      </div>

      {dragging || hovering ? (
        <div className="pointer-events-none absolute -bottom-8 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded border border-border bg-popover px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-popover-foreground shadow-lg">
          <span className="text-muted-foreground">Pan:</span>
          <span className="font-mono tabular-nums">{text}</span>
        </div>
      ) : null}
    </div>
  );
}
