"use client";
import { Loader2, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { UiEvent } from "@/lib/agent/events";
import { actions } from "@/lib/commerce/client";
import { CHANGE_COPY, isChange } from "@/lib/commerce/ops";
import type { Action } from "@/lib/commerce/types";
import { useOrders } from "@/lib/store/orders";
import { ActionSummary } from "../commerce/ActionSummary";
import { PayPalPay } from "../commerce/PayPalRoot";
import { Button } from "../ui";
import { Receipt } from "./Checkout";

type ActionEvent = Extract<UiEvent, { type: "action" }>;

const TITLE = {
  parts: "Ready to pay",
  shop_deposit: "Ready to hold your slot",
  technician_invoice: "Ready to book",
};

/**
 * What the mechanic prepared, waiting for the user's tap. One tap pays with saved PayPal (Vault);
 * without it, the PayPal popup approves it and can save PayPal for next time.
 */
export function ConfirmCard({ e }: { e: ActionEvent }) {
  const [action, setAction] = useState<Action>(e.action);
  const [blocker, setBlocker] = useState<string | null>(e.oneTap ? null : "");
  const [save, setSave] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wallet = useOrders((s) => s.wallet);

  // The card may be rendered again from saved chat history, so ask the server where it stands.
  useEffect(() => {
    let live = true;
    actions
      .status(e.action.id)
      .then((s) => {
        if (!live) return;
        setAction(s.action);
        setBlocker(s.oneTapBlocker ?? null);
        if (s.wallet?.email) setEmail((v) => v || s.wallet!.email!);
      })
      .catch(() => {});
    if (e.action.kind === "technician_invoice")
      fetch("/api/wallet")
        .then((r) => r.json())
        .then((w) => live && w.invoiceEmail && setEmail((v) => v || w.invoiceEmail))
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [e.action.id, e.action.kind, wallet]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const confirm = () => run(async () => setAction((await actions.confirm(action.id, email || undefined)).action));

  const oneTap = action.kind !== "technician_invoice" && blocker === null;
  const change = isChange(action.kind) ? CHANGE_COPY[action.kind] : null;
  const title = change ? change.ask : TITLE[action.kind as keyof typeof TITLE];

  if (action.status === "confirmed") return <Receipt action={action} />;

  return (
    <div className="rise overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <ShieldCheck size={14} className="shrink-0 text-accent" />
        <span className="text-[13px] font-semibold">{action.status === "pending" || action.status === "confirming" ? title : change ? "Closed" : "Checkout closed"}</span>
        <span className="sandbox-chip ml-auto">PayPal sandbox</span>
      </div>
      <div className="space-y-3 p-3.5">
        <ActionSummary action={action} compact />
        {action.status === "expired" || action.status === "cancelled" ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
            {change
              ? action.status === "expired"
                ? "This expired after 15 minutes. The order is unchanged."
                : "Dismissed. The order is unchanged."
              : action.status === "expired"
                ? "This offer expired after 15 minutes. Ask again and I'll prepare it fresh."
                : "Cancelled. Nothing was charged."}
          </p>
        ) : change ? (
          <div className="space-y-1.5">
            <Button variant={action.kind === "check_in" ? "primary" : "danger"} className="h-11 w-full text-[14px]" disabled={busy} onClick={confirm}>
              {busy && <Loader2 size={15} className="animate-spin" />} {change.button}
              {action.kind === "refund" || action.kind === "check_in" ? ` · $${Number(action.amount).toFixed(2)}` : ""}
            </Button>
            <p className="text-center text-[11px] text-muted">Done with PayPal right away. Nothing changes until you tap.</p>
          </div>
        ) : action.kind === "technician_invoice" ? (
          <div className="space-y-2">
            <label className="field block">
              <span className="mb-1 block text-[11px] text-muted">Send the PayPal invoice to</span>
              <input type="email" value={email} onChange={(x) => setEmail(x.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-line bg-surface-solid px-3 py-2 text-sm" />
            </label>
            <Button variant="primary" className="w-full" disabled={busy || !/\S+@\S+\.\S+/.test(email)} onClick={confirm}>
              {busy && <Loader2 size={14} className="animate-spin" />} Confirm · send PayPal invoice
            </Button>
          </div>
        ) : oneTap ? (
          <div className="space-y-1.5">
            <Button variant="primary" className="h-11 w-full text-[14px]" disabled={busy} onClick={confirm}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />} Confirm · pay ${Number(action.amount).toFixed(2)}
            </Button>
            <p className="text-center text-[11px] text-muted">One tap with your saved PayPal{wallet?.email ? ` (${wallet.email})` : ""}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {blocker && <p className="text-[11.5px] text-muted">{blocker}</p>}
            <PayPalPay
              createOrder={() => actions.approve(action.id, save)}
              onApproved={async (orderId) => {
                const r = await actions.complete(action.id, orderId);
                if (r.action) setAction(r.action);
              }}
            />
            <label className="flex items-start gap-2 text-[11.5px] text-muted">
              <input type="checkbox" checked={save} onChange={(x) => setSave(x.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span>Save PayPal so next time it&apos;s one tap. You can remove it in Orders.</span>
            </label>
            <p className="text-[11px] text-faint">Test payment: log in with a PayPal sandbox buyer account. No real money moves.</p>
          </div>
        )}
        {action.status === "pending" && (
          <button type="button" disabled={busy} className="text-[11.5px] text-muted hover:text-ink" onClick={() => run(async () => setAction(await actions.cancel(action.id)))}>
            Not now
          </button>
        )}
        {(err || action.error) && <p className="text-xs text-danger">{err ?? action.error}</p>}
      </div>
    </div>
  );
}
