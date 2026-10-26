import { describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { requireSession, sessionFrom } from "@/lib/server/http";
import { adoptLegacySession } from "@/lib/server/session";
import { isSessionId, newSessionId } from "@/lib/session-cookie";

const sid = newSessionId();
const req = (method: string, headers: Record<string, string>) => new Request("https://crankwell.test/api/orders", { method, headers });

describe("session cookie", () => {
  it("issues long random ids", () => {
    expect(sid).toHaveLength(43);
    expect(isSessionId(sid)).toBe(true);
    expect(newSessionId()).not.toBe(sid);
    expect(isSessionId("short")).toBe(false);
    expect(isSessionId("a;b=c,d".padEnd(20, "x"))).toBe(false);
  });

  it("reads the session from the cookie header only", () => {
    expect(sessionFrom(req("GET", { cookie: `theme=dark; cw_sid=${sid}` }))).toBe(sid);
    expect(sessionFrom(req("GET", {}))).toBeNull();
    expect(sessionFrom(req("GET", { cookie: "cw_sid=bad" }))).toBeNull();
  });

  it("requires a session and a same-origin request for writes", () => {
    expect(requireSession(req("GET", { cookie: `cw_sid=${sid}` }))).toBe(sid);
    expect(() => requireSession(req("GET", {}))).toThrow(/session/);
    expect(requireSession(req("POST", { cookie: `cw_sid=${sid}`, origin: "https://crankwell.test" }))).toBe(sid);
    expect(() => requireSession(req("POST", { cookie: `cw_sid=${sid}`, origin: "https://evil.example" }))).toThrow(/Cross-site/);
    expect(() => requireSession(req("POST", { cookie: `cw_sid=${sid}`, "sec-fetch-site": "cross-site" }))).toThrow(/Cross-site/);
    expect(requireSession(req("POST", { cookie: `cw_sid=${sid}`, "sec-fetch-site": "same-origin" }))).toBe(sid);
  });
});

describe("legacy session adoption", () => {
  const legacy = "3b241101-e2bb-4255-8caf-4136c566a962";

  it("adopts an old localStorage session once, and only if it owns data", () => {
    expect(adoptLegacySession(legacy)).toBeNull();
    db().prepare("INSERT INTO wallets (session_id, vault_id, created_at) VALUES (?, ?, ?)").run(legacy, "VAULT-L", new Date().toISOString());
    expect(adoptLegacySession(legacy)).toBe(legacy);
    expect(adoptLegacySession(legacy)).toBeNull();
  });

  it("only accepts the old UUID format", () => {
    expect(adoptLegacySession(sid)).toBeNull();
    expect(adoptLegacySession("not-a-uuid")).toBeNull();
  });
});
