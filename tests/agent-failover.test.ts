import { beforeEach, describe, expect, it, vi } from "vitest";

// The OpenAI client is faked per provider (by base URL): these tests cover failover, the cool-down
// breaker, reasoning replay and history trimming.
const llm = vi.hoisted(() => {
  // Provider settings are read when the model module loads, so set them before any import.
  Object.assign(process.env, { AGENT_API_KEY: "k1", AGENT_BASE_URL: "https://primary.test/v1", AGENT_FALLBACK_API_KEY: "k2", AGENT_FALLBACK_MODEL: "deepseek/deepseek-chat" });
  return { behave: new Map<string, () => unknown>(), calls: [] as { baseURL: string; body: Record<string, unknown> }[] };
});

vi.mock("openai", async (importOriginal) => {
  const real = (await importOriginal()) as { default: typeof import("openai").default };
  const Real = real.default;
  class Fake {
    baseURL: string;
    chat: { completions: { create: (body: Record<string, unknown>) => Promise<unknown> } };
    constructor(o: { baseURL: string }) {
      this.baseURL = o.baseURL;
      this.chat = {
        completions: {
          create: async (body) => {
            llm.calls.push({ baseURL: this.baseURL, body });
            return llm.behave.get(this.baseURL)!();
          },
        },
      };
    }
    static APIError = Real.APIError;
    static APIConnectionError = Real.APIConnectionError;
    static AuthenticationError = Real.AuthenticationError;
    static RateLimitError = Real.RateLimitError;
  }
  return { ...real, default: Fake };
});

const PRIMARY = "https://primary.test/v1";
const FALLBACK = "https://openrouter.ai/api/v1";

function streamOf(text: string, usage = { prompt_tokens: 10, completion_tokens: 5 }) {
  return (async function* () {
    yield { choices: [{ index: 0, delta: { content: text, reasoning_content: "thinking" }, finish_reason: null }] };
    yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
    yield { choices: [], usage };
  })();
}

const { default: OpenAI } = await import("openai");
const outage = (status: number) => () => {
  throw new OpenAI.APIError(status, undefined, `status ${status}`, new Headers());
};

beforeEach(() => {
  llm.calls.length = 0;
  llm.behave.clear();
  (globalThis as { __llmDown?: Map<string, unknown> }).__llmDown?.clear();
});

const { openStream, rotation, AllProvidersFailed } = await import("@/lib/agent/llm");
const { trimHistory, runAgentTurn } = await import("@/lib/agent/loop");
const build = (p: { model: string }) => ({ model: p.model, messages: [], stream: true as const });

describe("provider failover", () => {
  it("uses the primary when it works", async () => {
    llm.behave.set(PRIMARY, () => streamOf("hi"));
    const r = await openStream(build, { signal: new AbortController().signal });
    expect(r.provider.id).toBe("primary");
  });

  it("falls back on an outage and benches the primary for a while", async () => {
    llm.behave.set(PRIMARY, outage(402));
    llm.behave.set(FALLBACK, () => streamOf("hi"));
    const r = await openStream(build, { signal: new AbortController().signal });
    expect(r.provider.id).toBe("fallback");
    expect(rotation().map((p) => p.id)).toEqual(["fallback", "primary"]);
  });

  it("falls back on a bad request without benching the primary", async () => {
    llm.behave.set(PRIMARY, outage(400));
    llm.behave.set(FALLBACK, () => streamOf("hi"));
    expect((await openStream(build, { signal: new AbortController().signal })).provider.id).toBe("fallback");
    expect(rotation().map((p) => p.id)).toEqual(["primary", "fallback"]);
  });

  it("stays on the fallback for the rest of a turn", async () => {
    llm.behave.set(PRIMARY, () => streamOf("hi"));
    llm.behave.set(FALLBACK, () => streamOf("hi"));
    expect((await openStream(build, { signal: new AbortController().signal, from: "fallback" })).provider.id).toBe("fallback");
  });

  it("reports every failure when no provider answers", async () => {
    llm.behave.set(PRIMARY, outage(503));
    llm.behave.set(FALLBACK, outage(429));
    await expect(openStream(build, { signal: new AbortController().signal })).rejects.toBeInstanceOf(AllProvidersFailed);
  });
});

