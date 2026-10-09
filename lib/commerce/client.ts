"use client";
import type { Transaction } from "./types";
import { getSessionId } from "@/lib/session";
import { useOrders } from "@/lib/store/orders";

async function post<T>(url: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, sessionId: getSessionId() }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`);
  return data as T;
}

const track = (r: { tx: Transaction }) => {
  useOrders.getState().upsert(r.tx, true);
  return r.tx;
};

export const commerce = {
  async createPartsOrder(input: { items: { sku: string; quantity: number }[]; carId: string; partId: string }) {
    const r = await post<{ orderId: string; tx: Transaction }>("/api/paypal/orders", { kind: "parts", ...input });
    useOrders.getState().upsert(r.tx);
    return r.orderId;
  },
  async createDepositOrder(input: { shopId: string; slot: string; carId: string; partId?: string; issue?: string; location?: { lat: number; lng: number } | null }) {
    const r = await post<{ orderId: string; tx: Transaction }>("/api/paypal/orders", { kind: "shop_deposit", ...input });
    useOrders.getState().upsert(r.tx);
    return r.orderId;
  },
  capture: (orderId: string) => post<{ tx: Transaction }>(`/api/paypal/orders/${orderId}/capture`).then(track),
  authorize: (orderId: string) => post<{ tx: Transaction }>(`/api/paypal/orders/${orderId}/authorize`).then(track),
  captureDeposit: (txId: string) => post<{ tx: Transaction }>(`/api/paypal/authorizations/${txId}`, { action: "capture" }).then(track),
  voidDeposit: (txId: string) => post<{ tx: Transaction }>(`/api/paypal/authorizations/${txId}`, { action: "void" }).then(track),
  refund: (txId: string) => post<{ tx: Transaction }>(`/api/paypal/refunds/${txId}`).then(track),
  sendInvoice: (input: { technicianId: string; email: string; when: string; notes?: string; carId: string; partId?: string; issue?: string; hours?: number; partsEstimate?: number }) =>
    post<{ tx: Transaction }>("/api/paypal/invoices", input).then(track),
  refreshInvoice: (txId: string) => post<{ tx: Transaction }>(`/api/paypal/invoices/${txId}`, { action: "refresh" }).then(track),
  cancelInvoice: (txId: string) => post<{ tx: Transaction }>(`/api/paypal/invoices/${txId}`, { action: "cancel" }).then(track),
};
