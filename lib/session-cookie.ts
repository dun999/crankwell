// The browser's Crankwell session: an httpOnly cookie that proxy.ts sets on the first visit.
// It scopes chat history, orders and the saved PayPal wallet, so it never travels in URLs or bodies.

export const SESSION_COOKIE = "cw_sid";
const MAX_AGE = 365 * 24 * 3600;
// New ids are 43 base64url chars; ids adopted from the old localStorage session are UUIDs.
const ID = /^[A-Za-z0-9_-]{16,64}$/;

export const isSessionId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

export function newSessionId() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString("base64url");
}

export const sessionCookieOptions = () =>
  ({ httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE }) as const;
