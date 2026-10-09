import "server-only";
import { z } from "zod";
import { CommerceError } from "./commerce";
import { PayPalNotConfigured, paypalErrorMessage } from "./paypal";

export const Session = z.string().min(8).max(64);

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

export function originOf(req: Request) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
