import "server-only";
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Transaction, TxEvent } from "@/lib/commerce/types";

type DB = Database.Database;
const g = globalThis as unknown as { __fycDb?: DB };

export function db(): DB {
  if (g.__fycDb) return g.__fycDb;
  const file = process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "fyc.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      messages TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      order_id TEXT,
      capture_id TEXT,
      authorization_id TEXT,
      invoice_id TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tx_session ON transactions(session_id);
    CREATE INDEX IF NOT EXISTS tx_order ON transactions(order_id);
    CREATE INDEX IF NOT EXISTS tx_capture ON transactions(capture_id);
    CREATE INDEX IF NOT EXISTS tx_auth ON transactions(authorization_id);
    CREATE INDEX IF NOT EXISTS tx_invoice ON transactions(invoice_id);
    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      resource_id TEXT,
      received_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      case_id TEXT,
      status TEXT NOT NULL,
      tx_id TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS action_session ON actions(session_id);
    CREATE INDEX IF NOT EXISTS action_case ON actions(case_id);
    CREATE TABLE IF NOT EXISTS wallets (
      session_id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      customer_id TEXT,
      payer_email TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_codes (
      hash TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      hash TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      session_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      grant_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS oauth_token_session ON oauth_tokens(session_id);
    CREATE INDEX IF NOT EXISTS oauth_token_grant ON oauth_tokens(grant_id);
    CREATE TABLE IF NOT EXISTS secrets (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  g.__fycDb = d;
  return d;
}

/** A random server secret, created on first use and kept with the data it protects. */
export function serverSecret(name: string): Buffer {
  const d = db();
  d.prepare("INSERT OR IGNORE INTO secrets (name, value) VALUES (?, ?)").run(name, randomBytes(32).toString("base64url"));
  return Buffer.from((d.prepare("SELECT value FROM secrets WHERE name = ?").get(name) as { value: string }).value, "base64url");
}

// ───────────────────────── Conversations ─────────────────────────

export function loadConversation<T>(id: string, sessionId: string): T[] {
  const row = db().prepare("SELECT session_id, messages FROM conversations WHERE id = ?").get(id) as { session_id: string; messages: string } | undefined;
  if (!row || row.session_id !== sessionId) return [];
  return JSON.parse(row.messages) as T[];
}

export function saveConversation(id: string, sessionId: string, messages: unknown[]) {
  db()
    .prepare(
      `INSERT INTO conversations (id, session_id, messages, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET messages = excluded.messages, updated_at = excluded.updated_at WHERE conversations.session_id = excluded.session_id`,
    )
    .run(id, sessionId, JSON.stringify(messages), new Date().toISOString());
}

// ───────────────────────── Transactions ─────────────────────────

const now = () => new Date().toISOString();

function row(t: Transaction) {
  return {
    id: t.id,
    session_id: t.sessionId,
    kind: t.kind,
    status: t.status,
    order_id: t.paypal.orderId ?? null,
    capture_id: t.paypal.captureId ?? null,
    authorization_id: t.paypal.authorizationId ?? null,
    invoice_id: t.paypal.invoiceId ?? null,
    data: JSON.stringify(t),
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

export function txInsert(t: Transaction): Transaction {
  db()
    .prepare(
      `INSERT INTO transactions (id, session_id, kind, status, order_id, capture_id, authorization_id, invoice_id, data, created_at, updated_at)
       VALUES (@id, @session_id, @kind, @status, @order_id, @capture_id, @authorization_id, @invoice_id, @data, @created_at, @updated_at)`,
    )
    .run(row(t));
  return t;
}

export function txGet(id: string): Transaction | undefined {
  const r = db().prepare("SELECT data FROM transactions WHERE id = ?").get(id) as { data: string } | undefined;
  return r ? (JSON.parse(r.data) as Transaction) : undefined;
}

export function txFind(by: "order_id" | "capture_id" | "authorization_id" | "invoice_id", value: string): Transaction | undefined {
  const r = db().prepare(`SELECT data FROM transactions WHERE ${by} = ?`).get(value) as { data: string } | undefined;
  return r ? (JSON.parse(r.data) as Transaction) : undefined;
}

export function txList(sessionId: string): Transaction[] {
  return (db().prepare("SELECT data FROM transactions WHERE session_id = ? ORDER BY created_at DESC LIMIT 100").all(sessionId) as { data: string }[]).map(
    (r) => JSON.parse(r.data) as Transaction,
  );
}

/** Apply a patch and append a timeline event atomically. */
export function txUpdate(
  id: string,
  patch: Partial<Omit<Transaction, "paypal" | "events">> & { paypal?: Partial<Transaction["paypal"]> },
  event?: Omit<TxEvent, "at">,
): Transaction | undefined {
  const d = db();
  return d.transaction(() => {
    const cur = txGet(id);
    if (!cur) return undefined;
    const next: Transaction = {
      ...cur,
      ...patch,
      paypal: { ...cur.paypal, ...(patch.paypal ?? {}) },
      events: event ? [...cur.events, { ...event, at: now() }] : cur.events,
      updatedAt: now(),
    };
    const r = row(next);
    d.prepare(
      `UPDATE transactions SET status=@status, order_id=@order_id, capture_id=@capture_id, authorization_id=@authorization_id,
       invoice_id=@invoice_id, data=@data, updated_at=@updated_at WHERE id=@id`,
    ).run(r);
    return next;
  })();
}

// ───────────────────────── Webhooks ─────────────────────────

/** Record a webhook event id. Returns false if it was already processed. */
export function webhookFirstSeen(id: string, type: string, resourceId: string | undefined, payload: unknown): boolean {
  const res = db()
    .prepare("INSERT OR IGNORE INTO webhook_events (id, event_type, resource_id, received_at, payload) VALUES (?, ?, ?, ?, ?)")
    .run(id, type, resourceId ?? null, now(), JSON.stringify(payload));
  return res.changes === 1;
}
