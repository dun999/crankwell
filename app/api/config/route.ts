import { isPayPalConfigured, paypalEnv } from "@/lib/server/paypal";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({
    paypal: { configured: isPayPalConfigured(), env: paypalEnv(), webhook: Boolean(process.env.PAYPAL_WEBHOOK_ID), clientIdForBrowser: Boolean(process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID) },
    agent: { configured: Boolean(process.env.NEBIUS_API_KEY) },
    invoiceRecipient: process.env.INVOICE_RECIPIENT_EMAIL ?? "",
  });
}
