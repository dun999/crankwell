import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getPart, isCarId } from "@/lib/cars";
import { FREE_SHIPPING_OVER, SHIPPING_FLAT, findSku } from "@/lib/catalog/spare-parts";
import { getShop, getTechnician, slotOpen } from "@/lib/catalog/providers";
import { slotDate } from "@/lib/catalog/slots";
import type { Transaction, TxDispute, TxEvent, TxStatus } from "@/lib/commerce/types";
import { publishTx } from "./bus";
import { txFind, txGet, txInsert, txList, txUpdate } from "./db";
import * as pp from "./paypal";
import { forgetVaultToken, rememberShipTo, saveWallet, walletShipTo } from "./wallet";

export class CommerceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => `$${n.toFixed(2)}`;
const formatShipTo = (s: pp.ShipTo) => ({ name: s.name, address: [s.line1, s.line2, s.city, [s.state, s.postalCode].filter(Boolean).join(" "), s.countryCode].filter(Boolean).join(", ") });

function owned(txId: string, sessionId: string): Transaction {
  const tx = txGet(txId);
  if (!tx || tx.sessionId !== sessionId) throw new CommerceError("Order not found", 404);
  return tx;
}
function ownedByOrder(orderId: string, sessionId: string): Transaction {
  const tx = txFind("order_id", orderId);
  if (!tx || tx.sessionId !== sessionId) throw new CommerceError("Order not found", 404);
  return tx;
}

function save(id: string, patch: Parameters<typeof txUpdate>[1], event?: Omit<TxEvent, "at">) {
  const tx = txUpdate(id, patch, event);
  if (tx) publishTx(tx);
  return tx!;
}

const RANK: Record<TxStatus, number> = {
  CREATED: 0, DRAFT: 0, APPROVED: 1, SENT: 1, UNPAID: 1, AUTHORIZED: 2,
  COMPLETED: 3, CAPTURED: 3, PAID: 3, VOIDED: 4, REFUNDED: 4, REVERSED: 4, CANCELLED: 4, DENIED: 4, FAILED: 4,
};

/** Still waiting on the buyer at PayPal: nothing captured, held or invoiced yet. */
export const awaitingBuyer = (tx: Transaction) => tx.status === "CREATED" || tx.status === "APPROVED";

// ───────────────────────── Quotes (server catalog prices only) ─────────────────────────

export function quoteParts(input: { carId: string; partId: string; items: { sku: string; quantity: number }[] }) {
  if (!isCarId(input.carId)) throw new CommerceError("Unknown car");
  if (!input.items?.length || input.items.length > 5) throw new CommerceError("Choose 1–5 items");
  const lines = input.items.map((it) => {
    const sp = findSku(it.sku);
    if (!sp || sp.carId !== input.carId) throw new CommerceError(`Unknown part SKU ${it.sku}`);
    if (!sp.inStock) throw new CommerceError(`${sp.name} is out of stock`);
    const quantity = Math.min(8, Math.max(1, Math.floor(Number(it.quantity) || 1)));
    return { sp, quantity };
  });
  const subtotal = round2(lines.reduce((a, l) => a + l.sp.price * l.quantity, 0));
  const shipping = subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FLAT;
  const part = getPart(input.carId, input.partId);
  return {
    lines,
    subtotal,
    shipping,
    total: round2(subtotal + shipping),
    part,
    title: lines.length === 1 ? lines[0].sp.name : `${lines.length} parts`,
    detail: `${lines.map((l) => `${l.quantity}× ${l.sp.tier}`).join(", ")} · ${shipping ? `shipping $${shipping}` : "free shipping"}${part ? ` · for ${part.name}` : ""}`,
  };
}

export function quoteDeposit(input: { carId: string; shopId: string; slot: string; location?: { lat: number; lng: number } | null }) {
  if (!isCarId(input.carId)) throw new CommerceError("Unknown car");
  const shop = getShop(input.shopId, input.location?.lat, input.location?.lng);
  if (!shop) throw new CommerceError("Unknown repair shop");
  if (!slotOpen(shop.id, input.slot, input.location?.lat, input.location?.lng)) throw new CommerceError("That time slot isn't available. Pick another time.");
  return { shop, when: slotDate(input.slot, shop.timeZone) };
}

export function quoteTechnician(input: { carId: string; technicianId: string; hours?: number }) {
  if (!isCarId(input.carId)) throw new CommerceError("Unknown car");
  const tech = getTechnician(input.technicianId);
  if (!tech) throw new CommerceError("Unknown technician");
  const hours = Math.min(6, Math.max(1, Math.round(Number(input.hours) || 1)));
  return { tech, hours, total: round2(tech.calloutFee + hours * tech.hourlyRate) };
}

/** Options shared by the in-app popup, the /pay page and one-tap checkout. */
export interface CheckoutOptions {
  origin: string;
  /** Save PayPal for one-tap on approval, or pay with the saved wallet now. */
  vault?: pp.VaultOption;
  actionId?: string;
  /** Bought by the mechanic within this spending mandate (saved PayPal, no tap). */
  mandateId?: string;
  returnUrl?: string;
  cancelUrl?: string;
}

