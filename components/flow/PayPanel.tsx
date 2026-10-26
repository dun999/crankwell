"use client";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CHANGE_COPY, isChange } from "@/lib/commerce/ops";
import type { Action, WalletInfo } from "@/lib/commerce/types";
import { sessionReady } from "@/lib/session";
import { Button } from "../ui";

interface Status {
  action: Action;
  mine: boolean;
  wallet?: WalletInfo | null;
  oneTapBlocker?: string | null;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  await sessionReady();
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`);
  return data as T;
}

/**
 * Checkout for an action prepared in Claude (or the app). Works on any device through PayPal approval;
 * in the browser paired with Claude it also offers one tap with saved PayPal.
 */
export function PayPanel({ initial, notice }: { initial: Action; notice?: { kind: "done" | "cancelled" | "error"; text?: string } }) {
  const [s, setS] = useState<Status>({ action: initial, mine: false });
  const [save, setSave] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(notice?.kind === "error" ? (notice.text ?? "Payment failed") : null);

  useEffect(() => {
    const ctrl = new AbortController();
    sessionReady()
      .then(() => fetch(`/api/actions/${initial.id}`, { signal: ctrl.signal }))
      .then((r) => r.json())
      .then((d: Status) => {
        if (!d.action) return;
        setS(d);
        if (d.wallet?.email) setEmail((v) => v || d.wallet!.email!);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [initial.id]);

  const a = s.action;
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const change = isChange(a.kind) ? CHANGE_COPY[a.kind] : null;

  if (a.status === "confirmed" && change) {
    return (
      <div className="mt-5 rounded-2xl border border-ok/30 bg-ok/8 p-4">
        <div className="flex items-center gap-2 font-semibold text-ok">
          <CheckCircle2 size={18} /> {change.done}
        </div>
        <p className="mt-1.5 text-sm text-muted">{change.status} You can close this tab and go back to Claude.</p>
      </div>
    );
  }
  if (a.status === "confirmed") {
    return (
      <div className="mt-5 rounded-2xl border border-ok/30 bg-ok/8 p-4">
        <div className="flex items-center gap-2 font-semibold text-ok">
          <CheckCircle2 size={18} /> {a.kind === "technician_invoice" ? "Invoice sent" : a.kind === "shop_deposit" ? "Deposit held" : "Paid"} with PayPal
        </div>
        <p className="mt-1.5 text-sm text-muted">
          {a.kind === "technician_invoice" ? "Check your email for the PayPal invoice. Pay it to confirm the visit." : "You can close this tab and go back to Claude. It sees the update."}
        </p>
        <Link href={a.caseId ? `/app?case=${a.caseId}` : "/app"} className="mt-3 inline-block text-sm font-medium text-accent">
          Open in Crankwell →
        </Link>
      </div>
    );
  }
  if (a.status === "expired" || a.status === "cancelled") {
    return (
      <div className="mt-5 flex items-start gap-2 rounded-2xl border border-line bg-surface-2 p-4 text-sm">
        <XCircle size={16} className="mt-0.5 shrink-0 text-muted" />
        {change
          ? "This closed without changes to the order."
          : a.status === "expired"
            ? "This offer expired after 15 minutes. Ask Claude to prepare it again."
            : "This was cancelled. Nothing was charged."}
      </div>
    );
  }

  const oneTap = s.mine && a.kind !== "technician_invoice" && s.wallet && !s.oneTapBlocker;

  return (
    <div className="mt-5 space-y-3">
      {notice?.kind === "cancelled" && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">PayPal checkout was cancelled. Nothing was charged.</p>}
      {change ? (
        s.mine ? (
          <Button variant={change.tone} className="h-12 w-full text-[15px]" disabled={!!busy} onClick={() => run("confirm", async () => setS({ ...s, ...(await post<Status>(`/api/actions/${a.id}/confirm`, {})) }))}>
            {busy === "confirm" && <Loader2 size={15} className="animate-spin" />} {change.button}
          </Button>
        ) : (
          <p className="text-sm text-muted">Open this link in the browser you connected to Claude to make this change.</p>
        )
      ) : a.kind === "technician_invoice" ? (
        s.mine ? (
          <>
            <label className="field block">
              <span className="mb-1 block text-xs text-muted">Send the PayPal invoice to</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-line bg-surface-solid px-3 py-2 text-sm" />
            </label>
            <Button variant="primary" className="w-full" disabled={!!busy || !/\S+@\S+\.\S+/.test(email)} onClick={() => run("confirm", async () => setS({ ...s, ...(await post<Status>(`/api/actions/${a.id}/confirm`, { email })) }))}>
              {busy === "confirm" && <Loader2 size={14} className="animate-spin" />} Book & send PayPal invoice
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted">Open this link in the browser you connected to Claude to book this visit.</p>
        )
      ) : (
        <>
          {oneTap && (
            <Button variant="primary" className="h-12 w-full text-[15px]" disabled={!!busy} onClick={() => run("tap", async () => setS({ ...s, ...(await post<Status>(`/api/actions/${a.id}/confirm`, {})) }))}>
              {busy === "tap" && <Loader2 size={15} className="animate-spin" />} Pay ${Number(a.amount).toFixed(2)} · one tap
            </Button>
          )}
          {oneTap && <p className="text-center text-[11.5px] text-muted">Saved PayPal{s.wallet?.email ? ` · ${s.wallet.email}` : ""}</p>}
          {s.mine && s.oneTapBlocker && s.wallet && <p className="text-xs text-muted">{s.oneTapBlocker}</p>}
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              run("paypal", async () => {
                const r = await post<{ approveUrl?: string }>(`/api/actions/${a.id}/approve`, { save, returnTo: "pay" });
                if (!r.approveUrl) throw new Error("PayPal didn't return an approval link");
                window.location.assign(r.approveUrl);
              })
            }
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ffc439] text-[15px] font-semibold text-[#111] shadow-[var(--shadow-sm)] transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy === "paypal" ? <Loader2 size={15} className="animate-spin" /> : null}
            {oneTap ? "Use PayPal checkout instead" : "Continue to PayPal"}
          </button>
          {!oneTap && (
            <label className="flex items-start gap-2 text-xs text-muted">
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span>Save PayPal for one-tap checkout at Crankwell. PayPal asks you to agree, and you can remove it from Orders anytime.</span>
            </label>
          )}
        </>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
