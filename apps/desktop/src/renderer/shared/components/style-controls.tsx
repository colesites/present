"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, Lock, Plus, X } from "lucide-react";
import { cn } from "../lib/utils";
import type { SlideFill } from "../../../shared/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

/**
 * The compact controls the theme designer and the slide editor's sidebar
 * share: sections, labelled rows, colours with opacity, numbers with
 * sliders, segmented choices and fills. One set, so a theme and a slide are
 * styled with the same controls in the same order.
 */

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** A colour as the six-digit hex a colour well takes, and its opacity. */
export function splitColor(value: string | null | undefined): { hex: string; alpha: number } {
  const text = (value ?? "").trim();
  const rgba = text.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i);
  if (rgba) {
    const hex = `#${[rgba[1], rgba[2], rgba[3]]
      .map((part) => Math.min(255, Math.round(Number(part))).toString(16).padStart(2, "0"))
      .join("")}`;
    const alpha = rgba[4] === undefined ? 1 : rgba[4].endsWith("%") ? Number(rgba[4].slice(0, -1)) / 100 : Number(rgba[4]);
    return { hex, alpha: Math.max(0, Math.min(1, alpha)) };
  }
  if (/^#[0-9a-f]{6}$/i.test(text)) return { hex: text.toLowerCase(), alpha: 1 };
  if (/^#[0-9a-f]{8}$/i.test(text)) {
    return { hex: text.slice(0, 7).toLowerCase(), alpha: parseInt(text.slice(7), 16) / 255 };
  }
  if (/^#[0-9a-f]{3,4}$/i.test(text)) {
    const digits = [...text.slice(1)].map((c) => c + c);
    return {
      hex: `#${digits.slice(0, 3).join("")}`.toLowerCase(),
      alpha: digits[3] ? parseInt(digits[3], 16) / 255 : 1,
    };
  }
  return { hex: "#000000", alpha: 1 };
}

/** A hex colour and an opacity, as the shortest CSS for them. */
export function joinColor(hex: string, alpha: number): string {
  if (alpha >= 0.995) return hex;
  const channel = (start: number) => parseInt(hex.slice(start, start + 2), 16);
  return `rgba(${channel(1)},${channel(3)},${channel(5)},${Math.round(Math.max(0, alpha) * 100) / 100})`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * A titled group. With `enabled`, its switch is in the title and its body
 * shows only while it is on (a shadow, an outline); with `collapsible`, the
 * title folds it away.
 */
export function StyleSection({
  title,
  badge,
  enabled,
  onEnabledChange,
  disabled,
  collapsible = false,
  defaultOpen = true,
  aside,
  children,
}: {
  title: string;
  badge?: string | null;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  disabled?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const showBody = (enabled === undefined || enabled) && (!collapsible || open);
  return (
    <section className="border-b border-border/60 px-4 py-3 last:border-b-0">
      <div className="flex min-h-6 items-center gap-2">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="-ml-1 flex items-center gap-1 rounded px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground"
            aria-expanded={open}
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")} />
            {title}
          </button>
        ) : (
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
        )}
        {badge ? (
          <span className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold text-primary">
            <Lock className="h-2.5 w-2.5" />
            {badge}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {aside}
          {enabled !== undefined && onEnabledChange ? (
            <Switch checked={enabled} onChange={onEnabledChange} disabled={disabled} label={title} />
          ) : null}
        </span>
      </div>
      {showBody && children ? <div className="mt-2.5 flex flex-col gap-2">{children}</div> : null}
    </section>
  );
}

/** A label on the left and its control on the right. */
export function StyleRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-w-0 grid-cols-[64px_minmax(0,1fr)] items-center gap-2", className)}>
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-4 w-7 flex-none rounded-full transition disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-primary" : "bg-foreground/20",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left]",
          checked ? "left-3.5" : "left-0.5",
        )}
      />
    </button>
  );
}

