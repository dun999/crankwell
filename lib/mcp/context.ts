import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request facts the MCP tools need: the public origin for links, and who connected (if anyone). */
export interface McpRequestContext {
  origin: string;
  /** Browser session paired through OAuth, or null before the user connects. */
  sessionId: string | null;
  clientId?: string;
}

export const mcpContext = new AsyncLocalStorage<McpRequestContext>();

export function mcpRequest(): McpRequestContext {
  const c = mcpContext.getStore();
  if (!c) throw new Error("MCP tool called outside a request");
  return c;
}
