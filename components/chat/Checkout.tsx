"use client";
import clsx from "clsx";
import { AlertTriangle, Check, Copy, CreditCard, ExternalLink, Loader2, Webhook } from "lucide-react";
import { useEffect, useState } from "react";
import { actions, type ActionStatus } from "@/lib/commerce/client";
import { CHANGE_COPY, isChange } from "@/lib/commerce/ops";
import type { Action } from "@/lib/commerce/types";
import { useChat, type Block } from "@/lib/store/chat";
import { useOrders } from "@/lib/store/orders";
import { StatusPill } from "../commerce/txMeta";
import { Button } from "../ui";

const STEPS = ["Checking price and stock", "Preparing your PayPal sandbox checkout", "Ready for you to confirm"];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// One request per Buy, even when React mounts the card twice (Strict Mode, remounts while scrolling).
const inflight = new Map<string, Promise<ActionStatus>>();

/** Buy was tapped: the mechanic prices it on the server, then the card turns into the checkout. */
export function PreparingCheckout({ b, msgId, idx }: { b: Extract<Block, { kind: "checkout" }>; msgId: string; idx: number }) {
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const key = `${msgId}:${idx}:${attempt}`;
    const started = Date.now();
    let p = inflight.get(key);
    if (!p) inflight.set(key, (p = actions.prepare(b.sku, b.partId)));
    const t = setTimeout(() => live && setStep(1), 700);
    p.then(async (r) => {
      // Long enough to read what is happening, short enough not to feel slow.
      await wait(Math.max(0, 1500 - (Date.now() - started)));
      if (!live) return;
      setStep(STEPS.length);
      await wait(550);
      if (!live) return;
      inflight.delete(key);
      useChat.getState().replaceBlock(msgId, idx, { kind: "ui", event: { type: "action", action: r.action, oneTap: !r.oneTapBlocker } });
    }).catch((e: Error) => {
      inflight.delete(key);
      if (live) setErr(e.message);
    });
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [b.sku, b.partId, msgId, idx, attempt]);

  return (
    <div className="rise overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-[var(--shadow-sm)]" aria-busy={!err}>
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <CreditCard size={14} className="shrink-0 text-accent" />
        <span className="text-[13px] font-semibold">Preparing your transaction</span>
        <span className="sandbox-chip ml-auto">PayPal sandbox</span>
      </div>
      <div className="p-3">
        <p className="text-xs text-muted">{b.label}</p>
        <ol className="mt-2.5 space-y-2">
          {STEPS.map((s, i) => {
            const state = err && i === step ? "error" : i < step ? "done" : i === step ? "active" : "todo";
            return (
              <li key={s} className="flex items-center gap-2 text-[12.5px]">
                <span
                  className={clsx(
                    "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors duration-300",
                    state === "done" && "border-ok bg-ok text-white",
                    state === "active" && "border-accent text-accent",
                    state === "error" && "border-danger text-danger",
                    state === "todo" && "border-line-strong",
                  )}
                >
                  {state === "done" ? <Check size={11} strokeWidth={3} /> : state === "active" ? <Loader2 size={11} className="animate-spin" /> : state === "error" ? <AlertTriangle size={10} /> : null}
                </span>
                <span className={clsx(state === "todo" ? "text-faint" : state === "active" ? "font-medium text-ink" : "text-muted")}>{s}</span>
              </li>
            );
          })}
        </ol>
        <div className="prep-bar mt-3" aria-hidden>
          <span style={{ width: `${(Math.min(step + (err ? 0 : 0.5), STEPS.length) / STEPS.length) * 100}%` }} />
        </div>
        {err && (
          <div className="mt-3 flex items-center gap-2 text-xs text-danger">
            <span className="min-w-0 flex-1">{err}</span>
            <Button size="sm" onClick={() => (setErr(null), setStep(0), setAttempt((a) => a + 1))}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

const DONE = { parts: "Payment complete", shop_deposit: "Deposit held", technician_invoice: "Invoice sent" };
const VIA = { vault: "Paid with saved PayPal in one tap", approval: "Approved in PayPal", invoice: "Sent with PayPal Invoicing", change: "Done with PayPal from the chat" };
const fmt = (v: string) => `$${Number(v).toFixed(2)}`;

/** The receipt once PayPal has it: invoice details, PayPal references and the live transaction status. */
export function Receipt({ action }: { action: Action }) {
  const tx = useOrders((s) => (action.txId ? s.items.find((t) => t.id === action.txId) : undefined));
  const openOrders = useOrders((s) => s.setOpen);
  useEffect(() => {
    if (action.txId && !tx) void useOrders.getState().refresh();
  }, [action.txId, tx]);

  const when = new Date(action.confirmedAt ?? tx?.createdAt ?? action.createdAt);
  const number = tx?.paypal.invoiceNumber ?? (tx ? `CW-${tx.id.replace(/^tx_/, "").slice(0, 8).toUpperCase()}` : null);
  const refs = (
    [
      ["PayPal order", tx?.paypal.orderId],
      ["Capture", tx?.paypal.captureId],
      ["Authorization", tx?.paypal.authorizationId],
      ["Refund", tx?.paypal.refundId],
      ["PayPal invoice", tx?.paypal.invoiceId],
    ] satisfies [string, string | undefined][]
  ).flatMap(([k, v]) => (v ? [[k, v] as const] : []));
  const change = isChange(action.kind) ? CHANGE_COPY[action.kind] : null;
  const total = change ? change.total : action.kind === "shop_deposit" ? "Held on PayPal" : action.kind === "technician_invoice" ? "Invoice total" : "Total paid";

  return (
    <div className="rise overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2.5 px-3.5 pb-3 pt-3.5">
        <span className="receipt-check grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ok text-white">
          <Check size={18} strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold leading-tight">{change ? change.done : DONE[action.kind as keyof typeof DONE]}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted">{action.via ? VIA[action.via] : "PayPal"} · sandbox</div>
        </div>
        {tx && <StatusPill status={tx.status} press />}
      </div>

      <div className="receipt-body mx-3.5 border-t border-dashed border-line-strong">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 py-3">
          <div>
            <dt className="fig">{change ? "Order ref" : action.kind === "technician_invoice" ? "PayPal invoice" : "Invoice no."}</dt>
            <dd className="mono mt-0.5 text-[12px]">{number ?? "…"}</dd>
          </div>
          <div>
            <dt className="fig">Date</dt>
            <dd className="mono mt-0.5 text-[12px]">{when.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</dd>
          </div>
          <div className="col-span-2 min-w-0">
            <dt className="fig">Item</dt>
            <dd className="mt-0.5 text-[12.5px] font-medium leading-snug">{action.title}</dd>
          </div>
          {tx?.paypal.payerEmail && (
            <div className="col-span-2 min-w-0">
              <dt className="fig">{change ? "PayPal account" : action.kind === "technician_invoice" ? "Sent to" : "Paid by"}</dt>
              <dd className="mt-0.5 truncate text-[12px]">{tx.paypal.payerEmail}</dd>
            </div>
          )}
        </dl>

        <dl className="space-y-1.5 border-t border-line py-3 text-[12.5px]">
          {action.lines.map((l) => (
            <div key={l.label} className="flex justify-between gap-3">
              <dt className="min-w-0 text-muted">{l.label}</dt>
              <dd className="num shrink-0">{fmt(l.amount)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 border-t border-line pt-2 text-[13.5px] font-semibold">
            <dt>{total}</dt>
            <dd className="num">{fmt(action.amount)} USD</dd>
          </div>
        </dl>

        {refs.length > 0 && (
          <dl className="space-y-1 border-t border-line py-2.5">
            {refs.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-[11px]">
                <dt className="w-[92px] shrink-0 text-muted">{k}</dt>
                <dd className="mono min-w-0 flex-1 truncate">{v}</dd>
                <CopyButton value={v} label={k} />
              </div>
            ))}
          </dl>
        )}

        {tx && (
          <section className="border-t border-line py-3">
            <div className="mb-2 flex items-center gap-1.5">
              <h4 className="fig">Transaction status</h4>
              <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-muted">
                <span className="live-dot" /> Live
              </span>
            </div>
            <ol className="ml-1 space-y-2 border-l border-line pl-3.5">
              {tx.events.map((e, i) => {
                // The current state is the newest event that moved it; late webhooks only confirm.
                const latest = i === tx.events.findLastIndex((x) => !x.late);
                return (
                  <li key={`${e.at}-${i}`} className="rise relative text-[11.5px]">
                    <span
                      className={clsx(
                        "absolute -left-[19px] top-[4px] h-2 w-2 rounded-full ring-[3px] ring-[var(--surface-solid)]",
                        latest ? "bg-ok" : e.source === "paypal-webhook" ? "bg-accent" : "bg-[var(--border-strong)]",
                      )}
                    />
                    <div className="flex items-baseline gap-1.5">
                      <span className="min-w-0 flex-1 break-words">
                        <span className={latest ? "font-semibold text-ink" : "font-medium text-ink/85"}>{e.type}</span>
                        {e.source === "paypal-webhook" && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 whitespace-nowrap text-[10.5px] text-accent">
                            <Webhook size={10} /> webhook
                          </span>
                        )}
                      </span>
                      <span className="mono shrink-0 text-[10.5px] text-faint">{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                    </div>
                    {e.note && <div className={clsx("truncate", e.late ? "text-faint/80" : "text-faint")}>{e.note}</div>}
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/60 px-3.5 py-2.5">
        <Button size="sm" onClick={() => openOrders(true)}>
          View in Orders
        </Button>
        {tx?.paypal.payerViewUrl && (
          <a href={tx.paypal.payerViewUrl} target="_blank" rel="noreferrer" className="touch-target inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-accent hover:underline">
            Open PayPal invoice <ExternalLink size={12} />
          </a>
        )}
        <span className="ml-auto text-[10.5px] text-faint">Test payment · no real money</span>
      </div>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={done ? "Copied" : "Copy"}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-ink"
      onClick={() =>
        navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        })
      }
    >
      {done ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
    </button>
  );
}
