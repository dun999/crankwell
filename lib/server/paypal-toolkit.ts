import "server-only";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import type { Transaction } from "@/lib/commerce/types";
import { CommerceError } from "./commerce";
import { txGet } from "./db";
import { isPayPalConfigured, paypalEnv } from "./paypal";

// PayPal's Agent Toolkit, run by our server for one session's own orders.
//
// The toolkit's tools act on the whole merchant account (any order, any dispute, any invoice), so
// they are never handed to the customer-facing model as-is. The agent gets narrow tools that take an
// order_ref, check it belongs to the session, and only then run the toolkit tool with that order's
// PayPal ids. Only read tools plus one invoice reminder are enabled.

const ACTIONS = {
  orders: { get: true },
  invoices: { get: true, sendReminder: true },
  disputes: { list: true, get: true },
};

const g = globalThis as unknown as { __paypalToolkit?: PayPalAgentToolkit };

function toolkit() {
  if (!isPayPalConfigured()) throw new CommerceError("PayPal isn't configured on this server", 503);
  return (g.__paypalToolkit ??= new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: { actions: ACTIONS, context: { sandbox: paypalEnv() === "sandbox" } },
  }));
}

/** Run one toolkit tool. The toolkit reports PayPal errors as `{ ok: false, message }`. */
export async function runToolkit<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  const r = await toolkit().handleToolCall({ id: `cw_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
  let out: unknown;
  try {
    out = JSON.parse(String(r.content));
  } catch {
    throw new CommerceError(`PayPal Agent Toolkit ${name}: ${String(r.content).slice(0, 200)}`, 502);
  }
  const err = out as { ok?: boolean; status?: number; message?: string };
  if (err.ok === false) throw new CommerceError(`PayPal: ${err.message ?? "request failed"}`, err.status === 404 ? 404 : 502);
  return out as T;
}

/** The session's own order, or a 404 the agent can act on. */
export function ownOrder(orderRef: string, sessionId: string): Transaction {
  const tx = txGet(orderRef);
  if (!tx || tx.sessionId !== sessionId) throw new CommerceError("Order not found. Use an order_ref from get_orders.", 404);
  return tx;
}

type Money = { value?: string; currency_code?: string };
type RawOrder = {
  id: string;
  status: string;
  update_time?: string;
  payment_source?: { paypal?: { email_address?: string } };
  purchase_units?: {
    amount?: Money;
    shipping?: { name?: { full_name?: string }; address?: Record<string, string>; trackers?: { id: string; status?: string; update_time?: string }[] };
    payments?: {
      captures?: { id: string; status: string; amount?: Money; update_time?: string }[];
      authorizations?: { id: string; status: string; amount?: Money; expiration_time?: string }[];
      refunds?: { id: string; status: string; amount?: Money; update_time?: string }[];
    };
  }[];
};
type RawInvoice = {
  id: string;
  status: string;
  detail?: { invoice_number?: string; invoice_date?: string };
  amount?: Money;
  due_amount?: Money;
  payments?: { paid_amount?: Money; transactions?: { payment_id?: string; payment_date?: string }[] };
  refunds?: { refund_amount?: Money };
};
type RawDispute = {
  dispute_id: string;
  status?: string;
  reason?: string;
  dispute_state?: string;
  dispute_life_cycle_stage?: string;
  dispute_amount?: Money;
  seller_response_due_date?: string;
  dispute_outcome?: { outcome_code?: string };
  create_time?: string;
  update_time?: string;
};

const amount = (m?: Money) => (m?.value ? `${m.value} ${m.currency_code ?? "USD"}` : undefined);

/** What PayPal itself has for an order's payment, read through the toolkit. */
export async function paypalPayment(tx: Transaction) {
  if (tx.paypal.invoiceId) {
    const inv = await runToolkit<RawInvoice>("get_invoice", { invoice_id: tx.paypal.invoiceId });
    return {
      via: "PayPal Agent Toolkit · get_invoice",
      invoice_id: inv.id,
      invoice_number: inv.detail?.invoice_number,
      status: inv.status,
      total: amount(inv.amount),
      due: amount(inv.due_amount),
      paid: amount(inv.payments?.paid_amount),
      payments: inv.payments?.transactions?.map((t) => ({ payment_id: t.payment_id, date: t.payment_date })),
      refunded: amount(inv.refunds?.refund_amount),
    };
  }
  if (!tx.paypal.orderId) return { via: "none", note: "This checkout never reached PayPal, so there is nothing to check." };
  const o = await runToolkit<RawOrder>("get_order", { id: tx.paypal.orderId });
  const pay = o.purchase_units?.[0]?.payments;
  return {
    via: "PayPal Agent Toolkit · get_order",
    order_id: o.id,
    order_status: o.status,
    amount: amount(o.purchase_units?.[0]?.amount),
    payer: o.payment_source?.paypal?.email_address,
    captures: pay?.captures?.map((c) => ({ id: c.id, status: c.status, amount: amount(c.amount), updated: c.update_time })),
    holds: pay?.authorizations?.map((a) => ({ id: a.id, status: a.status, amount: amount(a.amount), expires: a.expiration_time })),
    refunds: pay?.refunds?.map((r) => ({ id: r.id, status: r.status, amount: amount(r.amount), updated: r.update_time })),
    updated: o.update_time,
  };
}

/** Shipment tracking PayPal has on a parts order. */
export async function paypalTracking(tx: Transaction) {
  if (tx.kind !== "parts") return { via: "none", note: "Only parts orders ship. Shop and technician bookings have no tracking." };
  if (!tx.paypal.orderId || !tx.paypal.captureId) return { via: "none", note: "Not paid yet, so nothing has shipped." };
  const o = await runToolkit<RawOrder>("get_order", { id: tx.paypal.orderId });
  const ship = o.purchase_units?.[0]?.shipping;
  const a = ship?.address;
  return {
    via: "PayPal Agent Toolkit · get_order",
    ship_to: a ? [ship?.name?.full_name, a.address_line_1, a.admin_area_2, a.admin_area_1, a.postal_code, a.country_code].filter(Boolean).join(", ") : undefined,
    shipments: (ship?.trackers ?? []).map((t) => ({
      // Tracker ids are "<captureId>-<trackingNumber>".
      tracking_number: t.id.startsWith(`${tx.paypal.captureId}-`) ? t.id.slice(tx.paypal.captureId!.length + 1) : t.id,
      carrier: tx.shipment?.trackingNumber && t.id.endsWith(tx.shipment.trackingNumber) ? tx.shipment.carrier : undefined,
      status: t.status,
      updated: t.update_time,
    })),
    note: ship?.trackers?.length ? undefined : "Paid, not shipped yet. Parts ship within a few minutes of payment in this sandbox.",
  };
}

/** Buyer disputes PayPal has on an order's payment. */
export async function paypalDisputes(tx: Transaction) {
  if (!tx.paypal.captureId) return { via: "none", note: "No captured payment, so there can't be a dispute." };
  const list = await runToolkit<{ items?: { dispute_id: string }[] }>("list_disputes", { disputed_transaction_id: tx.paypal.captureId, page_size: 5 });
  const ids = (list.items ?? []).map((d) => d.dispute_id).slice(0, 3);
  const disputes = await Promise.all(ids.map((id) => runToolkit<RawDispute>("get_dispute", { dispute_id: id })));
  return {
    via: `PayPal Agent Toolkit · list_disputes${ids.length ? " + get_dispute" : ""}`,
    disputes: disputes.map((d) => ({
      id: d.dispute_id,
      status: d.status,
      reason: d.reason,
      stage: d.dispute_life_cycle_stage,
      amount: amount(d.dispute_amount),
      seller_response_due: d.seller_response_due_date,
      outcome: d.dispute_outcome?.outcome_code,
      opened: d.create_time,
      updated: d.update_time,
    })),
    note: ids.length ? undefined : "PayPal has no dispute on this payment.",
  };
}

/** Ask PayPal to email the invoice again (runs only after the user's tap, as an order change). */
export async function sendInvoiceReminder(tx: Transaction) {
  if (!tx.paypal.invoiceId) throw new CommerceError("This order has no PayPal invoice", 409);
  await runToolkit("send_invoice_reminder", {
    invoice_id: tx.paypal.invoiceId,
    subject: `Reminder: ${tx.title}`.slice(0, 120),
    note: "Pay this invoice to confirm the visit. Reply to this email if anything changed.",
  });
}
