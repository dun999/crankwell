import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

// A small OAuth 2.1 authorization server so Claude can pair with a Crankwell browser session.
// There are no passwords: the consent page binds Claude to the browser that clicks Allow.
//  - Clients: Client ID Metadata Documents (what Claude uses) or Dynamic Client Registration.
//  - Authorization code + PKCE S256 only, public clients only.
//  - Opaque tokens stored as SHA-256 hashes; refresh tokens rotate on every use.

export const SCOPE = "orders";
const CODE_TTL_MS = 2 * 60_000;
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_MS = 30 * 86400_000;
const CIMD_CACHE_MS = 3600_000;

export class OAuthError extends Error {
  constructor(
    public error: string,
    public description: string,
    public status = 400,
  ) {
    super(description);
  }
}

export interface OAuthClient {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  kind: "cimd" | "dcr";
}

const sha = (s: string) => createHash("sha256").update(s).digest("base64url");
const secret = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;

// ───────────────────────── Metadata ─────────────────────────

export const mcpResource = (origin: string) => `${origin}/api/mcp`;

/** RFC 9728 protected resource metadata for /api/mcp. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Crankwell",
  };
}

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
  };
}

export const wwwAuthenticate = (origin: string, description = "Connect Crankwell to continue") =>
  `Bearer error="invalid_token", error_description="${description}", resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", scope="${SCOPE}"`;

// ───────────────────────── Clients ─────────────────────────

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function validRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    return u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname));
  } catch {
    return false;
  }
}

/** Exact match, except loopback redirects (Claude Code) match with any port (RFC 8252 §7.3). */
export function redirectAllowed(client: OAuthClient, requested: string) {
  if (client.redirect_uris.includes(requested)) return true;
  let r: URL;
  try {
    r = new URL(requested);
  } catch {
    return false;
  }
  if (r.protocol !== "http:" || !LOOPBACK.has(r.hostname)) return false;
  return client.redirect_uris.some((uri) => {
    try {
      const u = new URL(uri);
      return u.protocol === "http:" && u.hostname === r.hostname && u.pathname === r.pathname && u.search === r.search;
    } catch {
      return false;
    }
  });
}

