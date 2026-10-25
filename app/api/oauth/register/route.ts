import { OAuthError, registerClient } from "@/lib/server/oauth";
import { rateLimit } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "cache-control": "no-store" };

/** RFC 7591 Dynamic Client Registration, for MCP clients that don't use a Client ID Metadata Document. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "oauth", 30);
  if (limited) return limited;
  try {
    return Response.json(registerClient(await req.json()), { status: 201, headers: cors });
  } catch (e) {
    if (e instanceof OAuthError) return Response.json({ error: e.error, error_description: e.description }, { status: e.status, headers: cors });
    return Response.json({ error: "invalid_client_metadata", error_description: "Send client metadata as JSON" }, { status: 400, headers: cors });
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "POST" } });
