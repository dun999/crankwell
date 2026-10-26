import { z } from "zod";
import { handle, json, requireSession } from "@/lib/server/http";
import { approveMandate, revokeMandate } from "@/lib/server/mandates";

export const runtime = "nodejs";

/** The user's tap on the mandate card. */
export async function POST(req: Request, ctx: RouteContext<"/api/mandates/[id]">) {
  return handle(async () => {
    const session = requireSession(req);
    const { id } = await ctx.params;
    z.object({ action: z.literal("approve") }).parse(await req.json());
    return json({ mandate: approveMandate(id, session) });
  });
}

/** Revoke a spending limit, or turn down a proposed one. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/mandates/[id]">) {
  return handle(async () => {
    const session = requireSession(req);
    const { id } = await ctx.params;
    return json({ mandate: revokeMandate(id, session) });
  });
}
