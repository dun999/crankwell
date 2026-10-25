import { isPayPalConfigured, paypalEnv } from "@/lib/server/paypal";
import { json } from "@/lib/server/http";
import { MODEL, MODEL_LABEL, PROVIDER, agentKey } from "@/lib/agent/model";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({
    paypal: { configured: isPayPalConfigured(), env: paypalEnv(), webhook: Boolean(process.env.PAYPAL_WEBHOOK_ID), clientIdForBrowser: Boolean(process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID) },
    agent: { configured: Boolean(agentKey()), model: MODEL, label: MODEL_LABEL, provider: PROVIDER },
    invoiceRecipient: process.env.INVOICE_RECIPIENT_EMAIL ?? "",
  });
}
