import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSpareParts } from "@/lib/catalog/spare-parts";
import { allowedOps } from "@/lib/commerce/ops";

// The PayPal Agent Toolkit is mocked: these tests cover how the agent reaches it. Every lookup is
// scoped to one of the session's own orders, only the allowlisted read tools (plus the invoice
// reminder, after a tap) are enabled, and PayPal errors come back as tool errors.
const tk = vi.hoisted(() => ({
  config: null as unknown,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  replies: {} as Record<string, unknown>,
}));
vi.mock("@paypal/agent-toolkit/openai", () => ({
  PayPalAgentToolkit: class {
    constructor(opts: { configuration: unknown }) {
      tk.config = opts.configuration;
    }
    async handleToolCall(call: { id: string; function: { name: string; arguments: string } }) {
      const args = JSON.parse(call.function.arguments);
      tk.calls.push({ name: call.function.name, args });
      const reply = tk.replies[call.function.name];
      return { role: "tool", tool_call_id: call.id, content: JSON.stringify(typeof reply === "function" ? reply(args) : (reply ?? "")) };
    }
  },
}));

const pp = vi.hoisted(() => {
  let n = 0;
  return {
    createOrder: vi.fn(async () => {
      const orderId = `TK-ORDER${++n}`;
      return { orderId, status: "COMPLETED", captureId: `TK-CAP${n}`, captureStatus: "COMPLETED", payer: "b@x.com" };
    }),
    createAndSendInvoice: vi.fn(async () => ({ id: `INV2-TK${++n}`, status: "SENT", detail: { invoice_number: `00${n}`, metadata: {} } })),
    getOrder: vi.fn(async () => {
      throw new Error("offline");
    }),
  };
});
vi.mock("@/lib/server/paypal", () => ({
  ...pp,
  isPayPalConfigured: () => true,
  paypalEnv: () => "sandbox",
  isNotFound: () => false,
  PayPalNotConfigured: class extends Error {},
  RestError: class extends Error {},
  paypalErrorMessage: (e: Error) => e.message,
}));

const commerce = await import("@/lib/server/commerce");
const actions = await import("@/lib/server/actions");
const { runTool, TOOLS } = await import("@/lib/agent/tools");
const { PROTECTED_TOOLS } = await import("@/lib/mcp/server");
const { txGet } = await import("@/lib/server/db");

let n = 0;
const newSession = () => `session-toolkit-${++n}`;
const origin = "https://crankwell.test";
const pads = getSpareParts("corolla", "brakes.pads.fl")[0];
const ctx = (sessionId: string) => ({ sessionId, view: { carId: "corolla" as const }, emit: () => {} }) as never;
const lookup = async (s: string, order_ref: string, about: string) => runTool("paypal_lookup", { order_ref, about }, ctx(s));
const paidParts = async (s: string) => (await commerce.createPartsOrder({ sessionId: s, items: [{ sku: pads.sku, quantity: 1 }], carId: "corolla", partId: "brakes.pads.fl", origin, vault: { vaultId: "V" } })).tx;
const sentInvoice = (s: string) => commerce.sendTechnicianInvoice({ sessionId: s, technicianId: "tech_maria", email: "b@x.com", when: "ASAP", carId: "corolla", hours: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  tk.calls.length = 0;
  tk.replies = {};
});

