"use client";

// The session itself is an httpOnly cookie (see proxy.ts). Browsers from before that change still
// hold their old id in localStorage: hand it to the server once, then forget it.
const LEGACY_KEY = "fyc.session";
let ready: Promise<void> | null = null;

/** Resolves once this browser's session is settled. Await it before the first API call. */
export function sessionReady(): Promise<void> {
  return (ready ??= (async () => {
    let legacy: string | null = null;
    try {
      legacy = localStorage.getItem(LEGACY_KEY);
    } catch {
      return;
    }
    if (!legacy) return;
    try {
      const r = await fetch("/api/session/adopt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ legacyId: legacy }) });
      if (r.status < 500) localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* offline: try again on the next load */
    }
  })());
}
