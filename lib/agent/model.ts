import "server-only";

// The mechanic runs on any OpenAI-compatible chat completions endpoint.
// Default: DeepSeek V4 on Boundless inference.

export const MODEL = process.env.AGENT_MODEL || "dsv4";
export const BASE_URL = process.env.AGENT_BASE_URL || "https://api.inference.boundless.network/v1";
export const agentKey = () => process.env.AGENT_API_KEY;

const LABELS: Record<string, string> = { dsv4: "DeepSeek V4" };
/** Display names for the status bar and landing page. */
export const MODEL_LABEL = process.env.AGENT_MODEL_LABEL || LABELS[MODEL] || MODEL;
export const PROVIDER = new URL(BASE_URL).hostname.replace(/^(api\.)?(inference\.)?/, "");