/** A colour well, its hex, and (with `alpha`) its opacity. */
export function ColorInput({
  value,
  onChange,
  label,
  alpha = false,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  alpha?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { hex, alpha: opacity } = splitColor(value);
  const [typed, setTyped] = useState<string | null>(null);
  const commit = (text: string) => {
    setTyped(null);
    const next = text.trim().startsWith("#") ? text.trim() : `#${text.trim()}`;
    if (/^#[0-9a-f]{6}$/i.test(next)) onChange(joinColor(next.toLowerCase(), opacity));
    else if (/^#[0-9a-f]{3}$/i.test(next)) onChange(joinColor(splitColor(next).hex, opacity));
  };
  return (
    <div
      className={cn(
        "flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background/40 pl-1 pr-1.5",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <label className="relative h-6 w-6 flex-none cursor-pointer overflow-hidden rounded-[5px] border border-white/10" title={label}>
        <span
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(45deg,#8886 25%,transparent 25%,transparent 75%,#8886 75%),linear-gradient(45deg,#8886 25%,transparent 25%,transparent 75%,#8886 75%)",
            backgroundSize: "8px 8px",
            backgroundPosition: "0 0,4px 4px",
          }}
        />
        <span className="absolute inset-0" style={{ background: value }} />
        <input
          type="color"
          value={hex}
          aria-label={label}
          disabled={disabled}
          onChange={(event) => onChange(joinColor(event.target.value, opacity))}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <input
        type="text"
        value={typed ?? hex.slice(1).toUpperCase()}
        aria-label={`${label} hex`}
        disabled={disabled}
        spellCheck={false}
        maxLength={7}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(event.currentTarget.value);
          if (event.key === "Escape") {
            event.preventDefault();
            setTyped(null);
          }
        }}
        className="min-w-0 flex-1 bg-transparent font-mono text-[11px] uppercase text-foreground outline-none"
      />
      {alpha ? (
        <NumberInput
          value={Math.round(opacity * 100)}
          min={0}
          max={100}
          suffix="%"
          label={`${label} opacity`}
          disabled={disabled}
          bare
          onChange={(percent) => onChange(joinColor(hex, percent / 100))}
        />
      ) : null}
    </div>
  );
}

/**
 * A number, typed freely and taken on Enter or on leaving the field; arrow
 * keys step it (by ten with Shift).
 */
export function NumberInput({
  value,
  min,
  max,
  step = 1,
  suffix,
  label,
  onChange,
  disabled,
  bare = false,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  label: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  bare?: boolean;
  className?: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const decimals = step < 1 ? String(step).split(".")[1]?.length ?? 1 : 0;
  const shown = Number(value.toFixed(decimals));
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const commit = (text: string) => {
    setTyped(null);
    const next = Number(text.replace(/[^\d.-]/g, ""));
    if (text.trim() !== "" && Number.isFinite(next)) {
      const rounded = Number(clamp(next).toFixed(decimals));
      if (rounded !== value) onChange(rounded);
    }
  };
  return (
    <span
      className={cn(
        "flex min-w-0 items-center",
        !bare && "h-8 rounded-md border border-border bg-background/40 px-2",
        disabled && "opacity-50",
        className,
      )}
    >
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        title={label}
        value={typed ?? String(shown)}
        disabled={disabled}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(event.currentTarget.value);
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const direction = event.key === "ArrowUp" ? 1 : -1;
            const next = Number(clamp(shown + direction * step * (event.shiftKey ? 10 : 1)).toFixed(decimals));
            setTyped(null);
            onChange(next);
          }
        }}
        className={cn(
          "w-full min-w-0 bg-transparent text-right text-[11px] tabular-nums text-foreground outline-none",
          bare ? "w-9" : "",
        )}
      />
      {suffix ? <span className="ml-0.5 flex-none text-[10px] text-muted-foreground">{suffix}</span> : null}
    </span>
  );
}

/** A slider and the number it sets. */
export function SliderInput({
  value,
  min,
  max,
  step = 1,
  suffix,
  label,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  label: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
      />
      <NumberInput
        value={value}
        min={min}
        max={max}
        step={step}
        suffix={suffix}
        label={label}
        disabled={disabled}
        onChange={onChange}
        className="w-[62px] flex-none"
      />
    </div>
  );
}

type SegmentOption = { value: string; label: ReactNode; title?: string; disabled?: boolean };

