"use client";
import type { Action, Transaction, WalletInfo } from "./types";
import { sessionReady } from "@/lib/session";
import { useOrders } from "@/lib/store/orders";

async function post<T>(url: string, body: Record<string, unknown> = {}): Promise<T> {
  await sessionReady();
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
  remindInvoice: (txId: string) => post<{ tx: Transaction }>(`/api/paypal/invoices/${txId}`, { action: "remind" }).then(track),
  completeJob: (txId: string, hours?: number) => post<{ tx: Transaction }>(`/api/paypal/invoices/${txId}`, { action: "complete", hours }).then(track),
};

export interface ActionStatus {
  action: Action;
  mine: boolean;
  wallet?: WalletInfo | null;
  oneTapBlocker?: string | null;
}

/** Actions the mechanic prepared: confirm with one tap, or approve in the PayPal popup. */
export const actions = {
  status: async (id: string): Promise<ActionStatus> => {
    await sessionReady();
    const r = await fetch(`/api/actions/${id}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Couldn't load this checkout");
    return data;
  },
  /** Price a SKU from a parts card into an action (Buy). */
  prepare: (sku: string, partId?: string) => post<ActionStatus>("/api/actions", { sku, partId }),
  async confirm(id: string, email?: string) {
    const r = await post<{ action: Action; tx?: Transaction }>(`/api/actions/${id}/confirm`, { email });
    if (r.tx) useOrders.getState().upsert(r.tx, true);
    return r;
  },
  async approve(id: string, save: boolean) {
    const r = await post<{ orderId: string }>(`/api/actions/${id}/approve`, { save, returnTo: "popup" });
    void useOrders.getState().refresh();
    return r.orderId;
  },
  async complete(actionId: string, orderId: string) {
    const r = await post<{ action?: Action; tx: Transaction }>(`/api/actions/${actionId}/complete`, { orderId });
    useOrders.getState().upsert(r.tx, true);
    void useOrders.getState().refreshWallet();
    return r;
  },
  cancel: async (id: string) => {
    const r = await fetch(`/api/actions/${id}`, { method: "DELETE" });
    return ((await r.json()) as { action: Action }).action;
  },
};
