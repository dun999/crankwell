import { beforeEach, describe, expect, it, vi } from "vitest";
import { getShop } from "@/lib/catalog/providers";
import { getSpareParts } from "@/lib/catalog/spare-parts";
import { allowedOps } from "@/lib/commerce/ops";
import type { Transaction } from "@/lib/commerce/types";

const SLOT = getShop("shop_precision_brake")!.nextSlots[0];

// PayPal is mocked: these tests cover after-sale changes (refund, check-in, cancel) prepared by the
// agent and confirmed by the user's tap.
const pp = vi.hoisted(() => {
  let n = 0;
  return {
    createOrder: vi.fn(async (i: { intent: string }) => {
      const orderId = `OC-ORDER${++n}`;
      return i.intent === "CAPTURE"
        ? { orderId, status: "COMPLETED", captureId: `OC-CAP${n}`, captureStatus: "COMPLETED", payer: "b@x.com" }
        : { orderId, status: "COMPLETED", authorizationId: `OC-AUTH${n}`, authorizationStatus: "CREATED", payer: "b@x.com" };
    }),
    refundCapture: vi.fn(async (captureId: string) => ({ refundId: `REF-${captureId}`, status: "COMPLETED" })),
    captureAuthorization: vi.fn(async (authorizationId: string) => ({ captureId: `CAP-${authorizationId}`, status: "COMPLETED" })),
    voidAuthorization: vi.fn(async () => undefined),
    reauthorize: vi.fn(),
    createAndSendInvoice: vi.fn(async () => ({ id: `INV2-OC${++n}`, status: "SENT", detail: { invoice_number: `00${n}`, metadata: {} } })),
    cancelInvoice: vi.fn(async () => undefined),
    getOrder: vi.fn(async () => {
      throw new Error("offline");
    }),
  };
});
vi.mock("@/lib/server/paypal", () => ({
  ...pp,
  isPayPalConfigured: () => true,
  isNotFound: () => false,
  PayPalNotConfigured: class extends Error {},
  RestError: class extends Error {},
  paypalErrorMessage: (e: Error) => e.message,
}));

const commerce = await import("@/lib/server/commerce");
const actions = await import("@/lib/server/actions");
const { runTool } = await import("@/lib/agent/tools");
const { txGet } = await import("@/lib/server/db");

let n = 0;
const newSession = () => `session-changes-${++n}`;
const origin = "https://crankwell.test";
const pads = getSpareParts("corolla", "brakes.pads.fl")[0];
const vault = { vaultId: "VAULT-OC" };

const paidParts = async (s: string) => (await commerce.createPartsOrder({ sessionId: s, items: [{ sku: pads.sku, quantity: 1 }], carId: "corolla", partId: "brakes.pads.fl", origin, vault })).tx;
const heldDeposit = async (s: string) => (await commerce.createDepositOrder({ sessionId: s, shopId: "shop_precision_brake", slot: SLOT, carId: "corolla", origin, vault })).tx;
const sentInvoice = (s: string) => commerce.sendTechnicianInvoice({ sessionId: s, technicianId: "tech_maria", email: "b@x.com", when: "ASAP", carId: "corolla", hours: 1 });

beforeEach(() => vi.clearAllMocks());

describe("allowedOps", () => {
  const tx = (kind: Transaction["kind"], status: Transaction["status"], paypal: Transaction["paypal"] = { captureId: "C", authorizationId: "A", invoiceId: "I" }) => ({ kind, status, paypal });
  it("offers only what PayPal can do from each state", () => {
    expect(allowedOps(tx("parts", "COMPLETED"))).toEqual(["refund"]);
    expect(allowedOps(tx("parts", "CREATED"))).toEqual([]);
    expect(allowedOps(tx("parts", "REFUNDED"))).toEqual([]);
    expect(allowedOps(tx("shop_deposit", "AUTHORIZED"))).toEqual(["check_in", "cancel_reservation"]);
    expect(allowedOps(tx("shop_deposit", "CAPTURED"))).toEqual(["refund"]);
    expect(allowedOps(tx("shop_deposit", "VOIDED"))).toEqual([]);
    expect(allowedOps(tx("technician_invoice", "SENT"))).toEqual(["cancel_invoice"]);
    expect(allowedOps(tx("technician_invoice", "PAID"))).toEqual([]);
    expect(allowedOps(tx("parts", "COMPLETED", {}))).toEqual([]);
  });
});

