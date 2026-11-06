import { cn } from "../../../renderer/shared/lib/utils";

/** The quietest level a meter shows, in dBFS. */
const FLOOR_DB = -55;

/**
 * A peak (0 to 1) as a meter reads it: in decibels, so speech sits in the
 * middle of the meter rather than in its first few pixels.
 */
export function meterFraction(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0.004) return 0;
  const db = 20 * Math.log10(Math.min(1, peak));
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));
}

/**
 * A segmented level meter, green to amber to red, as a recording app draws
 * one. Unlit segments stay faintly visible so the scale reads at rest.
 */
export function LevelMeter({
  level,
  active,
  className,
  segments = 24,
}: {
  /** The loudest sample since the last read, 0 to 1. */
  level: number;
  /** Lit at all: false shows the empty scale. */
  active: boolean;
  className?: string;
  segments?: number;
}) {
  const lit = active ? Math.round(meterFraction(level) * segments) : 0;
  return (
    <div
      className={cn("flex h-1.5 items-stretch gap-px", className)}
      role="meter"
      aria-label="Input level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((lit / segments) * 100)}
    >
      {Array.from({ length: segments }, (_, index) => {
        const at = (index + 1) / segments;
        const colour = at > 0.9 ? "bg-red-500" : at > 0.72 ? "bg-amber-400" : "bg-emerald-500";
        return (
          <span
            key={index}
            className={cn("flex-1 rounded-[1px]", index < lit ? colour : "bg-foreground/10")}
          />
        );
      })}
    </div>
  );
}
