"use client";
import clsx from "clsx";
import { BadgeCheck, CalendarClock, CheckCircle2, ExternalLink, MapPin, Star } from "lucide-react";
import { useEffect, useState } from "react";
import type { CarId } from "@/lib/cars/types";
import { slotLabel } from "@/lib/catalog/slots";
import { commerce } from "@/lib/commerce/client";
import type { RepairShop, Technician, Transaction } from "@/lib/commerce/types";
import { useChat } from "@/lib/store/chat";
import { useOrders } from "@/lib/store/orders";
import { Button, money } from "../ui";
import { PayPalPay } from "./PayPalRoot";

/** Reserve a shop slot with a refundable deposit: Orders v2 intent AUTHORIZE → Payments v2 capture/void. */
export function ShopReserve({ shop, carId, partId, issue }: { shop: RepairShop; carId: CarId; partId?: string; issue?: string }) {
  const [slot, setSlot] = useState(shop.nextSlots[0]);
  const [done, setDone] = useState<Transaction | null>(null);
  const setOrdersOpen = useOrders((s) => s.setOpen);
  const location = useChat((s) => s.location);
  return (
    <div className="space-y-2 rounded-2xl border border-line bg-surface-2/70 p-3 text-xs">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{shop.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
            <span className="flex items-center gap-0.5">
              <Star size={11} className="fill-warn text-warn" /> {shop.rating} ({shop.reviews.toLocaleString()})
            </span>
            <span className="flex items-center gap-0.5">
              <MapPin size={11} /> {shop.distanceKm.toFixed(1)} km · {shop.address}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted">
            {shop.hours} · labor {money(shop.laborRate)}/h
          </div>
        </div>
      </div>
      {done ? (
        <div className="rounded-lg border border-ok/30 bg-ok/10 px-2.5 py-2">
          <div className="flex items-center gap-1.5 font-semibold text-ok">
            <CheckCircle2 size={14} /> {slotLabel(slot, shop.timeZone)} reserved
          </div>
          <div className="mt-0.5 text-muted">
            {money(Number(done.amount))} deposit authorized (not charged). The shop captures it at check-in, or it&apos;s voided if you cancel.
          </div>
          <button type="button" className="mt-1 font-medium text-accent" onClick={() => setOrdersOpen(true)}>
            Manage reservation
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {shop.nextSlots.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSlot(s)}
                className={clsx("flex items-center gap-1 rounded-lg border px-2 py-1", s === slot ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink")}
              >
                <CalendarClock size={12} /> {slotLabel(s, shop.timeZone)}
              </button>
            ))}
          </div>
          <div className="text-muted">
            Hold a <span className="font-semibold text-ink">{money(shop.deposit)}</span> refundable deposit to reserve. PayPal authorizes it now and the shop
            captures it when you arrive.
          </div>
          <PayPalPay
            createOrder={() => commerce.createDepositOrder({ shopId: shop.id, slot, carId, partId, issue, location })}
            onApproved={async (orderId) => setDone(await commerce.authorize(orderId))}
          />
        </>
      )}
    </div>
  );
}

/** Book a mobile technician: PayPal Invoicing v2 (draft → send → paid via webhook). */
export function TechnicianBook({
  tech,
  carId,
  partId,
  issue,
  estimate,
}: {
  tech: Technician;
  carId: CarId;
  partId?: string;
  issue?: string;
  estimate?: { min: number; max: number };
}) {
  const [email, setEmail] = useState("");
  const [when, setWhen] = useState("As soon as possible");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<Transaction | null>(null);
  const live = useOrders((s) => (tx ? s.items.find((x) => x.id === tx.id) : undefined)) ?? tx;
  useEffect(() => {
    fetch("/api/wallet")
      .then((r) => r.json())
      .then((w) => w.invoiceEmail && setEmail((e) => e || w.invoiceEmail))
      .catch(() => {});
  }, []);
  const hours = estimate ? Math.max(1, Math.round((estimate.max - tech.calloutFee) / tech.hourlyRate / 2)) : 1;

  return (
    <div className="space-y-2 rounded-2xl border border-line bg-surface-2/70 p-3 text-xs">
      <div className="flex items-center gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-agent-soft text-[12px] font-semibold text-agent">{tech.initials}</div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{tech.name}</div>
          <div className="flex items-center gap-1 text-[11px] text-muted">
            <BadgeCheck size={11} className="text-accent" /> {tech.certified}
          </div>
          <div className="text-[11px] text-muted">
            <Star size={11} className="inline fill-warn text-warn" /> {tech.rating} · {tech.jobs} jobs · arrives in ~{tech.etaMinutes} min
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        <div className="rounded-lg border border-line px-2 py-1.5">
          Call-out <span className="float-right font-semibold">{money(tech.calloutFee)}</span>
        </div>
        <div className="rounded-lg border border-line px-2 py-1.5">
          Labor <span className="float-right font-semibold">{money(tech.hourlyRate)}/h</span>
        </div>
      </div>
      {live && live.status !== "DRAFT" ? (
        <div className={clsx("rounded-lg border px-2.5 py-2", live.status === "PAID" ? "border-ok/30 bg-ok/10" : "border-line bg-surface-2")}>
          <div className={clsx("flex items-center gap-1.5 font-semibold", live.status === "PAID" && "text-ok")}>
            <CheckCircle2 size={14} /> {live.status === "PAID" ? "Invoice paid. Technician confirmed" : `Invoice ${live.paypal.invoiceNumber} sent`}
          </div>
          <div className="mt-0.5 text-muted">
            {money(Number(live.amount))} · emailed to {live.paypal.payerEmail}. {live.status !== "PAID" && "Pay on PayPal to confirm the visit; the booking confirms automatically via webhook."}
          </div>
          {live.status !== "PAID" && (
            <div className="mt-1.5 flex gap-1.5">
              {live.paypal.payerViewUrl && (
                <a href={live.paypal.payerViewUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#ffc439] px-2.5 font-semibold text-[#111]">
                  Pay invoice <ExternalLink size={12} />
                </a>
              )}
              <Button size="sm" variant="ghost" onClick={() => commerce.refreshInvoice(live.id).catch(() => {})}>
                Refresh status
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <label className="block">
            <span className="text-[11px] text-muted">Invoice email (PayPal sandbox buyer)</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="buyer@personal.example.com" className="mt-0.5 h-8 w-full rounded-lg border border-line bg-transparent px-2 outline-none focus:border-accent" />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted">When</span>
            <select value={when} onChange={(e) => setWhen(e.target.value)} className="mt-0.5 h-8 w-full rounded-lg border border-line bg-transparent px-1.5 outline-none">
              <option>As soon as possible</option>
              <option>Today, afternoon</option>
              <option>Tomorrow, morning</option>
              <option>Tomorrow, afternoon</option>
            </select>
          </label>
          <Button
            variant="primary"
            className="w-full"
            disabled={busy || !/^\S+@\S+\.\S+$/.test(email)}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                setTx(await commerce.sendInvoice({ technicianId: tech.id, email, when, carId, partId, issue, hours }));
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Sending PayPal invoice…" : "Book & send PayPal invoice"}
          </Button>
          {err && <div className="text-danger">{err}</div>}
        </>
      )}
    </div>
  );
}
