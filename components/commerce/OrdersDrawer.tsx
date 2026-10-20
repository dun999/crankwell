"use client";
import clsx from "clsx";
import { ExternalLink, Receipt, RefreshCw, Webhook, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { commerce } from "@/lib/commerce/client";
import type { Transaction } from "@/lib/commerce/types";
import { useOrders } from "@/lib/store/orders";
import { Button, IconButton, Modal, money } from "../ui";
import { KIND, StatusPill } from "./txMeta";

const OrdersLedger = dynamic(() => import("./OrdersLedger"), {
  ssr: false,
  loading: () => <p role="status" className="p-4 text-sm text-muted">Loading ledger…</p>,
});

function TxDetail({ tx }: { tx: Transaction }) {
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
  const ids = [
    ["Order", tx.paypal.orderId],
    ["Capture", tx.paypal.captureId],
    ["Authorization", tx.paypal.authorizationId],
    ["Refund", tx.paypal.refundId],
    ["Invoice", tx.paypal.invoiceId && `${tx.paypal.invoiceNumber} · ${tx.paypal.invoiceId}`],
  ].filter((r): r is [string, string] => Boolean(r[1]));
  return (
    <article aria-label={`${tx.title} details`} className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-3 text-ink">
          <K.icon size={18} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.01em]">{tx.title}</h3>
          <div className="text-[11px] text-muted">{K.label}</div>
        </div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold tabular-nums tracking-[-0.02em]">{money(Number(tx.amount))}</div>
        <StatusPill status={tx.status} />
      </div>
      {tx.detail && <p className="text-xs leading-relaxed text-muted">{tx.detail}</p>}

      <div className="flex flex-wrap gap-1.5">
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
              <a href={tx.paypal.payerViewUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-[#ffc439] px-3 text-xs font-semibold text-[#111]">
                Pay invoice <ExternalLink size={12} />
              </a>
            )}
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run("refresh", () => commerce.refreshInvoice(tx.id))}>
              <RefreshCw size={12} className={busy === "refresh" ? "animate-spin" : ""} /> Refresh
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("cancel", () => commerce.cancelInvoice(tx.id))}>
              Cancel invoice
            </Button>
          </>
        )}
      </div>
      {err && <div className="text-xs text-danger">{err}</div>}

      {!!ids.length && (
        <section>
          <h4 className="eyebrow mb-1.5">PayPal references</h4>
          <dl className="divide-y divide-[var(--border)] rounded-xl border border-line">
            {ids.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="text-[11px] text-muted">{k}</dt>
                <dd className="min-w-0 truncate font-mono text-[11px]">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section>
        <h4 className="eyebrow mb-2">Timeline</h4>
        <ol className="space-y-2.5 border-l border-line pl-4">
          {[...tx.events].reverse().map((e, i) => (
            <li key={i} className="relative text-xs">
              <span className={clsx("absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-[var(--surface-solid)]", e.source === "paypal-webhook" ? "bg-accent" : "bg-[var(--border-strong)]")} />
              <div className="flex flex-wrap items-center gap-x-1.5">
                <span className="font-medium text-ink/90">{e.type}</span>
                {e.source === "paypal-webhook" && (
                  <span className="inline-flex items-center gap-0.5 text-[11px] text-accent">
                    <Webhook size={11} /> webhook
                  </span>
                )}
                <span className="text-[11px] text-faint">{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              </div>
              {e.note && <div className="mt-0.5 text-faint">{e.note}</div>}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

function totals(items: Transaction[]) {
  const sum = (pred: (t: Transaction) => boolean) => {
    const hits = items.filter(pred);
    return { amount: hits.reduce((n, t) => n + Number(t.amount), 0), count: hits.length };
  };
  return [
    { label: "Paid", ...sum((t) => t.status === "COMPLETED" || t.status === "CAPTURED" || t.status === "PAID"), tone: "var(--ok)" },
    { label: "On hold", ...sum((t) => t.status === "AUTHORIZED"), tone: "var(--accent)" },
    { label: "Awaiting payment", ...sum((t) => ["CREATED", "APPROVED", "SENT", "UNPAID"].includes(t.status)), tone: "var(--warn)" },
    { label: "Refunded", ...sum((t) => t.status === "REFUNDED"), tone: "var(--muted)" },
  ];
}

export function OrdersDrawer() {
  const open = useOrders((s) => s.open);
  const items = useOrders((s) => s.items);
  const setOpen = useOrders((s) => s.setOpen);
  const refresh = useOrders((s) => s.refresh);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);
  const stats = useMemo(() => totals(items), [items]);
  if (!open) return null;
  const selected = items.find((t) => t.id === picked) ?? items[0];
  return (
    <Modal label="Orders and bookings" className="orders-dialog" onClose={() => setOpen(false)}>
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-surface-3 text-ink"><Receipt size={18} strokeWidth={1.75} /></span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Orders & bookings</h2>
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ffc439]" /> PayPal sandbox · statuses update live from PayPal
          </div>
        </div>
        <IconButton label="Close orders" className="ml-auto" onClick={() => setOpen(false)}>
          <X size={17} />
        </IconButton>
      </header>
      {items.length ? (
        <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto md:overflow-hidden">
          <dl className="grid shrink-0 grid-cols-2 gap-2 border-b border-line p-3 md:grid-cols-4 md:px-5">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl border border-line bg-surface-2 px-3.5 py-2.5">
                <dt className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.tone }} /> {s.label}
                </dt>
                <dd className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-lg font-semibold tabular-nums tracking-[-0.02em]">{money(s.amount)}</span>
                  <span className="text-[11px] text-faint">{s.count} {s.count === 1 ? "item" : "items"}</span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div className="h-[280px] shrink-0 md:h-auto md:min-w-0 md:flex-1">
              <OrdersLedger items={items} selectedId={selected?.id ?? null} onSelect={setPicked} />
            </div>
            {selected && (
              <aside aria-label="Selected transaction" className="scroll-thin border-t border-line p-4 md:w-[340px] md:shrink-0 md:overflow-y-auto md:border-l md:border-t-0">
                <TxDetail key={selected.id} tx={selected} />
              </aside>
            )}
          </div>
        </div>
      ) : (
        <div className="grid flex-1 place-content-center gap-2 px-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-3 text-muted"><Receipt size={22} strokeWidth={1.5} /></span>
          <p className="text-sm font-medium">No orders yet</p>
          <p className="max-w-sm text-[13px] text-muted">
            Ask the mechanic about a problem. Parts, shop reservations and technician visits you pay for with PayPal show up here.
          </p>
        </div>
      )}
    </Modal>
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
      className="glass rise fixed left-1/2 top-20 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-2xl py-2 pl-2 pr-4 text-[13px] font-medium"
    >
      <span className="grid h-7 w-7 place-items-center rounded-xl bg-[#ffc439] text-[11px] font-bold text-[#003087]">P</span>
      {flash.text}
    </button>
  );
}
