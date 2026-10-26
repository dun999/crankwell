import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSpareParts } from "@/lib/catalog/spare-parts";
import { allowedOps } from "@/lib/commerce/ops";

// PayPal is mocked: these tests cover what happens after payment: shipping with PayPal order
// tracking, finishing a technician job (partial refund of unused labor + PayPal Payouts), and the
// webhooks that report on both.
const pp = vi.hoisted(() => {
  let n = 0;
  return {
    createOrder: vi.fn(async (i: { intent: string; vault?: { vaultId?: string } }) => {
      const orderId = `FF-ORDER${++n}`;
      if (i.vault && "vaultId" in i.vault) return { orderId, status: "COMPLETED", captureId: `FF-CAP${n}`, captureStatus: "COMPLETED", payer: "b@x.com" };
      return { orderId, status: "PAYER_ACTION_REQUIRED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=X" };
    }),
    captureOrder: vi.fn(async (orderId: string) => ({
      orderId,
      status: "COMPLETED",
      captureId: `CAP-${orderId}`,
      captureStatus: "COMPLETED",
      payer: "b@x.com",
      vault: { id: "VAULT-FF", status: "VAULTED" },
      shipTo: { name: "John Doe", line1: "1 Main St", city: "San Jose", state: "CA", postalCode: "95131", countryCode: "US" },
    })),
    getOrder: vi.fn(async () => {
      throw new Error("offline");
    }),
    addTracking: vi.fn(async (_orderId: string, i: { captureId: string; trackingNumber: string }) => ({ trackerId: `${i.captureId}-${i.trackingNumber}`, status: "SHIPPED" })),
    refundCapture: vi.fn(async (captureId: string) => ({ refundId: `REF-${captureId}`, status: "COMPLETED" })),
    createPayout: vi.fn(async (i: { senderBatchId: string }) => ({ batchId: `BATCH-${i.senderBatchId}`, status: "PENDING" })),
    getPayoutBatch: vi.fn(async () => ({ status: "SUCCESS", item: { payout_item_id: "ITEM-1", transaction_status: "SUCCESS", payout_item_fee: { value: "0.25" } } })),
    createAndSendInvoice: vi.fn(async () => ({ id: `INV2-FF${++n}`, status: "SENT", detail: { invoice_number: `00${n}`, metadata: {} } })),
    getInvoice: vi.fn(async (id: string) => ({ id, status: "PAID", detail: { invoice_number: "0001" }, payments: { transactions: [{ payment_id: `PAY-${id}` }] } })),
  };
});
vi.mock("@/lib/server/paypal", () => ({
  ...pp,
  verifyWebhookSignature: async () => true,
  isPayPalConfigured: () => true,
  isNotFound: () => false,
  PayPalNotConfigured: class extends Error {},
  RestError: class extends Error {},
  paypalErrorMessage: (e: Error) => e.message,
}));

const commerce = await import("@/lib/server/commerce");
const actions = await import("@/lib/server/actions");
const reconcile = await import("@/lib/server/reconcile");
const wallet = await import("@/lib/server/wallet");
const { runTool } = await import("@/lib/agent/tools");
const { db, txGet } = await import("@/lib/server/db");

let n = 0;
const newSession = () => `session-fulfil-${++n}`;
const origin = "https://crankwell.test";
const pads = getSpareParts("corolla", "brakes.pads.fl")[0];

/** Pretend a transaction was last touched a while ago, so the reconciler picks it up. */
function age(txId: string, minutes: number) {
  const at = new Date(Date.now() - minutes * 60_000).toISOString();
  const tx = txGet(txId)!;
  db().prepare("UPDATE transactions SET updated_at = ?, created_at = ?, data = ? WHERE id = ?").run(at, at, JSON.stringify({ ...tx, createdAt: at, updatedAt: at }), txId);
}

/** A parts order paid in the PayPal popup with "save PayPal" on. */
async function paidWithApproval(s: string) {
  const { orderId } = await commerce.createPartsOrder({ sessionId: s, items: [{ sku: pads.sku, quantity: 1 }], carId: "corolla", partId: "brakes.pads.fl", origin, vault: { save: true } });
  return commerce.captureOrder(orderId, s);
}

/** A technician visit (2 h estimate with Maria: $59 call-out + 2 × $95), paid by the buyer. */
async function paidVisit(s: string) {
  const tx = await commerce.sendTechnicianInvoice({ sessionId: s, technicianId: "tech_maria", email: "b@x.com", when: "ASAP", carId: "corolla", hours: 2 });
  const paid = commerce.applyWebhook({ event_type: "INVOICING.INVOICE.PAID", resource: { invoice: { id: tx.paypal.invoiceId, status: "PAID", payments: { transactions: [{ payment_id: "PAY-1" }] } } } });
  expect(paid).toMatchObject({ status: "PAID", paypal: { captureId: "PAY-1" } });
  return paid!;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYOUT_RECEIVER_EMAIL = "tech@business.example.com";
  db().prepare("DELETE FROM transactions").run();
});