/** One of a few choices, side by side. */
export function Segmented({
  value,
  options,
  onChange,
  label,
  disabled,
  className,
}: {
  value: string;
  options: SegmentOption[];
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("flex h-8 min-w-0 rounded-md border border-border bg-background/40 p-0.5", disabled && "opacity-40", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          disabled={disabled || option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 text-[11px] font-medium transition disabled:cursor-not-allowed",
            value === option.value ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground",
            option.disabled && "opacity-40",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A button that stays pressed, for italic, underline and the like. */
export function IconToggle({
  pressed,
  onChange,
  label,
  children,
  disabled,
}: {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!pressed)}
      className={cn(
        "flex h-8 w-8 flex-none items-center justify-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-40",
        pressed
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** A compact menu of choices, opening over everything. */
export function SelectInput({
  value,
  options,
  onChange,
  label,
  disabled,
  className,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        className={cn("h-8 min-w-0 flex-1 rounded-md border-border bg-background/40 px-2 text-[11px] shadow-none", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="z-[200]">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-[12px]">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Fills
// ---------------------------------------------------------------------------

export type FillKind = "none" | SlideFill["kind"];

/** Mixes to start from, the look of the stand-in behind a clear theme among them. */
export const MIX_PRESETS: Array<{ name: string; fill: Extract<SlideFill, { kind: "mix" }> }> = [
  {
    name: "Dusk",
    fill: {
      kind: "mix",
      base: "#15161f",
      spots: [
        { color: "#3b3f6b", x: 0.2, y: 0.15, size: 0.6 },
        { color: "#5a3a2e", x: 0.85, y: 0.9, size: 0.55 },
      ],
    },
  },
  {
    name: "Ember",
    fill: {
      kind: "mix",
      base: "#140806",
      spots: [
        { color: "#7c2d12", x: 0.15, y: 0.85, size: 0.7 },
        { color: "#b45309", x: 0.8, y: 0.2, size: 0.45 },
      ],
    },
  },
  {
    name: "Forest",
    fill: {
      kind: "mix",
      base: "#07130f",
      spots: [
        { color: "#14532d", x: 0.25, y: 0.3, size: 0.6 },
        { color: "#0e7490", x: 0.9, y: 0.8, size: 0.5 },
      ],
    },
  },
  {
    name: "Violet",
    fill: {
      kind: "mix",
      base: "#0d0718",
      spots: [
        { color: "#6d28d9", x: 0.1, y: 0.1, size: 0.6 },
        { color: "#db2777", x: 0.9, y: 0.95, size: 0.5 },
        { color: "#1d4ed8", x: 0.9, y: 0.1, size: 0.35 },
      ],
    },
  },
];

/** A fill as a CSS background, for a swatch or a DOM preview. */
export function fillSwatchCss(fill: SlideFill): string {
  if (fill.kind === "color") return fill.color;
  if (fill.kind === "gradient") return `linear-gradient(${fill.angle + 90}deg, ${fill.from}, ${fill.to})`;
  return [
    ...fill.spots.map(
      (spot) =>
        `radial-gradient(circle at ${spot.x * 100}% ${spot.y * 100}%, ${spot.color}, transparent ${Math.round(spot.size * 100)}%)`,
    ),
    fill.base,
  ].join(", ");
}

/**
 * Choosing and changing a fill: none (when `allowNone`), a colour, a
 * gradient or a mix. `lockedKinds` are shown with a lock and not chosen.
 */
export function FillEditor({
  value,
  onChange,
  allowNone = false,
  noneLabel = "Clear",
  lockedKinds = [],
  lockedLabel,
  disabled,
  label,
  hideKindPicker = false,
}: {
  value: SlideFill | null;
  onChange: (value: SlideFill | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  lockedKinds?: FillKind[];
  lockedLabel?: string;
  disabled?: boolean;
  label: string;
  /** For a caller that offers the kinds itself, with more beside them. */
  hideKindPicker?: boolean;
}) {
  const kind: FillKind = value?.kind ?? "none";
  const base = value
    ? value.kind === "color"
      ? value.color
      : value.kind === "gradient"
        ? value.from
        : value.base
    : "#111827";
  const choose = (next: FillKind) => {
    if (next === kind) return;
    if (next === "none") onChange(null);
    else if (next === "color") onChange({ kind: "color", color: base });
    else if (next === "gradient") onChange({ kind: "gradient", from: base, to: "#0e5e6f", angle: 90 });
    else onChange({ ...MIX_PRESETS[0].fill, base: value ? base : MIX_PRESETS[0].fill.base });
  };
  const kinds: FillKind[] = allowNone ? ["none", "color", "gradient", "mix"] : ["color", "gradient", "mix"];
  const names: Record<FillKind, string> = { none: noneLabel, color: "Colour", gradient: "Gradient", mix: "Mix" };
  const id = useId();

  return (
    <div className="flex flex-col gap-2" aria-labelledby={id}>
      <span id={id} className="sr-only">
        {label}
      </span>
      {hideKindPicker ? null : <Segmented
        value={kind}
        label={label}
        disabled={disabled}
        onChange={(next) => choose(next as FillKind)}
        options={kinds.map((option) => ({
          value: option,
          label: lockedKinds.includes(option) ? (
            <>
              <Lock className="h-2.5 w-2.5" /> {names[option]}
            </>
          ) : (
            names[option]
          ),
          disabled: lockedKinds.includes(option),
          title: lockedKinds.includes(option) ? lockedLabel : undefined,
        }))}
      />}
      {value?.kind === "color" ? (
        <ColorInput label={`${label} colour`} value={value.color} alpha disabled={disabled} onChange={(color) => onChange({ kind: "color", color })} />
      ) : null}
      {value?.kind === "gradient" ? (
        <>
          <div className="flex gap-1.5">
            <ColorInput label={`${label} start`} value={value.from} alpha disabled={disabled} onChange={(from) => onChange({ ...value, from })} />
            <ColorInput label={`${label} end`} value={value.to} alpha disabled={disabled} onChange={(to) => onChange({ ...value, to })} />
          </div>
          <StyleRow label="Angle">
            <SliderInput value={value.angle} min={0} max={360} suffix="°" label={`${label} angle`} disabled={disabled} onChange={(angle) => onChange({ ...value, angle })} />
          </StyleRow>
        </>
      ) : null}
      {value?.kind === "mix" ? (
        <>
          <div className="flex gap-1.5">
            {MIX_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                title={preset.name}
                aria-label={`${preset.name} mix`}
                disabled={disabled}
                onClick={() => onChange(preset.fill)}
                className="h-7 flex-1 rounded-md border border-white/10 transition hover:ring-1 hover:ring-primary/60"
                style={{ background: fillSwatchCss(preset.fill) }}
              />
            ))}
          </div>
          <StyleRow label="Base">
            <ColorInput label={`${label} base`} value={value.base} disabled={disabled} onChange={(next) => onChange({ ...value, base: next })} />
          </StyleRow>
          {value.spots.map((spot, index) => (
            <div key={index} className="rounded-md border border-border/60 p-2">
              <div className="flex items-center gap-1.5">
                <ColorInput
                  label={`Colour ${index + 1}`}
                  value={spot.color}
                  disabled={disabled}
                  onChange={(color) =>
                    onChange({ ...value, spots: value.spots.map((each, at) => (at === index ? { ...each, color } : each)) })
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove colour ${index + 1}`}
                  disabled={disabled}
                  onClick={() => onChange({ ...value, spots: value.spots.filter((_, at) => at !== index) })}
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {(["x", "y", "size"] as const).map((key) => (
                  <NumberInput
                    key={key}
                    value={Math.round(spot[key] * 100)}
                    min={key === "size" ? 5 : -50}
                    max={key === "size" ? 200 : 150}
                    suffix={key === "size" ? "%" : key.toUpperCase()}
                    label={`Colour ${index + 1} ${key === "size" ? "size" : key}`}
                    disabled={disabled}
                    onChange={(percent) =>
                      onChange({
                        ...value,
                        spots: value.spots.map((each, at) => (at === index ? { ...each, [key]: percent / 100 } : each)),
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          {value.spots.length < 4 ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange({ ...value, spots: [...value.spots, { color: "#3b82f6", x: 0.5, y: 0.5, size: 0.5 }] })
              }
              className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-border text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> Add a colour
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
