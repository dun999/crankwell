import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isCarId } from "@/lib/cars";
import { getTemplate } from "@/lib/cars/parts-library";
import { SYSTEM_IDS, type CarId } from "@/lib/cars/types";
import { findSku } from "@/lib/catalog/spare-parts";
import type { Action, Mandate, Transaction } from "@/lib/commerce/types";
import { publishMandate } from "./bus";
import { ACTION_TTL_MS, ONE_TAP_DAILY_MAX, ONE_TAP_MAX, cancelAction, confirmAction, oneTapSpentToday, prepareAction } from "./actions";
import { CommerceError, quoteParts } from "./commerce";
import { db, serverSecret } from "./db";
import { walletVaultId } from "./wallet";

// Spending mandates for the in-app mechanic. The user approves the terms once, with a tap: which
// systems of which car, how much per order and in total, for how many days. Within them the mechanic
// can buy parts with the saved PayPal without a card per purchase. The terms are signed (HMAC with a
// server secret) when approved and checked on every purchase; the spend is reserved atomically, so
// two purchases can't both use the last of a limit. Claude over MCP never gets these tools.

const MAX_DAYS = 30;
const cents = (usd: number) => Math.round(usd * 100);
const usd = (c: number) => (c / 100).toFixed(2);
const now = () => new Date().toISOString();

/** What is signed: everything that limits the mechanic. The spend is tracked beside it. */
interface Terms {
  id: string;
  sessionId: string;
  carId: CarId;
  systems: string[];
  perOrderCents: number;
  totalCents: number;
  days: number;
  reason?: string;
  createdAt: string;
  expiresAt: string;
  approvedAt?: string;
  revokedAt?: string;
}

interface Row {
  id: string;
  session_id: string;
  status: Mandate["status"];
  spent_cents: number;
  terms: string;
  signature: string | null;
}

const SIGNED = ["id", "sessionId", "carId", "systems", "perOrderCents", "totalCents", "days", "expiresAt", "approvedAt"] as const;
const sign = (t: Terms) => createHmac("sha256", serverSecret("mandate")).update(JSON.stringify(SIGNED.map((k) => t[k]))).digest("base64url");

