"use client";

import type { ComponentType, ReactNode } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

/**
 * The dashboard's parts, sized once so every page matches.
 *
 * Plain on purpose: titles and lists carry the page, with borders and
 * whitespace rather than tinted cards and icon badges. Shapes come from one
 * scale in `globals.css`: `rounded-panel` for the white panel,
 * `rounded-card` for anything on it, `rounded-control` for fields.
 */

/** The text colours, named once. */
export const tone = {
  ink: "text-[#1d2240]",
  muted: "text-[#6b7285]",
  faint: "text-[#9aa1b1]",
} as const;

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

/** A page's frame: its width, and gutters that shrink with the screen. */
export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div
      className={cx(
        "mx-auto w-full px-4 pb-16 pt-6 text-[#1d2240] sm:px-6 sm:pt-8 lg:px-10 lg:pt-10",
        wide ? "max-w-6xl" : "max-w-4xl",
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Accepted for pages not yet moved over; not shown. */
  eyebrow?: string;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-[#eceef3] pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[1.6rem] font-semibold leading-tight tracking-[-0.03em] sm:text-[1.85rem]">{title}</h1>
        {description ? <div className="mt-1.5 text-[0.95rem] leading-6 text-[#6b7285]">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2 sm:flex-none sm:justify-end">{actions}</div> : null}
    </header>
  );
}

/** A small label above a value. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-[0.8rem] font-medium text-[#6b7285]", className)}>{children}</p>;
}

export function Card({
  children,
  className,
  tone: surface = "white",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  tone?: "white" | "soft";
  padded?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-card border",
        padded && "p-5",
        surface === "soft" ? "border-[#eceef3] bg-[#f8f9fb]" : "border-[#e7e9ef] bg-white",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A section's heading, with an optional link or control at its end. */
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
    <div className={cx("mb-3 flex min-h-8 items-center justify-between gap-3", className)}>
      <h2 className="text-[0.98rem] font-semibold tracking-[-0.01em]">{children}</h2>
      {aside}
    </div>
  );
}

/** Rows in a bordered list. Pass `<li>`s; dividers come from here. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul className={cx("divide-y divide-[#eff0f4] overflow-hidden rounded-card border border-[#e7e9ef] bg-white", className)}>
      {children}
    </ul>
  );
}

export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="min-w-0 rounded-card border border-[#e7e9ef] bg-white px-4 py-3.5">
      <p className="truncate text-[0.8rem] text-[#6b7285]">{label}</p>
      <p className="mt-1 text-[1.5rem] font-semibold leading-none tracking-[-0.03em]">{value}</p>
      {detail ? <p className="mt-1.5 truncate text-[0.8rem] text-[#9aa1b1]">{detail}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-[#dfe2ea] px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-[#6b7285]">{children}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function SkeletonRows({ rows = 3, height = "h-14" }: { rows?: number; height?: string }) {
  return (
    <div className="overflow-hidden rounded-card border border-[#e7e9ef]" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className={cx(height, "flex items-center gap-3 border-b border-[#eff0f4] px-4 last:border-b-0")}>
          <span className="h-3 w-1/3 animate-pulse rounded bg-[#eef0f4]" />
          <span className="h-3 w-1/5 animate-pulse rounded bg-[#f3f4f7]" />
        </div>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cx("block animate-pulse rounded bg-[#eef0f4]", className)} aria-hidden="true" />;
}

const BUTTON_STYLES = {
  primary: "bg-primary text-white hover:bg-primary/90",
  secondary: "bg-[#f1f2f6] text-[#1d2240] hover:bg-[#e8eaf0]",
  outline: "border border-[#dfe2ea] bg-white text-[#1d2240] hover:border-[#c9cdd9] hover:bg-[#fafbfc]",
  ghost: "text-[#6b7285] hover:bg-[#f1f2f6] hover:text-[#1d2240]",
  danger: "bg-red-600 text-white hover:bg-red-700",
  "danger-outline": "border border-red-200 bg-white text-red-600 hover:bg-red-50",
} as const;

export type ButtonVariant = keyof typeof BUTTON_STYLES;

export const buttonClass = (variant: ButtonVariant = "primary", size: "sm" | "md" = "md") =>
  cx(
    "inline-flex flex-none items-center justify-center gap-1.5 rounded-[10px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-8 px-3 text-[0.82rem]" : "h-10 px-4 text-sm",
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
  variant?: ButtonVariant;
  size?: "sm" | "md";
  busy?: boolean;
}) {
  return (
    <button type="button" {...props} disabled={props.disabled || busy} className={cx(buttonClass(variant, size), className)}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export const fieldClass =
  "h-10 w-full rounded-control border border-[#dfe2ea] bg-white px-3 text-[0.95rem] text-[#1d2240] outline-none transition placeholder:text-[#a6adbb] focus:border-primary/60 focus:ring-[3px] focus:ring-primary/15 disabled:bg-[#f8f9fb] disabled:text-[#6b7285]";

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
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1.5 text-[0.8rem] leading-5 text-[#9aa1b1]">{hint}</p> : null}
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
          "w-full appearance-none rounded-control border border-[#dfe2ea] bg-white pr-8 text-[#1d2240] outline-none transition focus:border-primary/60 focus:ring-[3px] focus:ring-primary/15 disabled:bg-[#f8f9fb] disabled:text-[#6b7285]",
          compact ? "h-8 pl-2.5 text-[0.84rem]" : "h-10 pl-3 text-[0.95rem]",
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa1b1]" />
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
        className={cx("relative mt-0.5 h-5 w-9 flex-none rounded-full transition", checked ? "bg-primary" : "bg-[#dcdfe7]")}
      >
        <span
          className={cx(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="mt-0.5 block text-[0.8rem] leading-5 text-[#9aa1b1]">{description}</span> : null}
      </span>
    </label>
  );
}

export function Notice({ kind, children }: { kind: "ok" | "error" | "info"; children: ReactNode }) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={cx(
        "rounded-control border px-3.5 py-2.5 text-sm",
        kind === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-800",
        kind === "error" && "border-red-200 bg-red-50 text-red-700",
        kind === "info" && "border-[#e2e4f5] bg-[#f5f6fd] text-[#3c418f]",
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
  return message.match(/ConvexError: (.*?)(?:\n|$)/)?.[1] ?? message.match(/Uncaught Error: (.*?)(?:\n|$)/)?.[1] ?? "Something went wrong. Try again.";
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
  const rounding = shape === "circle" ? "rounded-full" : "rounded-[8px]";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} style={{ width: size, height: size }} className={cx(rounding, "flex-none object-cover")} />
  ) : (
    <span
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
      className={cx(rounding, "flex flex-none items-center justify-center bg-[#e9eaf6] font-semibold text-[#3c418f]")}
    >
      {initials}
    </span>
  );
}

/** A modal panel, for forms that shouldn't take a page of their own. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-[#0d0f1a]/40" />
      <div className="relative w-full rounded-t-[18px] bg-white shadow-[0_24px_60px_rgba(15,18,40,0.25)] sm:max-w-md sm:rounded-[16px]">
        <div className="border-b border-[#eceef3] px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-[#eceef3] px-5 py-3.5">{footer}</div> : null}
      </div>
    </div>
  );
}