const returnUrls = (o: CheckoutOptions) => ({
  returnUrl: o.returnUrl ?? `${o.origin}/?paypal=return`,
  cancelUrl: o.cancelUrl ?? `${o.origin}/?paypal=cancel`,
});

const paidWithSavedWallet = (o: CheckoutOptions) => Boolean(o.vault && "vaultId" in o.vault);

// ───────────────────────── Parts (Orders v2, intent CAPTURE) ─────────────────────────

export async function createPartsOrder(input: { sessionId: string; items: { sku: string; quantity: number }[]; carId: string; partId: string } & CheckoutOptions) {
  if (!pp.isPayPalConfigured()) throw new pp.PayPalNotConfigured();
  const q = quoteParts(input);
  const id = `tx_${randomUUID()}`;
  const tx: Transaction = txInsert({
    id,
    sessionId: input.sessionId,
    kind: "parts",
    status: "CREATED",
    title: q.title,
    detail: q.detail,
    amount: q.total.toFixed(2),
    currency: "USD",
    carId: input.carId,
    partId: input.partId,
    items: q.lines.map((l) => ({ sku: l.sp.sku, name: l.sp.name, quantity: l.quantity, unitPrice: l.sp.price.toFixed(2) })),
    paypal: {},
    meta: input.actionId ? { actionId: input.actionId, ...(input.mandateId ? { mandateId: input.mandateId } : {}) } : undefined,
    events: [{ at: now(), source: "app", type: input.mandateId ? "Ordered by the mechanic within your spending limit" : input.actionId ? "Order prepared by the mechanic" : "Order started" }],
    createdAt: now(),
    updatedAt: now(),
  });
  try {
    const order = await pp.createOrder({
      referenceId: id,
      intent: "CAPTURE",
      description: `Crankwell parts: ${tx.title}`,
      lines: q.lines.map((l) => ({ name: l.sp.name, sku: l.sp.sku, quantity: l.quantity, unitPrice: l.sp.price, description: `${l.sp.tier} · ${l.sp.warranty} warranty`, physical: true })),
      shipping: q.shipping,
      needsShipping: true,
      ...returnUrls(input),
      vault: input.vault,
      shipTo: paidWithSavedWallet(input) ? walletShipTo(input.sessionId) : undefined,
    });
    let next = save(id, { paypal: { orderId: order.orderId } }, { source: "paypal-api", type: "PayPal order created", note: paidWithSavedWallet(input) ? "Orders v2 · saved PayPal" : `Orders v2 · ${order.status}` });
    if (order.status === "COMPLETED") next = settleCapture(next, order, input.mandateId ? "Paid with saved PayPal · within your spending limit" : "Paid with saved PayPal · one tap");
    return { orderId: order.orderId, approveUrl: order.approveUrl, tx: next };
  } catch (e) {
    save(id, { status: "FAILED" }, { source: "paypal-api", type: "Order creation failed", note: pp.paypalErrorMessage(e) });
    throw new CommerceError(pp.paypalErrorMessage(e), 502);
  }
}

function settleCapture(tx: Transaction, r: pp.OrderOutcome, label = "Payment captured") {
  // The popup, the webhook and the reconciler can all finish the same order; PayPal's request id makes
  // the capture itself idempotent, and this keeps the timeline to one entry.
  const cur = txGet(tx.id) ?? tx;
  if (cur.status === "COMPLETED" && cur.paypal.captureId && cur.paypal.captureId === r.captureId) return cur;
  const ok = r.captureStatus === "COMPLETED" || r.captureStatus === "PENDING";
  if (r.vault?.status === "VAULTED") saveWallet(tx.sessionId, r.vault, r.payer);
  if (r.vault?.status === "VAULTED" && r.shipTo) rememberShipTo(tx.sessionId, r.shipTo);
  return save(
    tx.id,
    { status: ok ? "COMPLETED" : "DENIED", paypal: { captureId: r.captureId, payerEmail: r.payer }, ...(r.shipTo ? { shipping: formatShipTo(r.shipTo) } : {}) },
    { source: "paypal-api", type: ok ? label : "Capture declined", note: `capture ${r.captureStatus}${r.vault?.status === "VAULTED" ? " · PayPal saved for one-tap" : ""}` },
  );
}

/** Capture an approved parts order. Ownership is the session, or the PayPal order id itself on the /pay return. */
export async function captureOrder(orderId: string, sessionId: string | null) {
  const tx = sessionId ? ownedByOrder(orderId, sessionId) : txFind("order_id", orderId);
  if (!tx) throw new CommerceError("Order not found", 404);
  if (tx.kind !== "parts") throw new CommerceError("This order uses authorize, not capture");
  if (tx.status === "COMPLETED") return tx;
  try {
    return settleCapture(tx, await pp.captureOrder(orderId, `${tx.id}-capture`));
  } catch (e) {
    save(tx.id, {}, { source: "paypal-api", type: "Capture failed", note: pp.paypalErrorMessage(e) });
    throw new CommerceError(pp.paypalErrorMessage(e), 502);
  }
}