describe("shipping", () => {
  it("keeps the PayPal ship-to and uses it for later one-tap orders", async () => {
    const s = newSession();
    const tx = await paidWithApproval(s);
    expect(tx.shipping).toEqual({ name: "John Doe", address: "1 Main St, San Jose, CA 95131, US" });
    expect(wallet.walletShipTo(s)).toMatchObject({ city: "San Jose", countryCode: "US" });

    await commerce.createPartsOrder({ sessionId: s, items: [{ sku: pads.sku, quantity: 1 }], carId: "corolla", partId: "brakes.pads.fl", origin, vault: { vaultId: "VAULT-FF" } });
    expect(pp.createOrder).toHaveBeenLastCalledWith(expect.objectContaining({ shipTo: expect.objectContaining({ line1: "1 Main St" }) }));
  });

  it("ships paid parts orders once, with a PayPal tracker", async () => {
    const s = newSession();
    const tx = await paidWithApproval(s);
    await reconcile.reconcileOnce();
    expect(pp.addTracking).not.toHaveBeenCalled(); // paid just now

    age(tx.id, 5);
    await reconcile.reconcileOnce();
    expect(pp.addTracking).toHaveBeenCalledWith(tx.paypal.orderId, { captureId: tx.paypal.captureId, trackingNumber: expect.stringMatching(/^CW1Z/), carrierName: expect.any(String) });
    const shipped = txGet(tx.id)!;
    expect(shipped.shipment).toMatchObject({ status: "SHIPPED", trackingNumber: expect.stringMatching(/^CW1Z/) });
    expect(shipped.events.at(-1)!.type).toMatch(/^Shipped/);

    age(tx.id, 10);
    await reconcile.reconcileOnce(Date.now() + 3600_000);
    expect(pp.addTracking).toHaveBeenCalledTimes(1);

    const orders = JSON.parse((await runTool("get_orders", {}, { sessionId: s, view: { carId: "corolla" }, emit: () => {} } as never)).content);
    expect(orders.orders[0]).toMatchObject({ ship_to: { name: "John Doe" }, shipment: { tracking_number: shipped.shipment!.trackingNumber } });
  });

  it("doesn't ship refunded orders", async () => {
    const s = newSession();
    const tx = await paidWithApproval(s);
    await commerce.refund(tx.id, s);
    age(tx.id, 5);
    await reconcile.reconcileOnce();
    expect(pp.addTracking).not.toHaveBeenCalled();
  });
});

