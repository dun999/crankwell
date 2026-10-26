import { handle, json, requireSession } from "@/lib/server/http";
import { listMandates } from "@/lib/server/mandates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The session's spending limits for the in-app mechanic. */
export async function GET(req: Request) {
  return handle(async () => json({ mandates: listMandates(requireSession(req)) }));
}