// ───────────────────────── Shop deposit (Orders v2 AUTHORIZE → Payments v2) ─────────────────────────

export async function createDepositOrder(
  input: {
    sessionId: string;
    shopId: string;
    slot: string;
    carId: string;
    partId?: string;
    issue?: string;
    location?: { lat: number; lng: number } | null;
  } & CheckoutOptions,
) {
  if (!pp.isPayPalConfigured()) throw new pp.PayPalNotConfigured();
  const { shop, when } = quoteDeposit(input);
  const id = `tx_${randomUUID()}`;
  const tx = txInsert({
    id,
    sessionId: input.sessionId,
    kind: "shop_deposit",
    status: "CREATED",
    title: `${shop.name} · ${when}`,
    detail: `Refundable diagnostic deposit${input.issue ? ` · ${input.issue}` : ""}`,
    amount: shop.deposit.toFixed(2),
    currency: "USD",
    carId: input.carId,
    partId: input.partId,
    paypal: {},
    meta: { shopId: shop.id, slot: input.slot, timeZone: shop.timeZone, address: shop.address, ...(input.actionId ? { actionId: input.actionId } : {}) },
    events: [{ at: now(), source: "app", type: input.actionId ? "Reservation prepared by the mechanic" : "Reservation started" }],
    createdAt: now(),
    updatedAt: now(),
  });
  try {
    const order = await pp.createOrder({
      referenceId: id,
      intent: "AUTHORIZE",
      description: `Repair reservation deposit · ${shop.name}`,
      lines: [{ name: `Reservation deposit: ${shop.name}`, sku: `DEPOSIT-${shop.id}`.slice(0, 127), quantity: 1, unitPrice: shop.deposit, description: when, physical: false }],
      shipping: 0,
      needsShipping: false,
      ...returnUrls(input),
      vault: input.vault,
    });
    let next = save(id, { paypal: { orderId: order.orderId } }, { source: "paypal-api", type: "PayPal order created", note: paidWithSavedWallet(input) ? "Orders v2 · intent AUTHORIZE · saved PayPal" : "Orders v2 · intent AUTHORIZE" });
    if (order.status === "COMPLETED" && order.authorizationId) next = settleAuthorization(next, order, "Deposit held with saved PayPal · one tap");
    return { orderId: order.orderId, approveUrl: order.approveUrl, tx: next ?? tx };
  } catch (e) {
    save(id, { status: "FAILED" }, { source: "paypal-api", type: "Order creation failed", note: pp.paypalErrorMessage(e) });
    throw new CommerceError(pp.paypalErrorMessage(e), 502);
  }
}

function settleAuthorization(tx: Transaction, r: pp.OrderOutcome, label = "Deposit authorized") {
  const cur = txGet(tx.id) ?? tx;
  if (cur.status === "AUTHORIZED" && cur.paypal.authorizationId && cur.paypal.authorizationId === r.authorizationId) return cur;
  if (r.vault?.status === "VAULTED") saveWallet(tx.sessionId, r.vault, r.payer);
  return save(
    tx.id,
    {
      status: r.authorizationStatus === "CREATED" ? "AUTHORIZED" : "DENIED",
      paypal: { authorizationId: r.authorizationId, payerEmail: r.payer },
      meta: { ...cur.meta, authExpires: r.expires, authorizedAt: now() },
    },
    { source: "paypal-api", type: label, note: r.expires ? `hold expires ${new Date(r.expires).toLocaleDateString()}` : undefined },
  );
}

export async function authorizeOrder(orderId: string, sessionId: string | null) {
  const tx = sessionId ? ownedByOrder(orderId, sessionId) : txFind("order_id", orderId);
  if (!tx) throw new CommerceError("Order not found", 404);
  if (tx.kind !== "shop_deposit") throw new CommerceError("Only reservations are authorized");
  if (tx.status === "AUTHORIZED") return tx;
  try {
    return settleAuthorization(tx, await pp.authorizeOrder(orderId, `${tx.id}-authorize`));
  } catch (e) {
    throw new CommerceError(pp.paypalErrorMessage(e), 502);
  }
}

/** PayPal guarantees held funds for 3 days; after that a hold is renewed before it's captured. */
export const HONOR_PERIOD_MS = 3 * 24 * 3600_000;

/** Renew an authorization past its honor period. A declined renewal still leaves the original to capture. */
async function freshAuthorization(tx: Transaction): Promise<string> {
  const authId = tx.paypal.authorizationId!;
  const since = Date.parse(String(tx.meta?.authorizedAt ?? tx.createdAt));
  if (!(Date.now() - since > HONOR_PERIOD_MS)) return authId;
  try {
    const r = await pp.reauthorize(authId, `${tx.id}-reauth-${authId}`);
    save(
      tx.id,
      { paypal: { authorizationId: r.authorizationId }, meta: { ...tx.meta, authorizedAt: now(), authExpires: r.expires ?? tx.meta?.authExpires } },
      { source: "paypal-api", type: "Hold renewed before capture", note: "Payments v2 reauthorize · the 3-day honor period had passed" },
    );
    return r.authorizationId;
  } catch (e) {
    save(tx.id, {}, { source: "paypal-api", type: "Hold renewal declined", note: `${pp.paypalErrorMessage(e)} · capturing the original hold` });
    return authId;
  }
}

