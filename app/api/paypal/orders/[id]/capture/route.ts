import { z } from "zod";
import { captureOrder } from "@/lib/server/commerce";
import { Session, handle, json } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: RouteContext<"/api/paypal/orders/[id]/capture">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { sessionId } = z.object({ sessionId: Session }).parse(await req.json());
    return json({ tx: await captureOrder(id, sessionId) });
  });
}