describe("agent turn", () => {
  const view = { carId: "corolla" as const };
  const run = (text: string, conversationId = `conv-${Math.random()}`) => {
    const events: { event: string; data: unknown }[] = [];
    return runAgentTurn({ conversationId, sessionId: "session-failover-1", text, view, signal: new AbortController().signal, write: (e) => events.push(e) }).then((r) => ({ ...r, events }));
  };

  it("records the provider and tokens in the trace", async () => {
    llm.behave.set(PRIMARY, () => streamOf("Likely the battery."));
    const r = await run("car won't start");
    expect(r.trace).toMatchObject({ provider: "primary.test", failover: false, llmCalls: 1, promptTokens: 10, completionTokens: 5 });
  });

  it("strips reasoning when replaying history to the fallback", async () => {
    const conv = "conv-reasoning";
    llm.behave.set(PRIMARY, () => streamOf("First answer."));
    await run("car won't start", conv);
    llm.behave.set(PRIMARY, outage(500));
    llm.behave.set(FALLBACK, () => streamOf("Second answer."));
    const r = await run("still dead", conv);
    expect(r.trace.failover).toBe(true);
    const sent = llm.calls.at(-1)!.body.messages as { role: string; reasoning_content?: string; provider?: string }[];
    expect(sent.some((m) => m.reasoning_content)).toBe(false);
    expect(sent.some((m) => "provider" in m)).toBe(false);
  });

  it("falls back to a keyword match when every provider is down", async () => {
    llm.behave.set(PRIMARY, outage(503));
    llm.behave.set(FALLBACK, outage(503));
    const r = await run("brakes grinding and the pedal feels soft");
    expect(r.stopReason).toBe("offline");
    expect(r.trace.offline).toBe(true);
    const ui = r.events.find((e) => e.event === "ui")?.data as { type: string; suspects: { partId: string }[] };
    expect(ui.type).toBe("diagnosis");
    expect(ui.suspects.some((s) => s.partId.startsWith("brakes."))).toBe(true);
  });
});

describe("history trimming", () => {
  type M = Parameters<typeof trimHistory>[0][number];
  const turn = (i: number): M[] => [
    { role: "user", content: `question ${i}` },
    { role: "assistant", content: `looking ${i}`, tool_calls: [{ id: `c${i}`, type: "function", function: { name: "get_orders", arguments: "{}" } }] },
    { role: "tool", tool_call_id: `c${i}`, content: "x".repeat(2000) },
    { role: "assistant", content: `answer ${i}` },
  ];
  const pairsValid = (msgs: M[]) => {
    const calls = new Set(msgs.flatMap((m) => (m.role === "assistant" ? (m.tool_calls ?? []).map((c) => c.id) : [])));
    return msgs.every((m) => m.role !== "tool" || calls.has(m.tool_call_id));
  };

  it("keeps recent turns and collapses older ones to what was said", () => {
    const msgs = Array.from({ length: 7 }, (_, i) => turn(i)).flat();
    const out = trimHistory(msgs, 4);
    expect(out.slice(0, 2)).toEqual([{ role: "user", content: "question 0" }, { role: "assistant", content: "looking 0\nanswer 0" }]);
    expect(out.filter((m) => m.role === "tool")).toHaveLength(4);
    expect(pairsValid(out)).toBe(true);
  });

  it("respects the size cap and always keeps the newest turn", () => {
    const msgs = Array.from({ length: 6 }, (_, i) => turn(i)).flat();
    const out = trimHistory(msgs, 4, 5000);
    expect(out.flat().reduce((n, m) => n + (m.content?.length ?? 0), 0)).toBeLessThan(5000);
    expect(out.at(-1)).toEqual({ role: "assistant", content: "answer 5" });
    expect(pairsValid(out)).toBe(true);
  });
});
