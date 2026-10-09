"use client";
import clsx from "clsx";
import { CalendarCheck, ExternalLink, Package, Receipt, RefreshCw, Webhook, Wrench, X } from "lucide-react";
import { useEffect, useState } from "react";
import { commerce } from "@/lib/commerce/client";
import type { Transaction, TxStatus } from "@/lib/commerce/types";
import { useOrders } from "@/lib/store/orders";
import { Button, IconButton, money } from "../ui";

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
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {s.label}
    </span>
  );
}

const KIND = {
  parts: { icon: Package, label: "Parts order · PayPal Orders v2" },
  shop_deposit: { icon: CalendarCheck, label: "Shop reservation · Orders + Payments v2" },
  technician_invoice: { icon: Wrench, label: "Technician visit · Invoicing v2" },
};

function TxCard({ tx }: { tx: Transaction }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const K = KIND[tx.kind];
  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="rounded-2xl border border-line bg-surface-solid/70 p-3">
      <div className="flex items-start gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
          <K.icon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-sm font-semibold">{tx.title}</div>
            <div className="text-sm font-semibold tabular-nums">{money(Number(tx.amount))}</div>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-muted">{K.label}</span>
            <StatusPill status={tx.status} />
          </div>
          {tx.detail && <div className="mt-1 text-xs text-muted">{tx.detail}</div>}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-muted">
        {tx.paypal.orderId && (<><dt>order</dt><dd className="truncate">{tx.paypal.orderId}</dd></>)}
        {tx.paypal.captureId && (<><dt>capture</dt><dd className="truncate">{tx.paypal.captureId}</dd></>)}
        {tx.paypal.authorizationId && (<><dt>auth</dt><dd className="truncate">{tx.paypal.authorizationId}</dd></>)}
        {tx.paypal.refundId && (<><dt>refund</dt><dd className="truncate">{tx.paypal.refundId}</dd></>)}
        {tx.paypal.invoiceId && (<><dt>invoice</dt><dd className="truncate">{tx.paypal.invoiceNumber} · {tx.paypal.invoiceId}</dd></>)}
      </dl>
      <ol className="mt-2 space-y-1 border-l border-line pl-3">
        {tx.events.slice(-5).map((e, i) => (
          <li key={i} className="relative text-[11px]">
            <span className={clsx("absolute -left-[15.5px] top-1 h-2 w-2 rounded-full", e.source === "paypal-webhook" ? "bg-accent" : "bg-[var(--border-strong)]")} />
            <span className="text-ink/80">{e.type}</span>
            {e.source === "paypal-webhook" && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-accent">
                <Webhook size={10} /> webhook
              </span>
            )}
            <span className="ml-1 text-faint">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            {e.note && <div className="text-faint">{e.note}</div>}
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tx.kind === "parts" && tx.status === "COMPLETED" && (
          <Button size="sm" variant="danger" disabled={!!busy} onClick={() => run("refund", () => commerce.refund(tx.id))}>
            {busy === "refund" ? "Refunding…" : "Cancel & refund"}
          </Button>
        )}
        {tx.kind === "shop_deposit" && tx.status === "AUTHORIZED" && (
          <>
            <Button size="sm" variant="primary" disabled={!!busy} onClick={() => run("capture", () => commerce.captureDeposit(tx.id))}>
              {busy === "capture" ? "Capturing…" : "I checked in (capture)"}
            </Button>
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run("void", () => commerce.voidDeposit(tx.id))}>
              {busy === "void" ? "Releasing…" : "Cancel (void hold)"}
            </Button>
          </>
        )}
        {tx.kind === "shop_deposit" && tx.status === "CAPTURED" && (
          <Button size="sm" variant="danger" disabled={!!busy} onClick={() => run("refund", () => commerce.refund(tx.id))}>
            {busy === "refund" ? "Refunding…" : "Refund deposit"}
          </Button>
        )}
        {tx.kind === "technician_invoice" && ["SENT", "UNPAID"].includes(tx.status) && (
          <>
            {tx.paypal.payerViewUrl && (
              <a href={tx.paypal.payerViewUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-xl bg-[#ffc439] px-2.5 text-xs font-semibold text-[#111]">
                Pay invoice <ExternalLink size={12} />
              </a>
            )}
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("refresh", () => commerce.refreshInvoice(tx.id))}>
              <RefreshCw size={12} className={busy === "refresh" ? "animate-spin" : ""} /> Refresh
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("cancel", () => commerce.cancelInvoice(tx.id))}>
              Cancel invoice
            </Button>
          </>
        )}
      </div>
      {err && <div className="mt-1.5 text-xs text-danger">{err}</div>}
    </li>
  );
}

export function OrdersDrawer() {
  const open = useOrders((s) => s.open);
  const items = useOrders((s) => s.items);
  const setOpen = useOrders((s) => s.setOpen);
  const refresh = useOrders((s) => s.refresh);
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
      <aside className="glass m-3 flex w-full max-w-md flex-col overflow-hidden rounded-3xl" onClick={(e) => e.stopPropagation()} aria-label="Orders and bookings">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Receipt size={18} className="text-muted" />
          <div>
            <div className="text-sm font-semibold">Orders & bookings</div>
            <div className="text-[11px] text-muted">PayPal sandbox · statuses update live from webhooks</div>
          </div>
          <IconButton label="Close" className="ml-auto" onClick={() => setOpen(false)}>
            <X size={16} />
          </IconButton>
        </header>
        <ul className="scroll-thin flex-1 space-y-2.5 overflow-y-auto p-3">
          {items.map((tx) => (
            <TxCard key={tx.id} tx={tx} />
          ))}
          {!items.length && (
            <li className="px-4 py-12 text-center text-sm text-muted">
              Nothing yet. Ask the mechanic about a problem. Parts, shop reservations and technician visits you pay for with PayPal show up here.
            </li>
          )}
        </ul>
      </aside>
    </div>
  );
}

export function OrderToast() {
  const flash = useOrders((s) => s.flash);
  const setOpen = useOrders((s) => s.setOpen);
  const [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setDismissed(flash.nonce), 5000);
    return () => clearTimeout(t);
  }, [flash]);
  if (!flash || dismissed === flash.nonce) return null;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="glass fixed left-1/2 top-20 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl px-4 py-2.5 text-sm"
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-[#ffc439] text-[11px] font-bold text-[#003087]">P</span>
      {flash.text}
    </button>
  );
}
