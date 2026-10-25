"use client";
import { CheckCircle2, Hand, Loader2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { UiEvent } from "@/lib/agent/events";
import { actions } from "@/lib/commerce/client";
import type { Action } from "@/lib/commerce/types";
import { useOrders } from "@/lib/store/orders";
import { ActionSummary } from "../commerce/ActionSummary";
import { PayPalPay } from "../commerce/PayPalRoot";
import { Button } from "../ui";

type ActionEvent = Extract<UiEvent, { type: "action" }>;

const DONE = {
  parts: "Paid with PayPal",
  shop_deposit: "Deposit held with PayPal",
  technician_invoice: "PayPal invoice sent",
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
  const openOrders = useOrders((s) => s.setOpen);

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
      fetch("/api/config")
        .then((r) => r.json())
        .then((c) => live && c.invoiceRecipient && setEmail((v) => v || c.invoiceRecipient))
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

  return (
    <div className="rise overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2/60 px-3.5 py-2.5">
        <Hand size={14} className="text-accent" />
        <span className="text-[13px] font-semibold">{action.status === "confirmed" ? "Done" : "Ready when you are"}</span>
        <span className="ml-auto text-[11px] text-muted">Prepared by your mechanic</span>
      </div>
      <div className="space-y-3 p-3.5">
        <ActionSummary action={action} compact />
        {action.status === "confirmed" ? (
          <div className="rounded-xl border border-ok/30 bg-ok/10 px-3 py-2.5 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-ok">
              <CheckCircle2 size={14} /> {DONE[action.kind]}
              {action.via === "vault" && <span className="font-normal text-muted">· one tap</span>}
            </div>
            <button type="button" className="mt-1.5 font-medium text-accent" onClick={() => openOrders(true)}>
              View in Orders
            </button>
          </div>
        ) : action.status === "expired" || action.status === "cancelled" ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
            {action.status === "expired" ? "This offer expired after 15 minutes. Ask again and I'll prepare it fresh." : "Cancelled. Nothing was charged."}
          </p>
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
