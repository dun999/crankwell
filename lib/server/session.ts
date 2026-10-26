import "server-only";
import { db } from "./db";

// Sessions used to be a UUID in localStorage, sent with every request. The first visit after the
// move to the httpOnly cookie hands that id over once, so existing orders and saved PayPal survive.

const LEGACY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OWNERS = ["transactions", "actions", "wallets", "conversations", "oauth_tokens", "cases"];

/** The legacy id to continue as, or null. Each id can be adopted only once, and only if it owns data. */
export function adoptLegacySession(legacyId: string): string | null {
  if (!LEGACY.test(legacyId)) return null;
  const d = db();
  const owns = OWNERS.some((t) => d.prepare(`SELECT 1 FROM ${t} WHERE session_id = ? LIMIT 1`).get(legacyId));
  if (!owns) return null;
  const r = d.prepare("INSERT OR IGNORE INTO session_adoptions (legacy_id, adopted_at) VALUES (?, ?)").run(legacyId, new Date().toISOString());
  return r.changes === 1 ? legacyId : null;
}
