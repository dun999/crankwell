import { CalendarCheck, Package, Wrench } from "lucide-react";
import type { TxStatus } from "@/lib/commerce/types";

const STATUS: Record<TxStatus, { label: string; tone: "ok" | "warn" | "muted" | "danger" | "accent" }> = {
  CREATED: { label: "Awaiting approval", tone: "muted" },
  APPROVED: { label: "Approved", tone: "accent" },
  COMPLETED: { label: "Paid", tone: "ok" },
  AUTHORIZED: { label: "Deposit held", tone: "accent" },
  CAPTURED: { label: "Deposit captured", tone: "ok" },
  VOIDED: { label: "Released", tone: "muted" },
  REFUNDED: { label: "Refunded", tone: "warn" },
  DENIED: { label: "Denied", tone: "danger" },
  FAILED: { label: "Failed", tone: "danger" },
  DRAFT: { label: "Draft", tone: "muted" },
  SENT: { label: "Invoice sent", tone: "accent" },
  UNPAID: { label: "Unpaid", tone: "warn" },
  PAID: { label: "Paid", tone: "ok" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

export function StatusPill({ status }: { status: TxStatus }) {
  const s = STATUS[status];
  const color = { ok: "var(--ok)", warn: "var(--warn)", muted: "var(--muted)", danger: "var(--danger)", accent: "var(--accent)" }[s.tone];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5" style={{ color, background: `color-mix(in srgb, ${color} 11%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {s.label}
    </span>
  );
}

export const KIND = {
  parts: { icon: Package, label: "Parts order · PayPal Orders v2", short: "Parts · Orders v2 capture" },
  shop_deposit: { icon: CalendarCheck, label: "Shop reservation · Orders + Payments v2", short: "Shop deposit · authorize → capture/void" },
  technician_invoice: { icon: Wrench, label: "Technician visit · Invoicing v2", short: "Technician · Invoicing v2" },
};
