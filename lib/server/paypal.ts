import "server-only";
import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  ItemCategory,
  OrdersController,
  PaymentsController,
  PaypalExperienceUserAction,
  PaypalPaymentTokenCustomerType,
  PaypalPaymentTokenUsageType,
  PaypalWalletContextShippingPreference,
  StoreInVaultInstruction,
  VaultController,
  type Order,
  type OrderRequest,
  type PaypalWallet,
} from "@paypal/paypal-server-sdk";

// PayPal integration (sandbox by default).
//  - Orders v2, Payments v2 and Vault v3 go through the official Server SDK.
//  - Invoicing v2, Payouts and webhook signature verification aren't in the SDK, so they use the
//    REST API directly with the same OAuth credentials.

export class PayPalNotConfigured extends Error {
  constructor() {
    super("PayPal sandbox credentials are missing. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local.");
  }
}

export const paypalEnv = () => ((process.env.PAYPAL_ENV ?? "sandbox") === "live" ? "live" : "sandbox");
export const paypalApiBase = () => (paypalEnv() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
export const isPayPalConfigured = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

const g = globalThis as unknown as {
  __pp?: { client: Client; orders: OrdersController; payments: PaymentsController; vault: VaultController };
  __ppToken?: { token: string; exp: number };
};

function sdk() {
  if (!isPayPalConfigured()) throw new PayPalNotConfigured();
  if (!g.__pp) {
    const client = new Client({
      clientCredentialsAuthCredentials: {
        oAuthClientId: process.env.PAYPAL_CLIENT_ID!,
        oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET!,
      },
      environment: paypalEnv() === "live" ? Environment.Production : Environment.Sandbox,
      timeout: 30_000,
    });
    g.__pp = { client, orders: new OrdersController(client), payments: new PaymentsController(client), vault: new VaultController(client) };
  }
  return g.__pp;
}

/** Human-readable message from a PayPal API error. */
export function paypalErrorMessage(e: unknown): string {
  if (e instanceof PayPalNotConfigured) return e.message;
  if (e instanceof ApiError) {
    const r = e.result as { message?: string; details?: { issue?: string; description?: string }[] } | undefined;
    const d = r?.details?.[0];
    return `PayPal ${e.statusCode}: ${d?.description ?? d?.issue ?? r?.message ?? e.message}`;
  }
  if (e instanceof RestError) return e.message;
  return e instanceof Error ? e.message : "PayPal request failed";
}

// ───────────────────────── REST (Invoicing, Webhooks) ─────────────────────────

export class RestError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    const b = body as { message?: string; details?: { description?: string; issue?: string }[] } | undefined;
    super(`PayPal ${status}: ${b?.details?.[0]?.description ?? b?.details?.[0]?.issue ?? b?.message ?? "request failed"}`);
  }
}

