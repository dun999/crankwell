import { refund } from "@/lib/server/commerce";
import { handle, json, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";

/** Payments v2 refund of a captured payment. `id` is our transaction id. */
export async function POST(req: Request, ctx: RouteContext<"/api/paypal/refunds/[id]">) {
  return handle(async () => {
    const session = requireSession(req);
    const { id } = await ctx.params;
    return json({ tx: await refund(id, session) });
  });
}
