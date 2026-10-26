import { providerHealth } from "@/lib/agent/llm";
import { db, lastWebhookAt } from "@/lib/server/db";
import { json } from "@/lib/server/http";
import { isPayPalConfigured, paypalEnv, paypalReachable } from "@/lib/server/paypal";
import { reconcilerStatus } from "@/lib/server/reconcile";
import { rateLimit } from "@/lib/server/ratelimit";
import { dailyBudget, tokensToday } from "@/lib/server/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health for uptime monitors. `?deep=1` also sends a 1-token request to each AI provider (cached for
 * five minutes). 503 when the app can't serve a diagnosis or a PayPal checkout.
 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  if (deep) {
    const limited = rateLimit(req, "health", 12);
    if (limited) return limited;
  }
  let dbOk = true;
  try {
    db().prepare("SELECT 1").get();
  } catch {
    dbOk = false;
  }
  const [agents, paypal] = await Promise.all([providerHealth(deep), isPayPalConfigured() ? paypalReachable() : Promise.resolve({ ok: false, error: "not configured" })]);
  const agentOk = agents.some((a) => a.healthy && (!deep || a.ping?.ok !== false));
  const budget = dailyBudget();
  const used = dbOk ? tokensToday() : 0;
  const ok = dbOk && paypal.ok && agentOk && used < budget;
  return json(
    {
      ok,
      time: new Date().toISOString(),
      db: dbOk,
      paypal: { env: paypalEnv(), ...paypal, webhook: Boolean(process.env.PAYPAL_WEBHOOK_ID), lastWebhookAt: dbOk ? lastWebhookAt() : null, reconciler: reconcilerStatus() },
      agent: { ok: agentOk, providers: agents, tokensToday: used, dailyBudget: Number.isFinite(budget) ? budget : null },
    },
    ok ? 200 : 503,
  );
}