export async function captureDeposit(txId: string, sessionId: string) {
  const tx = owned(txId, sessionId);
  if (tx.status !== "AUTHORIZED" || !tx.paypal.authorizationId) throw new CommerceError("No active authorization to capture");
  try {
    const authId = await freshAuthorization(tx);
    const r = await pp.captureAuthorization(authId, `${tx.id}-capture-${authId}`);
    return save(tx.id, { status: "CAPTURED", paypal: { captureId: r.captureId } }, { source: "paypal-api", type: "Deposit captured at check-in", note: `Payments v2 · ${r.status}` });
  } catch (e) {
    throw new CommerceError(pp.paypalErrorMessage(e), 502);
  }
}

export async function voidDeposit(txId: string, sessionId: string) {
  const tx = owned(txId, sessionId);
  if (tx.status !== "AUTHORIZED" || !tx.paypal.authorizationId) throw new CommerceError("No active authorization to void");
  try {
    await pp.voidAuthorization(tx.paypal.authorizationId, `${tx.id}-void`);
    return save(tx.id, { status: "VOIDED" }, { source: "paypal-api", type: "Reservation cancelled · hold released", note: "Payments v2 void" });
  } catch (e) {
    throw new CommerceError(pp.paypalErrorMessage(e), 502);
  }
}

export async function refund(txId: string, sessionId: string) {
  const tx = owned(txId, sessionId);
  if (!tx.paypal.captureId || !["COMPLETED", "CAPTURED"].includes(tx.status)) throw new CommerceError("Nothing to refund");
  try {
    const r = await pp.refundCapture(tx.paypal.captureId, `${tx.id}-refund`, `Refund for ${tx.title}`);
    return save(tx.id, { status: "REFUNDED", paypal: { refundId: r.refundId } }, { source: "paypal-api", type: "Refund issued", note: `Payments v2 · ${r.status}` });
  } catch (e) {
    throw new CommerceError(pp.paypalErrorMessage(e), 502);
  }
}

// ───────────────────────── Technician (Invoicing v2) ─────────────────────────

export async function sendTechnicianInvoice(input: {
  sessionId: string;
  technicianId: string;
  email: string;
  when: string;
  carId: string;
  partId?: string;
  issue?: string;
  hours?: number;
  actionId?: string;
}) {
  if (!pp.isPayPalConfigured()) throw new pp.PayPalNotConfigured();
  const { tech, hours, total } = quoteTechnician(input);
  if (!/^\S+@\S+\.\S+$/.test(input.email ?? "")) throw new CommerceError("Enter a valid email for the invoice");
  const part = input.partId && isCarId(input.carId) ? getPart(input.carId, input.partId) : undefined;
  const id = `tx_${randomUUID()}`;
  txInsert({
    id,
    sessionId: input.sessionId,
    kind: "technician_invoice",
    status: "DRAFT",
    title: `${tech.name} · mobile visit`,
    detail: `${input.when} · ${hours} h est.${input.issue ? ` · ${input.issue}` : ""}`,
    amount: total.toFixed(2),
    currency: "USD",
    carId: input.carId,
    partId: input.partId,
    paypal: { payerEmail: input.email },
    meta: { technicianId: tech.id, when: input.when, hours, ...(input.actionId ? { actionId: input.actionId } : {}) },
    events: [{ at: now(), source: "app", type: input.actionId ? "Visit prepared by the mechanic" : "Booking requested" }],
    createdAt: now(),
    updatedAt: now(),
  });
  try {
    const inv = await pp.createAndSendInvoice({
      reference: id,
      email: input.email,
      memo: `${id} · ${input.carId}${part ? ` · ${part.id}` : ""}`,
      note: `${tech.name} (${tech.certified}) will come to you: ${input.when}.${input.issue ? ` Issue: ${input.issue}.` : ""}${part ? ` Suspected part: ${part.name}.` : ""} Pay this invoice to confirm the visit.`,
      lines: [
        { name: "Mobile technician call-out", description: `${tech.name} · ETA ~${tech.etaMinutes} min`, quantity: 1, unitPrice: tech.calloutFee, unit: "QUANTITY" },
        { name: "Diagnosis & repair labor (estimate)", description: input.issue, quantity: hours, unitPrice: tech.hourlyRate, unit: "HOURS" },
      ],
    });
    return save(
      id,
      { status: "SENT", paypal: { invoiceId: inv.id, invoiceNumber: inv.detail.invoice_number, payerViewUrl: inv.detail.metadata?.recipient_view_url } },
      { source: "paypal-api", type: "Invoice created & sent", note: `Invoicing v2 · ${inv.detail.invoice_number}` },
    );
  } catch (e) {
    save(id, { status: "FAILED" }, { source: "paypal-api", type: "Invoice failed", note: pp.paypalErrorMessage(e) });
    throw new CommerceError(pp.paypalErrorMessage(e), 502);
  }
}

