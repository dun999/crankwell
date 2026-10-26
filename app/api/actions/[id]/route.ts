import { actionOwnedBy, cancelAction, getAction, oneTapBlocker } from "@/lib/server/actions";
import { handle, json, requireSession, sessionFrom } from "@/lib/server/http";
import { walletInfo } from "@/lib/server/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Action status. For the owning browser it also says whether one-tap is available. */
export async function GET(req: Request, ctx: RouteContext<"/api/actions/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const action = getAction(id);
    if (!action) return json({ error: "Not found" }, 404);
    const session = sessionFrom(req);
    if (!session || !actionOwnedBy(id, session)) return json({ action, mine: false });
    return json({ action, mine: true, wallet: walletInfo(session), oneTapBlocker: oneTapBlocker(action, session) });
  });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/actions/[id]">) {
  return handle(async () => {
    const session = requireSession(req);
    const { id } = await ctx.params;
    return json({ action: cancelAction(id, session) });
  });
}
