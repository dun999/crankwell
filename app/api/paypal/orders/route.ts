import { z } from "zod";
import { createDepositOrder, createPartsOrder } from "@/lib/server/commerce";
import { Session, handle, json, originOf } from "@/lib/server/http";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("parts"),
    sessionId: Session,
    carId: z.string(),
    partId: z.string().max(80),
    items: z.array(z.object({ sku: z.string().max(120), quantity: z.number().int().min(1).max(8) })).min(1).max(5),
  }),
  z.object({
    kind: z.literal("shop_deposit"),
    sessionId: Session,
    carId: z.string(),
    partId: z.string().max(80).optional(),
    shopId: z.string().max(80),
    slot: z.string().max(60),
    issue: z.string().max(200).optional(),
    location: z.object({ lat: z.number(), lng: z.number() }).nullish(),
  }),
]);

/** Create a PayPal order. Amounts come from the server catalog only. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = Body.parse(await req.json());
    const origin = originOf(req);
    const r = b.kind === "parts" ? await createPartsOrder({ ...b, origin }) : await createDepositOrder({ ...b, origin });
    return json(r);
  });
}
