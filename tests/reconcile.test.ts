import { beforeEach, describe, expect, it, vi } from "vitest";
import { getShop, slotOpen, zoneFor } from "@/lib/catalog/providers";
import { openSlots, slotDate, slotLabel } from "@/lib/catalog/slots";
import { getSpareParts } from "@/lib/catalog/spare-parts";

// PayPal is mocked: these tests cover keeping our copy in line with PayPal (reconciler, webhooks for
// reversals and disputes, reauthorization) and the real-time shop slots.
const pp = vi.hoisted(() => {
  let n = 0;
  class NotFound extends Error {}
  return {
    NotFound,
    createOrder: vi.fn(async (i: { intent: string; vault?: { vaultId?: string } }) => {
      const orderId = `RC-ORDER${++n}`;
      if (i.vault?.vaultId) {
        return i.intent === "CAPTURE"
          ? { orderId, status: "COMPLETED", captureId: `RC-CAP${n}`, captureStatus: "COMPLETED", payer: "b@x.com" }
          : { orderId, status: "COMPLETED", authorizationId: `RC-AUTH${n}`, authorizationStatus: "CREATED", payer: "b@x.com" };
      }
      return { orderId, status: "PAYER_ACTION_REQUIRED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=X" };
    }),
    captureOrder: vi.fn(async (orderId: string) => ({ orderId, status: "COMPLETED", captureId: `CAP-${orderId}`, captureStatus: "COMPLETED", payer: "b@x.com" })),
    authorizeOrder: vi.fn(async (orderId: string) => ({ orderId, status: "COMPLETED", authorizationId: `AUTH-${orderId}`, authorizationStatus: "CREATED", expires: "2026-12-01T00:00:00Z" })),
    getOrder: vi.fn(),
    reauthorize: vi.fn(async () => ({ authorizationId: "AUTH-RENEWED", status: "CREATED", expires: "2026-12-20T00:00:00Z" })),
    captureAuthorization: vi.fn(async (authorizationId: string) => ({ captureId: `CAP-${authorizationId}`, status: "COMPLETED" })),
    getInvoice: vi.fn(),
    addTracking: vi.fn(async () => ({ trackerId: "RC-TRACK", status: "SHIPPED" })),
    createAndSendInvoice: vi.fn(async () => ({ id: "INV2-RC", status: "SENT", detail: { invoice_number: "0009", metadata: {} } })),
  };
});
vi.mock("@/lib/server/paypal", () => ({
  ...pp,
  verifyWebhookSignature: async () => true,
  isPayPalConfigured: () => true,
  isNotFound: (e: unknown) => e instanceof pp.NotFound,
  PayPalNotConfigured: class extends Error {},
  RestError: class extends Error {},
  paypalErrorMessage: (e: Error) => e.message,
}));

// after() needs a request scope; collect its callbacks and run them by hand.
const later = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: (fn: () => Promise<void>) => later.push(fn) }));

const commerce = await import("@/lib/server/commerce");
const actions = await import("@/lib/server/actions");
const reconcile = await import("@/lib/server/reconcile");
const wallet = await import("@/lib/server/wallet");
const { db, txGet, txUpdate } = await import("@/lib/server/db");

let n = 0;
const newSession = () => `session-reconcile-${++n}`;
const origin = "https://crankwell.test";
const SLOT = getShop("shop_precision_brake")!.nextSlots[0];
const pads = getSpareParts("corolla", "brakes.pads.fl")[0];
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Pretend a transaction was last touched a while ago, so the reconciler picks it up. */
function age(txId: string, minutes: number) {
  const tx = txGet(txId)!;
  const at = minutesAgo(minutes);
  db().prepare("UPDATE transactions SET updated_at = ?, created_at = ?, data = ? WHERE id = ?").run(at, at, JSON.stringify({ ...tx, createdAt: at, updatedAt: at }), txId);
}

async function partsCheckout(s: string, actionId?: string) {
  return commerce.createPartsOrder({ sessionId: s, items: [{ sku: pads.sku, quantity: 1 }], carId: "corolla", partId: "brakes.pads.fl", origin, actionId });
}

beforeEach(() => {
  vi.clearAllMocks();
  db().prepare("DELETE FROM transactions").run();
});

