import "server-only";

// The mechanic runs on any OpenAI-compatible chat completions endpoint.
// Primary: DeepSeek V4 on Boundless inference. Fallback (optional): OpenRouter, used while the
// primary is down, out of budget or rate limited (see ./llm).

export interface Provider {
  id: "primary" | "fallback";
  baseURL: string;
  model: string;
  key: string;
  /** Display names for the status bar, trace and health check. */
  label: string;
  host: string;
  /** Send reasoning_content back on later tool steps of a turn (DeepSeek requires it; others get it stripped). */
  replayReasoning: boolean;
}

const LABELS: Record<string, string> = { dsv4: "DeepSeek V4" };
const hostOf = (url: string) => new URL(url).hostname.replace(/^(api\.)?(inference\.)?/, "");

export const MODEL = process.env.AGENT_MODEL || "dsv4";
export const BASE_URL = process.env.AGENT_BASE_URL || "https://api.inference.boundless.network/v1";
export const MODEL_LABEL = process.env.AGENT_MODEL_LABEL || LABELS[MODEL] || MODEL;
export const PROVIDER = hostOf(BASE_URL);

/** Configured providers, primary first. */
export function providers(): Provider[] {
  const out: Provider[] = [];
  if (process.env.AGENT_API_KEY) {
    out.push({ id: "primary", baseURL: BASE_URL, model: MODEL, key: process.env.AGENT_API_KEY, label: MODEL_LABEL, host: PROVIDER, replayReasoning: !/openrouter\.ai/.test(BASE_URL) });
  }
  if (process.env.AGENT_FALLBACK_API_KEY) {
    const baseURL = process.env.AGENT_FALLBACK_BASE_URL || "https://openrouter.ai/api/v1";
    const model = process.env.AGENT_FALLBACK_MODEL || "deepseek/deepseek-chat";
    out.push({
      id: "fallback",
      baseURL,
      model,
      key: process.env.AGENT_FALLBACK_API_KEY,
      label: process.env.AGENT_FALLBACK_LABEL || model.split("/").pop()!,
      host: hostOf(baseURL),
      replayReasoning: false,
    });
  }
  return out;
}

export const agentConfigured = () => providers().length > 0;
