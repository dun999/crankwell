import "server-only";
import { EventEmitter } from "node:events";
import type { Transaction } from "@/lib/commerce/types";

// In-process pub/sub for live transaction updates (single Node process).
const g = globalThis as unknown as { __fycBus?: EventEmitter };
const bus = (g.__fycBus ??= new EventEmitter().setMaxListeners(500));

export function publishTx(tx: Transaction) {
  bus.emit(`tx:${tx.sessionId}`, tx);
}

export function subscribeTx(sessionId: string, fn: (tx: Transaction) => void) {
  bus.on(`tx:${sessionId}`, fn);
  return () => bus.off(`tx:${sessionId}`, fn);
}