describe("completing approved orders", () => {
  it("shares one capture between the popup, the webhook and the reconciler", async () => {
    const s = newSession();
    const { orderId } = await partsCheckout(s);
    const [a, b] = await Promise.all([actions.completeApproval(orderId, s), actions.completeApproval(orderId, null)]);
    expect(a.tx.status).toBe("COMPLETED");
    expect(b.tx.id).toBe(a.tx.id);
    expect(pp.captureOrder).toHaveBeenCalledTimes(1);
    expect(txGet(a.tx.id)!.events.filter((e) => e.type === "Payment captured")).toHaveLength(1);
  });

  it("still checks ownership", async () => {
    const { orderId } = await partsCheckout(newSession());
    await expect(actions.completeApproval(orderId, "someone-else-1234")).rejects.toThrow(/not found/);
  });
});

describe("CHECKOUT.ORDER.APPROVED webhook", () => {
  const deliver = async (id: string, orderId: string) => {
    const { POST } = await import("@/app/api/paypal/webhook/route");
    const body = JSON.stringify({ id, event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: orderId } });
    return POST(new Request("https://crankwell.test/api/paypal/webhook", { method: "POST", body }));
  };

  it("captures the order after the popup's grace period", async () => {
    const { orderId, tx } = await partsCheckout(newSession());
    later.length = 0;
    expect((await deliver("WH-APPROVED-1", orderId)).status).toBe(200);
    expect(txGet(tx.id)!.status).toBe("APPROVED");
    expect(later).toHaveLength(1);
    vi.useFakeTimers();
    try {
      const run = later[0]();
      await vi.advanceTimersByTimeAsync(5_000);
      await run;
    } finally {
      vi.useRealTimers();
    }
    expect(txGet(tx.id)!.status).toBe("COMPLETED");
  });

  it("leaves it alone when the popup already captured it", async () => {
    const s = newSession();
    const { orderId, tx } = await partsCheckout(s);
    await actions.completeApproval(orderId, s);
    later.length = 0;
    await deliver("WH-APPROVED-2", orderId);
    expect(later).toHaveLength(0);
    expect(txGet(tx.id)!.events.at(-1)).toMatchObject({ late: true });
  });
});

describe("reconciler", () => {
  it("captures an order the buyer approved but the popup never reported", async () => {
    const s = newSession();
    const a = actions.prepareAction(s, { kind: "parts", carId: "corolla", partId: "brakes.pads.fl", items: [{ sku: pads.sku, quantity: 1 }] }, { source: "app" });
    const { orderId } = await actions.startApproval(a.id, { origin, save: false, returnTo: "popup" });
    const tx = actions.getAction(a.id)!.txId!;
    age(tx, 5);
    pp.getOrder.mockResolvedValueOnce({ orderId, status: "APPROVED" });
    const r = await reconcile.reconcileOnce();
    expect(r.fixed.join()).toMatch(/CREATED→COMPLETED/);
    expect(txGet(tx)!.status).toBe("COMPLETED");
    expect(actions.getAction(a.id)).toMatchObject({ status: "confirmed", via: "approval" });
  });

  it("settles a capture PayPal has but we never recorded", async () => {
    const { tx } = await partsCheckout(newSession());
    age(tx.id, 5);
    pp.getOrder.mockResolvedValueOnce({ orderId: tx.paypal.orderId, status: "COMPLETED", captureId: "CAP-ELSEWHERE", captureStatus: "COMPLETED", payer: "b@x.com" });
    await reconcile.reconcileOnce();
    expect(txGet(tx.id)).toMatchObject({ status: "COMPLETED", paypal: { captureId: "CAP-ELSEWHERE" } });
    expect(txGet(tx.id)!.events.at(-1)?.type).toBe("Payment confirmed with PayPal");
  });

  it("closes checkouts that expired at PayPal and leaves fresh ones alone", async () => {
    const old = (await partsCheckout(newSession())).tx;
    const fresh = (await partsCheckout(newSession())).tx;
    age(old.id, 200);
    pp.getOrder.mockRejectedValueOnce(new pp.NotFound("RESOURCE_NOT_FOUND"));
    await reconcile.reconcileOnce();
    expect(txGet(old.id)!.status).toBe("CANCELLED");
    expect(txGet(fresh.id)!.status).toBe("CREATED");
    expect(pp.getOrder).toHaveBeenCalledTimes(1);
  });

  it("marks a refund made at PayPal", async () => {
    const { tx } = await partsCheckout(newSession());
    commerce.applyOrderState(tx, { orderId: tx.paypal.orderId!, status: "COMPLETED", captureId: "CAP-R", captureStatus: "COMPLETED" } as never);
    const r = commerce.applyOrderState(txGet(tx.id)!, { orderId: tx.paypal.orderId!, status: "COMPLETED", captureId: "CAP-R", captureStatus: "REFUNDED" } as never);
    expect(r.status).toBe("REFUNDED");
  });

  it("reopens a one-tap interrupted mid-payment, or confirms it if PayPal settled", async () => {
    const s = newSession();
    wallet.saveWallet(s, { id: "VAULT-RC", status: "VAULTED" });
    const stuck = actions.prepareAction(s, { kind: "shop_deposit", carId: "corolla", shopId: "shop_precision_brake", slot: SLOT }, { source: "app" });
    const paid = actions.prepareAction(s, { kind: "parts", carId: "corolla", partId: "brakes.pads.fl", items: [{ sku: pads.sku, quantity: 1 }] }, { source: "app" });
    const setConfirming = (id: string) => {
      const a = actions.getAction(id)!;
      db().prepare("UPDATE actions SET status = 'confirming', data = ? WHERE id = ?").run(JSON.stringify({ ...a, status: "confirming", confirmingSince: minutesAgo(5) }), id);
    };
    setConfirming(stuck.id);
    const { tx } = await commerce.createPartsOrder({ sessionId: s, items: [{ sku: pads.sku, quantity: 1 }], carId: "corolla", partId: "brakes.pads.fl", origin, vault: { vaultId: "VAULT-RC" }, actionId: paid.id });
    setConfirming(paid.id);
    expect(actions.recoverStuckActions()).toHaveLength(2);
    expect(actions.getAction(stuck.id)).toMatchObject({ status: "pending", error: expect.stringMatching(/interrupted/) });
    expect(actions.getAction(paid.id)).toMatchObject({ status: "confirmed", txId: tx.id, via: "vault" });

    // Interrupted while the mechanic bought within a spending limit: still that limit's purchase.
    const bought = actions.prepareAction(s, { kind: "parts", carId: "corolla", partId: "brakes.pads.fl", items: [{ sku: pads.sku, quantity: 1 }] }, { source: "app" });
    await commerce.createPartsOrder({ sessionId: s, items: [{ sku: pads.sku, quantity: 1 }], carId: "corolla", partId: "brakes.pads.fl", origin, vault: { vaultId: "VAULT-RC" }, actionId: bought.id, mandateId: "mdt_test" });
    setConfirming(bought.id);
    expect(actions.recoverStuckActions()).toEqual([bought.id]);
    expect(actions.getAction(bought.id)).toMatchObject({ status: "confirmed", via: "mandate", mandateId: "mdt_test" });
  });
});