describe("finishing a technician job", () => {
  it("refunds unused labor and pays the technician their share", async () => {
    const s = newSession();
    const tx = await paidVisit(s);
    expect(allowedOps(tx)).toEqual(["complete_job"]);

    const a = actions.prepareAction(s, { kind: "complete_job", txId: tx.id, hours: 1 }, { source: "app" });
    expect(a).toMatchObject({ kind: "complete_job", amount: "95.00", summary: expect.stringMatching(/1 h worked of the 2 h/) });
    expect(a.lines.map((l) => l.amount)).toEqual(["249.00", "95.00", "130.90"]); // (59 + 95) × 85%
    expect(pp.refundCapture).not.toHaveBeenCalled();

    const r = await actions.confirmAction(a.id, s, { origin });
    expect(r.action).toMatchObject({ status: "confirmed", via: "change" });
    expect(pp.refundCapture).toHaveBeenCalledWith("PAY-1", `${tx.id}-unused-labor`, expect.stringMatching(/Unused labor/), 95);
    expect(pp.createPayout).toHaveBeenCalledWith(expect.objectContaining({ senderBatchId: `${tx.id}-payout`, senderItemId: tx.id, receiver: "tech@business.example.com", amount: 130.9 }));
    const done = txGet(tx.id)!;
    expect(done).toMatchObject({ status: "PAID", job: { hours: 1, estimatedHours: 2, refunded: "95.00" }, payout: { status: "PENDING", amount: "130.90", payee: "Maria Gonzalez" } });
    expect(allowedOps(done)).toEqual([]);
  });

  it("refunds nothing when the whole estimate was used", async () => {
    const s = newSession();
    const tx = await paidVisit(s);
    await commerce.completeJob(tx.id, s);
    expect(pp.refundCapture).not.toHaveBeenCalled();
    expect(pp.createPayout).toHaveBeenCalledWith(expect.objectContaining({ amount: 211.65 })); // (59 + 190) × 85%
    expect(txGet(tx.id)!.events.some((e) => /full estimate was used/.test(e.type))).toBe(true);
  });

  it("finds the invoice payment at PayPal when the webhook didn't carry it", async () => {
    const s = newSession();
    const sent = await commerce.sendTechnicianInvoice({ sessionId: s, technicianId: "tech_maria", email: "b@x.com", when: "ASAP", carId: "corolla", hours: 2 });
    commerce.applyWebhook({ event_type: "INVOICING.INVOICE.PAID", resource: { invoice: { id: sent.paypal.invoiceId, status: "PAID" } } });
    await commerce.completeJob(sent.id, s, 1.5);
    expect(pp.refundCapture).toHaveBeenCalledWith(`PAY-${sent.paypal.invoiceId}`, expect.any(String), expect.any(String), 47.5);
  });

  it("runs once, records a failed payout, and skips it with no payee", async () => {
    const s = newSession();
    const tx = await paidVisit(s);
    pp.createPayout.mockRejectedValueOnce(new Error("Payouts not enabled"));
    await commerce.completeJob(tx.id, s);
    await commerce.completeJob(tx.id, s);
    expect(pp.createPayout).toHaveBeenCalledTimes(1);
    expect(txGet(tx.id)!.payout).toMatchObject({ status: "FAILED", error: "Payouts not enabled" });

    delete process.env.PAYOUT_RECEIVER_EMAIL;
    const other = await paidVisit(newSession());
    await commerce.completeJob(other.id, other.sessionId);
    expect(pp.createPayout).toHaveBeenCalledTimes(1);
    expect(txGet(other.id)!.events.at(-1)!.type).toBe("Technician payout skipped");
  });

  it("is only for paid visits of the session", async () => {
    const s = newSession();
    const tx = await paidVisit(s);
    await expect(commerce.completeJob(tx.id, newSession())).rejects.toThrow(/not found/i);
    const unpaid = await commerce.sendTechnicianInvoice({ sessionId: s, technicianId: "tech_maria", email: "b@x.com", when: "ASAP", carId: "corolla", hours: 1 });
    await expect(commerce.completeJob(unpaid.id, s)).rejects.toThrow(/Only a paid technician visit/);
  });
});

describe("payout and refund webhooks", () => {
  it("follows the payout to SUCCESS from the webhook or the reconciler", async () => {
    const s = newSession();
    const one = await commerce.completeJob((await paidVisit(s)).id, s);
    const item = { payout_item_id: "ITEM-9", transaction_status: "SUCCESS", payout_item_fee: { value: "0.25" }, payout_item: { sender_item_id: one.id } };
    expect(commerce.applyWebhook({ event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: item as never })?.payout).toMatchObject({ status: "SUCCESS", itemId: "ITEM-9", fee: "0.25" });
    const events = txGet(one.id)!.events.length;
    commerce.applyWebhook({ event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: item as never });
    expect(txGet(one.id)!.events).toHaveLength(events);

    const two = await commerce.completeJob((await paidVisit(s)).id, s);
    await reconcile.reconcileOnce();
    expect(pp.getPayoutBatch).toHaveBeenCalledWith(two.payout!.batchId);
    expect(txGet(two.id)!.payout).toMatchObject({ status: "SUCCESS", itemId: "ITEM-1" });
  });

  it("logs a partial refund without marking the payment refunded", async () => {
    const s = newSession();
    const tx = await paidVisit(s);
    const partial = { id: "REF-P", amount: { value: "95.00" }, seller_payable_breakdown: { total_refunded_amount: { value: "95.00" } }, links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/PAY-1" }] };
    const after = commerce.applyWebhook({ event_type: "PAYMENT.CAPTURE.REFUNDED", resource: partial })!;
    expect(after.status).toBe("PAID");
    expect(after.events.at(-1)!.type).toBe("Partial refund completed · $95.00 of $249.00");
    commerce.applyWebhook({ event_type: "PAYMENT.CAPTURE.REFUNDED", resource: partial });
    expect(txGet(tx.id)!.events.filter((e) => e.type.startsWith("Partial refund"))).toHaveLength(1);

    const full = { id: "REF-F", amount: { value: "154.00" }, seller_payable_breakdown: { total_refunded_amount: { value: "249.00" } }, links: partial.links };
    expect(commerce.applyWebhook({ event_type: "PAYMENT.CAPTURE.REFUNDED", resource: full })!.status).toBe("REFUNDED");
  });
});
