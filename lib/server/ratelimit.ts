import "server-only";

// In-memory sliding-window limits per client IP (single Node process behind Caddy).
const g = globalThis as unknown as { __fycRate?: Map<string, number[]> };
const hits = (g.__fycRate ??= new Map<string, number[]>());

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/** Returns a 429 response when the client is over `limit` requests per window, otherwise null. */
export function rateLimit(req: Request, bucket: string, limit: number, windowMs = 60_000): Response | null {
  const key = `${bucket}:${clientIp(req)}`;
  const t = Date.now();
  const recent = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    const retry = Math.ceil((recent[0] + windowMs - t) / 1000);
    return Response.json({ error: "Too many requests. Try again in a moment." }, { status: 429, headers: { "retry-after": String(retry), "cache-control": "no-store" } });
  }
  recent.push(t);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || v[v.length - 1] < t - windowMs) hits.delete(k);
  return null;
}
