import { useState } from "react";
import { cn } from "../../../renderer/shared/lib/utils";

/**
 * An analog-style rotary console knob, matching GarageBand's Smart Controls
 * console (Images 2, 3, 4). Rotates on drag or click, styled with present's
 * theme colors.
 */
export function Knob({
  label,
  value: initialValue = 50,
  min = 0,
  max = 100,
  unit = "",
  disabled = false,
  className,
  onChange,
}: {
  label: string;
  value?: number;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
  className?: string;
  onChange?: (value: number) => void;
}) {
  const [val, setVal] = useState(initialValue);
  const [dragging, setDragging] = useState(false);

  // Map 0..100 to angle: -135deg to +135deg (270deg sweep)
  const fraction = Math.max(0, Math.min(1, (val - min) / (max - min)));
  const angle = -135 + fraction * 270;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    const startY = e.clientY;
    const startVal = val;
    setDragging(true);

    const onMove = (moveEvent: PointerEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const step = (max - min) / 100;
      const next = Math.max(min, Math.min(max, Math.round(startVal + deltaY * step)));
      setVal(next);
      onChange?.(next);
    };

    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const readout = unit ? `${val}${unit}` : `${val}`;

  return (
    <div className={cn("flex h-full max-h-full w-full min-h-0 flex-col items-center justify-center select-none", className)}>
      <span className="mb-[0.4em] shrink-0 text-[0.7rem] font-bold tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </span>

      <div
        className={cn(
          "relative aspect-square w-full max-h-[calc(100%-1.35rem)] min-h-0 cursor-ns-resize rounded-full border-[3px] border-border bg-gradient-to-b from-secondary to-background shadow-lg",
          dragging && "ring-2 ring-primary",
          disabled && "cursor-not-allowed opacity-40",
        )}
        onPointerDown={(event) => {
          event.stopPropagation();
          handlePointerDown(event);
        }}
        role="slider"
        aria-label={label}
        aria-valuenow={val}
        aria-valuemin={min}
        aria-valuemax={max}
        title={`${label}: ${readout}`}
      >
        <div
          className="absolute inset-[8%] rounded-full bg-gradient-to-br from-card to-background shadow-inner"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <div className="absolute top-[4%] left-1/2 h-[46%] w-[3px] -translate-x-1/2 rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}

/** Vertical throw switch, the compressor's power control. */
export function ToggleSwitch({
  label,
  active = false,
  onChange,
}: {
  label?: string;
  active?: boolean;
  onChange?: (active: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label ?? "Compressor"}
      onClick={() => onChange?.(!active)}
      className={cn(
        "flex flex-col items-center gap-1 cursor-pointer select-none outline-none group",
      )}
    >
      <div className="relative h-16 w-7 rounded-full border-2 border-border bg-background shadow-inner transition-colors group-hover:border-primary/50">
        <div
          className={cn(
            "absolute left-1/2 h-7 w-5 -translate-x-1/2 rounded-full border border-border shadow-md transition-all duration-150",
            active ? "top-1 bg-primary" : "bottom-1 bg-muted-foreground/80",
          )}
        />
      </div>
      {label ? <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</span> : null}
    </button>
  );
}

/** Round power lamp, the equalizer's on switch. */
export function PowerLamp({
  active,
  onChange,
  label = "EQ power",
  className,
}: {
  active: boolean;
  onChange: (active: boolean) => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label}
      title={active ? "EQ on" : "EQ off"}
      onClick={() => onChange(!active)}
      className={cn(
        "aspect-square w-[42%] max-h-full rounded-full border-[3px] shadow-md transition-colors",
        active
          ? "border-primary bg-primary shadow-primary/40"
          : "border-border bg-background hover:border-primary/50",
        className,
      )}
    />
  );
}
