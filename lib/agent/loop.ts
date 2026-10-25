import "server-only";
import OpenAI from "openai";
import { loadConversation, saveConversation } from "@/lib/server/db";
import type { StreamEvent, UiEvent, ViewContext } from "./events";
import { BASE_URL, MODEL, agentKey } from "./model";
import { SYSTEM_PROMPT } from "./prompt";
import { TOOLS, TOOL_LABELS, runTool, viewContextText, type ToolName } from "./tools";

const MAX_STEPS = 10;

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** OpenAI chat messages. reasoning_content is replayed when the model sends it (DeepSeek requires that on later tool turns). */
type ChatMsg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string }
  | { role: "tool"; content: string; tool_call_id: string; name?: string };

const g = globalThis as unknown as { __agent?: OpenAI; __agentKey?: string };
const client = () => {
  const apiKey = agentKey();
  if (!g.__agent || g.__agentKey !== apiKey) {
    g.__agentKey = apiKey;
    g.__agent = new OpenAI({ apiKey, baseURL: BASE_URL });
  }
  return g.__agent;
};

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

/**
 * One user turn of the mechanic agent: a streaming manual tool loop against
 * OpenAI-compatible chat completions (see ./model).
 */
export async function runAgentTurn(opts: {
  conversationId: string;
  sessionId: string;
  text: string;
  view: ViewContext;
  signal: AbortSignal;
  write: (e: StreamEvent) => void;
}) {
  const { write } = opts;
  const messages: ChatMsg[] = [
    ...usableHistory(loadConversation<unknown>(opts.conversationId, opts.sessionId)),
    { role: "user", content: `${viewContextText(opts.view)}\n\n${opts.text}` },
  ];
  const ctx = { sessionId: opts.sessionId, view: opts.view, emit: (e: UiEvent) => write({ event: "ui", data: e }) };

  let stopReason: string | null = null;
  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = await client().chat.completions.create(
      {
        model: MODEL,
        max_tokens: 16000,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages] as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: TOOLS,
        tool_choice: "auto",
        stream: true,
      },
      { signal: opts.signal },
    );

    let content = "";
    let reasoning = "";
    const acc = new Map<number, { id: string; name: string; arguments: string; announced: boolean }>();
    let finish: string | null = null;

    for await (const chunk of stream) {
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
      const note = delta.reasoning_content || delta.reasoning;
      if (note) {
        reasoning += note;
        write({ event: "progress", data: { text: note } });
      }
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
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    stopReason = finish;

    if (finish === "content_filter") {
      write({ event: "text", data: { delta: "\n\nSorry, I can't help with that request. I can help diagnose and fix car problems." } });
      return { stopReason };
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

    if (finish === "length" && toolCalls.length) {
      write({ event: "error", data: { message: "The answer got too long and was cut off. Please try again." } });
      break;
    }

    messages.push({
      role: "assistant",
      content: content || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      ...(reasoning ? { reasoning_content: reasoning } : {}),
    });

    if (!toolCalls.length) break;

    for (const tu of toolCalls) {
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
  }

  saveConversation(opts.conversationId, opts.sessionId, messages);
  return { stopReason };
}
