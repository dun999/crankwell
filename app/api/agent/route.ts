import OpenAI from "openai";
import { z } from "zod";
import { encodeSse, type StreamEvent } from "@/lib/agent/events";
import { AllProvidersFailed } from "@/lib/agent/llm";
import { runAgentTurn } from "@/lib/agent/loop";
import { agentConfigured } from "@/lib/agent/model";
import { CommerceError } from "@/lib/server/commerce";
import { json, originOf, requireSession } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { overBudget } from "@/lib/server/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  conversationId: z.string().min(8).max(64),
  message: z.string().min(1).max(4000),
  view: z.object({
    carId: z.enum(["corolla", "crv"]),
    selectedPart: z.string().max(80).nullish(),
    location: z.object({ lat: z.number(), lng: z.number(), label: z.string().max(80).optional() }).nullish(),
  }),
});

function friendly(e: unknown): string {
  if (e instanceof AllProvidersFailed) return "The AI mechanic dropped out mid-answer. Please try again in a moment.";
  if (e instanceof OpenAI.AuthenticationError) return "The AI mechanic isn't configured: set AGENT_API_KEY in .env.local.";
  if (e instanceof OpenAI.RateLimitError) return "The AI mechanic is busy right now (rate limited). Please try again in a moment.";
  if (e instanceof OpenAI.APIError) return `AI service error (${e.status ?? "network"}). Please try again.`;
  return "Something went wrong while thinking. Please try again.";
}

/** Streams one agent turn as Server-Sent Events: text, progress updates, tool status and UI events. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "agent", 20);
  if (limited) return limited;
  let sessionId: string;
  try {
    sessionId = requireSession(req);
  } catch (e) {
    return json({ error: e instanceof CommerceError ? e.message : "No session" }, e instanceof CommerceError ? e.status : 401);
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  if (!agentConfigured()) {
    return json({ error: "The AI mechanic isn't configured: set AGENT_API_KEY in .env.local and restart the dev server." }, 503);
  }
  if (overBudget()) {
    return json({ error: "The AI mechanic has reached today's usage limit. The 3D model and price guide still work, and the mechanic is back tomorrow." }, 503);
  }
  const b = parsed.data;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const write = (e: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(encodeSse(e)));
        } catch {
          open = false;
        }
      };
      try {
        const r = await runAgentTurn({
          conversationId: b.conversationId,
          sessionId,
          text: b.message,
          view: { carId: b.view.carId, selectedPart: b.view.selectedPart, location: b.view.location },
          signal: req.signal,
          write,
          origin: originOf(req),
        });
        const t = r.trace;
        write({
          event: "done",
          data: {
            stopReason: r.stopReason,
            trace: { provider: t.provider, model: t.model, failover: t.failover, offline: t.offline, llmCalls: t.llmCalls, tokens: t.promptTokens + t.completionTokens, toolErrors: t.tools.filter((x) => !x.ok).length },
          },
        });
      } catch (e) {
        if (!req.signal.aborted) {
          console.error("[agent]", e);
          write({ event: "error", data: { message: friendly(e) } });
        }
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* closed */
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
