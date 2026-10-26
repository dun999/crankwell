import { z } from "zod";
import type { CarId } from "@/lib/cars/types";
import { findSku, getSpareParts } from "@/lib/catalog/spare-parts";
import { oneTapBlocker, prepareAction } from "@/lib/server/actions";
import { CommerceError } from "@/lib/server/commerce";
import { handle, json, requireSession } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { walletInfo } from "@/lib/server/wallet";

export const runtime = "nodejs";

/** Buy on a parts card: the server prices the SKU into an action the user confirms (one tap or PayPal approval). */
export async function POST(req: Request) {
  const limited = rateLimit(req, "prepare", 20);
  if (limited) return limited;
  return handle(async () => {
    const session = requireSession(req);
    const b = z
      .object({ sku: z.string().max(80), partId: z.string().max(80).optional(), quantity: z.number().int().min(1).max(8).default(1) })
      .parse(await req.json());
    const sp = findSku(b.sku);
    if (!sp) throw new CommerceError("That part is no longer listed.", 404);
    // A SKU fits every instance of its template (e.g. each caliper); keep the one the card was for.
    const partId = b.partId && getSpareParts(sp.carId as CarId, b.partId).some((x) => x.sku === sp.sku) ? b.partId : sp.partId;
    const action = prepareAction(session, { kind: "parts", carId: sp.carId, partId, items: [{ sku: sp.sku, quantity: b.quantity }] }, { source: "app" });
    return json({ action, mine: true, wallet: walletInfo(session), oneTapBlocker: oneTapBlocker(action, session) });
  });
}
