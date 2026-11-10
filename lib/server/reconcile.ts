import "server-only";
import { allowedOps } from "@/lib/commerce/ops";
import type { Transaction, TxStatus } from "@/lib/commerce/types";
import { completeApproval, listActions, markActionSettled, recoverStuckActions } from "./actions";
import { PAYOUT_FINAL, abandonCheckout, applyOrderState, awaitingBuyer, listTransactions, shipOrder, syncInvoice, syncPayout } from "./commerce";
import { txPayoutsOpen, txStale, txUnshipped } from "./db";
import { listMandates } from "./mandates";
import * as pp from "./paypal";

// Keeps our copy of every payment in line with PayPal when the browser or a webhook doesn't report
// back: a closed popup after approval, a missed webhook, a restart mid-payment. Runs in the server
// process (started from instrumentation.ts) every two minutes.

const EVERY_MS = 2 * 60_000;
/** Give the popup and the webhook this long to finish an order before checking PayPal ourselves. */
const STALE_MS = 2 * 60_000;
const INVOICE_EVERY_MS = 10 * 60_000;
/** A checkout still open after this long was abandoned. */
const ABANDON_MS = 24 * 3600_000;
const ORDER_LOOKBACK_MS = 3 * 24 * 3600_000;
/** Simulated fulfilment: a paid parts order ships (gets a PayPal tracker) about a minute after payment. */
const SHIP_AFTER_MS = 60_000;
const PAYOUT_EVERY_MS = 5 * 60_000;
const INVOICE_LOOKBACK_MS = 30 * 24 * 3600_000;
const PER_RUN = 25;

interface State {
  timer?: ReturnType<typeof setInterval>;
  running: boolean;
  lastRun?: string;
  lastError?: string;
  fixedTotal: number;
  /** When each transaction was last checked with PayPal (orders and invoices that didn't change). */
  checked: Map<string, number>;
}
const g = globalThis as unknown as { __reconcile?: State };
const st: State = (g.__reconcile ??= { running: false, fixedTotal: 0, checked: new Map() });

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Check one transaction against PayPal and apply what changed. APPROVED orders are completed (captured
 * or authorized) exactly as the popup would have.
 */
export async function syncWithPayPal(tx: Transaction, nowMs = Date.now()): Promise<Transaction> {
  if (tx.kind === "technician_invoice") return tx.paypal.invoiceId ? syncInvoice(tx) : tx;
  if (!tx.paypal.orderId) {
    // PayPal never answered the create call, so there is no order to check.
    return nowMs - Date.parse(tx.createdAt) > STALE_MS ? abandonCheckout(tx, "PayPal didn't answer when the order was created") : tx;
  }
  let o: pp.OrderOutcome;
  try {
    o = await pp.getOrder(tx.paypal.orderId);
  } catch (e) {
    if (pp.isNotFound(e)) return abandonCheckout(tx, "The PayPal order expired before it was approved");
    throw e;
  }
  if (o.status === "APPROVED" && awaitingBuyer(tx)) return (await completeApproval(tx.paypal.orderId, null)).tx;
  const next = applyOrderState(tx, o);
  markActionSettled(next);
  if (awaitingBuyer(next) && nowMs - Date.parse(tx.createdAt) > ABANDON_MS) return abandonCheckout(next, `PayPal order still ${o.status?.toLowerCase() ?? "open"} after a day`);
  return next;
}

const due = (tx: Transaction, every: number, nowMs: number) => nowMs - (st.checked.get(tx.id) ?? 0) >= every;

