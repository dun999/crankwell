import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Action, ActionLine, ActionPayload, Transaction } from "@/lib/commerce/types";
import {
  CommerceError,
  authorizeOrder,
  captureOrder,
  createDepositOrder,
  createPartsOrder,
  quoteDeposit,
  quoteParts,
  quoteTechnician,
  sendTechnicianInvoice,
} from "./commerce";
import { db, serverSecret, txFind, txGet } from "./db";
import { walletInfo, walletVaultId } from "./wallet";

// Agent-prepared actions. The agent (in-app or Claude over MCP) can only propose one; the server prices it
// from the catalog, and only the user's tap confirms it: one tap with saved PayPal, or PayPal approval.

export const ACTION_TTL_MS = 15 * 60_000;
/** One-tap (saved PayPal) guardrails. Larger amounts go through PayPal approval. */
export const ONE_TAP_MAX = 500;
export const ONE_TAP_DAILY_MAX = 1000;

const now = () => new Date().toISOString();
const usd = (n: number) => n.toFixed(2);

interface Row {
  id: string;
  session_id: string;
  status: Action["status"];
  data: string;
}

/** Price and describe a proposal from the server catalog. Throws CommerceError on bad ids. */
export function quoteAction(payload: ActionPayload): Pick<Action, "kind" | "title" | "summary" | "lines" | "amount" | "policy" | "payload"> {
  switch (payload.kind) {
    case "parts": {
      const q = quoteParts(payload);
      const lines: ActionLine[] = q.lines.map((l) => ({ label: `${l.quantity}× ${l.sp.name} · ${l.sp.tier}`, amount: usd(l.sp.price * l.quantity) }));
      lines.push({ label: q.shipping ? "Shipping" : "Shipping (free over $150)", amount: usd(q.shipping) });
      const first = q.lines[0].sp;
      return {
        kind: "parts",
        title: q.title,
        summary: `${first.warranty} warranty · ships in ${first.shipDays} day${first.shipDays === 1 ? "" : "s"}${q.part ? ` · for ${q.part.name}` : ""}`,
        lines,
        amount: usd(q.total),
        policy: "Charged now · refundable from Orders",
        payload: { ...payload, items: q.lines.map((l) => ({ sku: l.sp.sku, quantity: l.quantity })) },
      };
    }
    case "shop_deposit": {
      const { shop } = quoteDeposit(payload);
      return {
        kind: "shop_deposit",
        title: `${shop.name} · ${payload.slot}`,
        summary: `${shop.address} · ★ ${shop.rating} · labor $${shop.laborRate}/h`,
        lines: [{ label: "Refundable diagnostic deposit", amount: usd(shop.deposit) }],
        amount: usd(shop.deposit),
        policy: "Held, not charged · captured at check-in or released if you cancel",
        payload,
      };
    }
    case "technician_invoice": {
      const { tech, hours, total } = quoteTechnician(payload);
      return {
        kind: "technician_invoice",
        title: `${tech.name} · mobile visit`,
        summary: `${payload.when} · ETA ~${tech.etaMinutes} min · ${tech.certified}`,
        lines: [
          { label: "Call-out fee", amount: usd(tech.calloutFee) },
          { label: `${hours} h labor estimate at $${tech.hourlyRate}/h`, amount: usd(hours * tech.hourlyRate) },
        ],
        amount: usd(total),
        policy: "Nothing charged now · PayPal invoice, paid to confirm the visit",
        payload: { ...payload, hours },
      };
    }
  }
}

function load(id: string): { action: Action; sessionId: string } | undefined {
  const r = db().prepare("SELECT id, session_id, status, data FROM actions WHERE id = ?").get(id) as Row | undefined;
  if (!r) return undefined;
  let action = JSON.parse(r.data) as Action;
  if (action.status === "pending" && !action.txId && Date.parse(action.expiresAt) < Date.now()) {
    action = write(id, { status: "expired" }) ?? action;
  }
  return { action, sessionId: r.session_id };
}

function write(id: string, patch: Partial<Action>, onlyIf?: Action["status"]): Action | undefined {
  const d = db();
  return d.transaction(() => {
    const r = d.prepare("SELECT data FROM actions WHERE id = ?").get(id) as { data: string } | undefined;
    if (!r) return undefined;
    const cur = JSON.parse(r.data) as Action;
    if (onlyIf && cur.status !== onlyIf) return undefined;
    const next = { ...cur, ...patch };
    d.prepare("UPDATE actions SET status = ?, tx_id = ?, data = ? WHERE id = ?").run(next.status, next.txId ?? null, JSON.stringify(next), id);
    return next;
  })();
}

function owned(id: string, sessionId: string) {
  const a = load(id);
  if (!a || a.sessionId !== sessionId) throw new CommerceError("Action not found", 404);
  return a.action;
}

