"use client";

import type { ComponentType, ReactNode } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

/**
 * The dashboard's parts, sized once so every page matches.
 *
 * Shapes come from one scale (`globals.css`): `rounded-panel` for the white
 * panel, `rounded-card` for cards on it, `rounded-control` for fields and
 * icon tiles, and full rounding for buttons and chips.
 */

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

/** A page's frame: its width, and gutters that shrink with the screen. */
export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div
      className={cx(
        "mx-auto w-full px-4 pb-12 pt-6 text-[#232946] sm:px-6 sm:pt-8 lg:px-10 lg:pt-10",
        wide ? "max-w-7xl" : "max-w-5xl",
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="mt-2 text-[1.9rem] font-semibold leading-[1.05] tracking-[-0.045em] sm:text-[2.4rem] lg:text-[2.75rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-[0.95rem] leading-6 text-[#7d8798] sm:text-base sm:leading-7">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2 sm:flex-none sm:justify-end">{actions}</div> : null}
    </header>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx("text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/70", className)}>
      {children}
    </p>
  );
}

export function Card({
  children,
  className,
  tone = "white",
}: {
  children: ReactNode;
  className?: string;
  tone?: "white" | "soft";
}) {
  return (
    <div
      className={cx(
        "rounded-card border p-5 sm:p-6",
        tone === "soft" ? "border-primary/10 bg-primary/[0.035]" : "border-[#ececf2] bg-white",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  aside,
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-center justify-between gap-3", className)}>
      <h2 className="text-lg font-semibold tracking-[-0.02em] sm:text-xl">{children}</h2>
      {aside}
    </div>
  );
}

/**
 * A number and what it counts. The icon sits beside, never over, the text;
 * on a phone the card is one short row with the number at its end.
 */
export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3.5 rounded-card border border-[#ececf2] bg-white px-4 py-3.5 sm:items-start sm:gap-4 sm:p-5">
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-primary/70">
          {label}
        </p>
        <p className="mt-1 hidden text-[1.75rem] font-semibold leading-none tracking-[-0.04em] sm:block">{value}</p>
        {detail ? <p className="truncate text-sm leading-5 text-[#7d8798] sm:mt-2 sm:whitespace-normal">{detail}</p> : null}
      </div>
      <p className="flex-none text-2xl font-semibold tracking-[-0.04em] sm:hidden">{value}</p>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-[#e2e4ec] px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-control bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-4 font-semibold">{title}</p>
      {children ? <p className="mt-1 max-w-sm text-sm leading-6 text-[#7d8798]">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function SkeletonRows({ rows = 3, height = "h-[68px]" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className={cx(height, "animate-pulse rounded-card bg-[#f3f4f8]")} />
      ))}
    </div>
  );
}

const BUTTON_STYLES = {
  primary: "bg-primary text-white hover:bg-primary/90",
  secondary: "border border-primary/15 bg-primary/[0.05] text-primary hover:bg-primary/[0.1]",
  outline: "border border-[#e2e4ec] bg-white text-[#232946] hover:border-primary/40 hover:text-primary",
  ghost: "text-[#7d8798] hover:bg-[#f3f4f8] hover:text-[#232946]",
  danger: "bg-red-500 text-white hover:bg-red-600",
  "danger-outline": "border border-red-200 text-red-600 hover:bg-red-50",
} as const;

export const buttonClass = (
  variant: keyof typeof BUTTON_STYLES = "primary",
  size: "sm" | "md" = "md",
) =>
  cx(
    "inline-flex flex-none items-center justify-center gap-2 rounded-full font-semibold transition disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-9 px-4 text-[0.8rem]" : "h-11 px-5 text-sm",
    BUTTON_STYLES[variant],
  );

export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_STYLES;
  size?: "sm" | "md";
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={cx(buttonClass(variant, size), className)}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export const fieldClass =
  "h-11 w-full rounded-control border border-[#e4e6ee] bg-[#fafbfd] px-3.5 text-[0.95rem] text-[#232946] outline-none transition placeholder:text-[#a3aaba] focus:border-primary/50 focus:bg-white focus:ring-4 focus:ring-primary/10 disabled:opacity-60";

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="text-sm font-medium text-[#232946]">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1.5 text-[0.8rem] leading-5 text-[#9aa3b2]">{hint}</p> : null}
    </div>
  );
}

/** A native select, dressed to match the fields. */
export function Select({
  className,
  children,
  compact = false,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return (
    <div className={cx("relative", compact ? "inline-block" : "w-full", className)}>
      <select
        {...props}
        className={cx(
          "w-full appearance-none rounded-control border border-[#e4e6ee] bg-[#fafbfd] pr-9 text-[#232946] outline-none transition focus:border-primary/50 focus:bg-white focus:ring-4 focus:ring-primary/10 disabled:opacity-60",
          compact ? "h-9 pl-3 text-[0.85rem]" : "h-11 pl-3.5 text-[0.95rem]",
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa3b2]" />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cx("flex items-start gap-3", disabled ? "opacity-60" : "cursor-pointer")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-6 w-11 flex-none rounded-full transition",
          checked ? "bg-primary" : "bg-[#dfe2ea]",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[#232946]">{label}</span>
        {description ? <span className="mt-0.5 block text-[0.8rem] leading-5 text-[#9aa3b2]">{description}</span> : null}
      </span>
    </label>
  );
}

export function Notice({ kind, children }: { kind: "ok" | "error" | "info"; children: ReactNode }) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={cx(
        "rounded-control px-3.5 py-2.5 text-sm",
        kind === "ok" && "bg-emerald-50 text-emerald-700",
        kind === "error" && "bg-red-50 text-red-600",
        kind === "info" && "bg-primary/[0.06] text-primary",
      )}
    >
      {children}
    </p>
  );
}

/** What a Convex error says, without the transport's prefix. */
export const friendlyError = (error: unknown): string => {
  const data = (error as { data?: unknown } | null)?.data;
  if (typeof data === "string") return data;
  const message = error instanceof Error ? error.message : "";
  return message.match(/ConvexError: (.*?)(?:\n|$)/)?.[1] ?? "Something went wrong. Try again.";
};

export function Avatar({
  src,
  name,
  size = 40,
  shape = "circle",
}: {
  src?: string | null;
  name: string;
  size?: number;
  shape?: "circle" | "tile";
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "P";
  const rounding = shape === "circle" ? "rounded-full" : "rounded-control";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} style={{ width: size, height: size }} className={cx(rounding, "flex-none object-cover")} />
  ) : (
    <span
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
      className={cx(rounding, "flex flex-none items-center justify-center bg-primary/10 font-semibold text-primary")}
    >
      {initials}
    </span>
  );
}
