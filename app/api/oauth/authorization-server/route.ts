import { originOf } from "@/lib/server/http";
import { authorizationServerMetadata } from "@/lib/server/oauth";

export const dynamic = "force-dynamic";

// Served at /.well-known/oauth-authorization-server (rewrite in next.config.ts).
export function GET(req: Request) {
  return Response.json(authorizationServerMetadata(originOf(req)), { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
}
