"use client";
import { Loader2, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import type { UiEvent } from "@/lib/agent/events";
import { carDisplayName, isCarId } from "@/lib/cars";
import { SYSTEM_META, type SystemId } from "@/lib/cars/types";
import { mandates } from "@/lib/commerce/client";
import type { Mandate } from "@/lib/commerce/types";
import { useOrders } from "@/lib/store/orders";
import { Button } from "../ui";

type MandateEvent = Extract<UiEvent, { type: "mandate" }>;

const money = (v: string) => `$${Number(v).toFixed(2)}`;
const until = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/** What a spending limit covers, in words: "Brakes and Suspension parts for your Corolla". */
export function mandateScope(m: Mandate) {
  const systems = m.systems.map((s) => SYSTEM_META[s as SystemId]?.label ?? s);
  const list = systems.length > 1 ? `${systems.slice(0, -1).join(", ")} and ${systems.at(-1)}` : systems[0];
  return `${list} parts for your ${isCarId(m.carId) ? carDisplayName(m.carId) : m.carId}`;
}

/**
 * The mechanic asks to buy parts without a card per purchase. Nothing can be bought until the user
 * taps Allow; afterwards the card shows what's left and can revoke it.
 */
export function MandateCard({ e }: { e: MandateEvent }) {
  // The server's latest word on this limit: fetched on mount, returned by a tap, or pushed live when the
  // mechanic buys within it or revokes it.
  const m = useOrders((s) => s.mandates[e.mandate.id]) ?? e.mandate;
  const put = useOrders((s) => s.putMandate);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wallet = useOrders((s) => s.wallet);

  // Rendered again from chat history: ask the server where it stands now.
  useEffect(() => {
    let live = true;
    mandates
      .list()
      .then((all) => {
        const now = all.find((x) => x.id === e.mandate.id);
        if (live && now) put(now);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [e.mandate.id, put]);

  const run = async (fn: () => Promise<Mandate>) => {
    setBusy(true);
    setErr(null);
    try {
      put(await fn());
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const terms = [
    ["Per order", `up to ${money(m.perOrderMax)}`],
    ["In total", m.status === "active" ? `${money(m.remaining)} left of ${money(m.totalMax)}` : `up to ${money(m.totalMax)}`],
    ["For", m.status === "active" ? `until ${until(m.expiresAt)}` : `${m.days} day${m.days === 1 ? "" : "s"}`],
    ["Pays with", `saved PayPal${wallet?.email ? ` · ${wallet.email}` : ""}`],
  ];

  return (
    <div className="rise overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <ShieldCheck size={14} className="shrink-0 text-accent" />
        <span className="text-[13px] font-semibold">
          {m.status === "proposed" ? "Let the mechanic buy for you?" : m.status === "active" ? "Spending limit active" : "Spending limit closed"}
        </span>
        <span className="sandbox-chip ml-auto">PayPal sandbox</span>
      </div>
      <div className="space-y-3 p-3.5">
        <div className="flex items-start gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-3">
            <Wallet size={16} strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold leading-snug">{mandateScope(m)}</div>
            {m.reason && <div className="mt-0.5 text-[11.5px] text-muted">“{m.reason}”</div>}
          </div>
        </div>
        <dl className="space-y-1.5 rounded-xl border border-line px-3 py-2.5 text-[12.5px]">
          {terms.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted">{k}</dt>
              <dd className="num min-w-0 truncate text-right">{v}</dd>
            </div>
          ))}
        </dl>

        {m.status === "proposed" ? (
          <div className="space-y-1.5">
            <Button variant="primary" className="h-11 w-full text-[14px]" disabled={busy} onClick={() => run(() => mandates.approve(m.id))}>
              {busy && <Loader2 size={15} className="animate-spin" />} Allow · up to {money(m.totalMax)}
            </Button>
            <p className="text-center text-[11px] text-muted">The mechanic buys only parts you asked for, within these limits. Every purchase gets a receipt you can undo.</p>
            <button type="button" disabled={busy} className="text-[11.5px] text-muted hover:text-ink" onClick={() => run(() => mandates.revoke(m.id))}>
              Not now
            </button>
          </div>
        ) : m.status === "active" ? (
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-muted">
              {m.purchases ? `${m.purchases} purchase${m.purchases === 1 ? "" : "s"} so far` : "No purchases yet"}
            </span>
            <Button size="sm" variant="secondary" className="ml-auto" disabled={busy} onClick={() => run(() => mandates.revoke(m.id))}>
              Revoke
            </Button>
          </div>
        ) : (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
            {m.status === "declined"
              ? "Not allowed. The mechanic will ask before each purchase."
              : m.status === "revoked"
                ? `Revoked. ${m.purchases ? "Purchases already made stay in Orders, refundable there." : "Nothing was bought."}`
                : "Expired. The mechanic will ask before each purchase."}
          </p>
        )}
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </div>
  );
}
