"use client";
import clsx from "clsx";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/** Native dialogs contain focus, support Escape, and keep the background inert. */
export function Modal({ children, label, className, onClose, focusDialog }: { children: ReactNode; label: string; className?: string; onClose: () => void; focusDialog?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    // Start on the dialog itself, e.g. so a search field doesn't open the phone keyboard.
    if (focusDialog) dialog?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <dialog ref={ref} aria-label={label} tabIndex={-1} className={clsx("modal", className)}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const targets = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
          .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (!first) { e.preventDefault(); e.currentTarget.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}>
      {children}
    </dialog>
  );
}

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
        "touch-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150",
        "hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40",
        active && "bg-primary text-primary-ink hover:bg-primary hover:text-primary-ink",
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
        "touch-target inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "min-h-8 px-2.5 py-1 text-xs" : "min-h-9 px-3.5 py-1.5 text-[13px]",
        variant === "primary" && "bg-primary text-primary-ink hover:opacity-90",
        variant === "secondary" && "border border-line-strong bg-surface-solid text-ink hover:bg-surface-2",
        variant === "ghost" && "text-muted hover:bg-surface-3 hover:text-ink",
        variant === "danger" && "border border-line bg-surface-solid text-danger hover:border-danger/40 hover:bg-danger/5",
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
      className={clsx("inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted", className)}
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

/** Short money for dense rows: $40, $1.2k, $12k. */
export function compactMoney(n: number) {
  if (n < 1000) return `$${Math.round(n)}`;
  const k = n / 1000;
  return `$${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}
