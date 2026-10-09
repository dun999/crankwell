"use client";
import { create } from "zustand";
import type { Transaction } from "@/lib/commerce/types";
import { getSessionId } from "@/lib/session";

interface OrdersState {
  items: Transaction[];
  open: boolean;
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
  SENT: "Invoice sent",
  PAID: "Invoice paid",
  CANCELLED: "Cancelled",
  DENIED: "Payment denied",
};

export const useOrders = create<OrdersState>((set, get) => ({
  items: [],
  open: false,
  flash: null,
  setOpen: (open) => set({ open }),
  upsert: (t, announce = false) =>
    set((s) => {
      const prev = s.items.find((x) => x.id === t.id);
      const items = prev ? s.items.map((x) => (x.id === t.id ? t : x)) : [t, ...s.items];
      const changed = !prev || prev.status !== t.status;
      return {
        items,
        flash: announce && changed && STATUS_TEXT[t.status] ? { id: t.id, text: `${STATUS_TEXT[t.status]} · ${t.title}`, nonce: Date.now() } : s.flash,
      };
    }),
  refresh: async () => {
    const r = await fetch(`/api/orders?session=${encodeURIComponent(getSessionId())}`);
    if (r.ok) set({ items: (await r.json()).items });
  },
  connect: () => {
    const es = new EventSource(`/api/events?session=${encodeURIComponent(getSessionId())}`);
    es.addEventListener("tx", (e) => {
      try {
        get().upsert(JSON.parse((e as MessageEvent).data), true);
      } catch {
        /* ignore malformed */
      }
    });
    return () => es.close();
  },
}));
