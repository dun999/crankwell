import { z } from "zod";
import { cancelInvoice, refreshInvoice } from "@/lib/server/commerce";
import { handle, json, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: RouteContext<"/api/paypal/invoices/[id]">) {
  return handle(async () => {
    const session = requireSession(req);
    const { id } = await ctx.params;
    const b = z.object({ action: z.enum(["refresh", "cancel"]) }).parse(await req.json());
    return json({ tx: b.action === "refresh" ? await refreshInvoice(id, session) : await cancelInvoice(id, session) });
  });
}