export function prepareAction(sessionId: string, payload: ActionPayload, opts: { source: Action["source"]; caseId?: string }): Action {
  const q = quoteAction(payload);
  const created = new Date();
  const action: Action = {
    id: `act_${randomUUID()}`,
    status: "pending",
    source: opts.source,
    caseId: opts.caseId,
    ...q,
    createdAt: created.toISOString(),
    expiresAt: new Date(created.getTime() + ACTION_TTL_MS).toISOString(),
  };
  db()
    .prepare("INSERT INTO actions (id, session_id, case_id, status, tx_id, data, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)")
    .run(action.id, sessionId, opts.caseId ?? null, action.status, JSON.stringify(action), action.createdAt);
  return action;
}

/** Public view of an action. The id is an unguessable capability, like a PayPal approval link. */
export function getAction(id: string): Action | undefined {
  return load(id)?.action;
}

export function getOwnedAction(id: string, sessionId: string): Action {
  return owned(id, sessionId);
}

export const actionOwnedBy = (id: string, sessionId: string) => load(id)?.sessionId === sessionId;

export function listActions(sessionId: string, caseId?: string): Action[] {
  const rows = (
    caseId
      ? db().prepare("SELECT id FROM actions WHERE session_id = ? AND case_id = ? ORDER BY created_at DESC LIMIT 20").all(sessionId, caseId)
      : db().prepare("SELECT id FROM actions WHERE session_id = ? ORDER BY created_at DESC LIMIT 20").all(sessionId)
  ) as { id: string }[];
  return rows.map((r) => load(r.id)!.action);
}

export function cancelAction(id: string, sessionId: string): Action {
  const a = owned(id, sessionId);
  if (a.status !== "pending") return a;
  return write(id, { status: "cancelled" }, "pending") ?? owned(id, sessionId);
}

function oneTapSpentToday(sessionId: string) {
  const since = Date.now() - 24 * 3600_000;
  return listActions(sessionId)
    .filter((a) => a.via === "vault" && a.status === "confirmed" && a.confirmedAt && Date.parse(a.confirmedAt) > since)
    .reduce((sum, a) => sum + Number(a.amount), 0);
}

/** Why one-tap isn't available for this action, or null when it is. */
export function oneTapBlocker(action: Action, sessionId: string): string | null {
  if (action.kind === "technician_invoice") return null;
  if (!walletVaultId(sessionId)) return "Approve this one in PayPal and tick “Save PayPal” to enable one-tap.";
  const amount = Number(action.amount);
  if (amount > ONE_TAP_MAX) return `One-tap is limited to $${ONE_TAP_MAX} per order. Approve this one in PayPal.`;
  if (oneTapSpentToday(sessionId) + amount > ONE_TAP_DAILY_MAX) return `One-tap is limited to $${ONE_TAP_DAILY_MAX} a day. Approve this one in PayPal.`;
  return null;
}

/** Where a technician invoice goes when the user doesn't type an address. */
export function invoiceRecipient(action: Action, sessionId: string): string | undefined {
  if (action.payload.kind !== "technician_invoice") return undefined;
  return action.payload.email ?? walletInfo(sessionId)?.email ?? process.env.INVOICE_RECIPIENT_EMAIL;
}

/**
 * Proof that a confirm came from the checkout card, not the model. Sent only in the tool result's
 * `_meta` (which hosts give to the card, not to the model), and required by confirm_purchase.
 */
