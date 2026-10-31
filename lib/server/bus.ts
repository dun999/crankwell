import "server-only";
import { EventEmitter } from "node:events";
import type { Mandate, Transaction } from "@/lib/commerce/types";

// In-process pub/sub for live transaction and spending-limit updates (single Node process).
const g = globalThis as unknown as { __fycBus?: EventEmitter };
const bus = (g.__fycBus ??= new EventEmitter().setMaxListeners(500));

export function publishTx(tx: Transaction) {
  bus.emit(`tx:${tx.sessionId}`, tx);
}

export function subscribeTx(sessionId: string, fn: (tx: Transaction) => void) {
  bus.on(`tx:${sessionId}`, fn);
  return () => bus.off(`tx:${sessionId}`, fn);
}

export function publishMandate(sessionId: string, m: Mandate) {
  bus.emit(`mandate:${sessionId}`, m);
}

export function subscribeMandates(sessionId: string, fn: (m: Mandate) => void) {
  bus.on(`mandate:${sessionId}`, fn);
  return () => bus.off(`mandate:${sessionId}`, fn);
}
