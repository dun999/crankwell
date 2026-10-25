import { originOf } from "@/lib/server/http";
import { protectedResourceMetadata } from "@/lib/server/oauth";

export const dynamic = "force-dynamic";

// Served at /.well-known/oauth-protected-resource[/api/mcp] (rewrite in next.config.ts).
export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(originOf(req)), { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
}
