import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";

// Token usage per provider and day (for the daily budget and /api/health), and one trace per agent turn.

const day = () => new Date().toISOString().slice(0, 10);

export function addUsage(provider: string, promptTokens: number, completionTokens: number) {
  db()
    .prepare(
      `INSERT INTO llm_usage (day, provider, prompt_tokens, completion_tokens, calls) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(day, provider) DO UPDATE SET prompt_tokens = prompt_tokens + excluded.prompt_tokens,
         completion_tokens = completion_tokens + excluded.completion_tokens, calls = calls + 1`,
    )
    .run(day(), provider, promptTokens, completionTokens);
}

/** Tokens used today (UTC) across providers. */
export function tokensToday(): number {
  const r = db().prepare("SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS n FROM llm_usage WHERE day = ?").get(day()) as { n: number };
  return r.n;
}

/** Daily token budget across providers; AGENT_DAILY_TOKEN_BUDGET=0 turns it off. */
export const dailyBudget = () => {
  const v = Number(process.env.AGENT_DAILY_TOKEN_BUDGET ?? 3_000_000);
  return Number.isFinite(v) && v > 0 ? v : Infinity;
};
export const overBudget = () => tokensToday() >= dailyBudget();

export interface ToolStep {
  id: string;
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

/** What happened during one agent turn: which model answered, how long it took, what it cost, which tools ran. */
export interface TurnTrace {
  id: string;
  provider: string;
  model: string;
  failover: boolean;
  offline?: boolean;
  ms: number;
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  tools: ToolStep[];
}

export function newTraceId() {
  return `turn_${randomUUID()}`;
}

export function saveTrace(conversationId: string, sessionId: string, t: TurnTrace) {
  db().prepare("INSERT INTO agent_turns (id, conversation_id, session_id, data, created_at) VALUES (?, ?, ?, ?, ?)").run(t.id, conversationId, sessionId, JSON.stringify(t), new Date().toISOString());
}
