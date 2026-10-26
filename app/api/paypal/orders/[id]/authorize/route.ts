import { authorizeOrder } from "@/lib/server/commerce";
import { handle, json, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: RouteContext<"/api/paypal/orders/[id]/authorize">) {
  return handle(async () => {
    const session = requireSession(req);
    const { id } = await ctx.params;
    return json({ tx: await authorizeOrder(id, session) });
  });
}
