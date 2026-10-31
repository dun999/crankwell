import { subscribeMandates, subscribeTx } from "@/lib/server/bus";
import { sessionFrom } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-Sent Events: live transaction updates (webhooks, captures) and spending-limit changes for this browser's session. */
export async function GET(req: Request) {
  const session = sessionFrom(req);
  if (!session) return new Response("no session", { status: 401 });
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
      const unsubTx = subscribeTx(session, (tx) => send(`event: tx\ndata: ${JSON.stringify(tx)}\n\n`));
      const unsubMandates = subscribeMandates(session, (m) => send(`event: mandate\ndata: ${JSON.stringify(m)}\n\n`));
      const ping = setInterval(() => send(": ping\n\n"), 20_000);
      cleanup = () => {
        clearInterval(ping);
        unsubTx();
        unsubMandates();
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
