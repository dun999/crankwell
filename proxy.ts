import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isSessionId, newSessionId, sessionCookieOptions } from "@/lib/session-cookie";

/** Give every browser an httpOnly session cookie before it reaches a page or an API route. */
export function proxy(req: NextRequest) {
  if (isSessionId(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const id = newSessionId();
  // This request already runs with the new session, so its handler doesn't see an anonymous visitor.
  req.cookies.set(SESSION_COOKIE, id);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(SESSION_COOKIE, id, sessionCookieOptions());
  return res;
}

export const config = {
  // Skip assets and the server-to-server endpoints (MCP, PayPal webhooks, OAuth token and metadata).
  matcher: ["/((?!_next/|api/mcp|api/paypal/webhook|api/health|api/oauth/(?:token|register|authorization-server|protected-resource)|\\.well-known/|.*\\.[A-Za-z0-9]+$).*)"],
};