describe("paypal_lookup", () => {
  it("reads the session's own order from PayPal with the toolkit", async () => {
    const s = newSession();
    const tx = await paidParts(s);
    tk.replies.get_order = (a: { id: string }) => ({
      id: a.id,
      status: "COMPLETED",
      purchase_units: [{ amount: { value: "42.98", currency_code: "USD" }, payments: { captures: [{ id: tx.paypal.captureId, status: "COMPLETED", amount: { value: "42.98", currency_code: "USD" } }] } }],
    });
    const r = await lookup(s, tx.id, "payment");
    expect(r.isError).toBeFalsy();
    expect(tk.calls).toEqual([{ name: "get_order", args: { id: tx.paypal.orderId } }]);
    expect(JSON.parse(r.content)).toMatchObject({ order_ref: tx.id, via: "PayPal Agent Toolkit · get_order", order_status: "COMPLETED", captures: [{ id: tx.paypal.captureId, status: "COMPLETED", amount: "42.98 USD" }] });
  });

  it("never touches another session's order", async () => {
    const tx = await paidParts(newSession());
    const r = await lookup(newSession(), tx.id, "payment");
    expect(r).toMatchObject({ isError: true, content: expect.stringMatching(/Order not found/) });
    expect(tk.calls).toEqual([]);
  });

  it("reads tracking from the order's trackers, and only for parts", async () => {
    const s = newSession();
    const tx = await paidParts(s);
    tk.replies.get_order = { id: tx.paypal.orderId, status: "COMPLETED", purchase_units: [{ shipping: { trackers: [{ id: `${tx.paypal.captureId}-CW1ZABC`, status: "SHIPPED" }] } }] };
    expect(JSON.parse((await lookup(s, tx.id, "tracking")).content).shipments).toEqual([{ tracking_number: "CW1ZABC", status: "SHIPPED" }]);

    const inv = await sentInvoice(s);
    tk.calls.length = 0;
    expect(JSON.parse((await lookup(s, inv.id, "tracking")).content)).toMatchObject({ via: "none", note: expect.stringMatching(/Only parts orders ship/) });
    expect(tk.calls).toEqual([]);
  });

  it("finds disputes by the order's capture", async () => {
    const s = newSession();
    const tx = await paidParts(s);
    tk.replies.list_disputes = { items: [{ dispute_id: "PP-D-1" }] };
    tk.replies.get_dispute = { dispute_id: "PP-D-1", status: "OPEN", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", dispute_amount: { value: "42.98", currency_code: "USD" } };
    const r = JSON.parse((await lookup(s, tx.id, "dispute")).content);
    expect(tk.calls.map((c) => c.name)).toEqual(["list_disputes", "get_dispute"]);
    expect(tk.calls[0].args).toMatchObject({ disputed_transaction_id: tx.paypal.captureId });
    expect(r.disputes).toEqual([expect.objectContaining({ id: "PP-D-1", status: "OPEN", amount: "42.98 USD" })]);
  });

  it("reads invoices with get_invoice and passes PayPal errors back as tool errors", async () => {
    const s = newSession();
    const inv = await sentInvoice(s);
    tk.replies.get_invoice = { ok: false, status: 404, message: "The specified resource does not exist." };
    const r = await lookup(s, inv.id, "payment");
    expect(tk.calls).toEqual([{ name: "get_invoice", args: { invoice_id: inv.paypal.invoiceId } }]);
    expect(r).toMatchObject({ isError: true, content: expect.stringMatching(/PayPal: The specified resource does not exist/) });
  });

  it("enables only read tools and the invoice reminder", async () => {
    const s = newSession();
    await lookup(s, (await paidParts(s)).id, "dispute").catch(() => {});
    expect(tk.config).toEqual({ actions: { orders: { get: true }, invoices: { get: true, sendReminder: true }, disputes: { list: true, get: true } }, context: { sandbox: true } });
    expect(TOOLS.map((t) => (t.type === "function" ? t.function.name : ""))).toContain("paypal_lookup");
    expect(PROTECTED_TOOLS.has("paypal_lookup")).toBe(true);
  });
});

describe("invoice reminder", () => {
  it("is sent by the toolkit only after the user's tap", async () => {
    const s = newSession();
    const inv = await sentInvoice(s);
    expect(allowedOps(inv)).toEqual(["remind_invoice", "cancel_invoice"]);
    const a = actions.prepareAction(s, { kind: "remind_invoice", txId: inv.id }, { source: "app" });
    expect(tk.calls).toEqual([]);
    await actions.confirmAction(a.id, s, { origin });
    expect(tk.calls).toEqual([{ name: "send_invoice_reminder", args: expect.objectContaining({ invoice_id: inv.paypal.invoiceId }) }]);
    const after = txGet(inv.id)!;
    expect(after.status).toBe("SENT");
    expect(after.events.at(-1)).toMatchObject({ type: "Invoice reminder sent", note: "PayPal Agent Toolkit · send_invoice_reminder" });
  });
});
