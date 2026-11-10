import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getShop } from "@/lib/catalog/providers";

/** The next open slot at the brake shop (slots are real times, so tests pick one at run time). */
const SLOT = getShop("shop_precision_brake")!.nextSlots[0];

// PayPal is mocked: these tests cover agent-prepared actions, one-tap guardrails and Vault wiring.
const pp = vi.hoisted(() => {
  let n = 0;
  return {
    createOrder: vi.fn(async (i: { referenceId: string; intent: string; vault?: { vaultId?: string } }) => {
      const orderId = `ORDER${++n}`;
      if (i.vault?.vaultId) {
        return i.intent === "CAPTURE"
          ? { orderId, status: "COMPLETED", captureId: `CAP${n}`, captureStatus: "COMPLETED", payer: "buyer@example.com" }
          : { orderId, status: "COMPLETED", authorizationId: `AUTH${n}`, authorizationStatus: "CREATED", payer: "buyer@example.com" };
      }
      return { orderId, status: "PAYER_ACTION_REQUIRED", approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}` };
    }),
    captureOrder: vi.fn(async () => ({ status: "COMPLETED", captureId: "CAP-A", captureStatus: "COMPLETED", payer: "buyer@example.com", vault: { id: "VAULT-1", status: "VAULTED", customerId: "CUST-1" } })),
    authorizeOrder: vi.fn(async () => ({ status: "COMPLETED", authorizationId: "AUTH-A", authorizationStatus: "CREATED" })),
    createAndSendInvoice: vi.fn(async () => ({ id: "INV2-B", status: "SENT", detail: { invoice_number: "0002", metadata: {} } })),
    deletePaymentToken: vi.fn(async () => undefined),
  };
});
vi.mock("@/lib/server/paypal", () => ({
  ...pp,
  isPayPalConfigured: () => true,
  PayPalNotConfigured: class extends Error {},
  RestError: class extends Error {},
  paypalErrorMessage: (e: Error) => e.message,
}));

const actions = await import("@/lib/server/actions");
const wallet = await import("@/lib/server/wallet");
const { txGet } = await import("@/lib/server/db");

let session = 0;
const newSession = () => `session-actions-${++session}`;
const origin = "https://crankwell.test";
const pads = { kind: "parts" as const, carId: "corolla", partId: "brakes.pads.fl", items: [{ sku: "FYC-COROLLA-BRAKE_PADS-O", quantity: 1 }] };

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("prepare", () => {
  it("prices from the server catalog, whatever the agent claims", () => {
    const a = actions.prepareAction(newSession(), { ...pads, items: [{ sku: pads.items[0].sku, quantity: 2 }] }, { source: "claude" });
    expect(a.status).toBe("pending");
    expect(a.amount).toBe((62.99 * 2 + 7.99).toFixed(2));
    expect(a.lines.at(-1)?.label).toMatch(/Shipping/);
    expect(a.policy).toMatch(/Charged now/);
  });

  it("explains holds and invoices", () => {
    const s = newSession();
    expect(actions.prepareAction(s, { kind: "shop_deposit", carId: "corolla", shopId: "shop_precision_brake", slot: SLOT }, { source: "app" }).policy).toMatch(/Held, not charged/);
    const t = actions.prepareAction(s, { kind: "technician_invoice", carId: "corolla", technicianId: "tech_maria", when: "ASAP", hours: 2 }, { source: "app" });
    expect(t.amount).toBe((59 + 2 * 95).toFixed(2));
    expect(t.policy).toMatch(/invoice/);
  });

  it("rejects ids that aren't in the catalog", () => {
    expect(() => actions.prepareAction(newSession(), { ...pads, items: [{ sku: "FYC-NOPE", quantity: 1 }] }, { source: "app" })).toThrow(/Unknown part SKU/);
    expect(() => actions.prepareAction(newSession(), { kind: "shop_deposit", carId: "corolla", shopId: "shop_precision_brake", slot: "2020-01-05T03:00:00.000Z" }, { source: "app" })).toThrow(/slot/);
  });
});

describe("confirm", () => {
  it("needs PayPal approval first, then saved PayPal makes the next one one tap", async () => {
    const s = newSession();
    const first = actions.prepareAction(s, pads, { source: "claude" });
    await expect(actions.confirmAction(first.id, s, { origin })).rejects.toThrow(/Approve this one in PayPal/);

    const { approveUrl, orderId } = await actions.startApproval(first.id, { origin, save: true, returnTo: "pay" });
    expect(approveUrl).toContain("checkoutnow");
    const created = pp.createOrder.mock.calls[0][0] as unknown as { vault: unknown; returnUrl: string; cancelUrl: string };
    expect(created.vault).toEqual({ save: true });
    expect(created.returnUrl).toBe(`${origin}/pay/return`);
    expect(created.cancelUrl).toBe(`${origin}/pay/${first.id}?cancelled=1`);

    const done = await actions.completeApproval(orderId, null);
    expect(done.action?.status).toBe("confirmed");
    expect(done.action?.via).toBe("approval");
    expect(wallet.walletInfo(s)?.email).toBe("buyer@example.com");

    const second = actions.prepareAction(s, pads, { source: "claude" });
    expect(actions.oneTapBlocker(second, s)).toBeNull();
    const r = await actions.confirmAction(second.id, s, { origin });
    expect(r.action.status).toBe("confirmed");
    expect(r.action.via).toBe("vault");
    expect(r.tx?.status).toBe("COMPLETED");
    expect((pp.createOrder.mock.calls[1][0] as unknown as { vault: unknown }).vault).toEqual({ vaultId: "VAULT-1" });
  });

  it("can't pay twice, and only the owner can confirm", async () => {
    const s = newSession();
    wallet.saveWallet(s, { id: "VAULT-2", status: "VAULTED" }, "b@example.com");
    const a = actions.prepareAction(s, pads, { source: "app" });
    await expect(actions.confirmAction(a.id, "someone-else-123", { origin })).rejects.toThrow(/not found/);
    const [x, y] = await Promise.allSettled([actions.confirmAction(a.id, s, { origin }), actions.confirmAction(a.id, s, { origin })]);
    expect([x.status, y.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(pp.createOrder).toHaveBeenCalledTimes(1);
    const again = await actions.confirmAction(a.id, s, { origin });
    expect(again.action.status).toBe("confirmed");
    expect(pp.createOrder).toHaveBeenCalledTimes(1);
  });

  it("holds a shop deposit with one tap", async () => {
    const s = newSession();
    wallet.saveWallet(s, { id: "VAULT-3", status: "VAULTED" });
    const a = actions.prepareAction(s, { kind: "shop_deposit", carId: "corolla", shopId: "shop_precision_brake", slot: SLOT }, { source: "claude" });
    const r = await actions.confirmAction(a.id, s, { origin });
    expect(r.tx?.status).toBe("AUTHORIZED");
    expect(r.tx?.paypal.authorizationId).toMatch(/^AUTH/);
  });

  it("caps one-tap per order and per day", async () => {
    const s = newSession();
    wallet.saveWallet(s, { id: "VAULT-4", status: "VAULTED" });
    const big = actions.prepareAction(s, { kind: "parts", carId: "corolla", partId: "cooling.radiator", items: [{ sku: "FYC-COROLLA-RADIATOR-O", quantity: 3 }] }, { source: "app" });
    expect(actions.oneTapBlocker(big, s)).toMatch(/\$500 per order/);
    for (let i = 0; i < 2; i++) {
      const a = actions.prepareAction(s, { kind: "parts", carId: "corolla", partId: "cooling.radiator", items: [{ sku: "FYC-COROLLA-RADIATOR-P", quantity: 1 }] }, { source: "app" });
      if (!actions.oneTapBlocker(a, s)) await actions.confirmAction(a.id, s, { origin });
    }
    const third = actions.prepareAction(s, { kind: "parts", carId: "corolla", partId: "cooling.radiator", items: [{ sku: "FYC-COROLLA-RADIATOR-P", quantity: 1 }] }, { source: "app" });
    expect(actions.oneTapBlocker(third, s)).toMatch(/a day/);
  });

  it("counts every one-tap charge toward the daily cap, however many cards were opened since", async () => {
    const s = newSession();
    wallet.saveWallet(s, { id: "VAULT-4B", status: "VAULTED" });
    const radiator = { kind: "parts" as const, carId: "corolla", partId: "cooling.radiator", items: [{ sku: "FYC-COROLLA-RADIATOR-P", quantity: 1 }] };
    const first = actions.prepareAction(s, radiator, { source: "app" });
    await actions.confirmAction(first.id, s, { origin });
    const spent = actions.oneTapSpentToday(s);
    expect(spent).toBeCloseTo(Number(first.amount));
    // More cards than a listing returns: the charge must not drop out of the total.
    for (let i = 0; i < 25; i++) actions.prepareAction(s, pads, { source: "app" });
    expect(actions.listActions(s).some((a) => a.id === first.id)).toBe(false);
    expect(actions.oneTapSpentToday(s)).toBeCloseTo(spent);
  });

  it("expires unconfirmed offers after 15 minutes", async () => {
    const s = newSession();
    wallet.saveWallet(s, { id: "VAULT-5", status: "VAULTED" });
    vi.useFakeTimers({ toFake: ["Date"] });
    const a = actions.prepareAction(s, pads, { source: "app" });
    vi.setSystemTime(Date.now() + actions.ACTION_TTL_MS + 1000);
    expect(actions.getAction(a.id)?.status).toBe("expired");
    await expect(actions.confirmAction(a.id, s, { origin })).rejects.toThrow(/expired/);
  });

  it("books a technician by sending the PayPal invoice", async () => {
    const s = newSession();
    const a = actions.prepareAction(s, { kind: "technician_invoice", carId: "corolla", technicianId: "tech_maria", when: "ASAP", hours: 1 }, { source: "claude" });
    await expect(actions.confirmAction(a.id, s, { origin })).rejects.toThrow(/email/);
    const r = await actions.confirmAction(a.id, s, { origin, email: "buyer@example.com" });
    expect(r.action.via).toBe("invoice");
    expect(txGet(r.action.txId!)?.status).toBe("SENT");
  });
});

describe("buy from a parts card", () => {
  const buy = async ({ sessionId, ...body }: { sessionId: string } & Record<string, unknown>) => {
    const { POST } = await import("@/app/api/actions/route");
    const headers = { "content-type": "application/json", cookie: `cw_sid=${sessionId}`, origin: "https://crankwell.test" };
    return POST(new Request("https://crankwell.test/api/actions", { method: "POST", headers, body: JSON.stringify(body) }));
  };

  it("prices the SKU on the server for the part on the card", async () => {
    const s = newSession();
    const res = await buy({ sessionId: s, sku: "FYC-COROLLA-BRAKE_PADS-O", partId: "brakes.pads.fr" });
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.action.status).toBe("pending");
    expect(r.action.payload).toMatchObject({ kind: "parts", partId: "brakes.pads.fr", items: [{ sku: "FYC-COROLLA-BRAKE_PADS-O", quantity: 1 }] });
    expect(r.oneTapBlocker).toMatch(/Save PayPal/);
    expect(actions.listActions(s).map((a) => a.id)).toContain(r.action.id);
  });

  it("ignores a part the SKU doesn't fit and rejects unknown SKUs", async () => {
    const s = newSession();
    const r = await (await buy({ sessionId: s, sku: "FYC-COROLLA-BRAKE_PADS-O", partId: "electrical.battery" })).json();
    expect(r.action.payload.partId).toMatch(/^brakes\.pads\./);
    expect((await buy({ sessionId: s, sku: "FYC-COROLLA-NOPE-O" })).status).toBe(404);
  });
});