/** Ship paid parts orders (PayPal tracker) and follow pending technician payouts. Returns failures. */
async function fulfil(nowMs: number, fixed: string[]) {
  let errors = 0;
  const attempt = async (tx: Transaction, every: number, run: () => Promise<string | undefined>) => {
    if (!due(tx, every, nowMs)) return;
    st.checked.set(tx.id, nowMs);
    try {
      const done = await run();
      if (done) fixed.push(`${tx.id} ${done}`);
    } catch (e) {
      errors++;
      console.warn(`[reconcile] ${tx.id}: ${pp.paypalErrorMessage(e)}`);
    }
  };
  for (const tx of txUnshipped(iso(nowMs - SHIP_AFTER_MS), iso(nowMs - ORDER_LOOKBACK_MS), PER_RUN)) {
    await attempt(tx, PAYOUT_EVERY_MS, async () => ((await shipOrder(tx)).shipment ? "shipped" : undefined));
  }
  for (const tx of txPayoutsOpen(PAYOUT_FINAL, PER_RUN * 4)) {
    await attempt(tx, PAYOUT_EVERY_MS, async () => {
      const next = await syncPayout(tx);
      return next.payout?.status !== tx.payout?.status ? `payout ${next.payout?.status}` : undefined;
    });
  }
  return errors;
}

/** One reconciliation pass. A call made while one is running returns at once with nothing done. */
export async function reconcileOnce(nowMs = Date.now()): Promise<{ fixed: string[]; errors: number }> {
  if (st.running) return { fixed: [], errors: 0 };
  st.running = true;
  const fixed: string[] = [];
  let errors = 0;
  const check = async (tx: Transaction, every: number) => {
    if (!due(tx, every, nowMs)) return;
    st.checked.set(tx.id, nowMs);
    try {
      const next = await syncWithPayPal(tx, nowMs);
      if (next.status !== tx.status) fixed.push(`${tx.id} ${tx.status}→${next.status}`);
    } catch (e) {
      errors++;
      console.warn(`[reconcile] ${tx.id}: ${pp.paypalErrorMessage(e)}`);
    }
  };
  try {
    if (pp.isPayPalConfigured()) {
      for (const tx of txStale(["CREATED", "APPROVED"], iso(nowMs - STALE_MS), iso(nowMs - ORDER_LOOKBACK_MS), PER_RUN)) await check(tx, STALE_MS);
      for (const tx of txStale(["SENT", "UNPAID"], iso(nowMs - INVOICE_EVERY_MS), iso(nowMs - INVOICE_LOOKBACK_MS), PER_RUN)) await check(tx, INVOICE_EVERY_MS);
      errors += await fulfil(nowMs, fixed);
    }
    // After PayPal has been checked, so an interrupted one-tap that did settle is confirmed, not reopened.
    fixed.push(...recoverStuckActions(nowMs).map((id) => `${id} recovered`));
    for (const [id, at] of st.checked) if (nowMs - at > INVOICE_LOOKBACK_MS) st.checked.delete(id);
    st.lastError = errors ? `${errors} PayPal check${errors === 1 ? "" : "s"} failed` : undefined;
  } catch (e) {
    st.lastError = e instanceof Error ? e.message : String(e);
    console.error("[reconcile]", e);
  } finally {
    st.running = false;
    st.lastRun = iso(nowMs);
    st.fixedTotal += fixed.length;
  }
  if (fixed.length) console.log(`[reconcile] ${fixed.join(", ")}`);
  return { fixed, errors };
}

/** Start the background loop once per process. */
export function startReconciler() {
  if (st.timer) return;
  st.timer = setInterval(() => void reconcileOnce(), EVERY_MS);
  st.timer.unref?.();
  setTimeout(() => void reconcileOnce(), 15_000).unref?.();
  console.log("[reconcile] started");
}

// ───────────────────────── Orders, as PayPal has them ─────────────────────────

/** Statuses PayPal can still change (approval, capture, void, refund, invoice payment). */
const LIVE: TxStatus[] = ["CREATED", "APPROVED", "AUTHORIZED", "COMPLETED", "CAPTURED", "SENT", "UNPAID"];
const FRESH_MS = 30_000;
const CHECK_TIMEOUT_MS = 8_000;
const VERIFY_MAX = 5;

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("PayPal didn't answer in time")), ms).unref?.())]);