function invoiceStatus(s: string): TxStatus {
  // A partial refund (unused labor) leaves the invoice paid.
  if (s === "PAID" || s === "MARKED_AS_PAID" || s === "PARTIALLY_PAID" || s === "PARTIALLY_REFUNDED") return "PAID";
  if (s === "REFUNDED") return "REFUNDED";
  if (s === "CANCELLED") return "CANCELLED";
  if (s === "DRAFT") return "DRAFT";
  if (s === "UNPAID") return "UNPAID";
  return "SENT";
}

/** Bring an invoice transaction in line with PayPal. */
export async function syncInvoice(tx: Transaction) {
  if (!tx.paypal.invoiceId) throw new CommerceError("No invoice");
  const inv = await pp.getInvoice(tx.paypal.invoiceId).catch((e) => {
    throw new CommerceError(pp.paypalErrorMessage(e), 502);
  });
  const status = invoiceStatus(inv.status);
  const captureId = tx.paypal.captureId ?? inv.payments?.transactions?.find((t) => t.payment_id)?.payment_id;
  if (status === tx.status || RANK[status] < RANK[tx.status]) return captureId && !tx.paypal.captureId ? save(tx.id, { paypal: { captureId } }) : tx;
  return save(
    tx.id,
    { status, paypal: { captureId, payerViewUrl: inv.detail.metadata?.recipient_view_url ?? tx.paypal.payerViewUrl } },
    { source: "paypal-api", type: `Invoice ${inv.status.toLowerCase().replace(/_/g, " ")}` },
  );
}

export async function refreshInvoice(txId: string, sessionId: string) {
  return syncInvoice(owned(txId, sessionId));
}

export async function cancelInvoice(txId: string, sessionId: string) {
  const tx = owned(txId, sessionId);
  if (!tx.paypal.invoiceId) throw new CommerceError("No invoice");
  try {
    await pp.cancelInvoice(tx.paypal.invoiceId);
  } catch (e) {
    throw new CommerceError(pp.paypalErrorMessage(e), 502);
  }
  return save(tx.id, { status: "CANCELLED" }, { source: "paypal-api", type: "Invoice cancelled" });
}

/** Have PayPal email an unpaid invoice again (PayPal Agent Toolkit · send_invoice_reminder). */
export async function remindInvoice(txId: string, sessionId: string) {
  const tx = owned(txId, sessionId);
  if (!["SENT", "UNPAID"].includes(tx.status)) throw new CommerceError(`This invoice is ${tx.status.toLowerCase()}, so there's nothing to remind about`, 409);
  const { sendInvoiceReminder } = await import("./paypal-toolkit");
  await sendInvoiceReminder(tx);
  return save(tx.id, {}, { source: "paypal-api", type: "Invoice reminder sent", note: "PayPal Agent Toolkit · send_invoice_reminder" });
}

/** The technician's share of what a job earned; the rest is Crankwell's fee. */
export const TECH_SHARE = 0.85;

/** Where technician payouts go: the technician's PayPal (one sandbox payee stands in for every seeded technician). */
export const payoutReceiver = () => process.env.PAYOUT_RECEIVER_EMAIL || undefined;

/** Settle a finished visit: hours worked (at most the estimate), unused labor, the technician's payout. */
export function quoteJob(tx: Transaction, hours?: number) {
  const tech = getTechnician(String(tx.meta?.technicianId ?? ""));
  if (!tech) throw new CommerceError("Unknown technician");
  const estimated = Number(tx.meta?.hours ?? 1);
  const actual = Math.min(estimated, Math.max(0.5, Math.round((hours ?? estimated) * 2) / 2));
  const unused = round2((estimated - actual) * tech.hourlyRate);
  const earned = round2(tech.calloutFee + actual * tech.hourlyRate);
  return { tech, estimated, actual, unused, earned, payout: round2(earned * TECH_SHARE) };
}

/**
 * The technician finished: refund the unused labor estimate to the buyer (a partial refund of the
 * invoice payment, Payments v2), then pay the technician their share with PayPal Payouts.
 */
export async function completeJob(txId: string, sessionId: string, hours?: number) {
  let tx = owned(txId, sessionId);
  if (tx.kind !== "technician_invoice" || tx.status !== "PAID") throw new CommerceError("Only a paid technician visit can be marked done");
  if (tx.job) return tx;
  const q = quoteJob(tx, hours);
  if (!tx.paypal.captureId) tx = await syncInvoice(tx);
  const captureId = tx.paypal.captureId;
  let refundId: string | undefined;
  if (q.unused > 0) {
    if (!captureId) throw new CommerceError("PayPal hasn't reported the invoice payment yet. Try again in a minute.", 409);
    try {
      const r = await pp.refundCapture(captureId, `${tx.id}-unused-labor`, `Unused labor: ${q.estimated - q.actual} h of the ${q.estimated} h estimate`, q.unused);
      refundId = r.refundId;
    } catch (e) {
      throw new CommerceError(pp.paypalErrorMessage(e), 502);
    }
  }
  tx = save(
    tx.id,
    { job: { completedAt: now(), hours: q.actual, estimatedHours: q.estimated, refunded: q.unused.toFixed(2) }, paypal: { refundId: refundId ?? tx.paypal.refundId } },
    {
      source: "paypal-api",
      type: q.unused > 0 ? `Job done · ${fmt(q.unused)} unused labor refunded` : "Job done · the full estimate was used",
      note: `${q.actual} h of ${q.estimated} h${refundId ? ` · Payments v2 partial refund ${refundId}` : ""}`,
    },
  );
  return payTechnician(tx, q);
}

