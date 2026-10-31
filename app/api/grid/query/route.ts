import { AllProvidersFailed } from "@/lib/agent/llm";
import { agentConfigured } from "@/lib/agent/model";
import { GridQueryBody, SCHEMA_MAX, askGrid } from "@/lib/server/grid-query";
import { handle, json, requireSession } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { overBudget } from "@/lib/server/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Ask" a grid: the grid's AI Toolkit schema and a question in, grid state to apply out. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "grid", 20);
  if (limited) return limited;
  return handle(async () => {
    requireSession(req);
    if (Number(req.headers.get("content-length") ?? 0) > SCHEMA_MAX + 8_000) return json({ error: "Request too large" }, 413);
    const q = GridQueryBody.parse(await req.json().catch(() => null));
    if (!agentConfigured()) return json({ error: "Ask needs the AI model: set AGENT_API_KEY." }, 503);
    if (overBudget()) return json({ error: "The AI has reached today's usage limit. Filters and sorting still work." }, 503);
    try {
      return json(await askGrid(q, { signal: AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]) }));
    } catch (e) {
      if (e instanceof AllProvidersFailed) return json({ error: "The AI is busy right now. Try again in a moment." }, 503);
      throw e;
    }
  });
}
