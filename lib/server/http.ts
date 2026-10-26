import "server-only";
import { z } from "zod";
import { SESSION_COOKIE, isSessionId } from "@/lib/session-cookie";
import { CommerceError } from "./commerce";
import { PayPalNotConfigured, paypalErrorMessage } from "./paypal";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/** Run a handler, mapping known errors to JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof z.ZodError) return json({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
    if (e instanceof CommerceError) return json({ error: e.message }, e.status);
    if (e instanceof PayPalNotConfigured) return json({ error: e.message }, 503);
    console.error("[api]", e);
    return json({ error: paypalErrorMessage(e) }, 500);
  }
}

/** The browser session from its httpOnly cookie (set by proxy.ts), if any. */
export function sessionFrom(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) {
      const v = decodeURIComponent(part.slice(i + 1).trim());
      return isSessionId(v) ? v : null;
    }
  }
  return null;
}

/**
 * The session for a request that reads or changes this browser's orders, wallet or chat.
 * Writes must also come from our own pages: SameSite=Lax already keeps the cookie off cross-site
 * POSTs, and the Origin check rejects anything else that isn't same-origin.
 */
export function requireSession(req: Request): string {
  if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
  const s = sessionFrom(req);
  if (!s) throw new CommerceError("Your session expired. Reload the page.", 401);
  return s;
}

function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== originOf(req) && origin !== new URL(req.url).origin) throw new CommerceError("Cross-site request blocked", 403);
    return;
  }
  // Browsers send Origin on POST; without it, fall back to Fetch Metadata.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new CommerceError("Cross-site request blocked", 403);
}

export function originOf(req: Request) {
  return originFromHeaders(req.headers);
}

/** Public origin for links and OAuth metadata: PUBLIC_URL, else the forwarded host. */
export function originFromHeaders(h: Headers) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
