import { z } from "zod";
import { captureDeposit, voidDeposit } from "@/lib/server/commerce";
import { handle, json, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";

/** Payments v2 on a held deposit: capture at check-in, or void on cancel. `id` is our transaction id. */
export async function POST(req: Request, ctx: RouteContext<"/api/paypal/authorizations/[id]">) {
  return handle(async () => {
    const session = requireSession(req);
    const { id } = await ctx.params;
    const b = z.object({ action: z.enum(["capture", "void"]) }).parse(await req.json());
    return json({ tx: b.action === "capture" ? await captureDeposit(id, session) : await voidDeposit(id, session) });
  });
}
