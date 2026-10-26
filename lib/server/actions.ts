import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { CHANGE_COPY, allowedOps, isChange } from "@/lib/commerce/ops";
import type { Action, ActionLine, ActionPayload, ChangePayload, Transaction } from "@/lib/commerce/types";
import {
  CommerceError,
  TECH_SHARE,
  authorizeOrder,
  cancelInvoice,
  captureDeposit,
  captureOrder,
  completeJob,
  createDepositOrder,
  createPartsOrder,
  quoteDeposit,
  quoteJob,
  quoteParts,
  quoteTechnician,
  refund,
  remindInvoice,
  sendTechnicianInvoice,
  voidDeposit,
} from "./commerce";
import { db, serverSecret, txFind, txForAction, txGet } from "./db";
import { walletInfo, walletVaultId } from "./wallet";

// Agent-prepared actions. The agent (in-app or Claude over MCP) can only propose one; the server prices it
// from the catalog, and only the user's tap confirms it: one tap with saved PayPal, or PayPal approval.
// After a purchase the same goes for changes to it (refund, check-in, cancel): proposed, then tapped.

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

type Quote = Pick<Action, "kind" | "title" | "summary" | "lines" | "amount" | "policy" | "payload">;

/** The order a change is for, checked against the session and what the order allows now. */
function changeTarget(p: ChangePayload, sessionId: string): Transaction {
  const tx = txGet(p.txId);
  if (!tx || tx.sessionId !== sessionId) throw new CommerceError("Order not found. Use an order_ref from get_orders.", 404);
  const allowed = allowedOps(tx);
  if (!allowed.includes(p.kind)) {
    throw new CommerceError(`Can't ${p.kind.replace(/_/g, " ")} this order: it is ${tx.status.toLowerCase()}. ${allowed.length ? `Possible now: ${allowed.join(", ")}.` : "No changes are possible now."}`, 409);
  }
  return tx;
}

function quoteChange(p: ChangePayload, sessionId: string): Quote {
  const tx = changeTarget(p, sessionId);
  const amount = usd(Number(tx.amount));
  const ref = tx.paypal.invoiceNumber
    ? `PayPal invoice ${tx.paypal.invoiceNumber}`
    : tx.status === "AUTHORIZED"
      ? `PayPal hold ${tx.paypal.authorizationId}`
      : `PayPal capture ${tx.paypal.captureId}`;
  const base = { kind: p.kind, amount, payload: p, summary: `${ref}${p.reason ? ` · ${p.reason}` : ""}` };
  switch (p.kind) {
    case "refund":
      return { ...base, title: `Refund · ${tx.title}`, lines: [{ label: tx.kind === "shop_deposit" ? "Captured deposit" : "Paid for this order", amount }], policy: "Back to the original PayPal payment · Payments v2 refund" };
    case "check_in":
      return { ...base, title: `Check in · ${tx.title}`, lines: [{ label: "Deposit on hold", amount }], policy: "Charged now · the shop's hold is captured (Payments v2)" };
    case "cancel_reservation":
      return { ...base, title: `Cancel · ${tx.title}`, lines: [{ label: "Deposit on hold", amount }], policy: "Nothing is charged · the hold is voided (Payments v2)" };
    case "cancel_invoice":
      return { ...base, title: `Cancel invoice · ${tx.title}`, lines: [{ label: "Invoice total", amount }], policy: "Nothing is charged · PayPal cancels the invoice and the visit is released" };
    case "remind_invoice":
      return { ...base, title: `Remind · ${tx.title}`, lines: [{ label: "Invoice total", amount }], policy: `PayPal emails the invoice again to ${tx.paypal.payerEmail ?? "the buyer"} · nothing is charged` };
    case "complete_job": {
      const j = quoteJob(tx, p.hours);
      const payload = { ...p, hours: j.actual };
      return {
        ...base,
        payload,
        amount: usd(j.unused),
        title: `Job done · ${tx.title}`,
        summary: `${j.actual} h worked of the ${j.estimated} h estimate${p.reason ? ` · ${p.reason}` : ""}`,
        lines: [
          { label: `Paid on PayPal invoice ${tx.paypal.invoiceNumber ?? ""}`.trim(), amount },
          { label: `Unused labor (${j.estimated - j.actual} h × $${j.tech.hourlyRate}) refunded`, amount: usd(j.unused) },
          { label: `${j.tech.name}'s payout (${Math.round(TECH_SHARE * 100)}%)`, amount: usd(j.payout) },
        ],
        policy: j.unused > 0 ? "Partial refund of the invoice payment (Payments v2) · technician paid with PayPal Payouts" : "No refund (the full estimate was used) · technician paid with PayPal Payouts",
      };
    }
  }
}

