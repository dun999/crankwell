import { subscribeTx } from "@/lib/server/bus";
import { Session } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-Sent Events: live transaction updates (webhooks, captures) for one session. */
export async function GET(req: Request) {
  const parsed = Session.safeParse(new URL(req.url).searchParams.get("session"));
  if (!parsed.success) return new Response("bad session", { status: 400 });
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      send(": connected\n\n");
      const unsub = subscribeTx(parsed.data, (tx) => send(`event: tx\ndata: ${JSON.stringify(tx)}\n\n`));
      const ping = setInterval(() => send(": ping\n\n"), 20_000);
      cleanup = () => {
        clearInterval(ping);
        unsub();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
