import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, requireSession } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { adoptLegacySession } from "@/lib/server/session";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session-cookie";

export const runtime = "nodejs";

/** One-time move of an old localStorage session into the httpOnly session cookie. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "adopt", 10);
  if (limited) return limited;
  return handle(async () => {
    requireSession(req);
    const { legacyId } = z.object({ legacyId: z.string().max(64) }).parse(await req.json());
    const adopted = adoptLegacySession(legacyId);
    const res = NextResponse.json({ adopted: Boolean(adopted) }, { headers: { "cache-control": "no-store" } });
    if (adopted) res.cookies.set(SESSION_COOKIE, adopted, sessionCookieOptions());
    return res;
  });
}
