import { z } from "zod";
import { Session, handle, json } from "@/lib/server/http";
import { listConnections, revokeConnections } from "@/lib/server/oauth";
import { removeWallet, walletInfo } from "@/lib/server/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saved PayPal (one-tap) and connected apps (Claude) for this browser. */
export async function GET(req: Request) {
  return handle(async () => {
    const session = Session.parse(new URL(req.url).searchParams.get("session"));
    return json({ wallet: walletInfo(session), connections: listConnections(session) });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const b = z.object({ sessionId: Session, what: z.enum(["wallet", "connections"]) }).parse(await req.json());
    if (b.what === "wallet") await removeWallet(b.sessionId);
    else revokeConnections(b.sessionId);
    return json({ wallet: walletInfo(b.sessionId), connections: listConnections(b.sessionId) });
  });
}