export const confirmKey = (id: string) => createHmac("sha256", serverSecret("action-confirm")).update(id).digest("base64url");
export function confirmKeyValid(id: string, key: string) {
  const want = Buffer.from(confirmKey(id));
  const got = Buffer.from(key);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** What happened to an action, in one line plus the PayPal ids, for the model and the card. */
export function actionStatus(id: string, sessionId: string) {
  const a = owned(id, sessionId);
  const tx = a.txId ? txGet(a.txId) : undefined;
  const paypal = tx
    ? { status: tx.status, order_id: tx.paypal.orderId, capture_id: tx.paypal.captureId, authorization_id: tx.paypal.authorizationId, invoice_id: tx.paypal.invoiceId, invoice_url: tx.paypal.payerViewUrl }
    : undefined;
  const message =
    a.status === "confirmed"
      ? a.kind === "technician_invoice"
        ? "PayPal invoice sent. The visit is confirmed when the invoice is paid."
        : a.kind === "shop_deposit"
          ? "Deposit authorized (held, not charged) with PayPal."
          : "Paid with PayPal."
      : a.status === "expired"
        ? "Expired without payment."
        : a.status === "cancelled"
          ? "Cancelled. Nothing was charged."
          : a.txId
            ? "Waiting for the user to approve in PayPal."
            : "Waiting for the user to confirm.";
  return { action: a, tx, paypal, message };
}

function settled(tx: Transaction) {
  return ["COMPLETED", "AUTHORIZED", "SENT", "PAID"].includes(tx.status);
}

/**
 * The user's tap. Parts and deposits are paid with the saved PayPal wallet (Orders v2 with vault_id,
 * completed without a redirect); a technician visit sends the PayPal invoice.
 */
export async function confirmAction(id: string, sessionId: string, opts: { origin: string; email?: string }): Promise<{ action: Action; tx?: Transaction }> {
  const a = owned(id, sessionId);
  if (a.status === "confirmed") return { action: a, tx: a.txId ? txGet(a.txId) : undefined };
  if (a.status === "expired") throw new CommerceError("This offer expired. Ask the mechanic to prepare it again.", 410);
  if (a.status !== "pending") throw new CommerceError(a.status === "confirming" ? "Already confirming" : "This action was cancelled", 409);

  const blocker = oneTapBlocker(a, sessionId);
  if (blocker) throw new CommerceError(blocker, 409);
  const email = a.payload.kind === "technician_invoice" ? (opts.email ?? invoiceRecipient(a, sessionId)) : undefined;
  if (a.payload.kind === "technician_invoice" && !email) throw new CommerceError("Add an email for the PayPal invoice", 400);

  // Compare-and-set so a double tap can't pay twice.
  if (!write(id, { status: "confirming", error: undefined }, "pending")) throw new CommerceError("Already confirming", 409);
  try {
    const p = a.payload;
    let tx: Transaction;
    if (p.kind === "technician_invoice") {
      tx = await sendTechnicianInvoice({ ...p, sessionId, email: email!, actionId: id });
    } else {
      const vault = { vaultId: walletVaultId(sessionId)! };
      const r = p.kind === "parts" ? await createPartsOrder({ ...p, sessionId, origin: opts.origin, vault, actionId: id }) : await createDepositOrder({ ...p, sessionId, origin: opts.origin, vault, actionId: id });
      tx = r.tx;
    }
    if (!settled(tx)) {
      const action = write(id, { status: "pending", txId: undefined, error: "PayPal asked for approval this time. Continue to PayPal." })!;
      return { action, tx };
    }
    const via = p.kind === "technician_invoice" ? "invoice" : "vault";
    return { action: write(id, { status: "confirmed", txId: tx.id, via, confirmedAt: now() })!, tx };
  } catch (e) {
    write(id, { status: "pending", error: e instanceof Error ? e.message : "Payment failed" });
    throw e;
  }
}

/**
 * Start PayPal approval for an action (no saved wallet yet, or over the one-tap limit).
 * `save` stores the buyer's PayPal in the Vault on success, which turns on one-tap.
 */
export async function startApproval(id: string, opts: { origin: string; save: boolean; sessionId?: string; returnTo: "pay" | "popup" }) {
  const loaded = load(id);
  if (!loaded || (opts.sessionId && loaded.sessionId !== opts.sessionId)) throw new CommerceError("Action not found", 404);
  const { action: a, sessionId } = loaded;
  if (a.status === "confirmed") throw new CommerceError("Already paid", 409);
  if (a.status !== "pending") throw new CommerceError(a.status === "expired" ? "This offer expired. Ask the mechanic to prepare it again." : "This action is no longer open", 410);
  const p = a.payload;
  if (p.kind === "technician_invoice") throw new CommerceError("Technician visits are booked with a PayPal invoice. Use Confirm instead.");
  const urls = opts.returnTo === "pay" ? { returnUrl: `${opts.origin}/pay/return`, cancelUrl: `${opts.origin}/pay/${id}?cancelled=1` } : {};
  const checkout = { sessionId, origin: opts.origin, actionId: id, vault: opts.save ? ({ save: true } as const) : undefined, ...urls };
  const r = p.kind === "parts" ? await createPartsOrder({ ...p, ...checkout }) : await createDepositOrder({ ...p, ...checkout });
  write(id, { txId: r.tx.id, error: undefined });
  return { orderId: r.orderId, approveUrl: r.approveUrl };
}

/** After PayPal approval (popup or /pay redirect): capture or authorize, then mark the action confirmed. */
export async function completeApproval(orderId: string, sessionId: string | null): Promise<{ action?: Action; tx: Transaction }> {
  const found = txFind("order_id", orderId);
  if (!found || (sessionId && found.sessionId !== sessionId)) throw new CommerceError("Order not found", 404);
  const tx = found.kind === "shop_deposit" ? await authorizeOrder(orderId, sessionId) : await captureOrder(orderId, sessionId);
  const actionId = typeof tx.meta?.actionId === "string" ? tx.meta.actionId : undefined;
  if (!actionId) return { tx };
  const current = getAction(actionId);
  if (!settled(tx) || current?.status === "confirmed") return { action: current, tx };
  return { action: write(actionId, { status: "confirmed", txId: tx.id, via: "approval", confirmedAt: now(), error: undefined }), tx };
}
