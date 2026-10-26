import "server-only";
import type OpenAI from "openai";
import { getPart } from "@/lib/cars";
import { findSuspectParts } from "@/lib/catalog/symptom-search";
import { loadConversation, saveConversation } from "@/lib/server/db";
import { addUsage, newTraceId, saveTrace, type ToolStep, type TurnTrace } from "@/lib/server/telemetry";
import type { StreamEvent, Suspect, UiEvent, ViewContext } from "./events";
import { AllProvidersFailed, openStream } from "./llm";
import type { Provider } from "./model";
import { SYSTEM_PROMPT } from "./prompt";
import { TOOLS, TOOL_LABELS, runTool, viewContextText, type ToolName } from "./tools";

const MAX_STEPS = 10;
/** Turns kept word for word; older ones keep only what was said. */
const KEEP_TURNS = 4;
const MAX_HISTORY_CHARS = 60_000;

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/**
 * OpenAI chat messages. reasoning_content is replayed to providers that need it (DeepSeek, on later tool
 * steps); `provider` records which one wrote an assistant message and is never sent.
 */
export type ChatMsg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string; provider?: Provider["id"] }
  | { role: "tool"; content: string; tool_call_id: string; name?: string };

function textOf(content: unknown): string | null | undefined {
  if (content == null) return null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  if (!content.every((b) => b && typeof b === "object" && (b as { type?: string }).type === "text")) return undefined;
  return content.map((b: { text?: string }) => b.text ?? "").join("\n");
}

/** Drop history written by the old Anthropic message format so a provider switch cannot poison the next call. */
function usableHistory(raw: unknown[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return [];
    const rec = m as Record<string, unknown>;
    const content = textOf(rec.content);
    if (content === undefined) return [];
    if (rec.role === "user") {
      out.push({ role: "user", content: content ?? "" });
    } else if (rec.role === "assistant") {
      const tool_calls = Array.isArray(rec.tool_calls) ? (rec.tool_calls as ToolCall[]) : undefined;
      out.push({
        role: "assistant",
        content,
        ...(tool_calls?.length ? { tool_calls } : {}),
        ...(typeof rec.reasoning_content === "string" && rec.reasoning_content ? { reasoning_content: rec.reasoning_content } : {}),
        ...(rec.provider === "primary" || rec.provider === "fallback" ? { provider: rec.provider } : {}),
      });
    } else if (rec.role === "tool" && typeof rec.tool_call_id === "string") {
      out.push({
        role: "tool",
        content: content ?? "",
        tool_call_id: rec.tool_call_id,
        ...(typeof rec.name === "string" ? { name: rec.name } : {}),
      });
    } else {
      return [];
    }
  }
  return out;
}

const size = (m: ChatMsg) => (m.content?.length ?? 0) + (m.role === "assistant" ? JSON.stringify(m.tool_calls ?? "").length + (m.reasoning_content?.length ?? 0) : 0);

/** A past turn reduced to what was said: the user's message and the mechanic's words, no tool traffic. */
function collapse(turn: ChatMsg[]): ChatMsg[] {
  const said = turn
    .filter((m): m is Extract<ChatMsg, { role: "assistant" }> => m.role === "assistant" && Boolean(m.content?.trim()))
    .map((m) => m.content!.trim())
    .join("\n");
  return [turn[0], { role: "assistant", content: said || "(answered with cards)" }];
}

/**
 * Keep the last few turns as they were and collapse older ones, so cost and latency stay flat in long
 * chats. Collapsing whole turns keeps every tool call next to its result.
 */
export function trimHistory(msgs: ChatMsg[], keepTurns = KEEP_TURNS, maxChars = MAX_HISTORY_CHARS): ChatMsg[] {
  const turns: ChatMsg[][] = [];
  for (const m of msgs) {
    if (m.role === "user") turns.push([m]);
    else if (turns.length) turns[turns.length - 1].push(m);
  }
  let out = turns.map((t, i) => (i < turns.length - keepTurns ? collapse(t) : t));
  const total = () => out.flat().reduce((n, m) => n + size(m), 0);
  // Still too long: collapse the oldest full turns, then drop the oldest turns, always keeping the newest.
  for (let i = 0; i < out.length - 1 && total() > maxChars; i++) out[i] = collapse(out[i]);
  while (out.length > 1 && total() > maxChars) out = out.slice(1);
  return out.flat();
}

