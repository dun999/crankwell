import { z } from "zod";
import { startApproval } from "@/lib/server/actions";
import { Session, handle, json, originOf } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

/**
 * Create the PayPal order for an action and return its approval link.
 * The in-app popup passes its session; the /pay page (any device) relies on the action id.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/actions/[id]/approve">) {
  const limited = rateLimit(req, "approve", 10);
  if (limited) return limited;
  return handle(async () => {
    const { id } = await ctx.params;
    const b = z.object({ sessionId: Session.optional(), save: z.boolean(), returnTo: z.enum(["pay", "popup"]) }).parse(await req.json());
    return json(await startApproval(id, { origin: originOf(req), ...b }));
  });
}
