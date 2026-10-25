import { completeApproval } from "@/lib/server/actions";
import { CommerceError } from "@/lib/server/commerce";
import { txFind } from "@/lib/server/db";
import { originOf } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PayPal sends the buyer back here (?token=<order id>) after approving on paypal.com. */
export async function GET(req: Request) {
  const origin = originOf(req);
  const orderId = new URL(req.url).searchParams.get("token") ?? "";
  const tx = /^[A-Z0-9]{8,32}$/.test(orderId) ? txFind("order_id", orderId) : undefined;
  const actionId = typeof tx?.meta?.actionId === "string" ? tx.meta.actionId : undefined;
  if (!tx || !actionId) return Response.redirect(`${origin}/app?paypal=return`, 303);
  try {
    await completeApproval(orderId, null);
    return Response.redirect(`${origin}/pay/${actionId}?done=1`, 303);
  } catch (e) {
    const msg = e instanceof CommerceError ? e.message : "PayPal couldn't finish this payment";
    return Response.redirect(`${origin}/pay/${actionId}?error=${encodeURIComponent(msg)}`, 303);
  }
}