function signatureValid(r: Row, t: Terms) {
  if (!r.signature) return false;
  const want = Buffer.from(sign(t));
  const got = Buffer.from(r.signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

const getRow = (id: string) => db().prepare("SELECT * FROM mandates WHERE id = ?").get(id) as Row | undefined;

function owned(id: string, sessionId: string): { row: Row; terms: Terms } {
  const row = getRow(id);
  if (!row || row.session_id !== sessionId) throw new CommerceError("Spending limit not found", 404);
  return { row, terms: JSON.parse(row.terms) as Terms };
}

/** The status as of now: a proposal or a mandate past its end is expired. */
function liveStatus(row: Row, t: Terms, nowMs = Date.now()): Mandate["status"] {
  if ((row.status === "proposed" || row.status === "active") && Date.parse(t.expiresAt) <= nowMs) return "expired";
  return row.status;
}

/**
 * Purchases under a mandate that were refunded since (Undo, Orders, or PayPal itself). Their share of
 * the limit is free again, so `spent_cents` counts what was reserved and this what came back.
 */
function refundedUnder(id: string): { cents: number; count: number } {
  const rows = db().prepare("SELECT data FROM transactions WHERE json_extract(data, '$.meta.mandateId') = ? AND status IN ('REFUNDED', 'REVERSED')").all(id) as { data: string }[];
  return { cents: rows.reduce((n, r) => n + cents(Number((JSON.parse(r.data) as Transaction).amount)), 0), count: rows.length };
}

function view(row: Row, terms: Terms): Mandate {
  const purchases = (db().prepare("SELECT COUNT(*) AS n FROM actions WHERE session_id = ? AND json_extract(data, '$.mandateId') = ? AND status = 'confirmed'").get(row.session_id, row.id) as { n: number }).n;
  const back = refundedUnder(row.id);
  const spent = Math.max(0, row.spent_cents - back.cents);
  return {
    id: row.id,
    status: liveStatus(row, terms),
    carId: terms.carId,
    systems: terms.systems,
    perOrderMax: usd(terms.perOrderCents),
    totalMax: usd(terms.totalCents),
    spent: usd(spent),
    remaining: usd(Math.max(0, terms.totalCents - spent)),
    days: terms.days,
    reason: terms.reason,
    createdAt: terms.createdAt,
    expiresAt: terms.expiresAt,
    approvedAt: terms.approvedAt,
    revokedAt: terms.revokedAt,
    purchases,
    undone: back.count,
  };
}

/** Write new terms and status, if the status is still `from`. */
function transition(row: Row, terms: Terms, from: Mandate["status"], to: Mandate["status"], signature: string | null = row.signature) {
  const r = db().prepare("UPDATE mandates SET status = ?, terms = ?, signature = ? WHERE id = ? AND status = ?").run(to, JSON.stringify(terms), signature, row.id, from);
  return r.changes === 1;
}

export function listMandates(sessionId: string): Mandate[] {
  const rows = db().prepare("SELECT * FROM mandates WHERE session_id = ? ORDER BY created_at DESC LIMIT 20").all(sessionId) as Row[];
  return rows.map((r) => view(r, JSON.parse(r.terms) as Terms));
}

export function getMandate(id: string, sessionId: string): Mandate {
  const { row, terms } = owned(id, sessionId);
  return view(row, terms);
}

/** The mandate after a change, also sent to the user's open tabs so its card and Orders update live. */
function announce(id: string, sessionId: string): Mandate {
  const m = getMandate(id, sessionId);
  publishMandate(sessionId, m);
  return m;
}

/**
 * The mechanic proposes terms; nothing can be bought until the user approves them. Limits are capped
 * by the one-tap limits, and a saved PayPal is required (that's what pays).
 */
export function proposeMandate(
  sessionId: string,
  input: { carId: string; systems: string[]; perOrderMax: number; totalMax: number; days?: number; reason?: string },
): Mandate {
  if (!walletVaultId(sessionId)) throw new CommerceError("Save PayPal first: the next purchase approved in PayPal with “Save PayPal” ticked turns it on. Spending limits pay with it.", 409);
  if (!isCarId(input.carId)) throw new CommerceError("Unknown car");
  const systems = [...new Set(input.systems)];
  const bad = systems.filter((s) => !(SYSTEM_IDS as readonly string[]).includes(s));
  if (!systems.length || bad.length) throw new CommerceError(`Unknown system ${bad.join(", ") || "(none)"}. Use: ${SYSTEM_IDS.join(", ")}`);
  const perOrderCents = cents(Math.min(ONE_TAP_MAX, Math.max(1, input.perOrderMax)));
  const totalCents = Math.max(perOrderCents, cents(Math.min(ONE_TAP_DAILY_MAX, Math.max(1, input.totalMax))));
  const days = Math.min(MAX_DAYS, Math.max(1, Math.round(input.days ?? 7)));
  const created = new Date();
  const terms: Terms = {
    id: `mdt_${randomUUID()}`,
    sessionId,
    carId: input.carId,
    systems,
    perOrderCents,
    totalCents,
    days,
    reason: input.reason?.slice(0, 160),
    createdAt: created.toISOString(),
    // A proposal waits as long as a checkout card does.
    expiresAt: new Date(created.getTime() + ACTION_TTL_MS).toISOString(),
  };
  db().prepare("INSERT INTO mandates (id, session_id, status, spent_cents, terms, signature, created_at) VALUES (?, ?, 'proposed', 0, ?, NULL, ?)").run(terms.id, sessionId, JSON.stringify(terms), terms.createdAt);
  return getMandate(terms.id, sessionId);
}

/** The user's tap on the mandate card: the terms start, and are signed. */
export function approveMandate(id: string, sessionId: string): Mandate {
  const { row, terms } = owned(id, sessionId);
  const status = liveStatus(row, terms);
  if (status === "active") return view(row, terms);
  if (status !== "proposed") throw new CommerceError(status === "expired" ? "This request expired. Ask the mechanic again." : `This spending limit is ${status}`, 409);
  if (!walletVaultId(sessionId)) throw new CommerceError("Save PayPal first. Spending limits pay with it.", 409);
  const at = new Date();
  const next: Terms = { ...terms, approvedAt: at.toISOString(), expiresAt: new Date(at.getTime() + terms.days * 24 * 3600_000).toISOString() };
  transition(row, next, "proposed", "active", sign(next));
  return announce(id, sessionId);
}

/** Stop a mandate (or turn down a proposal). Purchases already made stay; each can be refunded. */
export function revokeMandate(id: string, sessionId: string): Mandate {
  const { row, terms } = owned(id, sessionId);
  if (row.status === "proposed") transition(row, { ...terms, revokedAt: now() }, "proposed", "declined");
  else if (row.status === "active") transition(row, { ...terms, revokedAt: now() }, "active", "revoked");
  return announce(id, sessionId);
}

export function revokeAllMandates(sessionId: string): Mandate[] {
  const open = db().prepare("SELECT id FROM mandates WHERE session_id = ? AND status IN ('active', 'proposed')").all(sessionId) as { id: string }[];
  return open.map((r) => revokeMandate(r.id, sessionId));
}

/** Reserve part of the limit; false when it doesn't fit (another purchase may have used it). */
function reserve(id: string, amountCents: number, totalCents: number) {
  return db().prepare("UPDATE mandates SET spent_cents = spent_cents + ? WHERE id = ? AND status = 'active' AND spent_cents + ? <= ?").run(amountCents, id, amountCents, totalCents).changes === 1;
}
const release = (id: string, amountCents: number) => db().prepare("UPDATE mandates SET spent_cents = MAX(0, spent_cents - ?) WHERE id = ?").run(amountCents, id);

/**
 * Buy a part within an approved mandate: priced from the catalog, checked against the signed terms,
 * then paid with the saved PayPal (the same one-tap path as a tapped card).
 */
export async function buyWithinMandate(
  sessionId: string,
  input: { sku: string; quantity: number },
  opts: { origin: string },
): Promise<{ action: Action; tx?: Transaction; mandate: Mandate }> {
  const sp = findSku(input.sku);
  if (!sp) throw new CommerceError(`Unknown part SKU ${input.sku}`);
  const q = quoteParts({ carId: sp.carId, partId: sp.partId, items: [{ sku: sp.sku, quantity: input.quantity }] });
  const amountCents = cents(q.total);
  const system = getTemplate(sp.template).system;

  const rows = db().prepare("SELECT * FROM mandates WHERE session_id = ? AND status = 'active' ORDER BY created_at DESC").all(sessionId) as Row[];
  const usable = rows
    .map((row) => ({ row, terms: JSON.parse(row.terms) as Terms, back: refundedUnder(row.id).cents }))
    .filter(({ row, terms }) => liveStatus(row, terms) === "active");
  if (!usable.length) throw new CommerceError("No active spending limit. Ask the user to approve one, or prepare a checkout card instead.", 403);
  const why: string[] = [];
  const fits = usable.find(({ row, terms, back }) => {
    if (!signatureValid(row, terms)) return void why.push("its terms failed verification");
    if (terms.carId !== sp.carId) return void why.push(`it covers the ${terms.carId}, not this car`);
    if (!terms.systems.includes(system)) return void why.push(`it covers ${terms.systems.join(", ")}, not ${system}`);
    if (amountCents > terms.perOrderCents) return void why.push(`$${usd(amountCents)} is over its $${usd(terms.perOrderCents)} per order`);
    if (row.spent_cents - back + amountCents > terms.totalCents) return void why.push(`only $${usd(terms.totalCents - (row.spent_cents - back))} of it is left`);
    return true;
  });
  if (!fits) throw new CommerceError(`Not covered by the user's spending limit: ${why.join("; ")}. Prepare a checkout card instead.`, 403);
  if (oneTapSpentToday(sessionId) + q.total > ONE_TAP_DAILY_MAX) throw new CommerceError(`Over the $${ONE_TAP_DAILY_MAX} a day one-tap limit. Prepare a checkout card instead.`, 403);
  // Refunds only ever grow, so the cap may lag one behind but never lets a purchase over the limit.
  if (!reserve(fits.row.id, amountCents, fits.terms.totalCents + fits.back)) throw new CommerceError("The spending limit was just used up. Prepare a checkout card instead.", 409);

  const pending = prepareAction(sessionId, { kind: "parts", carId: sp.carId, partId: sp.partId, items: [{ sku: sp.sku, quantity: input.quantity }] }, { source: "app" });
  try {
    const r = await confirmAction(pending.id, sessionId, { origin: opts.origin, mandateId: fits.row.id });
    if (r.action.status !== "confirmed") {
      // PayPal wanted the buyer this time: hand the card to the user instead.
      release(fits.row.id, amountCents);
      return { ...r, mandate: getMandate(fits.row.id, sessionId) };
    }
    return { ...r, mandate: announce(fits.row.id, sessionId) };
  } catch (e) {
    release(fits.row.id, amountCents);
    cancelAction(pending.id, sessionId);
    throw e;
  }
}
