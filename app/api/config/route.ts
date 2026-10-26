import { isPayPalConfigured, paypalEnv } from "@/lib/server/paypal";
import { json } from "@/lib/server/http";
import { MODEL, MODEL_LABEL, PROVIDER, providers } from "@/lib/agent/model";

export const dynamic = "force-dynamic";

export async function GET() {
  const fallback = providers().find((p) => p.id === "fallback");
  return json({
    paypal: { configured: isPayPalConfigured(), env: paypalEnv(), webhook: Boolean(process.env.PAYPAL_WEBHOOK_ID), clientIdForBrowser: Boolean(process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID) },
    agent: { configured: providers().length > 0, model: MODEL, label: MODEL_LABEL, provider: PROVIDER, fallback: fallback ? { label: fallback.label, provider: fallback.host } : null },
  });
}