async function accessToken(): Promise<string> {
  if (!isPayPalConfigured()) throw new PayPalNotConfigured();
  if (g.__ppToken && g.__ppToken.exp > Date.now() + 60_000) return g.__ppToken.token;
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = await r.json();
  if (!r.ok) throw new RestError(r.status, body);
  g.__ppToken = { token: body.access_token, exp: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

/** Can we get a PayPal OAuth token right now? (For /api/health; the token is cached.) */
export async function paypalReachable(): Promise<{ ok: boolean; error?: string }> {
  try {
    await accessToken();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: paypalErrorMessage(e) };
  }
}

export async function paypalRest<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const token = await accessToken();
  const r = await fetch(`${paypalApiBase()}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!r.ok) throw new RestError(r.status, body);
  return body as T;
}

// ───────────────────────── Orders v2 ─────────────────────────

const usd = (v: number) => ({ currencyCode: "USD", value: v.toFixed(2) });

export interface OrderLine {
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  description?: string;
  physical: boolean;
}

/** Save the buyer's PayPal for one-tap on approval, or pay with a wallet saved earlier. */
export type VaultOption = { save: true } | { vaultId: string };

export interface VaultInfo {
  id: string;
  status?: string;
  customerId?: string;
}

/** What happened to an order: payer action needed, or captured/authorized right away (saved wallet). */
export function orderOutcome(o: Order) {
  const pay = o.purchaseUnits?.[0]?.payments;
  const cap = pay?.captures?.[0];
  const auth = pay?.authorizations?.[0];
  const v = o.paymentSource?.paypal?.attributes?.vault;
  return {
    orderId: o.id!,
    status: o.status,
    approveUrl: o.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href,
    captureId: cap?.id,
    captureStatus: cap?.status,
    authorizationId: auth?.id,
    authorizationStatus: auth?.status,
    expires: auth?.expirationTime,
    payer: o.paymentSource?.paypal?.emailAddress ?? o.payer?.emailAddress,
    vault: v?.id ? ({ id: v.id, status: v.status, customerId: v.customer?.id } satisfies VaultInfo) : undefined,
  };
}

export async function createOrder(input: {
  referenceId: string;
  intent: "CAPTURE" | "AUTHORIZE";
  description: string;
  lines: OrderLine[];
  shipping: number;
  needsShipping: boolean;
  returnUrl: string;
  cancelUrl: string;
  vault?: VaultOption;
}) {
  const itemTotal = input.lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  const body: OrderRequest = {
    intent: input.intent === "CAPTURE" ? CheckoutPaymentIntent.Capture : CheckoutPaymentIntent.Authorize,
    purchaseUnits: [
      {
        referenceId: input.referenceId,
        customId: input.referenceId,
        description: input.description.slice(0, 127),
        softDescriptor: "CRANKWELL",
        amount: {
          ...usd(itemTotal + input.shipping),
          breakdown: { itemTotal: usd(itemTotal), shipping: usd(input.shipping) },
        },
        items: input.lines.map((l) => ({
          name: l.name.slice(0, 127),
          sku: l.sku,
          description: l.description?.slice(0, 127),
          quantity: String(l.quantity),
          unitAmount: usd(l.unitPrice),
          category: l.physical ? ItemCategory.PhysicalGoods : ItemCategory.DigitalGoods,
        })),
      },
    ],
    paymentSource: { paypal: walletSource(input) },
  };
  const { result } = await sdk().orders.createOrder({ body, prefer: "return=representation", paypalRequestId: `${input.referenceId}-create` });
  return orderOutcome(result);
}

function walletSource(input: { needsShipping: boolean; returnUrl: string; cancelUrl: string; vault?: VaultOption }): PaypalWallet {
  // A saved wallet pays without a buyer redirect, so it needs no experience context.
  if (input.vault && "vaultId" in input.vault) return { vaultId: input.vault.vaultId };
  return {
    experienceContext: {
      brandName: "Crankwell",
      shippingPreference: input.needsShipping ? PaypalWalletContextShippingPreference.GetFromFile : PaypalWalletContextShippingPreference.NoShipping,
      userAction: PaypalExperienceUserAction.PayNow,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
    },
    attributes: input.vault
      ? {
          vault: {
            storeInVault: StoreInVaultInstruction.OnSuccess,
            usageType: PaypalPaymentTokenUsageType.Merchant,
            customerType: PaypalPaymentTokenCustomerType.Consumer,
            description: "Crankwell one-tap checkout",
          },
        }
      : undefined,
  };
}

export async function captureOrder(orderId: string, requestId: string) {
  const { result } = await sdk().orders.captureOrder({ id: orderId, prefer: "return=representation", paypalRequestId: requestId });
  return orderOutcome(result);
}

export async function authorizeOrder(orderId: string, requestId: string) {
  const { result } = await sdk().orders.authorizeOrder({ id: orderId, prefer: "return=representation", paypalRequestId: requestId });
  return orderOutcome(result);
}

// ───────────────────────── Vault v3 (REST) ─────────────────────────

/** Remove a saved PayPal wallet (payment token). A token that's already gone counts as removed. */
export async function deletePaymentToken(id: string) {
  try {
    await sdk().vault.deletePaymentToken(id);
  } catch (e) {
    if (!(e instanceof ApiError && e.statusCode === 404)) throw e;
  }
}

// ───────────────────────── Payments v2 ─────────────────────────

export async function captureAuthorization(authorizationId: string, requestId: string) {
  const { result } = await sdk().payments.captureAuthorizedPayment({
    authorizationId,
    prefer: "return=representation",
    paypalRequestId: requestId,
    body: { finalCapture: true, noteToPayer: "Checked in at the repair shop. Thanks for using Crankwell!" },
  });
  return { captureId: result.id, status: result.status };
}

export async function voidAuthorization(authorizationId: string, requestId: string) {
  await sdk().payments.voidPayment({ authorizationId, paypalRequestId: requestId });
}

export async function refundCapture(captureId: string, requestId: string, note: string) {
  const { result } = await sdk().payments.refundCapturedPayment({
    captureId,
    prefer: "return=representation",
    paypalRequestId: requestId,
    body: { noteToPayer: note.slice(0, 255) },
  });
  return { refundId: result.id, status: result.status };
}

// ───────────────────────── Invoicing v2 (REST) ─────────────────────────

interface InvoiceLine {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  unit: "QUANTITY" | "HOURS" | "AMOUNT";
}

export interface PayPalInvoice {
  id: string;
  status: string;
  detail: { invoice_number: string; metadata?: { recipient_view_url?: string; invoicer_view_url?: string } };
  amount?: { value: string; currency_code: string };
  primary_recipients?: { billing_info?: { email_address?: string } }[];
}

export async function createAndSendInvoice(input: { reference: string; email: string; note: string; lines: InvoiceLine[]; memo: string }) {
  const { invoice_number } = await paypalRest<{ invoice_number: string }>("/v2/invoicing/generate-next-invoice-number", { method: "POST" });
  const draft = await paypalRest<PayPalInvoice>("/v2/invoicing/invoices", {
    method: "POST",
    headers: { Prefer: "return=representation", "PayPal-Request-Id": `${input.reference}-invoice` },
    body: {
      detail: {
        invoice_number,
        reference: input.reference,
        currency_code: "USD",
        note: input.note.slice(0, 4000),
        memo: input.memo.slice(0, 500),
        terms_and_conditions:
          "Mobile technician visit booked through Crankwell. Labor is billed at the posted hourly rate. If the job takes less time than estimated, the unused labor is refunded to your PayPal when you mark the job done.",
        payment_term: { term_type: "DUE_ON_RECEIPT" },
      },
      invoicer: { business_name: "Crankwell Mobile Service" },
      primary_recipients: [{ billing_info: { email_address: input.email } }],
      items: input.lines.map((l) => ({
        name: l.name.slice(0, 200),
        description: l.description?.slice(0, 1000),
        quantity: String(l.quantity),
        unit_amount: { currency_code: "USD", value: l.unitPrice.toFixed(2) },
        unit_of_measure: l.unit,
      })),
      configuration: { allow_tip: true, tax_inclusive: false, partial_payment: { allow_partial_payment: false } },
    },
  });
  await paypalRest(`/v2/invoicing/invoices/${draft.id}/send`, {
    method: "POST",
    headers: { "PayPal-Request-Id": `${input.reference}-send` },
    body: { send_to_invoicer: true, send_to_recipient: true, subject: `Your Crankwell technician visit (${invoice_number})` },
  });
  return getInvoice(draft.id);
}

export const getInvoice = (id: string) => paypalRest<PayPalInvoice>(`/v2/invoicing/invoices/${id}`);

export async function cancelInvoice(id: string) {
  await paypalRest(`/v2/invoicing/invoices/${id}/cancel`, {
    method: "POST",
    body: { subject: "Technician visit cancelled", note: "Your visit was cancelled. No payment is due.", send_to_invoicer: true, send_to_recipient: true },
  });
}

// ───────────────────────── Webhooks (REST) ─────────────────────────

export async function verifyWebhookSignature(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const h = (k: string) => headers.get(k) ?? "";
  if (!h("paypal-transmission-sig")) return false;
  const r = await paypalRest<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    },
  });
  return r.verification_status === "SUCCESS";
}
