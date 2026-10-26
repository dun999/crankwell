"use client";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { sessionReady } from "@/lib/session";
import { Button } from "../ui";

const CAN = [
  "Diagnose your car with Crankwell's 3D model and parts catalog",
  "Prepare parts orders, shop deposits and technician visits",
  "See your orders, reservations and invoices",
];

/** OAuth consent: pairs the asking app (Claude) with this browser's Crankwell session. No password. */
export function ConsentForm({ params, app, redirectHost }: { params: Record<string, string>; app: string; redirectHost: string }) {
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(allow: boolean) {
    setBusy(allow ? "allow" : "deny");
    setError(null);
    try {
      await sessionReady();
      const r = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params, allow }),
      });
      const body = await r.json();
      if (!r.ok || !body.redirect) throw new Error(body.error ?? "Couldn't finish connecting");
      window.location.assign(body.redirect);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 className="text-[21px] font-semibold leading-tight tracking-[-0.02em]">
        <span className="text-accent">{app}</span> wants to connect to your Crankwell garage
      </h1>
      <p className="mt-2 text-sm text-muted">It will be able to:</p>
      <ul className="mt-3 space-y-2.5">
        {CAN.map((t) => (
          <li key={t} className="flex gap-2.5 text-sm">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ok/12 text-ok"><Check size={13} strokeWidth={2.5} /></span>
            {t}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2.5 rounded-2xl border border-line bg-surface-2 p-3 text-sm">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" strokeWidth={1.75} />
        <p>
          <span className="font-medium">It can&apos;t pay on its own.</span> Every payment waits for your tap on a confirm card, and PayPal processes it.
        </p>
      </div>
      <p className="mt-4 text-xs text-muted">
        This links {app} to this browser: its orders appear in this browser&apos;s Orders, where you can disconnect anytime. You&apos;ll return to <span className="font-medium text-ink">{redirectHost}</span>.
      </p>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button onClick={() => decide(false)} disabled={busy !== null}>
          {busy === "deny" && <Loader2 size={14} className="animate-spin" />} Cancel
        </Button>
        <Button variant="primary" onClick={() => decide(true)} disabled={busy !== null}>
          {busy === "allow" && <Loader2 size={14} className="animate-spin" />} Allow
        </Button>
      </div>
    </div>
  );
}
