import { z } from "zod";
import { completeApproval } from "@/lib/server/actions";
import { CommerceError } from "@/lib/server/commerce";
import { txFind } from "@/lib/server/db";
import { handle, json, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";

/** In-app popup approval finished: capture or authorize the order and confirm the action. */
export async function POST(req: Request, ctx: RouteContext<"/api/actions/[id]/complete">) {
  return handle(async () => {
    const session = requireSession(req);
    const { id } = await ctx.params;
    const b = z.object({ orderId: z.string().max(64) }).parse(await req.json());
    if (txFind("order_id", b.orderId)?.meta?.actionId !== id) throw new CommerceError("Order not found", 404);
    return json(await completeApproval(b.orderId, session));
  });
}
