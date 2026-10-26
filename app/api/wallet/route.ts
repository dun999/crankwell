import { z } from "zod";
import { handle, json, requireSession } from "@/lib/server/http";
import { listConnections, revokeConnections } from "@/lib/server/oauth";
import { revokeAllMandates } from "@/lib/server/mandates";
import { removeWallet, walletInfo } from "@/lib/server/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = (session: string) => ({
  wallet: walletInfo(session),
  connections: listConnections(session),
  // Where a technician invoice goes by default: the saved PayPal's email, else the sandbox buyer.
  invoiceEmail: walletInfo(session)?.email ?? process.env.INVOICE_RECIPIENT_EMAIL ?? null,
});

/** Saved PayPal (one-tap) and connected apps (Claude) for this browser. */
export async function GET(req: Request) {
  return handle(async () => json(view(requireSession(req))));
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const session = requireSession(req);
    const b = z.object({ what: z.enum(["wallet", "connections"]) }).parse(await req.json());
    if (b.what === "wallet") {
      // Spending limits pay with the saved PayPal, so they end with it.
      revokeAllMandates(session);
      await removeWallet(session);
    }
    else revokeConnections(session);
    return json(view(session));
  });
}
