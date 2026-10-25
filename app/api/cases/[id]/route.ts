import { listActions } from "@/lib/server/actions";
import { claimCase, getCase } from "@/lib/server/cases";
import { Session, handle, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Open a deep-linked diagnosis. The first browser to open an unclaimed case keeps it. */
export async function GET(req: Request, ctx: RouteContext<"/api/cases/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const c = getCase(id);
    if (!c) return json({ error: "Not found" }, 404);
    const session = Session.safeParse(new URL(req.url).searchParams.get("session"));
    const mine = session.success && (c.sessionId === session.data || claimCase(id, session.data));
    return json({ case: c.record, actions: mine ? listActions(session.data!, id) : [] });
  });
}