describe("orders for the agent", () => {
  it("checks open orders with PayPal and says how fresh each status is", async () => {
    const s = newSession();
    const open = (await partsCheckout(s)).tx;
    const done = (await partsCheckout(s)).tx;
    txUpdate(done.id, { status: "REFUNDED" });
    pp.getOrder.mockResolvedValueOnce({ orderId: open.paypal.orderId, status: "PAYER_ACTION_REQUIRED" });
    const r = await reconcile.ordersForAgent(s);
    const byRef = Object.fromEntries(r.orders.map((o) => [o.order_ref, o]));
    expect(byRef[open.id].paypal_check).toBe("live");
    expect(byRef[done.id].paypal_check).toBe("final");
    pp.getOrder.mockRejectedValueOnce(new Error("timeout"));
    const s2 = newSession();
    const other = (await partsCheckout(s2)).tx;
    expect((await reconcile.ordersForAgent(s2)).orders.find((o) => o.order_ref === other.id)?.paypal_check).toBe("unavailable");
  });
});

describe("webhooks: reversals and disputes", () => {
  async function paid() {
    const s = newSession();
    const { orderId } = await partsCheckout(s);
    return (await actions.completeApproval(orderId, s)).tx;
  }

  it("marks a reversed capture", async () => {
    const tx = await paid();
    const r = commerce.applyWebhook({ event_type: "PAYMENT.CAPTURE.REVERSED", resource: { id: "REV-1", links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${tx.paypal.captureId}` }] } });
    expect(r?.status).toBe("REVERSED");
  });

  it("attaches a dispute to the disputed capture and tracks it to resolution", async () => {
    const tx = await paid();
    const resource = { dispute_id: "PP-D-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status: "OPEN", dispute_life_cycle_stage: "INQUIRY", dispute_amount: { value: tx.amount }, disputed_transactions: [{ seller_transaction_id: tx.paypal.captureId }] };
    const opened = commerce.applyWebhook({ event_type: "CUSTOMER.DISPUTE.CREATED", resource });
    expect(opened?.dispute).toMatchObject({ id: "PP-D-1", status: "OPEN", stage: "INQUIRY" });
    expect(opened?.events.at(-1)?.type).toBe("Buyer opened a dispute · merchandise or service not received");
    const closed = commerce.applyWebhook({ event_type: "CUSTOMER.DISPUTE.RESOLVED", resource: { ...resource, status: "RESOLVED", dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" } } });
    expect(closed?.dispute?.outcome).toBe("RESOLVED_SELLER_FAVOUR");
    expect(closed?.status).toBe("COMPLETED");
  });
});

describe("deposit holds past the honor period", () => {
  it("reauthorizes before capturing an old hold", async () => {
    const s = newSession();
    const { orderId } = await commerce.createDepositOrder({ sessionId: s, shopId: "shop_precision_brake", slot: SLOT, carId: "corolla", origin });
    const held = await commerce.authorizeOrder(orderId, s);
    txUpdate(held.id, { meta: { ...held.meta, authorizedAt: new Date(Date.now() - 4 * 24 * 3600_000).toISOString() } });
    const cap = await commerce.captureDeposit(held.id, s);
    expect(pp.reauthorize).toHaveBeenCalledWith(held.paypal.authorizationId, expect.any(String));
    expect(pp.captureAuthorization).toHaveBeenCalledWith("AUTH-RENEWED", expect.any(String));
    expect(cap).toMatchObject({ status: "CAPTURED", paypal: { authorizationId: "AUTH-RENEWED" } });
  });

  it("captures a fresh hold directly, and the original when renewal is declined", async () => {
    const s = newSession();
    const fresh = await commerce.authorizeOrder((await commerce.createDepositOrder({ sessionId: s, shopId: "shop_precision_brake", slot: SLOT, carId: "corolla", origin })).orderId, s);
    await commerce.captureDeposit(fresh.id, s);
    expect(pp.reauthorize).not.toHaveBeenCalled();
    const old = await commerce.authorizeOrder((await commerce.createDepositOrder({ sessionId: s, shopId: "shop_precision_brake", slot: SLOT, carId: "corolla", origin })).orderId, s);
    txUpdate(old.id, { meta: { ...old.meta, authorizedAt: new Date(Date.now() - 5 * 24 * 3600_000).toISOString() } });
    pp.reauthorize.mockRejectedValueOnce(new Error("REAUTHORIZATION_NOT_ALLOWED"));
    const cap = await commerce.captureDeposit(old.id, s);
    expect(cap.status).toBe("CAPTURED");
    expect(pp.captureAuthorization).toHaveBeenLastCalledWith(old.paypal.authorizationId, expect.any(String));
    expect(cap.events.some((e) => e.type === "Hold renewal declined")).toBe(true);
  });
});

describe("shop slots", () => {
  const MON_SAT = [1, 2, 3, 4, 5, 6];
  const tz = "America/Los_Angeles";

  it("are real future times in the shop's zone, inside opening hours", () => {
    const now = Date.parse("2026-10-27T17:10:00Z"); // Tue 10:10 AM PDT
    const slots = openSlots({ tz, openDays: MON_SAT, seed: 0, leadMin: 60, now });
    expect(slots.length).toBeGreaterThan(5);
    expect(slots.every((s) => Date.parse(s) >= now + 60 * 60_000)).toBe(true);
    for (const s of slots) {
      const local = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "short" }).format(new Date(s));
      expect(local).not.toMatch(/^Sun/);
      const hour = Number(local.split(" ").at(-1));
      expect(hour >= 8 && hour < 18).toBe(true);
    }
    expect(slotLabel(slots[0], tz, now)).toMatch(/^Today /);
  });

  it("keep wall-clock times across the DST change", () => {
    const slots = openSlots({ tz, openDays: [0, 1, 2, 3, 4, 5, 6], seed: 0, leadMin: 0, now: Date.parse("2026-10-31T07:00:00Z") });
    expect(slots.map((s) => slotDate(s, tz))).toContain("Sun, Nov 1, 9:30 AM PST");
    expect(slots.map((s) => slotDate(s, tz))).toContain("Sat, Oct 31, 8:00 AM PDT");
  });

  it("accept any open time at the shop and reject the rest", () => {
    const shop = getShop("shop_precision_brake")!;
    expect(shop.timeZone).toBe(tz);
    expect(slotOpen(shop.id, shop.nextSlots[2])).toBe(true);
    expect(slotOpen(shop.id, "Today 3:30 PM")).toBe(false);
    expect(slotOpen(shop.id, "2020-01-01T16:00:00.000Z")).toBe(false);
    expect(slotOpen("shop_nope", shop.nextSlots[0])).toBe(false);
  });

  it("use the local zone near the user", () => {
    expect(zoneFor(-6.2, 106.8)).toBe("Etc/GMT-7");
    expect(zoneFor(40.7, -74)).toBe("Etc/GMT+5");
    expect(zoneFor()).toBe(tz);
  });
});
