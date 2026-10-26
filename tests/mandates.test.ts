import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSpareParts } from "@/lib/catalog/spare-parts";

// PayPal is mocked: these tests cover spending mandates, the limits within which the in-app mechanic
// may buy parts with the user's saved PayPal without a card per purchase.
const pp = vi.hoisted(() => {
  let n = 0;
  return {
    createOrder: vi.fn(async (i: { vault?: { vaultId?: string } }) => {
      const orderId = `MD-ORDER${++n}`;
      if (i.vault && "vaultId" in i.vault) return { orderId, status: "COMPLETED", captureId: `MD-CAP${n}`, captureStatus: "COMPLETED", payer: "b@x.com" };
      return { orderId, status: "PAYER_ACTION_REQUIRED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=X" };
    }),
    refundCapture: vi.fn(async (captureId: string) => ({ refundId: `REF-${captureId}`, status: "COMPLETED" })),
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

const mandates = await import("@/lib/server/mandates");
const actions = await import("@/lib/server/actions");
const wallet = await import("@/lib/server/wallet");
const { runTool, TOOLS } = await import("@/lib/agent/tools");
const { db } = await import("@/lib/server/db");

let n = 0;
const origin = "https://crankwell.test";
const pads = getSpareParts("corolla", "brakes.pads.fl")[0]; // $34.99 + $7.99 shipping = $42.98
const battery = getSpareParts("corolla", "electrical.battery")[0] ?? getSpareParts("corolla", "battery")[0];
const crvPads = getSpareParts("crv", "brakes.pads.fl")[0];

/** A session with saved PayPal. */
function newSession() {
  const s = `session-mandate-${++n}`;
  wallet.saveWallet(s, { id: "VAULT-MD", status: "VAULTED" }, "b@x.com");
  return s;
}
const brakes = (s: string, perOrderMax = 100, totalMax = 200) => mandates.approveMandate(mandates.proposeMandate(s, { carId: "corolla", systems: ["brakes"], perOrderMax, totalMax }).id, s);
const buy = (s: string, sku = pads.sku, quantity = 1) => mandates.buyWithinMandate(s, { sku, quantity }, { origin });

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("approving a spending limit", () => {
  it("needs saved PayPal, valid systems, and caps the limits at one-tap's", () => {
    expect(() => mandates.proposeMandate(`no-wallet-${++n}`, { carId: "corolla", systems: ["brakes"], perOrderMax: 50, totalMax: 100 })).toThrow(/Save PayPal first/);
    const s = newSession();
    expect(() => mandates.proposeMandate(s, { carId: "corolla", systems: ["rockets"], perOrderMax: 50, totalMax: 100 })).toThrow(/Unknown system rockets/);
    const m = mandates.proposeMandate(s, { carId: "corolla", systems: ["brakes", "brakes"], perOrderMax: 9000, totalMax: 9000, days: 90 });
    expect(m).toMatchObject({ status: "proposed", systems: ["brakes"], perOrderMax: "500.00", totalMax: "1000.00", days: 30, spent: "0.00" });
    expect(mandates.proposeMandate(s, { carId: "corolla", systems: ["brakes"], perOrderMax: 80, totalMax: 20 }).totalMax).toBe("80.00");
  });

  it("allows nothing until the user approves it", async () => {
    const s = newSession();
    const m = mandates.proposeMandate(s, { carId: "corolla", systems: ["brakes"], perOrderMax: 100, totalMax: 200 });
    await expect(buy(s)).rejects.toThrow(/No active spending limit/);
    const active = mandates.approveMandate(m.id, s);
    expect(active.status).toBe("active");
    expect(Date.parse(active.expiresAt) - Date.parse(active.approvedAt!)).toBe(7 * 24 * 3600_000);
    expect(() => mandates.approveMandate(m.id, newSession())).toThrow(/not found/);
  });

  it("expires an unanswered proposal", () => {
    const s = newSession();
    const m = mandates.proposeMandate(s, { carId: "corolla", systems: ["brakes"], perOrderMax: 100, totalMax: 200 });
    vi.useFakeTimers({ now: Date.now() + 16 * 60_000 });
    expect(() => mandates.approveMandate(m.id, s)).toThrow(/expired/);
  });
});

describe("buying within a limit", () => {
  it("pays with saved PayPal and records the purchase against the limit", async () => {
    const s = newSession();
    const m = brakes(s);
    const r = await buy(s);
    expect(pp.createOrder).toHaveBeenCalledWith(expect.objectContaining({ vault: { vaultId: "VAULT-MD" }, intent: "CAPTURE" }));
    expect(r.action).toMatchObject({ status: "confirmed", via: "mandate", mandateId: m.id, amount: "42.98" });
    expect(r.tx?.status).toBe("COMPLETED");
    expect(r.mandate).toMatchObject({ spent: "42.98", remaining: "157.02", purchases: 1 });
    expect(actions.oneTapSpentToday(s)).toBeCloseTo(42.98);
  });

  it("refuses what the limit doesn't cover, and says why", async () => {
    const s = newSession();
    brakes(s, 40, 200);
    await expect(buy(s)).rejects.toThrow(/\$42\.98 is over its \$40\.00 per order/);
    await expect(buy(s, battery.sku)).rejects.toThrow(/covers brakes, not electrical/);
    await expect(buy(s, crvPads.sku)).rejects.toThrow(/covers the corolla, not this car/);
    expect(pp.createOrder).not.toHaveBeenCalled();
  });

  it("stops at the total", async () => {
    const s = newSession();
    brakes(s, 50, 60);
    await buy(s);
    await expect(buy(s)).rejects.toThrow(/only \$17\.02 of it is left/);
    expect(pp.createOrder).toHaveBeenCalledTimes(1);
  });

  it("lets only one of two simultaneous purchases use the last of a limit", async () => {
    const s = newSession();
    const m = brakes(s, 50, 60);
    const both = await Promise.allSettled([buy(s), buy(s)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(pp.createOrder).toHaveBeenCalledTimes(1);
    expect(mandates.getMandate(m.id, s).spent).toBe("42.98");
  });

  it("gives the limit back when PayPal fails", async () => {
    const s = newSession();
    const m = brakes(s);
    pp.createOrder.mockRejectedValueOnce(new Error("INSTRUMENT_DECLINED"));
    await expect(buy(s)).rejects.toThrow(/INSTRUMENT_DECLINED/);
    expect(mandates.getMandate(m.id, s)).toMatchObject({ spent: "0.00", purchases: 0 });
    expect(actions.listActions(s)[0]).toMatchObject({ status: "cancelled" });
  });

  it("ends on expiry or revoke", async () => {
    const s = newSession();
    const m = brakes(s);
    vi.useFakeTimers({ now: Date.now() + 8 * 24 * 3600_000 });
    await expect(buy(s)).rejects.toThrow(/No active spending limit/);
    expect(mandates.getMandate(m.id, s).status).toBe("expired");
    vi.useRealTimers();

    const t = newSession();
    const m2 = brakes(t);
    expect(mandates.revokeMandate(m2.id, t).status).toBe("revoked");
    await expect(buy(t)).rejects.toThrow(/No active spending limit/);
  });

  it("refuses terms changed outside the app", async () => {
    const s = newSession();
    const m = brakes(s, 100, 200);
    const row = db().prepare("SELECT terms FROM mandates WHERE id = ?").get(m.id) as { terms: string };
    db().prepare("UPDATE mandates SET terms = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(row.terms), perOrderCents: 50_000 }), m.id);
    await expect(buy(s)).rejects.toThrow(/failed verification/);
    expect(pp.createOrder).not.toHaveBeenCalled();
  });
});

describe("agent tools", () => {
  const ctx = (sessionId: string, events: unknown[]) => ({ sessionId, view: { carId: "corolla" as const }, emit: (e: unknown) => events.push(e), origin }) as never;

  it("proposes as a card, buys once allowed, and revokes on request", async () => {
    const s = newSession();
    const events: { type: string; mandate?: { id: string } }[] = [];
    const proposed = await runTool("propose_mandate", { car_id: "corolla", systems: ["brakes"], per_order_max_usd: 120, total_max_usd: 300, reason: "Order whatever brake parts it needs" }, ctx(s, events));
    expect(JSON.parse(proposed.content)).toMatchObject({ status: "waiting_for_user" });
    expect(events[0]).toMatchObject({ type: "mandate", mandate: { status: "proposed", perOrderMax: "120.00" } });

    const early = await runTool("buy_within_mandate", { sku: pads.sku }, ctx(s, events));
    expect(early).toMatchObject({ isError: true, content: expect.stringMatching(/No active spending limit/) });

    mandates.approveMandate(events[0].mandate!.id, s);
    const orders = JSON.parse((await runTool("get_orders", {}, ctx(s, events))).content);
    expect(orders.spending_limits).toEqual([expect.objectContaining({ status: "active", systems: ["brakes"], left_usd: "300.00" })]);

    const bought = JSON.parse((await runTool("buy_within_mandate", { sku: pads.sku }, ctx(s, events))).content);
    expect(bought).toMatchObject({ status: "bought", amount_usd: "42.98", limit_left_usd: "257.02" });
    expect(events.at(-1)).toMatchObject({ type: "action", oneTap: true });

    expect(JSON.parse((await runTool("revoke_mandates", {}, ctx(s, events))).content)).toMatchObject({ revoked: 1 });
    expect(mandates.listMandates(s)[0].status).toBe("revoked");
  });

  it("are in-app only: Claude over MCP can't buy without a tap", () => {
    const names = TOOLS.map((t) => (t.type === "function" ? t.function.name : ""));
    expect(names).toEqual(expect.arrayContaining(["propose_mandate", "buy_within_mandate", "revoke_mandates"]));
    const mcp = readFileSync("lib/mcp/server.ts", "utf8");
    expect(mcp).not.toMatch(/mandate/i);
  });
});
