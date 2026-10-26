import "server-only";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { RecommendedAction, Suspect } from "@/lib/agent/events";
import { SAFETY_RULES } from "@/lib/agent/prompt";
import {
  CarIdS,
  DiagnosisSuspectS,
  OrderChangeS,
  PrepareActionS,
  RecommendedOptionS,
  SPECIALTIES,
  ToolInputError,
  actionPayload,
  buildRecommendations,
  partBrief,
  requirePart,
  shopBrief,
  skuBrief,
  technicianBrief,
} from "@/lib/agent/tools";
import { carDisplayName } from "@/lib/cars";
import type { CarId } from "@/lib/cars/types";
import { DEFAULT_LOCATION, findShops, findTechnicians } from "@/lib/catalog/providers";
import { getSpareParts } from "@/lib/catalog/spare-parts";
import { findSuspectParts, referenceCar } from "@/lib/catalog/symptom-search";
import type { Action } from "@/lib/commerce/types";
import { actionStatus, confirmAction, confirmKey, confirmKeyValid, invoiceRecipient, oneTapBlocker, prepareAction } from "@/lib/server/actions";
import { claimCase, createCase, getCase, updateCase } from "@/lib/server/cases";
import { CommerceError } from "@/lib/server/commerce";
import { paypalErrorMessage } from "@/lib/server/paypal";
import { ordersForAgent } from "@/lib/server/reconcile";
import { cardHtml } from "./card";
import { mcpRequest } from "./context";

export const CARD_URI = "ui://crankwell/card";
/** Tools that act for a paired browser. Calling one before pairing returns 401, which makes Claude show Connect. */
export const PROTECTED_TOOLS = new Set(["prepare_purchase", "prepare_order_change", "get_purchase_status", "get_orders", "confirm_purchase"]);
const CONFIRM_KEY_META = "crankwell/confirmKey";

export const MCP_INSTRUCTIONS = `Crankwell is an AI mechanic with PayPal checkout. Use it when someone describes a car problem or wants a part, a mobile mechanic or a repair-shop booking.

Workflow:
1. find_suspect_parts with the user's own words and their vehicle. It maps any car to the closest reference model (a sedan or an SUV) and returns real part_ids. Prices are typical US estimates for that reference model; say so when the user's car is different.
2. show_diagnosis with 2-5 suspects (exact part_ids), honestly calibrated confidences that add up to at most 1, and conservative severity and drive_safety. The card shows the details and a link to the interactive 3D view, so keep your text short.
3. If it's ambiguous, ask for one or two safe checks in chat (follow the safety rules), then call show_diagnosis again.
4. Look up real options first (search_spare_parts, find_technicians, find_repair_shops), then show_options with 2-4 options from safest to least safe: diy only when genuinely beginner-safe, buy_part, book_technician (comes to the car; best when it shouldn't be driven), reserve_shop, tow.
5. When the user asks to buy, book or reserve, call prepare_purchase. It shows a PayPal checkout card. You cannot pay: the user confirms with one tap (saved PayPal) or approves in PayPal. Never say something is paid, booked or reserved until get_purchase_status says so.
6. After a purchase, when the user wants a refund, to check in at the shop, to cancel a reservation, to cancel an unpaid invoice or to mark a technician's job done: get_orders, then prepare_order_change with that order's order_ref and one of its allowed_changes. It shows a confirm card; nothing changes until the user taps it.
The first prepare_purchase asks the user to connect Crankwell once (it links Claude to their Crankwell browser, where orders appear).

Safety rules:
${SAFETY_RULES}`;

// ───────────────────────── helpers ─────────────────────────

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean; _meta?: Record<string, unknown> };

const text = (t: string, structured?: Record<string, unknown>, meta?: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(structured ? { structuredContent: structured } : {}),
  ...(meta ? { _meta: meta } : {}),
});
const data = (x: unknown) => text(JSON.stringify(x));
const fail = (msg: string): ToolResult => ({ content: [{ type: "text", text: msg }], isError: true });

