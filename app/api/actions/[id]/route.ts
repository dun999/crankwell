import { z } from "zod";
import { actionOwnedBy, cancelAction, getAction, oneTapBlocker } from "@/lib/server/actions";
import { Session, handle, json } from "@/lib/server/http";
import { walletInfo } from "@/lib/server/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Action status. With the owning session it also says whether one-tap is available. */
export async function GET(req: Request, ctx: RouteContext<"/api/actions/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const action = getAction(id);
    if (!action) return json({ error: "Not found" }, 404);
    const session = Session.safeParse(new URL(req.url).searchParams.get("session"));
    const mine = session.success && actionOwnedBy(id, session.data);
    if (!mine) return json({ action, mine: false });
    return json({ action, mine: true, wallet: walletInfo(session.data), oneTapBlocker: oneTapBlocker(action, session.data) });
  });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/actions/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { sessionId } = z.object({ sessionId: Session }).parse(await req.json());
    return json({ action: cancelAction(id, sessionId) });
  });
}
