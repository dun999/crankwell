"use client";
import { create } from "zustand";
import type { Mandate, Transaction, WalletInfo } from "@/lib/commerce/types";
import { sessionReady } from "@/lib/session";

interface OrdersState {
  items: Transaction[];
  open: boolean;
  /** Saved PayPal for one-tap, and apps (Claude) connected to this browser. */
  wallet: WalletInfo | null;
  connections: { client: string }[];
  /** Spending limits as the server last reported them, by id. The chat cards show these. */
  mandates: Record<string, Mandate>;
  putMandate: (m: Mandate) => void;
  refreshWallet: () => Promise<void>;
  forget: (what: "wallet" | "connections") => Promise<void>;
  /** last update notice for toasts */
  flash: { id: string; text: string; nonce: number } | null;
  setOpen: (v: boolean) => void;
  upsert: (t: Transaction, announce?: boolean) => void;
  refresh: () => Promise<void>;
  connect: () => () => void;
}

const STATUS_TEXT: Record<string, string> = {
  COMPLETED: "Payment captured",
  AUTHORIZED: "Deposit authorized",
  CAPTURED: "Deposit captured",
  VOIDED: "Authorization voided",
  REFUNDED: "Refund issued",
  REVERSED: "Payment reversed",
  SENT: "Invoice sent",
  PAID: "Invoice paid",
  CANCELLED: "Cancelled",
  DENIED: "Payment denied",
};

export const useOrders = create<OrdersState>((set, get) => ({
  items: [],
  open: false,
  flash: null,
  wallet: null,
  connections: [],
  mandates: {},
  putMandate: (m) => set((s) => ({ mandates: { ...s.mandates, [m.id]: m } })),
  refreshWallet: async () => {
    await sessionReady();
    const r = await fetch("/api/wallet");
    if (r.ok) set(await r.json());
  },
  forget: async (what) => {
    const r = await fetch("/api/wallet", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ what }) });
    if (r.ok) set(await r.json());
  },
  setOpen: (open) => set({ open }),
  upsert: (t, announce = false) =>
    set((s) => {
      const prev = s.items.find((x) => x.id === t.id);
      const items = prev ? s.items.map((x) => (x.id === t.id ? t : x)) : [t, ...s.items];
      const changed = !prev || prev.status !== t.status;
      const disputed = t.dispute && t.dispute.status !== prev?.dispute?.status;
      const text = changed && STATUS_TEXT[t.status] ? STATUS_TEXT[t.status] : disputed ? (t.dispute!.outcome ? "Dispute resolved" : "Buyer dispute update") : null;
      return { items, flash: announce && text ? { id: t.id, text: `${text} · ${t.title}`, nonce: Date.now() } : s.flash };
    }),
  refresh: async () => {
    await sessionReady();
    const r = await fetch("/api/orders");
    if (r.ok) set({ items: (await r.json()).items });
  },
  connect: () => {
    let es: EventSource | null = null;
    let closed = false;
    void sessionReady().then(() => {
      if (closed) return;
      es = new EventSource("/api/events");
      es.addEventListener("tx", (e) => {
        try {
          const tx = JSON.parse((e as MessageEvent).data) as Transaction;
          get().upsert(tx, true);
          if (tx.status === "COMPLETED" || tx.status === "AUTHORIZED") void get().refreshWallet();
        } catch {
          /* ignore malformed */
        }
      });
      // A purchase or revoke by the mechanic, or a revoke in Orders.
      es.addEventListener("mandate", (e) => {
        try {
          get().putMandate(JSON.parse((e as MessageEvent).data) as Mandate);
        } catch {
          /* ignore malformed */
        }
      });
    });
    return () => {
      closed = true;
      es?.close();
    };
  },
}));
