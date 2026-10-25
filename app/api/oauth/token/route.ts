import { OAuthError, exchange } from "@/lib/server/oauth";
import { rateLimit } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization", "cache-control": "no-store", pragma: "no-cache" };

/** OAuth token endpoint (form-urlencoded per RFC 6749; JSON accepted too). */
export async function POST(req: Request) {
  const limited = rateLimit(req, "oauth", 30);
  if (limited) return limited;
  const type = req.headers.get("content-type") ?? "";
  let form: Record<string, string>;
  try {
    form = type.includes("application/json") ? await req.json() : Object.fromEntries(new URLSearchParams(await req.text()));
  } catch {
    return Response.json({ error: "invalid_request", error_description: "Unreadable body" }, { status: 400, headers: cors });
  }
  try {
    return Response.json(exchange(form), { headers: cors });
  } catch (e) {
    if (e instanceof OAuthError) return Response.json({ error: e.error, error_description: e.description }, { status: e.status, headers: cors });
    console.error("[oauth] token", e);
    return Response.json({ error: "server_error", error_description: "Token request failed" }, { status: 500, headers: cors });
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "POST" } });
