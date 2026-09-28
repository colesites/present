"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "../../../renderer/shared/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../renderer/shared/components/ui/select";

/*
 * The pieces every settings page is made of, so they all read the same way:
 * a page title, then groups, each a card of rows, and each row a name on the
 * left and its control on the right.
 */

export function SettingsPage({
  title,
  description,
  children,
  wide,
}: {
  title: string;
  description: string;
  children: ReactNode;
  /** For a page laid out in panes, like Screen Configuration. */
  wide?: boolean;
}) {
  return (
    <div className={cn("mx-auto w-full px-8 pb-16 pt-7", wide ? "max-w-[1040px]" : "max-w-[760px]")}>
      <header className="mb-7">
        <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-foreground">{title}</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{description}</p>
      </header>
      <div className="space-y-8">{children}</div>
    </div>
  );
}

export function SettingsGroup({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Beside the title, on the right: a count, a refresh. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-2.5 flex items-end justify-between gap-4 px-0.5">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[12px] leading-[18px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card/50 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="divide-y divide-border/60">{children}</div>
      </div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  children,
  htmlFor,
  disabled,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[56px] items-center justify-between gap-6 px-4 py-3",
        disabled && "opacity-50",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[13px] font-medium text-foreground">
            {label}
          </label>
        ) : (
          <div className="text-[13px] font-medium text-foreground">{label}</div>
        )}
        {description ? (
          <div className="mt-0.5 text-[12px] leading-[18px] text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Something that fills a whole row: a preview, a list, a picker. */
export function SettingsBlock({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3.5", className)}>{children}</div>;
}

/** A quiet note under a group, for the thing people ask about. */
export function SettingsNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2.5 flex gap-2 px-0.5 text-[12px] leading-[18px] text-muted-foreground">
      <Info className="mt-[2px] h-3.5 w-3.5 flex-none opacity-70" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function SettingsSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
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
        "relative h-[22px] w-[38px] flex-none rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-primary" : "bg-foreground/15",
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-[left] duration-150",
          checked ? "left-[19px]" : "left-[3px]",
        )}
      />
    </button>
  );
}

export const SETTINGS_FIELD =
  "h-8 rounded-lg border border-border/80 bg-background/60 px-2.5 text-[12.5px] text-foreground outline-none transition focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/25";

export function SettingsSelect({
  value,
  onChange,
  options,
  label,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className={cn(SETTINGS_FIELD, "w-[240px] justify-between", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A whole number, typed or stepped, kept within its range when it is left. */
export function SettingsNumber({
  value,
  onChange,
  min,
  max,
  suffix,
  label,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max?: number;
  suffix?: string;
  label: string;
  className?: string;
}) {
  const clamp = (next: number) => Math.round(Math.min(Math.max(next, min), max ?? Number.POSITIVE_INFINITY));
  return (
    <label className={cn(SETTINGS_FIELD, "flex w-[104px] items-center gap-1 pr-2", className)}>
      <input
        type="number"
        aria-label={label}
        // Keyed to the value, so what is shown follows a change made
        // elsewhere, and a half-typed number is only committed when left.
        key={value}
        defaultValue={value}
        min={min}
        max={max}
        step={1}
        onBlur={(event) => {
          const next = Number(event.currentTarget.value);
          if (!Number.isFinite(next)) {
            event.currentTarget.value = String(value);
            return;
          }
          const clamped = clamp(next);
          event.currentTarget.value = String(clamped);
          if (clamped !== value) onChange(clamped);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="min-w-0 flex-1 bg-transparent text-right tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix ? <span className="text-[11.5px] text-muted-foreground">{suffix}</span> : null}
    </label>
  );
}

export function SettingsSlider({
  value,
  onChange,
  min,
  max,
  suffix = "",
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  suffix?: string;
  label: string;
}) {
  return (
    <div className="flex w-[240px] items-center gap-3">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-primary"
      />
      <span className="w-12 text-right text-[12px] tabular-nums text-muted-foreground">
        {Math.round(value)}
        {suffix}
      </span>
    </div>
  );
}

export function SettingsButton({
  children,
  onClick,
  variant = "secondary",
  disabled,
  className,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "secondary" && "border border-border/80 bg-background/60 text-foreground hover:bg-muted",
        variant === "ghost" && "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A small status: green when it is running, red when it needs a look. */
export function SettingsStatus({ tone, children }: { tone: "ok" | "off" | "warn"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium",
        tone === "ok" && "bg-emerald-500/10 text-emerald-500",
        tone === "off" && "bg-foreground/[0.06] text-muted-foreground",
        tone === "warn" && "bg-red-500/10 text-red-400",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "ok" && "bg-emerald-500",
          tone === "off" && "bg-muted-foreground/60",
          tone === "warn" && "bg-red-400",
        )}
      />
      {children}
    </span>
  );
}

/** A row of one-tap actions that look like a segmented control. */
export function SettingsButtonGroup({
  options,
  onPick,
  label,
}: {
  options: Array<{ value: string; label: string }>;
  onPick: (value: string) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex h-8 rounded-lg border border-border/80 bg-background/60 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onPick(option.value)}
          className="rounded-md px-2.5 text-[12px] font-medium text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