/** The messages as one provider should see them. */
function forProvider(msgs: ChatMsg[], p: Provider): OpenAI.Chat.ChatCompletionMessageParam[] {
  return msgs.map((m) => {
    if (m.role !== "assistant") return m;
    const { provider: _by, reasoning_content, ...rest } = m;
    void _by;
    return (p.replayReasoning && reasoning_content ? { ...rest, reasoning_content } : rest) as OpenAI.Chat.ChatCompletionMessageParam;
  });
}

/** Every AI provider is down: still point at likely parts, from a keyword match against the catalog. */
function offlineReply(text: string, view: ViewContext, write: (e: StreamEvent) => void, emit: (e: UiEvent) => void): string {
  const hits = findSuspectParts(view.carId, text, 4);
  const total = hits.reduce((n, h) => n + h.score, 0);
  const suspects: Suspect[] = hits.flatMap((h) => {
    const p = getPart(view.carId, h.part_id);
    if (!p) return [];
    const why = h.matched_symptoms.length ? `Matches "${h.matched_symptoms.slice(0, 2).join('", "')}".` : `Matches your description of the ${h.system.toLowerCase()}.`;
    return [{ partId: p.id, name: p.name, system: p.system, confidence: Math.round((h.score / total) * 60) / 100, rationale: why }];
  });
  const say = suspects.length
    ? "The AI mechanic is offline for a moment, so this is a plain keyword match against the parts catalog, not a diagnosis. If the car feels unsafe, don't drive it and have a mechanic check it."
    : "The AI mechanic is offline for a moment. Please try again shortly. If the car feels unsafe, don't drive it and have a mechanic check it.";
  write({ event: "text", data: { delta: say } });
  if (suspects.length) {
    emit({
      type: "diagnosis",
      carId: view.carId,
      title: "Keyword match (AI offline)",
      summary: "These catalog parts match the words in your message. Without the AI mechanic there is no safety assessment, so treat it as a starting point only.",
      severity: "moderate",
      driveSafety: "caution",
      suspects,
    });
  }
  return say;
}

/**
 * One user turn of the mechanic agent: a streaming manual tool loop against OpenAI-compatible chat
 * completions, failing over between providers (see ./llm).
 */
