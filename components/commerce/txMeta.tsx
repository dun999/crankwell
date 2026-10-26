import { BadgeCheck, CalendarCheck, CalendarX2, FileX2, type LucideIcon, Package, RotateCcw, Wrench } from "lucide-react";
import type { ActionKind, TxStatus } from "@/lib/commerce/types";

const STATUS: Record<TxStatus, { label: string; tone: "ok" | "warn" | "muted" | "danger" | "accent" }> = {
  CREATED: { label: "Awaiting approval", tone: "muted" },
  APPROVED: { label: "Approved", tone: "accent" },
  COMPLETED: { label: "Paid", tone: "ok" },
  AUTHORIZED: { label: "Deposit held", tone: "accent" },
  CAPTURED: { label: "Deposit captured", tone: "ok" },
  VOIDED: { label: "Released", tone: "muted" },
  REFUNDED: { label: "Refunded", tone: "warn" },
  REVERSED: { label: "Reversed", tone: "danger" },
  DENIED: { label: "Denied", tone: "danger" },
  FAILED: { label: "Failed", tone: "danger" },
  DRAFT: { label: "Draft", tone: "muted" },
  SENT: { label: "Invoice sent", tone: "accent" },
  UNPAID: { label: "Unpaid", tone: "warn" },
  PAID: { label: "Paid", tone: "ok" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

export function StatusPill({ status, press }: { status: TxStatus; press?: boolean }) {
  const s = STATUS[status];
  const color = { ok: "var(--ok)", warn: "var(--warn)", muted: "var(--muted)", danger: "var(--danger)", accent: "var(--accent)" }[s.tone];
  return (
    <span className={press ? "stamp stamp-press" : "stamp"} style={{ color, background: `color-mix(in srgb, ${color} 7%, transparent)` }}>
      {s.label}
    </span>
  );
}

export const KIND = {
  parts: { icon: Package, label: "Parts order · PayPal Orders v2", short: "Parts · Orders v2 capture" },
  shop_deposit: { icon: CalendarCheck, label: "Shop reservation · Orders + Payments v2", short: "Shop deposit · authorize → capture/void" },
  technician_invoice: { icon: Wrench, label: "Technician visit · Invoicing v2", short: "Technician · Invoicing v2" },
};

export const ACTION_ICON: Record<ActionKind, LucideIcon> = {
  parts: Package,
  shop_deposit: CalendarCheck,
  technician_invoice: Wrench,
  refund: RotateCcw,
  check_in: CalendarCheck,
  cancel_reservation: CalendarX2,
  cancel_invoice: FileX2,
  complete_job: BadgeCheck,
};