function isIpLiteral(host: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[");
}

/** Fetch and check a Client ID Metadata Document (the client_id is its own HTTPS URL). */
export async function fetchClientMetadata(clientId: string, fetcher: typeof fetch = fetch): Promise<OAuthClient> {
  let u: URL;
  try {
    u = new URL(clientId);
  } catch {
    throw new OAuthError("invalid_client", "client_id is not a URL");
  }
  if (u.protocol !== "https:" || u.username || u.password || u.pathname === "/" || LOOPBACK.has(u.hostname) || isIpLiteral(u.hostname) || !u.hostname.includes(".")) {
    throw new OAuthError("invalid_client", "client_id must be an https URL with a path on a public host");
  }
  let text: string;
  try {
    const r = await fetcher(u, { redirect: "error", signal: AbortSignal.timeout(3000), headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    if (Number(r.headers.get("content-length") ?? 0) > 10_000) throw new Error("too large");
    text = await r.text();
    if (text.length > 10_000) throw new Error("too large");
  } catch {
    throw new OAuthError("invalid_client", "Couldn't load the client metadata document");
  }
  let doc: { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown };
  try {
    doc = JSON.parse(text);
  } catch {
    throw new OAuthError("invalid_client", "Client metadata isn't JSON");
  }
  if (doc.client_id !== clientId) throw new OAuthError("invalid_client", "client_id in the metadata document doesn't match its URL");
  const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter((x): x is string => typeof x === "string" && validRedirect(x)) : [];
  if (!uris.length) throw new OAuthError("invalid_client", "Client metadata has no usable redirect_uris");
  return { client_id: clientId, client_name: typeof doc.client_name === "string" ? doc.client_name.slice(0, 80) : undefined, redirect_uris: uris, kind: "cimd" };
}

export async function resolveClient(clientId: string): Promise<OAuthClient> {
  const row = db().prepare("SELECT data, created_at FROM oauth_clients WHERE id = ?").get(clientId) as { data: string; created_at: string } | undefined;
  const cached = row ? (JSON.parse(row.data) as OAuthClient) : undefined;
  if (cached && (cached.kind === "dcr" || Date.parse(row!.created_at) > Date.now() - CIMD_CACHE_MS)) return cached;
  if (!clientId.startsWith("https://")) throw new OAuthError("invalid_client", "Unknown client");
  const client = await fetchClientMetadata(clientId);
  db()
    .prepare("INSERT INTO oauth_clients (id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at")
    .run(clientId, JSON.stringify(client), new Date().toISOString());
  return client;
}

/** RFC 7591 Dynamic Client Registration (public clients). */
export function registerClient(meta: { client_name?: unknown; redirect_uris?: unknown }) {
  const uris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris.filter((x): x is string => typeof x === "string") : [];
  if (!uris.length || uris.length > 10 || !uris.every(validRedirect)) throw new OAuthError("invalid_redirect_uri", "redirect_uris must be https or loopback http URLs");
  const client: OAuthClient = {
    client_id: `dcr_${randomBytes(16).toString("base64url")}`,
    client_name: typeof meta.client_name === "string" ? meta.client_name.slice(0, 80) : undefined,
    redirect_uris: uris,
    kind: "dcr",
  };
  db().prepare("INSERT INTO oauth_clients (id, data, created_at) VALUES (?, ?, ?)").run(client.client_id, JSON.stringify(client), new Date().toISOString());
  return {
    client_id: client.client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: client.client_name,
    redirect_uris: uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: SCOPE,
  };
}

/** Who is asking, as shown on the consent page: the client_id's host for CIMD (the name is self-asserted). */
export function clientLabel(client: OAuthClient) {
  if (client.kind === "cimd") return new URL(client.client_id).hostname;
  return client.client_name ?? "An app";
}

// ───────────────────────── Authorization ─────────────────────────

export interface AuthRequest {
  client_id: string;
  redirect_uri: string;
  state?: string;
  code_challenge: string;
  scope: string;
}

/** Validate /oauth/authorize parameters. Errors here must not redirect (the redirect itself is unverified). */
export async function validateAuthRequest(p: Record<string, string | undefined>, origin: string): Promise<{ req: AuthRequest; client: OAuthClient }> {
  if (!p.client_id) throw new OAuthError("invalid_request", "Missing client_id");
  const client = await resolveClient(p.client_id);
  if (!p.redirect_uri || !redirectAllowed(client, p.redirect_uri)) throw new OAuthError("invalid_request", "redirect_uri isn't registered for this client");
  if (p.response_type !== "code") throw new OAuthError("unsupported_response_type", "Only response_type=code is supported");
  if (!p.code_challenge || p.code_challenge_method !== "S256") throw new OAuthError("invalid_request", "PKCE with S256 is required");
  if (p.resource && p.resource.replace(/\/$/, "") !== mcpResource(origin)) throw new OAuthError("invalid_target", "Unknown resource");
  return { req: { client_id: p.client_id, redirect_uri: p.redirect_uri, state: p.state, code_challenge: p.code_challenge, scope: SCOPE }, client };
}

export function issueCode(req: AuthRequest, sessionId: string): string {
  const code = secret("cwc");
  db()
    .prepare("INSERT INTO oauth_codes (hash, data, expires_at) VALUES (?, ?, ?)")
    .run(sha(code), JSON.stringify({ ...req, session_id: sessionId }), Date.now() + CODE_TTL_MS);
  db().prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(Date.now());
  return code;
}

export function redirectWith(uri: string, params: Record<string, string | undefined>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

// ───────────────────────── Tokens ─────────────────────────

function issueTokens(sessionId: string, clientId: string, grantId: string) {
  const access = secret("cwa");
  const refresh = secret("cwr");
  const ins = db().prepare("INSERT INTO oauth_tokens (hash, kind, session_id, client_id, grant_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run(sha(access), "access", sessionId, clientId, grantId, Date.now() + ACCESS_TTL_S * 1000);
  ins.run(sha(refresh), "refresh", sessionId, clientId, grantId, Date.now() + REFRESH_TTL_MS);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
}

/** Token endpoint: authorization_code (with PKCE) or refresh_token (rotated). */
export function exchange(form: Record<string, string | undefined>) {
  const d = db();
  if (form.grant_type === "authorization_code") {
    if (!form.code || !form.code_verifier) throw new OAuthError("invalid_request", "code and code_verifier are required");
    const row = d.prepare("SELECT data, expires_at FROM oauth_codes WHERE hash = ?").get(sha(form.code)) as { data: string; expires_at: number } | undefined;
    d.prepare("DELETE FROM oauth_codes WHERE hash = ?").run(sha(form.code)); // single use
    if (!row || row.expires_at < Date.now()) throw new OAuthError("invalid_grant", "Authorization code is invalid or expired");
    const c = JSON.parse(row.data) as AuthRequest & { session_id: string };
    if (form.client_id && form.client_id !== c.client_id) throw new OAuthError("invalid_grant", "Code was issued to another client");
    if (form.redirect_uri && form.redirect_uri !== c.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match");
    if (sha(form.code_verifier) !== c.code_challenge) throw new OAuthError("invalid_grant", "PKCE verification failed");
    return issueTokens(c.session_id, c.client_id, randomBytes(12).toString("base64url"));
  }
  if (form.grant_type === "refresh_token") {
    if (!form.refresh_token) throw new OAuthError("invalid_request", "refresh_token is required");
    const h = sha(form.refresh_token);
    const row = d.prepare("SELECT session_id, client_id, grant_id, expires_at FROM oauth_tokens WHERE hash = ? AND kind = 'refresh'").get(h) as
      | { session_id: string; client_id: string; grant_id: string; expires_at: number }
      | undefined;
    if (!row || row.expires_at < Date.now() || (form.client_id && form.client_id !== row.client_id)) throw new OAuthError("invalid_grant", "Refresh token is invalid or expired");
    d.prepare("DELETE FROM oauth_tokens WHERE grant_id = ?").run(row.grant_id); // rotate: old access + refresh die
    return issueTokens(row.session_id, row.client_id, row.grant_id);
  }
  throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token");
}

/** Resolve a bearer access token to the browser session it was granted for. */
export function verifyAccessToken(token: string | null | undefined): { sessionId: string; clientId: string } | null {
  if (!token || !token.startsWith("cwa_")) return null;
  const row = db().prepare("SELECT session_id, client_id, expires_at FROM oauth_tokens WHERE hash = ? AND kind = 'access'").get(sha(token)) as
    | { session_id: string; client_id: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at < Date.now()) return null;
  return { sessionId: row.session_id, clientId: row.client_id };
}

export function bearer(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  return /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim() ?? null;
}

// ───────────────────────── Connections (shown in Orders) ─────────────────────────

export function listConnections(sessionId: string): { client: string }[] {
  const rows = db().prepare("SELECT DISTINCT client_id FROM oauth_tokens WHERE session_id = ? AND kind = 'refresh' AND expires_at > ?").all(sessionId, Date.now()) as { client_id: string }[];
  return rows.map((r) => {
    const c = db().prepare("SELECT data FROM oauth_clients WHERE id = ?").get(r.client_id) as { data: string } | undefined;
    return { client: c ? clientLabel(JSON.parse(c.data) as OAuthClient) : r.client_id };
  });
}

export function revokeConnections(sessionId: string) {
  db().prepare("DELETE FROM oauth_tokens WHERE session_id = ?").run(sessionId);
}
