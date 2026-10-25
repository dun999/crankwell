import { z } from "zod";
import { Session, json, originOf } from "@/lib/server/http";
import { OAuthError, issueCode, redirectWith, validateAuthRequest } from "@/lib/server/oauth";
import { rateLimit } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

const Body = z.object({ params: z.record(z.string(), z.string().max(2048)), sessionId: Session, allow: z.boolean() });

/** The consent page's Allow / Cancel. Returns where to send the browser next. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "oauth", 30);
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const origin = originOf(req);
  try {
    const { req: ar } = await validateAuthRequest(parsed.data.params, origin);
    if (!parsed.data.allow) return json({ redirect: redirectWith(ar.redirect_uri, { error: "access_denied", state: ar.state, iss: origin }) });
    const code = issueCode(ar, parsed.data.sessionId);
    return json({ redirect: redirectWith(ar.redirect_uri, { code, state: ar.state, iss: origin }) });
  } catch (e) {
    if (e instanceof OAuthError) return json({ error: e.description }, 400);
    throw e;
  }
}