async function payTechnician(tx: Transaction, q: ReturnType<typeof quoteJob>) {
  const receiver = payoutReceiver();
  const base = { amount: q.payout.toFixed(2), payee: q.tech.name, receiver: receiver ?? "" };
  if (!receiver) return save(tx.id, {}, { source: "app", type: "Technician payout skipped", note: "No payee configured (PAYOUT_RECEIVER_EMAIL)" });
  try {
    const r = await pp.createPayout({
      senderBatchId: `${tx.id}-payout`,
      senderItemId: tx.id,
      receiver,
      amount: q.payout,
      subject: `Crankwell payout: ${tx.title}`,
      note: `${q.tech.name}: call-out + ${q.actual} h labor, ${Math.round(TECH_SHARE * 100)}% share`,
    });
    return save(
      tx.id,
      { payout: { ...base, batchId: r.batchId, status: r.status } },
      { source: "paypal-api", type: `${q.tech.name} paid ${fmt(q.payout)} with PayPal Payouts`, note: `batch ${r.batchId} · ${r.status.toLowerCase()} · ${Math.round(TECH_SHARE * 100)}% of ${fmt(q.earned)}` },
    );
  } catch (e) {
    const error = pp.paypalErrorMessage(e);
    return save(tx.id, { payout: { ...base, batchId: "", status: "FAILED", error } }, { source: "paypal-api", type: "Technician payout failed", note: error });
  }
}

export const PAYOUT_FINAL = ["SUCCESS", "FAILED", "RETURNED", "REFUNDED", "REVERSED", "BLOCKED", "DENIED", "CANCELED"];
export const payoutOpen = (tx: Transaction) => Boolean(tx.payout?.batchId && !PAYOUT_FINAL.includes(tx.payout.status));

function applyPayoutItem(tx: Transaction, item: pp.PayoutItem, source: TxEvent["source"]) {
  const p = tx.payout;
  if (!p) return tx;
  const status = item.transaction_status ?? p.status;
  const next = { ...p, status, itemId: item.payout_item_id ?? p.itemId, fee: item.payout_item_fee?.value ?? p.fee, error: item.errors?.message ?? p.error };
  if (status === p.status) return next.itemId !== p.itemId || next.fee !== p.fee ? save(tx.id, { payout: next }) : tx;
  return save(tx.id, { payout: next }, { source, type: `Technician payout ${status.toLowerCase()}`, note: item.payout_item_id ? `item ${item.payout_item_id}` : undefined });
}

/** Re-read a pending payout from PayPal. */
export async function syncPayout(tx: Transaction) {
  if (!payoutOpen(tx)) return tx;
  const b = await pp.getPayoutBatch(tx.payout!.batchId);
  return applyPayoutItem(tx, b.item ?? { transaction_status: b.status }, "paypal-api");
}

/** Simulated fulfilment: a carrier number, added to the PayPal order as an Orders v2 tracker. */
export async function shipOrder(tx: Transaction) {
  if (tx.kind !== "parts" || tx.status !== "COMPLETED" || !tx.paypal.orderId || !tx.paypal.captureId || tx.shipment) return tx;
  const trackingNumber = `CW1Z${createHash("sha256").update(tx.id).digest("hex").slice(0, 10).toUpperCase()}`;
  const carrier = "Crankwell Express (sandbox)";
  const t = await pp.addTracking(tx.paypal.orderId, { captureId: tx.paypal.captureId, trackingNumber, carrierName: carrier });
  return save(
    tx.id,
    { shipment: { carrier, trackingNumber, trackerId: t.trackerId, status: t.status, shippedAt: now() } },
    { source: "paypal-api", type: `Shipped · ${carrier} ${trackingNumber}`, note: "Tracking added to the PayPal order (Orders v2 trackers)" },
  );
}

export function listTransactions(sessionId: string) {
  return txList(sessionId);
}

// ───────────────────────── PayPal as the source of truth ─────────────────────────

/**
 * Apply what GET /v2/checkout/orders/{id} says to our copy: a capture or hold we never heard about
 * (closed popup, lost webhook), a refund, a capture or void done elsewhere. APPROVED orders are left to
 * the caller, which completes them (see completeApproval).
 */
