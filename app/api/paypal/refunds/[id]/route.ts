import { z } from "zod";
import { refund } from "@/lib/server/commerce";
import { Session, handle, json } from "@/lib/server/http";

export const runtime = "nodejs";

/** Payments v2 refund of a captured payment. `id` is our transaction id. */
export async function POST(req: Request, ctx: RouteContext<"/api/paypal/refunds/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { sessionId } = z.object({ sessionId: Session }).parse(await req.json());
    return json({ tx: await refund(id, sessionId) });
  });
}
