"use client";
import clsx from "clsx";
import { CheckCircle2, Minus, Plus, Truck, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { CarId } from "@/lib/cars/types";
import { FREE_SHIPPING_OVER, SHIPPING_FLAT, getSpareParts } from "@/lib/catalog/spare-parts";
import { commerce } from "@/lib/commerce/client";
import type { SparePart, Transaction } from "@/lib/commerce/types";
import { useOrders } from "@/lib/store/orders";
import { IconButton, money } from "../ui";
import { PayPalPay } from "./PayPalRoot";

/** Buy a spare part: PayPal Orders v2 (intent CAPTURE). */
export function PartShop({ carId, partId, skus, onClose }: { carId: CarId; partId: string; skus?: SparePart[]; onClose?: () => void }) {
  const options = useMemo(() => skus ?? getSpareParts(carId, partId), [skus, carId, partId]);
  const [sku, setSku] = useState(options.find((o) => o.tier === "OE-Equivalent")?.sku ?? options[0]?.sku);
  const [qty, setQty] = useState(1);
  const [done, setDone] = useState<Transaction | null>(null);
  const setOrdersOpen = useOrders((s) => s.setOpen);
  const pick = options.find((o) => o.sku === sku);
  if (!options.length || !pick) return null;
  const subtotal = pick.price * qty;
  const shipping = subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FLAT;

  if (done)
    return (
      <div className="rounded-xl border border-ok/30 bg-ok/10 px-3 py-2.5 text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-ok">
          <CheckCircle2 size={14} /> Paid with PayPal
        </div>
        <div className="mt-1 text-muted">
          {done.title} · {money(Number(done.amount))} · capture {done.paypal.captureId?.slice(0, 10)}…
        </div>
        <button type="button" className="mt-1.5 font-medium text-accent" onClick={() => setOrdersOpen(true)}>
          View order & tracking
        </button>
      </div>
    );

  return (
    <div className="space-y-2.5 rounded-2xl border border-line bg-surface-2/70 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">Choose a part</div>
        {onClose && (
          <IconButton label="Close" onClick={onClose} className="h-6 w-6">
            <X size={14} />
          </IconButton>
        )}
      </div>
      <div className="space-y-1.5">
        {options.map((o) => (
          <button
            key={o.sku}
            type="button"
            onClick={() => setSku(o.sku)}
            disabled={!o.inStock}
            className={clsx(
              "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition disabled:opacity-50",
              o.sku === sku ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong",
            )}
          >
            <span className={clsx("h-3.5 w-3.5 shrink-0 rounded-full border-2", o.sku === sku ? "border-accent bg-accent" : "border-line-strong")} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">
                {o.tier} · {o.brand}
              </span>
              <span className="block text-[11px] text-muted">
                {o.inStock ? `Ships in ${o.shipDays} days` : "Out of stock"} · {o.warranty} warranty
              </span>
            </span>
            <span className="font-semibold tabular-nums">{money(o.price)}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">Quantity</span>
        <span className="flex items-center gap-1">
          <IconButton label="Decrease" className="h-7 w-7" onClick={() => setQty(Math.max(1, qty - 1))}>
            <Minus size={12} />
          </IconButton>
          <span className="w-5 text-center font-semibold tabular-nums">{qty}</span>
          <IconButton label="Increase" className="h-7 w-7" onClick={() => setQty(Math.min(8, qty + 1))}>
            <Plus size={12} />
          </IconButton>
        </span>
      </div>
      <div className="space-y-0.5 border-t border-line pt-2 text-xs">
        <div className="flex justify-between text-muted">
          <span>Subtotal</span>
          <span className="tabular-nums">{money(subtotal)}</span>
        </div>
        <div className="flex justify-between text-muted">
          <span className="flex items-center gap-1">
            <Truck size={12} /> Shipping
          </span>
          <span className="tabular-nums">{shipping ? money(shipping) : "Free"}</span>
        </div>
        <div className="flex justify-between pt-0.5 text-[13px] font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{money(subtotal + shipping)}</span>
        </div>
      </div>
      <PayPalPay
        createOrder={() => commerce.createPartsOrder({ items: [{ sku: pick.sku, quantity: qty }], carId, partId })}
        onApproved={async (orderId) => setDone(await commerce.capture(orderId))}
        payLater={subtotal + shipping}
      />
    </div>
  );
}