/**
 * The session's orders for the agents (in-app and MCP), with the newest open ones checked against
 * PayPal first, so "did my payment go through?" is answered from PayPal, not from our copy.
 * `paypal_check` says how fresh each status is: live (checked just now), final (can't change), or
 * unavailable (PayPal didn't answer; this is our last known status).
 */
export async function ordersForAgent(sessionId: string, opts: { actionIds?: boolean; mandates?: boolean } = {}) {
  const nowMs = Date.now();
  const all = listTransactions(sessionId).slice(0, 10);
  const verify = pp.isPayPalConfigured() ? all.filter((t) => LIVE.includes(t.status)).slice(0, VERIFY_MAX) : [];
  const checks = new Map<string, "live" | "unavailable">();
  const synced = new Map<string, Transaction>();
  await Promise.all(
    verify.map(async (t) => {
      if (nowMs - (st.checked.get(t.id) ?? 0) < FRESH_MS) return void checks.set(t.id, "live");
      try {
        synced.set(t.id, await withTimeout(syncWithPayPal(t, nowMs), CHECK_TIMEOUT_MS));
        st.checked.set(t.id, nowMs);
        checks.set(t.id, "live");
      } catch (e) {
        console.warn(`[orders] PayPal check for ${t.id} failed: ${pp.paypalErrorMessage(e)}`);
        checks.set(t.id, "unavailable");
      }
    }),
  );
  const waiting = listActions(sessionId).filter((x) => x.status === "pending");
  const limits = opts.mandates ? listMandates(sessionId).filter((m) => m.status === "active" || m.status === "proposed") : [];
  return {
    ...(opts.mandates
      ? {
          spending_limits: limits.map((m) => ({
            status: m.status === "proposed" ? "waiting_for_user" : "active",
            car_id: m.carId,
            systems: m.systems,
            per_order_max_usd: m.perOrderMax,
            left_usd: m.remaining,
            until: m.status === "active" ? m.expiresAt : undefined,
          })),
        }
      : {}),
    waiting_for_confirmation: waiting.map((x) => ({ ...(opts.actionIds ? { action_id: x.id } : {}), title: x.title, amount_usd: x.amount, expires: x.expiresAt })),
    orders: all.map((orig) => {
      const t = synced.get(orig.id) ?? orig;
      return {
        order_ref: t.id,
        kind: t.kind,
        title: t.title,
        status: t.status,
        amount_usd: t.amount,
        created: t.createdAt,
        last_event: t.events[t.events.length - 1]?.type,
        paypal_check: checks.get(t.id) ?? (LIVE.includes(t.status) ? "unavailable" : "final"),
        allowed_changes: allowedOps(t),
        ...(t.shipping ? { ship_to: t.shipping } : {}),
        ...(t.shipment ? { shipment: { carrier: t.shipment.carrier, tracking_number: t.shipment.trackingNumber, status: t.shipment.status, shipped: t.shipment.shippedAt } } : {}),
        ...(t.job ? { job: { hours_worked: t.job.hours, hours_estimated: t.job.estimatedHours, unused_labor_refunded_usd: t.job.refunded } } : {}),
        ...(t.payout ? { technician_payout: { payee: t.payout.payee, amount_usd: t.payout.amount, status: t.payout.status, error: t.payout.error } } : {}),
        paypal: {
          order_id: t.paypal.orderId,
          capture_id: t.paypal.captureId,
          authorization_id: t.paypal.authorizationId,
          refund_id: t.paypal.refundId,
          invoice_id: t.paypal.invoiceId,
          payout_batch_id: t.payout?.batchId || undefined,
        },
        ...(t.dispute ? { dispute: { status: t.dispute.status, reason: t.dispute.reason, outcome: t.dispute.outcome } } : {}),
      };
    }),
  };
}

export const reconcilerStatus = () => ({ running: Boolean(st.timer), lastRun: st.lastRun ?? null, lastError: st.lastError ?? null, fixedTotal: st.fixedTotal });
