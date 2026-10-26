import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The Crankwell MCP connector end to end through the route handler (PayPal mocked): lazy auth,
// the card resource, and the one-tap path that only the checkout card can trigger.
const pp = vi.hoisted(() => ({
  createOrder: vi.fn(async (i: { intent: string; vault?: { vaultId?: string } }) =>
    i.vault?.vaultId
      ? { orderId: "ORDER-V", status: "COMPLETED", authorizationId: "AUTH-V", authorizationStatus: "CREATED", captureId: "CAP-V", captureStatus: "COMPLETED" }
      : { orderId: "ORDER-A", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-A" },
  ),
  captureOrder: vi.fn(),
  authorizeOrder: vi.fn(),
  createAndSendInvoice: vi.fn(),
  deletePaymentToken: vi.fn(),
  voidAuthorization: vi.fn(async () => undefined),
  getOrder: vi.fn(async () => {
    throw new Error("offline");
  }),
}));
vi.mock("@/lib/server/paypal", () => ({
  ...pp,
  isPayPalConfigured: () => true,
  PayPalNotConfigured: class extends Error {},
  RestError: class extends Error {},
  paypalErrorMessage: (e: Error) => e.message,
}));

const ORIGIN = "https://crankwell.test";
vi.stubEnv("PUBLIC_URL", ORIGIN);
const { POST } = await import("@/app/api/mcp/route");
const oauth = await import("@/lib/server/oauth");
const wallet = await import("@/lib/server/wallet");

type Rpc = { status: number; headers: Headers; body: { result?: Record<string, unknown> & { content?: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> }; error?: unknown } };

async function rpc(method: string, params: unknown, token?: string): Promise<Rpc> {
  const res = await POST(
    new Request(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return { status: res.status, headers: res.headers, body: JSON.parse(line ? line.slice(6) : text) };
}
const call = (name: string, args: unknown, token?: string) => rpc("tools/call", { name, arguments: args }, token);

async function pair(sessionId: string) {
  const verifier = "x".repeat(50);
  const reg = oauth.registerClient({ client_name: "Test", redirect_uris: ["http://localhost/callback"] });
  const { req } = await oauth.validateAuthRequest(
    { client_id: reg.client_id, redirect_uri: "http://localhost:4321/callback", response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: `${ORIGIN}/api/mcp` },
    ORIGIN,
  );
  return oauth.exchange({ grant_type: "authorization_code", code: oauth.issueCode(req, sessionId), code_verifier: verifier }).access_token;
}

describe("MCP connector", () => {
  let token: string;
  const session = "session-mcp-1";
  beforeAll(async () => {
    token = await pair(session);
  });

  it("advertises the card on UI tools and hides confirm_purchase from the model", async () => {
    const { body } = await rpc("tools/list", {});
    const tools = body.result!.tools as { name: string; _meta?: { ui?: { resourceUri?: string; visibility?: string[] } } }[];
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const n of ["show_diagnosis", "show_options", "prepare_purchase"]) expect(byName[n]._meta?.ui?.resourceUri).toBe("ui://crankwell/card");
    expect(byName.confirm_purchase._meta?.ui?.visibility).toEqual(["app"]);
  });

  it("serves the card as a self-contained MCP App", async () => {
    const { body } = await rpc("resources/read", { uri: "ui://crankwell/card" });
    const [c] = body.result!.contents as { mimeType: string; text: string }[];
    expect(c.mimeType).toBe("text/html;profile=mcp-app");
    expect(c.text).toContain("globalThis.__crankwellExt = { App:");
    expect(c.text).not.toMatch(/<script[^>]+src=/);
  });

  it("diagnoses without sign-in", async () => {
    const r = await call("find_suspect_parts", { symptoms: "grinding noise when braking", vehicle: "2016 Mazda 3" });
    expect(r.status).toBe(200);
    const d = JSON.parse(r.body.result!.content![0].text);
    expect(d.reference_car_id).toBe("corolla");
    expect(d.suspects[0].part_id).toBe("brakes.pads.fl");
  });

  it("answers a protected call without a token with 401 + resource metadata (lazy auth)", async () => {
    const r = await call("prepare_purchase", { car_id: "corolla", kind: "parts", sku: "FYC-COROLLA-BRAKE_PADS-O" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
  });

  it("lets only the card confirm, and pays with one tap once PayPal is saved", async () => {
    const prep = (await call("prepare_purchase", { car_id: "corolla", kind: "shop_deposit", shop_id: "shop_quickstop_tire" }, token)).body.result!;
    if (prep.isError) throw new Error(prep.content![0].text);
    const actionId = (prep.structuredContent!.action as { id: string }).id;
    const key = prep._meta!["crankwell/confirmKey"] as string;
    expect(JSON.stringify(prep.structuredContent) + prep.content![0].text).not.toContain(key);
    expect(prep.structuredContent!.one_tap).toBe(false);

    const guessed = (await call("confirm_purchase", { action_id: actionId, confirm_key: "model-guess" }, token)).body.result!;
    expect(guessed.isError).toBe(true);
    expect(pp.createOrder).not.toHaveBeenCalled();

    wallet.saveWallet(session, { id: "VAULT-MCP", status: "VAULTED" }, "buyer@example.com");
    const tap = (await call("confirm_purchase", { action_id: actionId, confirm_key: key }, token)).body.result!;
    expect(tap.isError).toBeFalsy();
    expect((tap.structuredContent!.action as { status: string }).status).toBe("confirmed");
    expect(pp.createOrder).toHaveBeenCalledWith(expect.objectContaining({ intent: "AUTHORIZE", vault: { vaultId: "VAULT-MCP" } }));

    const status = (await call("get_purchase_status", { action_id: actionId }, token)).body.result!;
    expect(status.content![0].text).toMatch(/held, not charged/);
  });

  it("prepares a change to an order from get_orders and lets only the card confirm it", async () => {
    const orders = JSON.parse((await call("get_orders", {}, token)).body.result!.content![0].text);
    const held = orders.orders.find((o: { kind: string; status: string }) => o.kind === "shop_deposit" && o.status === "AUTHORIZED");
    expect(held.allowed_changes).toEqual(["check_in", "cancel_reservation"]);

    const prep = (await call("prepare_order_change", { order_ref: held.order_ref, change: "cancel_reservation" }, token)).body.result!;
    if (prep.isError) throw new Error(prep.content![0].text);
    expect(prep.structuredContent).toMatchObject({ view: "checkout", one_tap: true, action: { kind: "cancel_reservation" } });
    expect(pp.voidAuthorization).not.toHaveBeenCalled();

    const actionId = (prep.structuredContent!.action as { id: string }).id;
    const key = prep._meta!["crankwell/confirmKey"] as string;
    const tap = (await call("confirm_purchase", { action_id: actionId, confirm_key: key }, token)).body.result!;
    expect(tap.isError).toBeFalsy();
    expect(pp.voidAuthorization).toHaveBeenCalledTimes(1);
    expect((await call("get_purchase_status", { action_id: actionId }, token)).body.result!.content![0].text).toMatch(/hold was released/);

    const other = await pair("session-mcp-3");
    const peek = (await call("prepare_order_change", { order_ref: held.order_ref, change: "check_in" }, other)).body.result!;
    expect(peek.isError).toBe(true);
  });

  it("keeps another browser's purchases private", async () => {
    const other = await pair("session-mcp-2");
    const prep = (await call("prepare_purchase", { car_id: "corolla", kind: "technician", technician_id: "tech_maria" }, token)).body.result!;
    if (prep.isError) throw new Error(prep.content![0].text);
    const actionId = (prep.structuredContent!.action as { id: string }).id;
    const peek = (await call("get_purchase_status", { action_id: actionId }, other)).body.result!;
    expect(peek.isError).toBe(true);
  });
});
