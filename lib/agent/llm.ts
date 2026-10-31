import "server-only";
import OpenAI from "openai";
import { providers, type Provider } from "./model";

// Provider failover for the mechanic. A provider that fails with an outage (auth, budget, rate limit,
// 5xx, network) sits out for a few minutes; while it does, the next one takes its turns.

const COOL_DOWN_MS = 5 * 60_000;
const g = globalThis as unknown as {
  __llmClients?: Map<string, OpenAI>;
  __llmDown?: Map<Provider["id"], { until: number; reason: string }>;
  __llmPing?: Map<Provider["id"], { at: number; ok: boolean; ms: number; error?: string }>;
};
const clients = (g.__llmClients ??= new Map());
const down = (g.__llmDown ??= new Map());
const pings = (g.__llmPing ??= new Map());

export function clientFor(p: Provider): OpenAI {
  const key = `${p.id}|${p.baseURL}|${p.key}`;
  let c = clients.get(key);
  if (!c) {
    const openrouter = /openrouter\.ai/.test(p.baseURL);
    c = new OpenAI({
      apiKey: p.key,
      baseURL: p.baseURL,
      timeout: 90_000,
      // One quick retry; after that, failing over beats waiting on backoff.
      maxRetries: 1,
      defaultHeaders: openrouter ? { "HTTP-Referer": "https://crankwell.xyz", "X-Title": "Crankwell" } : undefined,
    });
    clients.set(key, c);
  }
  return c;
}

export class AllProvidersFailed extends Error {
  constructor(public errors: { provider: Provider["id"]; message: string }[]) {
    super(errors.length ? `All AI providers failed: ${errors.map((e) => `${e.provider}: ${e.message}`).join("; ")}` : "No AI provider is configured");
  }
}

export function describe(e: unknown): string {
  if (e instanceof OpenAI.APIError) return `${e.status ?? "network"} ${e.message}`.slice(0, 200);
  return e instanceof Error ? e.message.slice(0, 200) : "unknown error";
}

/** Does this error mean the provider itself is unavailable (rather than our request being wrong)? */
export function isOutage(e: unknown): boolean {
  if (e instanceof OpenAI.APIConnectionError) return true;
  if (e instanceof OpenAI.APIError) {
    const s = e.status ?? 0;
    return s === 0 || s === 401 || s === 402 || s === 403 || s === 408 || s === 429 || s >= 500;
  }
  return false;
}

const healthy = (p: Provider) => (down.get(p.id)?.until ?? 0) < Date.now();

/**
 * Providers to try, in order. A turn that already failed over starts from that provider, so it never
 * mixes back to one that needs reasoning replay. Providers sitting out go last instead of being skipped.
 */
export function rotation(from?: Provider["id"]): Provider[] {
  const all = providers();
  const start = from ? Math.max(0, all.findIndex((p) => p.id === from)) : 0;
  const list = all.slice(start);
  return [...list.filter(healthy), ...list.filter((p) => !healthy(p))];
}

/**
 * Open a streaming completion. A provider that fails before sending anything hands over to the next;
 * once chunks flow the provider is committed, and a mid-stream failure ends the turn.
 */
export async function openStream(
  build: (p: Provider) => OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  opts: { signal: AbortSignal; from?: Provider["id"] },
): Promise<{ provider: Provider; chunks: AsyncGenerator<OpenAI.Chat.ChatCompletionChunk> }> {
  const errors: AllProvidersFailed["errors"] = [];
  for (const p of rotation(opts.from)) {
    try {
      const stream = await clientFor(p).chat.completions.create(build(p), { signal: opts.signal });
      const it = stream[Symbol.asyncIterator]();
      const first = await it.next();
      down.delete(p.id);
      const chunks = (async function* () {
        if (first.done) return;
        yield first.value;
        for (let n = await it.next(); !n.done; n = await it.next()) yield n.value;
      })();
      return { provider: p, chunks };
    } catch (e) {
      if (opts.signal.aborted) throw e;
      if (isOutage(e)) down.set(p.id, { until: Date.now() + COOL_DOWN_MS, reason: describe(e) });
      console.warn(`[llm] ${p.id} (${p.host}) failed before streaming: ${describe(e)}`);
      errors.push({ provider: p.id, message: describe(e) });
    }
  }
  throw new AllProvidersFailed(errors);
}

/** One non-streaming completion with the same failover, for small structured jobs (the grids' Ask). */
export async function complete(
  build: (p: Provider) => OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  opts: { signal?: AbortSignal } = {},
): Promise<{ provider: Provider; completion: OpenAI.Chat.ChatCompletion }> {
  const errors: AllProvidersFailed["errors"] = [];
  for (const p of rotation()) {
    try {
      const completion = await clientFor(p).chat.completions.create(build(p), { signal: opts.signal });
      down.delete(p.id);
      return { provider: p, completion };
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (isOutage(e)) down.set(p.id, { until: Date.now() + COOL_DOWN_MS, reason: describe(e) });
      console.warn(`[llm] ${p.id} (${p.host}) failed: ${describe(e)}`);
      errors.push({ provider: p.id, message: describe(e) });
    }
  }
  throw new AllProvidersFailed(errors);
}

/** Provider health for /api/health. `deep` sends a 1-token request to each (cached for 5 minutes). */
export async function providerHealth(deep: boolean) {
  return Promise.all(
    providers().map(async (p) => {
      let ping = pings.get(p.id);
      if (deep && (!ping || Date.now() - ping.at > COOL_DOWN_MS)) {
        const t0 = Date.now();
        try {
          await clientFor(p).chat.completions.create({ model: p.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }, { timeout: 20_000, maxRetries: 0 });
          ping = { at: Date.now(), ok: true, ms: Date.now() - t0 };
        } catch (e) {
          ping = { at: Date.now(), ok: false, ms: Date.now() - t0, error: describe(e) };
        }
        pings.set(p.id, ping);
      }
      const d = down.get(p.id);
      return {
        id: p.id,
        label: p.label,
        host: p.host,
        model: p.model,
        healthy: healthy(p),
        ...(d && !healthy(p) ? { downUntil: new Date(d.until).toISOString(), reason: d.reason } : {}),
        ...(ping ? { ping: { ok: ping.ok, ms: ping.ms, at: new Date(ping.at).toISOString(), ...(ping.error ? { error: ping.error } : {}) } } : {}),
      };
    }),
  );
}
