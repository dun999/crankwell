import { createMcpHandler } from "mcp-handler";
import { mcpContext } from "@/lib/mcp/context";
import { MCP_INSTRUCTIONS, PROTECTED_TOOLS, registerCrankwell } from "@/lib/mcp/server";
import { originOf } from "@/lib/server/http";
import { bearer, verifyAccessToken, wwwAuthenticate } from "@/lib/server/oauth";
import { rateLimit } from "@/lib/server/ratelimit";

// Crankwell as a remote MCP server (Streamable HTTP) for Claude and other MCP clients.
// Diagnosis and lookups are public. Tools that act for a user need the browser pairing (OAuth):
// calling one without a token returns 401, which makes Claude show its Connect prompt (lazy auth).

const handler = createMcpHandler(registerCrankwell, {
  serverInfo: { name: "crankwell", version: "1.0.0" },
  instructions: MCP_INSTRUCTIONS,
});

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
};

function withCors(res: Response) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

/** Does this JSON-RPC body call a tool that needs a paired browser? */
async function needsAuth(req: Request) {
  if (req.method !== "POST") return false;
  const body = await req
    .clone()
    .json()
    .catch(() => null);
  const msgs: unknown[] = Array.isArray(body) ? body : [body];
  return msgs.some((m) => {
    const x = m as { method?: unknown; params?: { name?: unknown } } | null;
    return x?.method === "tools/call" && typeof x.params?.name === "string" && PROTECTED_TOOLS.has(x.params.name);
  });
}

async function serve(req: Request) {
  const limited = rateLimit(req, "mcp", 120);
  if (limited) return withCors(limited);
  const origin = originOf(req);
  const token = bearer(req);
  const auth = token ? verifyAccessToken(token) : null;

  if (!auth && (await needsAuth(req))) {
    const description = token ? "Your Crankwell connection expired. Connect again." : "Connect Crankwell to check out with PayPal";
    return withCors(
      Response.json(
        { error: "invalid_token", error_description: description },
        { status: 401, headers: { "www-authenticate": wwwAuthenticate(origin, description), "cache-control": "no-store" } },
      ),
    );
  }
  const res = await mcpContext.run({ origin, sessionId: auth?.sessionId ?? null, clientId: auth?.clientId }, () => handler(req));
  return withCors(res);
}

export { serve as DELETE, serve as GET, serve as POST };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
