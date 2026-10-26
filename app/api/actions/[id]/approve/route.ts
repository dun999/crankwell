import { z } from "zod";
import { startApproval } from "@/lib/server/actions";
import { handle, json, originOf, requireSession } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

/**
 * Create the PayPal order for an action and return its approval link. The action id is the
 * capability, like a PayPal approval link: the /pay page works from any browser or device.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/actions/[id]/approve">) {
  const limited = rateLimit(req, "approve", 10);
  if (limited) return limited;
  return handle(async () => {
    requireSession(req);
    const { id } = await ctx.params;
    const b = z.object({ save: z.boolean(), returnTo: z.enum(["pay", "popup"]) }).parse(await req.json());
    return json(await startApproval(id, { origin: originOf(req), ...b }));
  });
}
