import OpenAI from "openai";
import { z } from "zod";
import { encodeSse, type StreamEvent } from "@/lib/agent/events";
import { runAgentTurn } from "@/lib/agent/loop";
import { Session, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  conversationId: z.string().min(8).max(64),
  sessionId: Session,
  message: z.string().min(1).max(4000),
  view: z.object({
    carId: z.enum(["corolla", "crv"]),
    selectedPart: z.string().max(80).nullish(),
    location: z.object({ lat: z.number(), lng: z.number(), label: z.string().max(80).optional() }).nullish(),
  }),
});

function friendly(e: unknown): string {
  if (e instanceof OpenAI.AuthenticationError) return "The AI mechanic isn't configured: set NEBIUS_API_KEY in .env.local.";
  if (e instanceof OpenAI.RateLimitError) return "The AI mechanic is busy right now (rate limited). Please try again in a moment.";
  if (e instanceof OpenAI.APIError) return `AI service error (${e.status ?? "network"}). Please try again.`;
  return "Something went wrong while thinking. Please try again.";
}

/** Streams one agent turn as Server-Sent Events: text, progress updates, tool status and UI events. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  if (!process.env.NEBIUS_API_KEY) {
    return json({ error: "The AI mechanic isn't configured: set NEBIUS_API_KEY in .env.local and restart the dev server." }, 503);
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
          sessionId: b.sessionId,
          text: b.message,
          view: { carId: b.view.carId, selectedPart: b.view.selectedPart, location: b.view.location },
          signal: req.signal,
          write,
        });
        write({ event: "done", data: { stopReason: r.stopReason } });
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