describe("prepared changes", () => {
  it("refunds a paid part only after the user's tap", async () => {
    const s = newSession();
    const tx = await paidParts(s);
    const a = actions.prepareAction(s, { kind: "refund", txId: tx.id, reason: "Wrong pads" }, { source: "app" });
    expect(a).toMatchObject({ kind: "refund", status: "pending", amount: tx.amount });
    expect(a.summary).toMatch(/Wrong pads/);
    expect(pp.refundCapture).not.toHaveBeenCalled();
    expect(actions.oneTapBlocker(a, s)).toBeNull();
    const r = await actions.confirmAction(a.id, s, { origin });
    expect(r.action).toMatchObject({ status: "confirmed", via: "change", txId: tx.id });
    expect(r.tx?.status).toBe("REFUNDED");
    expect(pp.refundCapture).toHaveBeenCalledTimes(1);
    expect(actions.actionStatus(a.id, s).message).toMatch(/Refunded/);
  });

  it("checks in or cancels a held deposit", async () => {
    const s = newSession();
    const one = await heldDeposit(s);
    const two = await heldDeposit(s);
    await actions.confirmAction(actions.prepareAction(s, { kind: "check_in", txId: one.id }, { source: "app" }).id, s, { origin });
    await actions.confirmAction(actions.prepareAction(s, { kind: "cancel_reservation", txId: two.id }, { source: "claude" }).id, s, { origin });
    expect(txGet(one.id)!.status).toBe("CAPTURED");
    expect(txGet(two.id)!.status).toBe("VOIDED");
    expect(pp.captureAuthorization).toHaveBeenCalledTimes(1);
    expect(pp.voidAuthorization).toHaveBeenCalledTimes(1);
  });

  it("cancels an unpaid technician invoice", async () => {
    const s = newSession();
    const inv = await sentInvoice(s);
    await actions.confirmAction(actions.prepareAction(s, { kind: "cancel_invoice", txId: inv.id }, { source: "app" }).id, s, { origin });
    expect(txGet(inv.id)!.status).toBe("CANCELLED");
  });

  it("only touches the session's own orders", async () => {
    const tx = await paidParts(newSession());
    expect(() => actions.prepareAction(newSession(), { kind: "refund", txId: tx.id }, { source: "app" })).toThrow(/not found/);
  });

  it("refuses changes the order doesn't allow, and says what is possible", async () => {
    const s = newSession();
    const tx = await heldDeposit(s);
    expect(() => actions.prepareAction(s, { kind: "refund", txId: tx.id }, { source: "app" })).toThrow(/it is authorized\. Possible now: check_in, cancel_reservation/);
  });

  it("shows the same card when asked twice, and never runs a change twice", async () => {
    const s = newSession();
    const tx = await paidParts(s);
    const a = actions.prepareAction(s, { kind: "refund", txId: tx.id }, { source: "app" });
    expect(actions.prepareAction(s, { kind: "refund", txId: tx.id }, { source: "claude" }).id).toBe(a.id);
    const both = await Promise.allSettled([actions.confirmAction(a.id, s, { origin }), actions.confirmAction(a.id, s, { origin })]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(pp.refundCapture).toHaveBeenCalledTimes(1);
  });

  it("re-checks the order at confirm time", async () => {
    const s = newSession();
    const tx = await paidParts(s);
    const a = actions.prepareAction(s, { kind: "refund", txId: tx.id }, { source: "app" });
    await commerce.refund(tx.id, s); // refunded from the Orders panel meanwhile
    await expect(actions.confirmAction(a.id, s, { origin })).rejects.toThrow(/refunded/);
    expect(actions.getAction(a.id)).toMatchObject({ status: "pending", error: expect.stringMatching(/refunded/) });
    expect(pp.refundCapture).toHaveBeenCalledTimes(1);
  });

  it("never sends a change through PayPal approval", async () => {
    const s = newSession();
    const a = actions.prepareAction(s, { kind: "refund", txId: (await paidParts(s)).id }, { source: "app" });
    await expect(actions.startApproval(a.id, { origin, save: false, returnTo: "popup" })).rejects.toThrow(/no PayPal approval/);
  });
});

describe("agent tools", () => {
  it("lists allowed changes and prepares one as a confirm card", async () => {
    const s = newSession();
    const tx = await heldDeposit(s);
    const events: unknown[] = [];
    const ctx = { sessionId: s, view: { carId: "corolla" as const }, emit: (e: unknown) => events.push(e) };
    const orders = JSON.parse((await runTool("get_orders", {}, ctx as never)).content);
    const mine = orders.orders.find((o: { order_ref: string }) => o.order_ref === tx.id);
    expect(mine).toMatchObject({ allowed_changes: ["check_in", "cancel_reservation"], paypal_check: "unavailable" });

    const r = await runTool("prepare_order_change", { order_ref: tx.id, change: "cancel_reservation" }, ctx as never);
    expect(r.isError).toBeFalsy();
    expect(events).toEqual([expect.objectContaining({ type: "action", oneTap: true, action: expect.objectContaining({ kind: "cancel_reservation" }) })]);
    expect(pp.voidAuthorization).not.toHaveBeenCalled();

    const bad = await runTool("prepare_order_change", { order_ref: tx.id, change: "refund" }, ctx as never);
    expect(bad).toMatchObject({ isError: true });
    expect(bad.content).toMatch(/Possible now/);
  });
});