/** Run a confirmed change. The order is checked again: it may have moved since the card was shown. */
async function runChange(p: ChangePayload, sessionId: string): Promise<Transaction> {
  changeTarget(p, sessionId);
  switch (p.kind) {
    case "refund":
      return refund(p.txId, sessionId);
    case "check_in":
      return captureDeposit(p.txId, sessionId);
    case "cancel_reservation":
      return voidDeposit(p.txId, sessionId);
    case "cancel_invoice":
      return cancelInvoice(p.txId, sessionId);
    case "remind_invoice":
      return remindInvoice(p.txId, sessionId);
    case "complete_job":
      return completeJob(p.txId, sessionId, p.hours);
  }
}

/** Price and describe a proposal from the server catalog. Throws CommerceError on bad ids. */
export function quoteAction(payload: ActionPayload, sessionId: string): Quote {
  if ("txId" in payload) return quoteChange(payload, sessionId);
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
      const { shop, when } = quoteDeposit(payload);
      return {
        kind: "shop_deposit",
        title: `${shop.name} · ${when}`,
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
  const q = quoteAction(payload, sessionId);
  // Asking twice for the same change shows the same card.
  if ("txId" in payload) {
    const same = listActions(sessionId).find((a) => a.status === "pending" && "txId" in a.payload && a.payload.txId === payload.txId && a.kind === payload.kind);
    if (same) return same;
  }
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

/** Charged with saved PayPal (one tap, or by the mechanic within a mandate) in the last 24 hours. */
export function oneTapSpentToday(sessionId: string) {
  const since = Date.now() - 24 * 3600_000;
  return listActions(sessionId)
    .filter((a) => (a.via === "vault" || a.via === "mandate") && a.status === "confirmed" && a.confirmedAt && Date.parse(a.confirmedAt) > since)
    .reduce((sum, a) => sum + Number(a.amount), 0);
}

/** Why one-tap isn't available for this action, or null when it is. */
export function oneTapBlocker(action: Action, sessionId: string): string | null {
  if (action.kind === "technician_invoice" || isChange(action.kind)) return null;
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
    ? {
        status: tx.status,
        order_id: tx.paypal.orderId,
        capture_id: tx.paypal.captureId,
        authorization_id: tx.paypal.authorizationId,
        refund_id: tx.paypal.refundId,
        invoice_id: tx.paypal.invoiceId,
        invoice_url: tx.paypal.payerViewUrl,
        payout_batch_id: tx.payout?.batchId || undefined,
        payout_status: tx.payout?.status,
        tracking_number: tx.shipment?.trackingNumber,
      }
    : undefined;
  const message =
    a.status === "confirmed"
      ? isChange(a.kind)
        ? CHANGE_COPY[a.kind].status
        : a.kind === "technician_invoice"
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
export async function confirmAction(
  id: string,
  sessionId: string,
  /** `mandateId`: bought by the mechanic within that approved mandate (see mandates.ts), not tapped. */
  opts: { origin: string; email?: string; mandateId?: string },
): Promise<{ action: Action; tx?: Transaction }> {
  const a = owned(id, sessionId);
  if (a.status === "confirmed") return { action: a, tx: a.txId ? txGet(a.txId) : undefined };
  if (a.status === "expired") throw new CommerceError("This offer expired. Ask the mechanic to prepare it again.", 410);
  if (a.status !== "pending") throw new CommerceError(a.status === "confirming" ? "Already confirming" : "This action was cancelled", 409);

  const blocker = oneTapBlocker(a, sessionId);
  if (blocker) throw new CommerceError(blocker, 409);
  const email = a.payload.kind === "technician_invoice" ? (opts.email ?? invoiceRecipient(a, sessionId)) : undefined;
  if (a.payload.kind === "technician_invoice" && !email) throw new CommerceError("Add an email for the PayPal invoice", 400);

  // Compare-and-set so a double tap can't pay twice.
  if (!write(id, { status: "confirming", confirmingSince: now(), error: undefined }, "pending")) throw new CommerceError("Already confirming", 409);
  const p = a.payload;
  if ("txId" in p) {
    try {
      const tx = await runChange(p, sessionId);
      return { action: write(id, { status: "confirmed", txId: tx.id, via: "change", confirmedAt: now() })!, tx };
    } catch (e) {
      write(id, { status: "pending", error: e instanceof Error ? e.message : "The change failed" });
      throw e;
    }
  }
  try {
    let tx: Transaction;
    if (p.kind === "technician_invoice") {
      tx = await sendTechnicianInvoice({ ...p, sessionId, email: email!, actionId: id });
    } else {
      const vault = { vaultId: walletVaultId(sessionId)! };
      const checkout = { sessionId, origin: opts.origin, vault, actionId: id, mandateId: opts.mandateId };
      const r = p.kind === "parts" ? await createPartsOrder({ ...p, ...checkout }) : await createDepositOrder({ ...p, ...checkout });
      tx = r.tx;
    }
    if (!settled(tx)) {
      const action = write(id, { status: "pending", txId: undefined, error: "PayPal asked for approval this time. Continue to PayPal." })!;
      return { action, tx };
    }
    const via = p.kind === "technician_invoice" ? "invoice" : opts.mandateId ? "mandate" : "vault";
    return { action: write(id, { status: "confirmed", txId: tx.id, via, mandateId: opts.mandateId, confirmedAt: now() })!, tx };
  } catch (e) {
    write(id, { status: "pending", error: e instanceof Error ? e.message : "Payment failed" });
    throw e;
  }
}

/**
 * Start PayPal approval for an action (no saved wallet yet, or over the one-tap limit).
 * `save` stores the buyer's PayPal in the Vault on success, which turns on one-tap.
 */
export async function startApproval(id: string, opts: { origin: string; save: boolean; returnTo: "pay" | "popup" }) {
  const loaded = load(id);
  if (!loaded) throw new CommerceError("Action not found", 404);
  const { action: a, sessionId } = loaded;
  if (a.status === "confirmed") throw new CommerceError("Already paid", 409);
  if (a.status !== "pending") throw new CommerceError(a.status === "expired" ? "This offer expired. Ask the mechanic to prepare it again." : "This action is no longer open", 410);
  const p = a.payload;
  if ("txId" in p) throw new CommerceError("Changes to an order need no PayPal approval. Use Confirm instead.");
  if (p.kind === "technician_invoice") throw new CommerceError("Technician visits are booked with a PayPal invoice. Use Confirm instead.");
  const urls = opts.returnTo === "pay" ? { returnUrl: `${opts.origin}/pay/return`, cancelUrl: `${opts.origin}/pay/${id}?cancelled=1` } : {};
  const checkout = { sessionId, origin: opts.origin, actionId: id, vault: opts.save ? ({ save: true } as const) : undefined, ...urls };
  const r = p.kind === "parts" ? await createPartsOrder({ ...p, ...checkout }) : await createDepositOrder({ ...p, ...checkout });
  write(id, { txId: r.tx.id, error: undefined });
  return { orderId: r.orderId, approveUrl: r.approveUrl };
}

/**
 * Mark the action behind a settled transaction confirmed. Money moved, so this holds even if the card
 * was cancelled or expired meanwhile (the user finished paying in a PayPal window still open).
 */
export function markActionSettled(tx: Transaction, via: NonNullable<Action["via"]> = "approval"): Action | undefined {
  const actionId = typeof tx.meta?.actionId === "string" ? tx.meta.actionId : undefined;
  if (!actionId) return undefined;
  const current = getAction(actionId);
  if (!current || !settled(tx) || current.status === "confirmed") return current;
  return write(actionId, { status: "confirmed", txId: tx.id, via, confirmedAt: now(), error: undefined });
}

const g = globalThis as unknown as { __completing?: Map<string, Promise<{ action?: Action; tx: Transaction }>> };
const completing = (g.__completing ??= new Map());

/**
 * After PayPal approval: capture or authorize, then mark the action confirmed. The popup, the /pay
 * return, the CHECKOUT.ORDER.APPROVED webhook and the reconciler can all call this for one order; they
 * share one run.
 */
export async function completeApproval(orderId: string, sessionId: string | null): Promise<{ action?: Action; tx: Transaction }> {
  const found = txFind("order_id", orderId);
  if (!found || (sessionId && found.sessionId !== sessionId)) throw new CommerceError("Order not found", 404);
  let run = completing.get(orderId);
  if (!run) {
    run = (async () => {
      const tx = found.kind === "shop_deposit" ? await authorizeOrder(orderId, null) : await captureOrder(orderId, null);
      return { action: markActionSettled(tx), tx };
    })().finally(() => completing.delete(orderId));
    completing.set(orderId, run);
  }
  return run;
}

/** How long a confirm may run before it counts as interrupted (a crash or restart mid-payment). */
export const STUCK_CONFIRM_MS = 2 * 60_000;

/**
 * Recover actions left "confirming" by an interrupted payment: confirmed if PayPal settled it (the
 * reconciler checks PayPal first), otherwise open again for the user to retry.
 */
export function recoverStuckActions(nowMs = Date.now()): string[] {
  const ids = (db().prepare("SELECT id FROM actions WHERE status = 'confirming'").all() as { id: string }[]).map((r) => r.id);
  const fixed: string[] = [];
  for (const id of ids) {
    const a = load(id)?.action;
    if (!a || nowMs - Date.parse(a.confirmingSince ?? a.createdAt) < STUCK_CONFIRM_MS) continue;
    const tx = a.txId ? txGet(a.txId) : txForAction(id);
    const next =
      tx && settled(tx)
        ? write(id, { status: "confirmed", txId: tx.id, via: tx.kind === "technician_invoice" ? "invoice" : "vault", confirmedAt: now(), error: undefined }, "confirming")
        : write(id, { status: "pending", error: "The last attempt was interrupted. Check Orders before you try again." }, "confirming");
    if (next) fixed.push(id);
  }
  return fixed;
}
