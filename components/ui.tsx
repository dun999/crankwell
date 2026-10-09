"use client";
import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function IconButton({
  active,
  className,
  label,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={clsx(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition",
        "hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40",
        active && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:brightness-110",
        variant === "secondary" && "border border-line bg-surface-solid text-ink hover:border-line-strong",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "border border-line bg-surface-solid text-danger hover:border-danger/40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Chip({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={clsx("inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted", className)}
      style={color ? { color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` } : undefined}
    >
      {children}
    </span>
  );
}

export function Dots({ value, max = 5, color = "var(--accent)" }: { value: number; max?: number; color?: string }) {
  return (
    <span className="inline-flex gap-1" aria-label={`${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className="h-1.5 w-4 rounded-full" style={{ background: i < value ? color : "var(--border-strong)" }} />
      ))}
    </span>
  );
}

export function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });
}
