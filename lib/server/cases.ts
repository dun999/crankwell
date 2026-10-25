import "server-only";
import { randomBytes } from "node:crypto";
import type { DiagnosisCase } from "@/lib/agent/events";
import { db } from "./db";

// Diagnoses saved for a deep link. A case made in Claude before sign-in has no session until a
// browser opens its link and claims it; the id itself is the (unguessable) capability.

export function createCase(input: Omit<DiagnosisCase, "id" | "createdAt">, sessionId: string | null): DiagnosisCase {
  const c: DiagnosisCase = { ...input, id: `case_${randomBytes(12).toString("base64url")}`, createdAt: new Date().toISOString() };
  db().prepare("INSERT INTO cases (id, session_id, data, created_at) VALUES (?, ?, ?, ?)").run(c.id, sessionId, JSON.stringify(c), c.createdAt);
  return c;
}

export function getCase(id: string): { record: DiagnosisCase; sessionId: string | null } | undefined {
  const r = db().prepare("SELECT session_id, data FROM cases WHERE id = ?").get(id) as { session_id: string | null; data: string } | undefined;
  return r ? { record: JSON.parse(r.data) as DiagnosisCase, sessionId: r.session_id } : undefined;
}

/** Attach an unclaimed case to this browser. Returns whether the case now belongs to it. */
export function claimCase(id: string, sessionId: string): boolean {
  db().prepare("UPDATE cases SET session_id = ? WHERE id = ? AND session_id IS NULL").run(sessionId, id);
  return getCase(id)?.sessionId === sessionId;
}

export function updateCase(id: string, patch: Partial<Pick<DiagnosisCase, "options">>) {
  const cur = getCase(id);
  if (!cur) return undefined;
  const next = { ...cur.record, ...patch };
  db().prepare("UPDATE cases SET data = ? WHERE id = ?").run(JSON.stringify(next), id);
  return next;
}