export function applyOrderState(tx: Transaction, o: pp.OrderOutcome): Transaction {
  const early = awaitingBuyer(tx);
  if ((tx.status === "COMPLETED" || tx.status === "CAPTURED") && o.captureStatus === "REFUNDED") {
    return save(tx.id, { status: "REFUNDED" }, { source: "paypal-api", type: "Refund confirmed with PayPal" });
  }
  if (tx.kind === "parts") {
    if (early && o.captureId) return settleCapture(tx, o, "Payment confirmed with PayPal");
    if (early && (o.captureStatus === "DECLINED" || o.captureStatus === "FAILED")) return save(tx.id, { status: "DENIED" }, { source: "paypal-api", type: "Capture declined" });
  } else if (tx.kind === "shop_deposit") {
    if (early && o.authorizationId) return settleAuthorization(tx, o, "Deposit confirmed with PayPal");
    if (tx.status === "AUTHORIZED" && o.authorizationStatus === "CAPTURED") {
      return save(tx.id, { status: "CAPTURED", paypal: { captureId: o.captureId } }, { source: "paypal-api", type: "Capture confirmed with PayPal" });
    }
    // The SDK's enum lacks EXPIRED, which PayPal returns for holds older than 29 days.
    const auth = String(o.authorizationStatus ?? "");
    if (tx.status === "AUTHORIZED" && (auth === "VOIDED" || auth === "EXPIRED")) {
      return save(tx.id, { status: "VOIDED" }, { source: "paypal-api", type: auth === "EXPIRED" ? "Hold expired · released" : "Hold released" });
    }
  }
  if (early && o.status === "VOIDED") return save(tx.id, { status: "CANCELLED" }, { source: "paypal-api", type: "PayPal voided the order" });
  return tx;
}

/** Close out a checkout the buyer never finished. */
export function abandonCheckout(tx: Transaction, note: string) {
  if (!awaitingBuyer(tx)) return tx;
  return save(tx.id, { status: "CANCELLED" }, { source: "paypal-api", type: "Checkout not completed", note });
}

// ───────────────────────── Webhooks ─────────────────────────

type Resource = {
  id?: string;
  status?: string;
  invoice?: { id?: string; status?: string; payments?: { transactions?: { payment_id?: string }[] } };
  supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string; capture_id?: string } };
  links?: { rel: string; href: string }[];
  // Refunds
  amount?: { value?: string };
  seller_payable_breakdown?: { total_refunded_amount?: { value?: string } };
  // Vault payment tokens
  metadata?: { order_id?: string };
  // Disputes
  dispute_id?: string;
  reason?: string;
  dispute_life_cycle_stage?: string;
  dispute_amount?: { value?: string };
  dispute_outcome?: { outcome_code?: string };
  disputed_transactions?: { seller_transaction_id?: string }[];
  customer?: { id?: string };
  payment_source?: { paypal?: { email_address?: string } };
};

function moveTo(tx: Transaction, status: TxStatus, type: string, extra: Partial<Transaction["paypal"]> = {}) {
  if (RANK[status] < RANK[tx.status]) {
    // Out-of-order delivery (e.g. APPROVED after COMPLETED): keep the newer state, still log it.
    return save(tx.id, { paypal: extra }, { source: "paypal-webhook", type, note: "Arrived late · status unchanged", late: true });
  }
  return save(tx.id, { status, paypal: extra }, { source: "paypal-webhook", type });
}