export async function runAgentTurn(opts: {
  conversationId: string;
  sessionId: string;
  text: string;
  view: ViewContext;
  signal: AbortSignal;
  write: (e: StreamEvent) => void;
  /** This app's public origin, for PayPal return URLs on purchases the mechanic makes. */
  origin?: string;
}) {
  const { write } = opts;
  const started = Date.now();
  const messages: ChatMsg[] = [
    ...trimHistory(usableHistory(loadConversation<unknown>(opts.conversationId, opts.sessionId))),
    { role: "user", content: `${viewContextText(opts.view)}\n\n${opts.text}` },
  ];
  const emit = (e: UiEvent) => write({ event: "ui", data: e });
  const ctx = { sessionId: opts.sessionId, view: opts.view, emit, origin: opts.origin };
  const trace: TurnTrace = { id: newTraceId(), provider: "", model: "", failover: false, ms: 0, llmCalls: 0, promptTokens: 0, completionTokens: 0, tools: [] };
  const finish = (stopReason: string | null) => {
    trace.ms = Date.now() - started;
    saveConversation(opts.conversationId, opts.sessionId, messages);
    saveTrace(opts.conversationId, opts.sessionId, trace);
    return { stopReason, trace };
  };

  let stopReason: string | null = null;
  let said = false;
  let from: Provider["id"] | undefined;
  for (let step = 0; step < MAX_STEPS; step++) {
    let opened: Awaited<ReturnType<typeof openStream>>;
    try {
      opened = await openStream(
        (p) => ({
          model: p.model,
          max_tokens: 16000,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...forProvider(messages, p)],
          tools: TOOLS,
          tool_choice: "auto",
          stream: true,
          stream_options: { include_usage: true },
        }),
        { signal: opts.signal, from },
      );
    } catch (e) {
      if (!(e instanceof AllProvidersFailed) || step > 0 || said) throw e;
      trace.offline = true;
      trace.provider = "offline";
      messages.push({ role: "assistant", content: offlineReply(opts.text, opts.view, write, emit) });
      return finish("offline");
    }
    const { provider, chunks } = opened;
    from = provider.id;
    trace.provider = provider.host;
    trace.model = provider.label;
    trace.failover ||= provider.id !== "primary";
    trace.llmCalls++;

    let content = "";
    let reasoning = "";
    const acc = new Map<number, { id: string; name: string; arguments: string; announced: boolean }>();
    let finishReason: string | null = null;

    for await (const chunk of chunks) {
      if (chunk.usage) {
        trace.promptTokens += chunk.usage.prompt_tokens ?? 0;
        trace.completionTokens += chunk.usage.completion_tokens ?? 0;
        addUsage(provider.id, chunk.usage.prompt_tokens ?? 0, chunk.usage.completion_tokens ?? 0);
      }
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta as OpenAI.Chat.ChatCompletionChunk.Choice.Delta & {
        reasoning_content?: string | null;
        reasoning?: string | null;
      };
      if (delta.content) {
        content += delta.content;
        write({ event: "text", data: { delta: delta.content } });
      }
      // Reasoning stays on the server: it is replayed to the model, never shown in the chat.
      reasoning += delta.reasoning_content || delta.reasoning || "";
      for (const tc of delta.tool_calls ?? []) {
        const cur = acc.get(tc.index) ?? { id: "", name: "", arguments: "", announced: false };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        if (!cur.announced && cur.id && cur.name) {
          cur.announced = true;
          write({
            event: "tool",
            data: { id: cur.id, name: cur.name, label: TOOL_LABELS[cur.name as ToolName] ?? cur.name, status: "running" },
          });
        }
        acc.set(tc.index, cur);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    stopReason = finishReason;

    if (finishReason === "content_filter") {
      write({ event: "text", data: { delta: "\n\nSorry, I can't help with that request. I can help diagnose and fix car problems." } });
      return finish(stopReason);
    }

    const toolCalls: ToolCall[] = [...acc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, t], i) => {
        const id = t.id || `call_${step}_${i}`;
        if (!t.announced && t.name) {
          write({ event: "tool", data: { id, name: t.name, label: TOOL_LABELS[t.name as ToolName] ?? t.name, status: "running" } });
        }
        return { id, type: "function" as const, function: { name: t.name, arguments: t.arguments || "{}" } };
      });

    if (finishReason === "length" && toolCalls.length) {
      write({ event: "error", data: { message: "The answer got too long and was cut off. Please try again." } });
      break;
    }

    messages.push({
      role: "assistant",
      content: content || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      provider: provider.id,
    });

    if (!toolCalls.length) break;
    said ||= Boolean(content.trim());

    let failed = false;
    for (const tu of toolCalls) {
      const t0 = Date.now();
      let input: unknown = {};
      let parsed = true;
      try {
        input = tu.function.arguments ? JSON.parse(tu.function.arguments) : {};
      } catch {
        parsed = false;
      }
      const r = parsed
        ? await runTool(tu.function.name, input, ctx)
        : { content: "Invalid input: tool arguments were not valid JSON. Call the tool again with valid JSON.", isError: true };
      failed ||= Boolean(r.isError);
      const toolStep: ToolStep = { id: tu.id, name: tu.function.name, ok: !r.isError, ms: Date.now() - t0, ...(r.isError ? { error: r.content.slice(0, 200) } : {}) };
      trace.tools.push(toolStep);
      messages.push({ role: "tool", tool_call_id: tu.id, name: tu.function.name, content: r.content });
      write({
        event: "tool",
        data: {
          id: tu.id,
          name: tu.function.name,
          label: TOOL_LABELS[tu.function.name as ToolName] ?? tu.function.name,
          status: r.isError ? "error" : "done",
        },
      });
    }
    // Reply chips close the turn: once the message is written, another model call would only repeat it.
    if (said && !failed && toolCalls.some((t) => t.function.name === "suggest_replies")) break;
  }

  return finish(stopReason);
}
