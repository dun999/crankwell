import { z } from "zod";
import { sendTechnicianInvoice } from "@/lib/server/commerce";
import { Session, handle, json } from "@/lib/server/http";

export const runtime = "nodejs";

const Body = z.object({
  sessionId: Session,
  technicianId: z.string().max(60),
  email: z.string().email().max(200),
  when: z.string().max(60),
  carId: z.string(),
  partId: z.string().max(80).optional(),
  issue: z.string().max(200).optional(),
  hours: z.number().min(1).max(6).optional(),
});

/** Book a mobile technician: create + send a PayPal invoice (Invoicing v2). */
export async function POST(req: Request) {
  return handle(async () => json({ tx: await sendTechnicianInvoice(Body.parse(await req.json())) }));
}