/** Map known errors to a message the model can act on. */
async function guard(fn: () => ToolResult | Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ToolInputError || e instanceof CommerceError) return fail(e.message);
    if (e instanceof z.ZodError) return fail(`Invalid input: ${e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
    console.error("[mcp]", e);
    return fail(paypalErrorMessage(e));
  }
}

function session(): string {
  const s = mcpRequest().sessionId;
  // The route answers 401 before we get here; this is a backstop.
  if (!s) throw new CommerceError("Connect Crankwell first.", 401);
  return s;
}

const refNote = (carId: CarId, vehicle?: string) =>
  vehicle && !new RegExp(carDisplayName(carId).split(" ").pop()!, "i").test(vehicle) ? `Using the ${carDisplayName(carId)} as the reference model for prices and the 3D view.` : undefined;

const caseUrl = (id: string) => `${mcpRequest().origin}/app?case=${id}`;
const payUrl = (id: string) => `${mcpRequest().origin}/pay/${id}`;

/** A case created before pairing belongs to nobody; once paired, give it to this browser. */
function caseForSession(caseId: string | undefined, sessionId: string) {
  if (!caseId) return undefined;
  const c = getCase(caseId);
  if (!c) throw new ToolInputError(`Unknown case_id "${caseId}". Use the id show_diagnosis returned, or omit it.`);
  if (c.sessionId !== sessionId && !claimCase(caseId, sessionId)) throw new ToolInputError("That case belongs to another Crankwell browser. Omit case_id.");
  return c.record;
}

function optionPrice(o: RecommendedAction): string | undefined {
  if (o.skus?.length) return `from $${Math.min(...o.skus.map((s) => s.price)).toFixed(2)}`;
  if (o.technician) return `$${o.technician.calloutFee} call-out + $${o.technician.hourlyRate}/h`;
  if (o.shop) return `$${o.shop.deposit} refundable deposit`;
  if (o.estCost) return o.estCost.max ? `$${o.estCost.min}–$${o.estCost.max}` : "Free";
  return undefined;
}

function checkoutView(a: Action, sessionId: string) {
  const blocker = oneTapBlocker(a, sessionId);
  const invoiceTo = invoiceRecipient(a, sessionId);
  return {
    view: "checkout",
    action: { id: a.id, kind: a.kind, status: a.status, title: a.title, summary: a.summary, lines: a.lines, amount: a.amount, policy: a.policy, expires_at: a.expiresAt, error: a.error },
    // Technician visits send a PayPal invoice: one tap needs an address to send it to.
    one_tap: a.kind === "technician_invoice" ? Boolean(invoiceTo) : !blocker,
    one_tap_note: a.kind === "technician_invoice" ? (invoiceTo ? undefined : "Add the email for the invoice on the next page.") : (blocker ?? undefined),
    pay_url: payUrl(a.id),
    case_url: a.caseId ? caseUrl(a.caseId) : undefined,
  };
}

// ───────────────────────── registration ─────────────────────────

export function registerCrankwell(server: McpServer) {
  const ui = { ui: { resourceUri: CARD_URI } };
  const lookup = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool(
    "find_suspect_parts",
    {
      title: "Find suspect parts",
      description:
        "Rank the parts most likely behind a symptom, from Crankwell's parts catalog. Returns real part_ids with typical price, DIY difficulty and the symptoms that matched. Start here, then call show_diagnosis.",
      inputSchema: z.object({
        symptoms: z.string().min(3).max(500).describe("What the user notices, in their words, e.g. 'brake pedal feels soft and sinks at lights'"),
        vehicle: z.string().max(80).optional().describe("The user's car, e.g. '2017 Honda Civic' or 'Toyota RAV4'"),
        car_id: CarIdS.optional().describe("Force a reference model: corolla (sedan) or crv (SUV)"),
      }),
      annotations: { title: "Find suspect parts", ...lookup },
    },
    (a) =>
      guard(() => {
        const carId = referenceCar(a.vehicle, a.car_id);
        const hits = findSuspectParts(carId, a.symptoms);
        return data({
          reference_car_id: carId,
          reference_model: carDisplayName(carId),
          note: refNote(carId, a.vehicle),
          suspects: hits.map((h) => ({ ...h, score: undefined })),
          ...(hits.length ? {} : { hint: "Nothing matched those words. Rephrase with the symptom (noise, smell, warning light, leak) and where it is." }),
        });
      }),
  );

  server.registerTool(
    "get_part_info",
    {
      title: "Get part info",
      description: "Details for one part: what it does, typical price, DIY difficulty, common symptoms and lifespan.",
      inputSchema: z.object({ car_id: CarIdS, part_id: z.string() }),
      annotations: { title: "Get part info", ...lookup },
    },
    (a) => guard(() => data(partBrief(a.car_id, a.part_id))),
  );

  server.registerTool(
    "search_spare_parts",
    {
      title: "Search spare parts",
      description: "SKUs Crankwell's parts store sells for a part (value, OE-equivalent, performance), with price, warranty and shipping time.",
      inputSchema: z.object({ car_id: CarIdS, part_id: z.string() }),
      annotations: { title: "Search spare parts", ...lookup },
    },
    (a) =>
      guard(() => {
        const p = requirePart(a.car_id, a.part_id);
        const skus = getSpareParts(a.car_id, a.part_id);
        if (!skus.length) return data({ part_id: p.id, available: false, note: "Not sold in the parts store. Suggest a repair shop instead." });
        return data({ part_id: p.id, part: p.name, skus: skus.map(skuBrief) });
      }),
  );

  server.registerTool(
    "find_technicians",
    {
      title: "Find mobile technicians",
      description: "Mobile mechanics who come to the car, with call-out fee, hourly rate, rating and ETA. Booking one sends the user a PayPal invoice.",
      inputSchema: z.object({ skill: z.enum(SPECIALTIES) }),
      annotations: { title: "Find mobile technicians", ...lookup },
    },
    (a) => guard(() => data({ technicians: findTechnicians(a.skill).map(technicianBrief) })),
  );

  server.registerTool(
    "find_repair_shops",
    {
      title: "Find repair shops",
      description: "Repair shops near the user with rating, distance, labor rate, refundable deposit and next open slots. Without coordinates it uses the demo location (San Jose, CA).",
      inputSchema: z.object({
        specialty: z.enum(SPECIALTIES),
        max_km: z.number().min(1).max(50).optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      }),
      annotations: { title: "Find repair shops", ...lookup },
    },
    (a) =>
      guard(() => {
        const at = a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : DEFAULT_LOCATION;
        return data({ near: a.lat != null ? "given location" : DEFAULT_LOCATION.label, shops: findShops({ specialty: a.specialty, maxKm: a.max_km, lat: at.lat, lng: at.lng }).map(shopBrief) });
      }),
  );

  registerAppTool(
    server,
    "show_diagnosis",
    {
      title: "Show diagnosis",
      description:
        "Show the user a diagnosis card: ranked suspect parts with confidence, a drive-safety banner, and a link that opens their car in Crankwell's interactive 3D view with the suspects highlighted. Returns a case_id to pass to show_options and prepare_purchase.",
      inputSchema: z.object({
        car_id: CarIdS.describe("reference_car_id from find_suspect_parts"),
        vehicle: z.string().max(80).optional().describe("The user's car as they described it"),
        title: z.string().max(90).describe("Short headline, e.g. 'Soft brake pedal'"),
        summary: z.string().max(700).describe("2-3 sentences: what is probably happening and why"),
        severity: z.enum(["low", "moderate", "high", "critical"]),
        drive_safety: z.enum(["safe", "caution", "do_not_drive"]),
        suspects: z.array(DiagnosisSuspectS).min(1).max(6),
      }),
      annotations: { title: "Show diagnosis", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: ui,
    },
    (a) =>
      guard(() => {
        const suspects: Suspect[] = a.suspects.map((s) => {
          const p = requirePart(a.car_id, s.part_id);
          return { partId: p.id, name: p.name, system: p.system, confidence: s.confidence, rationale: s.rationale };
        });
        const total = suspects.reduce((x, s) => x + s.confidence, 0);
        if (total > 1.05) suspects.forEach((s) => (s.confidence = Math.round((s.confidence / total) * 100) / 100));
        suspects.sort((x, y) => y.confidence - x.confidence);
        const c = createCase(
          { source: "claude", carId: a.car_id, vehicle: a.vehicle, title: a.title, summary: a.summary, severity: a.severity, driveSafety: a.drive_safety, suspects },
          mcpRequest().sessionId,
        );
        const view = {
          view: "diagnosis",
          case_id: c.id,
          case_url: caseUrl(c.id),
          vehicle: a.vehicle,
          reference_model: carDisplayName(a.car_id),
          reference_note: refNote(a.car_id, a.vehicle),
          title: c.title,
          summary: c.summary,
          severity: c.severity,
          drive_safety: c.driveSafety,
          suspects: suspects.map((s) => ({ part_id: s.partId, name: s.name, confidence: s.confidence, rationale: s.rationale })),
        };
        return text(
          `Diagnosis shown (case_id ${c.id}). Top suspect: ${suspects[0].name} (${Math.round(suspects[0].confidence * 100)}%). Drive safety: ${a.drive_safety}. 3D view: ${view.case_url}`,
          view,
        );
      }),
  );

  registerAppTool(
    server,
    "show_options",
    {
      title: "Show fix options",
      description:
        "Show 2-4 ways to fix it as a card: diy, buy_part, book_technician, reserve_shop or tow. Look up ids first (search_spare_parts, find_technicians, find_repair_shops). The user picks one in the card or in chat; then call prepare_purchase.",
      inputSchema: z.object({
        car_id: CarIdS,
        case_id: z.string().max(40).optional().describe("From show_diagnosis"),
        headline: z.string().max(120),
        options: z.array(RecommendedOptionS).min(1).max(5),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      }),
      annotations: { title: "Show fix options", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: ui,
    },
    (a) =>
      guard(() => {
        const loc = a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : DEFAULT_LOCATION;
        const options = buildRecommendations(a.car_id, a.options, loc);
        if (a.case_id && getCase(a.case_id)) updateCase(a.case_id, { options: { headline: a.headline, actions: options } });
        const view = {
          view: "options",
          headline: a.headline,
          case_url: a.case_id ? caseUrl(a.case_id) : undefined,
          options: options.map((o) => ({
            type: o.type,
            title: o.title,
            why: o.why,
            urgency: o.urgency,
            price: optionPrice(o),
            part: o.part?.name,
            who: o.technician?.name ?? o.shop?.name,
            steps: o.steps,
          })),
        };
        return text(`Options shown: ${options.map((o) => `${o.type} "${o.title}"`).join("; ")}. Wait for the user to choose, then prepare_purchase.`, view);
      }),
  );

  registerAppTool(
    server,
    "prepare_purchase",
    {
      title: "Prepare PayPal checkout",
      description:
        "Prepare a purchase the user asked for and show it as a PayPal checkout card: kind=parts (a sku), shop_deposit (a shop_id and slot; the deposit is held, not charged) or technician (a technician_id; sends a PayPal invoice). The server prices it from the catalog. Nothing is charged until the user confirms on the card. Expires in 15 minutes.",
      inputSchema: PrepareActionS.extend({
        case_id: z.string().max(40).optional().describe("From show_diagnosis"),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      }),
      annotations: { title: "Prepare PayPal checkout", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: ui,
    },
    (a) =>
      guard(() => {
        const sessionId = session();
        const c = caseForSession(a.case_id, sessionId);
        const loc = a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null;
        const action = prepareAction(sessionId, actionPayload(a, loc), { source: "claude", caseId: c?.id });
        const view = checkoutView(action, sessionId);
        return text(
          `Prepared "${action.title}" for $${action.amount} (${action.policy}). Nothing is charged yet. ` +
            (view.one_tap ? "The user can confirm with one tap on the card" : "The user approves it with PayPal from the card") +
            `, or at ${view.pay_url}. It expires in 15 minutes. Don't say it's paid until get_purchase_status says so (action_id ${action.id}).`,
          view,
          { [CONFIRM_KEY_META]: confirmKey(action.id) },
        );
      }),
  );

  registerAppTool(
    server,
    "prepare_order_change",
    {
      title: "Prepare a change to an order",
      description:
        "Prepare a change to an order the user already has and show it as a confirm card: refund (a part or captured deposit), check_in (capture the held shop deposit), cancel_reservation (release the hold), cancel_invoice (an unpaid technician invoice) or complete_job (a paid technician visit is finished: unused labor is refunded, the technician is paid). Use an order_ref and one of its allowed_changes from get_orders. Nothing changes until the user taps the card.",
      inputSchema: OrderChangeS,
      annotations: { title: "Prepare a change to an order", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: ui,
    },
    (a) =>
      guard(() => {
        const sessionId = session();
        const action = prepareAction(sessionId, { kind: a.change, txId: a.order_ref, reason: a.reason, hours: a.actual_hours }, { source: "claude" });
        return text(
          `Prepared "${action.title}" (${action.policy}). Nothing has changed yet: the user confirms on the card or at ${payUrl(action.id)}. Don't say it's done until get_purchase_status says so (action_id ${action.id}).`,
          checkoutView(action, sessionId),
          { [CONFIRM_KEY_META]: confirmKey(action.id) },
        );
      }),
  );

  server.registerTool(
    "get_purchase_status",
    {
      title: "Get purchase status",
      description: "Whether a prepared purchase was paid, held, invoiced, expired or cancelled, with the PayPal ids.",
      inputSchema: z.object({ action_id: z.string().max(60) }),
      annotations: { title: "Get purchase status", ...lookup, idempotentHint: true },
    },
    (a) =>
      guard(() => {
        const sessionId = session();
        const s = actionStatus(a.action_id, sessionId);
        return text(`${s.action.title}: ${s.message}`, { ...checkoutView(s.action, sessionId), message: s.message, paypal: s.paypal });
      }),
  );

  server.registerTool(
    "get_orders",
    {
      title: "Get orders",
      description:
        "The user's Crankwell orders (parts, shop deposits, technician invoices). Open ones are checked live against PayPal first (paypal_check: live, final or unavailable). Also lists checkouts still waiting for them.",
      inputSchema: z.object({}),
      annotations: { title: "Get orders", ...lookup },
    },
    () =>
      guard(async () => data(await ordersForAgent(session(), { actionIds: true }))),
  );

  // The card's Pay button. Hidden from the model (visibility: app) and gated by a key only the card gets.
  registerAppTool(
    server,
    "confirm_purchase",
    {
      title: "Confirm purchase",
      description: "Called by the checkout card when the user taps Pay. Not for the model.",
      inputSchema: z.object({ action_id: z.string().max(60), confirm_key: z.string().max(100) }),
      annotations: { title: "Confirm purchase", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: CARD_URI, visibility: ["app"] } },
    },
    (a) =>
      guard(async () => {
        const sessionId = session();
        if (!confirmKeyValid(a.action_id, a.confirm_key)) return fail("Only the user can confirm a purchase, by tapping Pay on the checkout card.");
        const { action } = await confirmAction(a.action_id, sessionId, { origin: mcpRequest().origin });
        const s = actionStatus(action.id, sessionId);
        return text(`${action.title}: ${s.message}`, { ...checkoutView(s.action, sessionId), message: s.message, paypal: s.paypal });
      }),
  );

  registerAppResource(server, "Crankwell card", CARD_URI, { description: "Diagnosis, options and PayPal checkout cards" }, async () => ({
    contents: [{ uri: CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: await cardHtml(), _meta: { ui: { prefersBorder: true, csp: {} } } }],
  }));
}
