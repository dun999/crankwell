import { after } from "next/server";
import { completeApproval } from "@/lib/server/actions";
import { applyWebhook, awaitingBuyer } from "@/lib/server/commerce";
import { txGet, webhookFirstSeen } from "@/lib/server/db";
import { json } from "@/lib/server/http";
import { paypalErrorMessage, verifyWebhookSignature } from "@/lib/server/paypal";

export const runtime = "nodejs";

/** The popup usually captures within a second or two of approval; the webhook takes over after this. */
const POPUP_GRACE_MS = 5_000;

/**
 * PayPal webhook receiver.
 * 1. Verify the signature with PayPal (POST /v1/notifications/verify-webhook-signature).
 * 2. Deduplicate by event id (PayPal retries until it gets a 2xx).
 * 3. Apply the state change and push it to connected browsers.
 * 4. An approved order the browser never finished (closed popup, lost network) is captured or
 *    authorized here, after the response, so the buyer is never left approved but unpaid.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event: { id?: string; event_type?: string; resource?: { id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  if (!event.id || !event.event_type) return json({ error: "not a PayPal event" }, 400);

  let verified = false;
  try {
    verified = await verifyWebhookSignature(req.headers, event);
  } catch (e) {
    console.error("[webhook] verification error", e);
    return json({ error: "verification unavailable" }, 503); // PayPal will retry
  }
  if (!verified) {
    console.warn(`[webhook] rejected unverified ${event.event_type} ${event.id}`);
    return json({ error: "signature verification failed" }, 401);
  }

  if (!webhookFirstSeen(event.id, event.event_type, event.resource?.id, event)) {
    return json({ ok: true, duplicate: true });
  }
  const tx = applyWebhook(event as Parameters<typeof applyWebhook>[0]);
  console.log(`[webhook] ${event.event_type} ${event.id} → ${tx ? `${tx.id} ${tx.status}` : "no matching transaction"}`);
  const orderId = event.resource?.id;
  if (event.event_type === "CHECKOUT.ORDER.APPROVED" && tx && orderId && awaitingBuyer(tx)) {
    after(async () => {
      await new Promise((r) => setTimeout(r, POPUP_GRACE_MS));
      const cur = txGet(tx.id);
      if (!cur || !awaitingBuyer(cur)) return;
      try {
        const done = await completeApproval(orderId, null);
        console.log(`[webhook] completed approved order ${orderId} → ${done.tx.status}`);
      } catch (e) {
        // The reconciler retries in a couple of minutes.
        console.warn(`[webhook] couldn't complete ${orderId}: ${paypalErrorMessage(e)}`);
      }
    });
  }
  return json({ ok: true, matched: Boolean(tx) });
}