/** Apply a verified PayPal webhook event. Returns the affected transaction, if any. */
export function applyWebhook(event: { event_type: string; resource: Resource }): Transaction | undefined {
  const r = event.resource ?? {};
  const related = r.supplementary_data?.related_ids ?? {};
  switch (event.event_type) {
    case "CHECKOUT.ORDER.APPROVED": {
      const tx = r.id ? txFind("order_id", r.id) : undefined;
      return tx && moveTo(tx, "APPROVED", "Buyer approved in PayPal");
    }
    case "PAYMENT.CAPTURE.COMPLETED":
    case "PAYMENT.CAPTURE.PENDING": {
      const tx =
        (related.authorization_id && txFind("authorization_id", related.authorization_id)) ||
        (related.order_id && txFind("order_id", related.order_id)) ||
        (r.id && txFind("capture_id", r.id));
      if (!tx) return undefined;
      return moveTo(tx, tx.kind === "shop_deposit" ? "CAPTURED" : "COMPLETED", event.event_type === "PAYMENT.CAPTURE.PENDING" ? "Capture pending" : "Capture completed", { captureId: r.id });
    }
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED": {
      const tx = (related.order_id && txFind("order_id", related.order_id)) || (r.id && txFind("capture_id", r.id));
      return tx ? moveTo(tx, "DENIED", "Capture denied") : undefined;
    }
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED": {
      // The resource is the refund (or reversal); its "up" link points at the capture.
      const up = r.links?.find((l) => l.rel === "up")?.href ?? "";
      const captureId = /\/captures\/([^/]+)/.exec(up)?.[1] ?? related.capture_id ?? r.id;
      const tx = captureId ? txFind("capture_id", captureId) : undefined;
      if (!tx) return undefined;
      const refundId = r.id !== captureId ? r.id : tx.paypal.refundId;
      if (event.event_type === "PAYMENT.CAPTURE.REVERSED") return moveTo(tx, "REVERSED", "Payment reversed by PayPal", { refundId });
      // A partial refund (unused labor on a finished job) leaves the payment in place.
      const refunded = Number(r.seller_payable_breakdown?.total_refunded_amount?.value ?? r.amount?.value ?? NaN);
      if (refunded > 0 && refunded < Number(tx.amount) - 0.005) {
        if (tx.events.some((e) => e.type.startsWith("Partial refund") && e.note?.includes(r.id ?? "-"))) return tx;
        return save(tx.id, { paypal: { refundId } }, { source: "paypal-webhook", type: `Partial refund completed · ${fmt(refunded)} of ${fmt(Number(tx.amount))}`, note: `refund ${r.id}` });
      }
      return moveTo(tx, "REFUNDED", "Refund completed", { refundId });
    }
    case "CUSTOMER.DISPUTE.CREATED":
    case "CUSTOMER.DISPUTE.UPDATED":
    case "CUSTOMER.DISPUTE.RESOLVED": {
      // The disputed transaction is our capture.
      const captureId = r.disputed_transactions?.map((t) => t.seller_transaction_id).find(Boolean);
      const tx = captureId ? txFind("capture_id", captureId) : undefined;
      if (!tx || !r.dispute_id) return undefined;
      const dispute: TxDispute = {
        id: r.dispute_id,
        reason: r.reason,
        status: r.status,
        stage: r.dispute_life_cycle_stage,
        outcome: r.dispute_outcome?.outcome_code,
        amount: r.dispute_amount?.value,
        updatedAt: now(),
      };
      const reason = (r.reason ?? "").toLowerCase().replace(/_/g, " ");
      const type =
        event.event_type === "CUSTOMER.DISPUTE.CREATED"
          ? `Buyer opened a dispute${reason ? ` · ${reason}` : ""}`
          : event.event_type === "CUSTOMER.DISPUTE.RESOLVED"
            ? `Dispute resolved${dispute.outcome ? ` · ${dispute.outcome.toLowerCase().replace(/_/g, " ")}` : ""}`
            : `Dispute updated${dispute.status ? ` · ${dispute.status.toLowerCase().replace(/_/g, " ")}` : ""}`;
      return save(tx.id, { dispute }, { source: "paypal-webhook", type });
    }
    case "PAYMENT.AUTHORIZATION.CREATED": {
      const tx = (r.id && txFind("authorization_id", r.id)) || (related.order_id && txFind("order_id", related.order_id));
      return tx ? moveTo(tx, "AUTHORIZED", "Authorization created", { authorizationId: r.id }) : undefined;
    }
    case "PAYMENT.AUTHORIZATION.VOIDED": {
      const tx = r.id ? txFind("authorization_id", r.id) : undefined;
      return tx ? moveTo(tx, "VOIDED", "Authorization voided") : undefined;
    }
    case "VAULT.PAYMENT-TOKEN.CREATED": {
      // Some approvals vault asynchronously; the token then arrives here instead of in the capture response.
      const tx = r.metadata?.order_id ? txFind("order_id", r.metadata.order_id) : undefined;
      if (!tx || !r.id) return undefined;
      saveWallet(tx.sessionId, { id: r.id, status: "VAULTED", customerId: r.customer?.id }, r.payment_source?.paypal?.email_address);
      return save(tx.id, {}, { source: "paypal-webhook", type: "PayPal saved for one-tap" });
    }
    case "PAYMENT.PAYOUTS-ITEM.SUCCEEDED":
    case "PAYMENT.PAYOUTS-ITEM.FAILED":
    case "PAYMENT.PAYOUTS-ITEM.UNCLAIMED":
    case "PAYMENT.PAYOUTS-ITEM.RETURNED":
    case "PAYMENT.PAYOUTS-ITEM.BLOCKED":
    case "PAYMENT.PAYOUTS-ITEM.DENIED":
    case "PAYMENT.PAYOUTS-ITEM.HELD":
    case "PAYMENT.PAYOUTS-ITEM.CANCELED":
    case "PAYMENT.PAYOUTS-ITEM.REFUNDED": {
      // The item's sender_item_id is our transaction id.
      const item = r as pp.PayoutItem;
      const tx = item.payout_item?.sender_item_id ? txGet(item.payout_item.sender_item_id) : undefined;
      return tx?.payout ? applyPayoutItem(tx, item, "paypal-webhook") : undefined;
    }
    case "VAULT.PAYMENT-TOKEN.DELETED": {
      if (r.id) forgetVaultToken(r.id);
      return undefined;
    }
    case "INVOICING.INVOICE.PAID":
    case "INVOICING.INVOICE.CANCELLED":
    case "INVOICING.INVOICE.UPDATED": {
      const invoiceId = r.invoice?.id ?? r.id;
      const tx = invoiceId ? txFind("invoice_id", invoiceId) : undefined;
      if (!tx) return undefined;
      if (event.event_type === "INVOICING.INVOICE.PAID") {
        const captureId = r.invoice?.payments?.transactions?.find((t) => t.payment_id)?.payment_id;
        return moveTo(tx, "PAID", "Invoice paid. Visit confirmed", captureId ? { captureId } : {});
      }
      if (event.event_type === "INVOICING.INVOICE.CANCELLED") return moveTo(tx, "CANCELLED", "Invoice cancelled");
      return save(tx.id, {}, { source: "paypal-webhook", type: "Invoice updated" });
    }
  }
  return undefined;
}
