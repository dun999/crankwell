import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSpareParts } from "@/lib/catalog/spare-parts";
import { getShop } from "@/lib/catalog/providers";

/** The next open slot at the brake shop (slots are real times, so tests pick one at run time). */
const SLOT = getShop("shop_precision_brake")!.nextSlots[0];

// PayPal is mocked: these tests cover our order logic, pricing and webhook state machine.
const pp = vi.hoisted(() => ({
  createOrder: vi.fn(async (i: { referenceId: string }) => ({ orderId: `ORDER-${i.referenceId.slice(-6)}`, status: "PAYER_ACTION_REQUIRED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=X" })),
  captureOrder: vi.fn(async () => ({ status: "COMPLETED", captureId: "CAP-1", captureStatus: "COMPLETED", payer: "buyer@example.com" })),
  authorizeOrder: vi.fn(async () => ({ status: "COMPLETED", authorizationId: "AUTH-1", authorizationStatus: "CREATED", expires: "2026-10-09T00:00:00Z" })),
  captureAuthorization: vi.fn(async () => ({ captureId: "CAP-AUTH-1", status: "COMPLETED" })),
  voidAuthorization: vi.fn(async () => undefined),
  refundCapture: vi.fn(async () => ({ refundId: "REF-1", status: "COMPLETED" })),
  createAndSendInvoice: vi.fn(async () => ({ id: "INV2-AAAA", status: "SENT", detail: { invoice_number: "0001", metadata: { recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/#INV2-AAAA" } } })),
}));
vi.mock("@/lib/server/paypal", () => ({
  ...pp,
  isPayPalConfigured: () => true,
  PayPalNotConfigured: class extends Error {},
  paypalErrorMessage: (e: Error) => e.message,
  getInvoice: vi.fn(),
  cancelInvoice: vi.fn(),
  deletePaymentToken: vi.fn(),
  RestError: class extends Error {},
}));

const commerce = await import("@/lib/server/commerce");
const db = await import("@/lib/server/db");
const S = "session-aaaa-1111";

describe("parts orders (Orders v2 CAPTURE)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prices strictly from the catalog and adds shipping under the threshold", async () => {
    const sku = getSpareParts("corolla", "brakes.pads.fl")[1];
    const { orderId, tx } = await commerce.createPartsOrder({ sessionId: S, items: [{ sku: sku.sku, quantity: 2 }], carId: "corolla", partId: "brakes.pads.fl", origin: "http://x" });
    const expected = sku.price * 2 + (sku.price * 2 >= 150 ? 0 : 7.99);
    expect(Number(tx.amount)).toBeCloseTo(expected, 2);
    expect(orderId).toMatch(/^ORDER-/);
    const call = pp.createOrder.mock.calls[0][0] as unknown as { intent: string; lines: { unitPrice: number }[] };
    expect(call.intent).toBe("CAPTURE");
    expect(call.lines[0].unitPrice).toBe(sku.price);
  });

  it("rejects unknown SKUs and SKUs from the other car", async () => {
    await expect(commerce.createPartsOrder({ sessionId: S, items: [{ sku: "FYC-COROLLA-NOPE-V", quantity: 1 }], carId: "corolla", partId: "x", origin: "" })).rejects.toThrow(/Unknown part SKU/);
    const crvSku = getSpareParts("crv", "brakes.pads.fl")[0].sku;
    await expect(commerce.createPartsOrder({ sessionId: S, items: [{ sku: crvSku, quantity: 1 }], carId: "corolla", partId: "x", origin: "" })).rejects.toThrow(/Unknown part SKU/);
  });

  it("captures once, is idempotent, and enforces session ownership", async () => {
    const sku = getSpareParts("corolla", "electrical.battery")[0];
    const { orderId } = await commerce.createPartsOrder({ sessionId: S, items: [{ sku: sku.sku, quantity: 1 }], carId: "corolla", partId: "electrical.battery", origin: "" });
    await expect(commerce.captureOrder(orderId, "someone-else-123")).rejects.toThrow(/not found/);
    const tx = await commerce.captureOrder(orderId, S);
    expect(tx.status).toBe("COMPLETED");
    expect(tx.paypal.captureId).toBe("CAP-1");
    await commerce.captureOrder(orderId, S);
    expect(pp.captureOrder).toHaveBeenCalledTimes(1);
    const refunded = await commerce.refund(tx.id, S);
    expect(refunded.status).toBe("REFUNDED");
  });
});

describe("shop deposit (AUTHORIZE → capture / void)", () => {
  it("authorizes, then captures at check-in", async () => {
    const { orderId } = await commerce.createDepositOrder({ sessionId: S, shopId: "shop_precision_brake", slot: SLOT, carId: "corolla", origin: "" });
    const auth = await commerce.authorizeOrder(orderId, S);
    expect(auth.status).toBe("AUTHORIZED");
    const cap = await commerce.captureDeposit(auth.id, S);
    expect(cap.status).toBe("CAPTURED");
    await expect(commerce.voidDeposit(auth.id, S)).rejects.toThrow(/No active authorization/);
  });
  it("rejects slots the shop doesn't offer", async () => {
    await expect(commerce.createDepositOrder({ sessionId: S, shopId: "shop_precision_brake", slot: "2020-01-05T03:00:00.000Z", carId: "corolla", origin: "" })).rejects.toThrow(/slot/);
  });
});

describe("webhooks", () => {
  it("deduplicates events by id", () => {
    expect(db.webhookFirstSeen("WH-1", "X", undefined, {})).toBe(true);
    expect(db.webhookFirstSeen("WH-1", "X", undefined, {})).toBe(false);
  });

  it("never downgrades status on out-of-order delivery", async () => {
    const sku = getSpareParts("corolla", "cooling.radiator")[0];
    const { orderId } = await commerce.createPartsOrder({ sessionId: S, items: [{ sku: sku.sku, quantity: 1 }], carId: "corolla", partId: "cooling.radiator", origin: "" });
    await commerce.captureOrder(orderId, S);
    const late = commerce.applyWebhook({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: orderId } });
    expect(late?.status).toBe("COMPLETED");
    expect(late?.events.at(-1)?.source).toBe("paypal-webhook");
  });

  it("maps refund events back to the capture via the 'up' link", async () => {
    const sku = getSpareParts("corolla", "engine.oil_filter")[0];
    const { orderId } = await commerce.createPartsOrder({ sessionId: S, items: [{ sku: sku.sku, quantity: 1 }], carId: "corolla", partId: "engine.oil_filter", origin: "" });
    pp.captureOrder.mockResolvedValueOnce({ status: "COMPLETED", captureId: "CAP-77", captureStatus: "COMPLETED", payer: "b@x.com" });
    await commerce.captureOrder(orderId, S);
    const r = commerce.applyWebhook({
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: { id: "REF-77", links: [{ rel: "up", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAP-77" }] },
    });
    expect(r?.status).toBe("REFUNDED");
    expect(r?.paypal.refundId).toBe("REF-77");
  });

  it("confirms a technician booking when the invoice is paid", async () => {
    const tx = await commerce.sendTechnicianInvoice({ sessionId: S, technicianId: "tech_lin", email: "buyer@personal.example.com", when: "ASAP", carId: "corolla", hours: 2 });
    expect(tx.status).toBe("SENT");
    expect(Number(tx.amount)).toBe(65 + 2 * 110);
    const paid = commerce.applyWebhook({ event_type: "INVOICING.INVOICE.PAID", resource: { invoice: { id: "INV2-AAAA" } } });
    expect(paid?.status).toBe("PAID");
  });
});
