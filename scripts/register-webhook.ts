// Registers this app's webhook endpoint with PayPal (sandbox) and prints the webhook id.
//
//   pnpm webhook:register https://<your-tunnel>.trycloudflare.com [--write]
//
// --write saves PAYPAL_WEBHOOK_ID into .env.local. PayPal needs a public HTTPS URL;
// for local dev run a tunnel first:  pnpm dlx cloudflared tunnel --url http://localhost:3000
import fs from "node:fs";

const EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.UPDATED",
  "VAULT.PAYMENT-TOKEN.CREATED",
  "VAULT.PAYMENT-TOKEN.DELETED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
];

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

const base = (process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : process.env.PUBLIC_URL)?.replace(/\/$/, "");
const write = process.argv.includes("--write");
const api = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

async function main() {
  if (!base?.startsWith("https://")) throw new Error("Pass your public HTTPS base URL (or set PUBLIC_URL). PayPal only delivers to HTTPS.");
  const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing (.env.local)");

  const tok = await fetch(`${api}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`OAuth failed: ${JSON.stringify(tok)}`);
  const auth = { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json" };

  const url = `${base}/api/paypal/webhook`;
  const list = await fetch(`${api}/v1/notifications/webhooks`, { headers: auth }).then((r) => r.json());
  let hook = (list.webhooks ?? []).find((w: { url: string }) => w.url === url);
  if (hook) {
    console.log(`Webhook already registered for ${url}`);
    // Add event types this version handles that the existing hook doesn't send yet.
    const have = new Set<string>((hook.event_types ?? []).map((e: { name: string }) => e.name));
    const missing = EVENTS.filter((e) => !have.has(e));
    if (!have.has("*") && missing.length) {
      const res = await fetch(`${api}/v1/notifications/webhooks/${hook.id}`, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify([{ op: "replace", path: "/event_types", value: [...have, ...missing].map((name) => ({ name })) }]),
      });
      if (!res.ok) throw new Error(`Update failed: ${await res.text()}`);
      console.log(`Subscribed to ${missing.join(", ")}`);
    }
  } else {
    const res = await fetch(`${api}/v1/notifications/webhooks`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ url, event_types: EVENTS.map((name) => ({ name })) }),
    });
    hook = await res.json();
    if (!res.ok) throw new Error(`Create failed: ${JSON.stringify(hook)}`);
    console.log(`Registered ${url}`);
  }
  console.log(`PAYPAL_WEBHOOK_ID=${hook.id}`);

  if (write) {
    const file = ".env.local";
    const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const next = /^PAYPAL_WEBHOOK_ID=.*$/m.test(cur) ? cur.replace(/^PAYPAL_WEBHOOK_ID=.*$/m, `PAYPAL_WEBHOOK_ID=${hook.id}`) : `${cur.trimEnd()}\nPAYPAL_WEBHOOK_ID=${hook.id}\n`;
    fs.writeFileSync(file, next);
    console.log("Saved to .env.local. Restart the dev server to pick it up.");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
