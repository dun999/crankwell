import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as oauth from "@/lib/server/oauth";

const origin = "https://crankwell.test";
const challenge = (v: string) => createHash("sha256").update(v).digest("base64url");
const doc = (body: unknown) => (async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
const CIMD = "https://claude.ai/oauth/mcp-client-metadata";

describe("metadata", () => {
  it("advertises what Claude needs to pick CIMD", () => {
    const as = oauth.authorizationServerMetadata(origin);
    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(as.token_endpoint_auth_methods_supported).toContain("none");
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(oauth.protectedResourceMetadata(origin)).toMatchObject({ resource: `${origin}/api/mcp`, authorization_servers: [origin] });
  });
});

describe("client metadata documents", () => {
  it("accepts a document whose client_id is its own URL", async () => {
    const c = await oauth.fetchClientMetadata(CIMD, doc({ client_id: CIMD, client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }));
    expect(c.redirect_uris).toEqual(["https://claude.ai/api/mcp/auth_callback"]);
    expect(oauth.clientLabel(c)).toBe("claude.ai");
  });
  it("rejects mismatched ids, non-https and IP hosts", async () => {
    await expect(oauth.fetchClientMetadata(CIMD, doc({ client_id: "https://evil.example/x", redirect_uris: ["https://evil.example/cb"] }))).rejects.toThrow(/doesn't match/);
    await expect(oauth.fetchClientMetadata("http://claude.ai/x", doc({}))).rejects.toThrow(/https/);
    await expect(oauth.fetchClientMetadata("https://10.0.0.1/x", doc({}))).rejects.toThrow(/public host/);
    await expect(oauth.fetchClientMetadata("https://localhost/x", doc({}))).rejects.toThrow(/public host/);
  });
});

describe("redirect matching", () => {
  const client: oauth.OAuthClient = { client_id: CIMD, kind: "cimd", redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "http://localhost/callback", "http://127.0.0.1/callback"] };
  it("is exact for https and port-agnostic for loopback (Claude Code)", () => {
    expect(oauth.redirectAllowed(client, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(oauth.redirectAllowed(client, "https://claude.ai/api/mcp/auth_callback/x")).toBe(false);
    expect(oauth.redirectAllowed(client, "http://localhost:3118/callback")).toBe(true);
    expect(oauth.redirectAllowed(client, "http://127.0.0.1:50211/callback")).toBe(true);
    expect(oauth.redirectAllowed(client, "http://localhost:3118/other")).toBe(false);
    expect(oauth.redirectAllowed(client, "https://claude.ai:444/api/mcp/auth_callback")).toBe(false);
  });
});

describe("authorization code + PKCE + refresh rotation", () => {
  const verifier = "v".repeat(48);
  async function authorize(sessionId: string) {
    const reg = oauth.registerClient({ client_name: "Inspector", redirect_uris: ["http://localhost:6274/oauth/callback"] });
    const { req } = await oauth.validateAuthRequest(
      { client_id: reg.client_id, redirect_uri: "http://localhost:6274/oauth/callback", response_type: "code", code_challenge: challenge(verifier), code_challenge_method: "S256", state: "s1", resource: `${origin}/api/mcp` },
      origin,
    );
    return { client_id: reg.client_id, code: oauth.issueCode(req, sessionId) };
  }

  it("binds tokens to the browser session that clicked Allow", async () => {
    const { client_id, code } = await authorize("session-oauth-1");
    const t = oauth.exchange({ grant_type: "authorization_code", code, code_verifier: verifier, client_id, redirect_uri: "http://localhost:6274/oauth/callback" });
    expect(oauth.verifyAccessToken(t.access_token)).toEqual({ sessionId: "session-oauth-1", clientId: client_id });
    expect(oauth.listConnections("session-oauth-1")).toEqual([{ client: "Inspector" }]);
    expect(() => oauth.exchange({ grant_type: "authorization_code", code, code_verifier: verifier })).toThrow(/invalid or expired/);
  });

  it("rejects a wrong verifier and a wrong resource", async () => {
    const { code } = await authorize("session-oauth-2");
    expect(() => oauth.exchange({ grant_type: "authorization_code", code, code_verifier: "w".repeat(48) })).toThrow(oauth.OAuthError);
    const reg = oauth.registerClient({ redirect_uris: ["https://app.example/cb"] });
    const base = { client_id: reg.client_id, redirect_uri: "https://app.example/cb", response_type: "code", code_challenge: challenge(verifier), code_challenge_method: "S256" };
    await expect(oauth.validateAuthRequest({ ...base, resource: "https://other.example/api/mcp" }, origin)).rejects.toThrow(/Unknown resource/);
    await expect(oauth.validateAuthRequest({ ...base, code_challenge_method: "plain" }, origin)).rejects.toThrow(/S256/);
    await expect(oauth.validateAuthRequest({ ...base, redirect_uri: "https://evil.example/cb" }, origin)).rejects.toThrow(/redirect_uri/);
  });

  it("rotates refresh tokens and kills the old pair", async () => {
    const { code } = await authorize("session-oauth-3");
    const t1 = oauth.exchange({ grant_type: "authorization_code", code, code_verifier: verifier });
    const t2 = oauth.exchange({ grant_type: "refresh_token", refresh_token: t1.refresh_token });
    expect(oauth.verifyAccessToken(t1.access_token)).toBeNull();
    expect(oauth.verifyAccessToken(t2.access_token)?.sessionId).toBe("session-oauth-3");
    try {
      oauth.exchange({ grant_type: "refresh_token", refresh_token: t1.refresh_token });
      expect.unreachable();
    } catch (e) {
      expect((e as oauth.OAuthError).error).toBe("invalid_grant");
    }
    oauth.revokeConnections("session-oauth-3");
    expect(oauth.verifyAccessToken(t2.access_token)).toBeNull();
  });
});
