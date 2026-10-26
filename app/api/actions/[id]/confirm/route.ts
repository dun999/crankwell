import { z } from "zod";
import { confirmAction } from "@/lib/server/actions";
import { handle, json, originOf, requireSession } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

/** The user's one tap: pay with saved PayPal, or send the technician's PayPal invoice. */
export async function POST(req: Request, ctx: RouteContext<"/api/actions/[id]/confirm">) {
  const limited = rateLimit(req, "confirm", 10);
  if (limited) return limited;
  return handle(async () => {
    const session = requireSession(req);
    const { id } = await ctx.params;
    const b = z.object({ email: z.string().email().max(200).optional() }).parse(await req.json());
    return json(await confirmAction(id, session, { origin: originOf(req), email: b.email }));
  });
}
