import "server-only";
import type OpenAI from "openai";
import { z } from "zod";
import { formatPrice, getCar, getPart } from "@/lib/cars";
import { CAR_SPECS } from "@/lib/cars/specs";
import type { CarId } from "@/lib/cars/types";
import { DEFAULT_LOCATION, findShops, findTechnicians, getShop, getTechnician, slotOpen } from "@/lib/catalog/providers";
import { slotLabel } from "@/lib/catalog/slots";
import { findSku, getSpareParts } from "@/lib/catalog/spare-parts";
import { CHANGE_KINDS } from "@/lib/commerce/ops";
import type { ActionPayload, RepairShop, SparePart, Technician } from "@/lib/commerce/types";
import { oneTapBlocker, prepareAction } from "@/lib/server/actions";
import { CommerceError } from "@/lib/server/commerce";
import { ordersForAgent } from "@/lib/server/reconcile";
import type { RecommendedAction, Suspect, UiEvent, ViewContext } from "./events";

export const CarIdS = z.enum(["corolla", "crv"]);
/** A change to an order the user already has (flat, like PrepareActionS). */
export const OrderChangeS = z.object({
  order_ref: z.string().max(60).describe("The order_ref from get_orders"),
  change: z.enum(CHANGE_KINDS).describe("One of that order's allowed_changes from get_orders"),
  reason: z.string().max(120).optional().describe("Why, in the user's words, e.g. 'Ordered the wrong pads'"),
});

export const SPECIALTIES = ["brakes", "engine", "transmission", "electrical", "suspension", "cooling", "exhaust", "tires", "body", "general"] as const;

/** A purchase the user asked for. Flat on purpose: models fill flat schemas more reliably than unions. */
export const PrepareActionS = z.object({
  car_id: CarIdS,
  kind: z.enum(["parts", "shop_deposit", "technician"]),
  part_id: z.string().optional().describe("The part this is for. Required for parts unless the sku implies it."),
  sku: z.string().optional().describe("parts: a sku from search_spare_parts"),
  quantity: z.number().int().min(1).max(8).optional().describe("parts: how many (default 1)"),
  shop_id: z.string().optional().describe("shop_deposit: a shop_id from find_repair_shops"),
  slot: z.string().max(60).optional().describe("shop_deposit: a `slot` value from that shop's next_slots, copied exactly (default: the earliest)"),
  technician_id: z.string().optional().describe("technician: a technician_id from find_technicians"),
  when: z.string().max(60).optional().describe("technician: when they should come, e.g. 'Today, as soon as possible'"),
  hours: z.number().min(1).max(6).optional().describe("technician: labor estimate in hours (default 1)"),
  issue: z.string().max(200).optional().describe("One line for the shop or technician, e.g. 'Soft brake pedal, suspected caliper leak'"),
});

const schemas = {
  show_diagnosis: z.object({
    car_id: CarIdS,
    title: z.string().max(90).describe("Short headline, e.g. 'Soft brake pedal'"),
    summary: z.string().max(700).describe("2–3 sentences: what is probably happening and why"),
    severity: z.enum(["low", "moderate", "high", "critical"]),
    drive_safety: z.enum(["safe", "caution", "do_not_drive"]),
    suspects: z
      .array(
        z.object({
          part_id: z.string(),
          confidence: z.number().min(0).max(1).describe("Probability this part is the main cause"),
          rationale: z.string().max(300),
        }),
      )
      .min(1)
      .max(6),
  }),
  focus_parts: z.object({
    car_id: CarIdS,
    part_ids: z.array(z.string()).min(1).max(8),
    reason: z.string().max(140).describe("Shown to the user, e.g. 'Brake fluid reservoir, under the hood near the windshield'"),
  }),
  request_safety_tests: z.object({
    intro: z.string().max(300),
    tests: z
      .array(
        z.object({
          id: z.string().max(40),
          title: z.string().max(80),
          why: z.string().max(240).describe("What this check tells us"),
          steps: z.array(z.string().max(240)).min(1).max(7),
          safety_note: z.string().max(240),
          answer_options: z.array(z.string().max(80)).min(2).max(5),
        }),
      )
      .min(1)
      .max(4),
  }),
  get_part_info: z.object({ car_id: CarIdS, part_id: z.string() }),
  search_spare_parts: z.object({ car_id: CarIdS, part_id: z.string() }),
  find_repair_shops: z.object({ specialty: z.enum(SPECIALTIES), max_km: z.number().min(1).max(50).optional() }),
  find_technicians: z.object({ skill: z.enum(SPECIALTIES) }),
  recommend_actions: z.object({
    car_id: CarIdS,
    headline: z.string().max(120),
    actions: z
      .array(
        z.object({
          type: z.enum(["diy", "buy_part", "book_technician", "reserve_shop", "tow"]),
          title: z.string().max(100),
          why: z.string().max(400),
          urgency: z.enum(["now", "soon", "when_convenient"]),
          part_id: z.string().optional().describe("Required for buy_part; recommended for the others"),
          technician_id: z.string().optional().describe("Required for book_technician (from find_technicians)"),
          shop_id: z.string().optional().describe("Required for reserve_shop (from find_repair_shops)"),
          steps: z.array(z.string().max(300)).max(10).optional().describe("Numbered steps for diy"),
          tools_needed: z.array(z.string().max(60)).max(10).optional(),
          est_cost_usd: z.object({ min: z.number().min(0), max: z.number().min(0) }).optional(),
        }),
      )
      .min(1)
      .max(5),
  }),
  show_parts: z.object({
    car_id: CarIdS,
    part_ids: z.array(z.string()).min(1).max(3).describe("The part(s) to replace, most likely fix first. Usually one."),
    headline: z.string().max(90).describe("e.g. 'Batteries that fit your Corolla'"),
    pick_tier: z.enum(["Value", "OE-Equivalent", "Performance"]).optional().describe("The tier you recommend for this job (default OE-Equivalent)"),
    note: z.string().max(200).optional().describe("One short line on which to choose and why"),
  }),
  suggest_replies: z.object({
    replies: z.array(z.string().min(2).max(60)).min(2).max(4).describe("Short replies in the user's voice, the one you recommend first"),
  }),
  prepare_action: PrepareActionS,
  get_orders: z.object({}),
  prepare_order_change: OrderChangeS,
} as const;

export type ToolName = keyof typeof schemas;
/** One recommended option (shared with the MCP server's show_options). */
export const RecommendedOptionS = schemas.recommend_actions.shape.actions.element;
export const DiagnosisSuspectS = schemas.show_diagnosis.shape.suspects.element;

const DESCRIPTIONS: Record<ToolName, string> = {
  show_diagnosis:
    "Show the ranked diagnosis on the 3D model: the camera flies to the suspects, other systems are ghosted and each suspect gets a confidence label. Call this as soon as you have hypotheses, and again after test results to update confidences.",
  focus_parts: "Point the 3D camera at one or more parts (for explanations, 'where is X', or DIY steps). Switches car if car_id differs from the one on screen.",
  request_safety_tests:
    "Show a checklist of SAFE checks the user can do to tell the suspects apart (visual, listening, engine-off or idling in Park, walking-pace roll in an empty lot at most). The user's answers arrive as their next message.",
  get_part_info: "Look up a part: purpose, typical price range, DIY difficulty, common failure symptoms, whether it is sold in the parts store.",
  search_spare_parts: "List purchasable SKUs (Value / OE-Equivalent / Performance) with prices for a part, without showing them. show_parts already includes this.",
  show_parts:
    "Show a parts card: every SKU for the part(s) with price, warranty and shipping, each with a Buy button. Buy opens PayPal sandbox checkout in the chat, then a receipt with live payment status. Use it when the user wants parts or accepts your offer to find them. Don't call prepare_action for parts shown here; the user buys from the card.",
  suggest_replies:
    "Show tappable reply chips under your message so the user can answer in one tap. Call it last, after writing your message: it ends your turn.",
  find_repair_shops: "Find nearby repair shops for a specialty with rating, distance, labor rate, deposit and open slots. Use before recommending reserve_shop.",
  find_technicians: "Find mobile technicians who can come to the car, with call-out fee, hourly rate and ETA. Use before recommending book_technician.",
  recommend_actions:
    "Show the user's options as cards with built-in PayPal checkout (parts), PayPal invoice (technician) or PayPal deposit authorization (shop). Use exact IDs from the lookup tools.",
  prepare_action:
    "Prepare a purchase the user asked for: buy a part, reserve a repair shop (refundable deposit hold) or book a mobile technician (PayPal invoice). The server prices it and shows a confirm card. Nothing is charged until the user taps Confirm (one tap with saved PayPal, otherwise PayPal approval). Call it only when the user asks you to buy, book or reserve, or accepts your suggestion. Use exact ids from the lookup tools.",
  get_orders:
    "Get the user's PayPal orders, shop reservations and technician invoices, with open ones checked live against PayPal (paypal_check), what can be changed on each (allowed_changes), plus anything still waiting for their confirmation.",
  prepare_order_change:
    "Prepare a change to an order the user already has: refund a part or captured deposit, check in at a shop (capture the held deposit), cancel a reservation (release the hold) or cancel an unpaid technician invoice. Call get_orders first and use its order_ref and one of allowed_changes. Shows a confirm card; nothing changes until the user taps it. Call it only when the user asks for that change.",
};

/** What the user sees while a tool runs. */
export const TOOL_LABELS: Record<ToolName, string> = {
  show_diagnosis: "Analyzing your car",
  focus_parts: "Pointing at the part on your car",
  request_safety_tests: "Preparing a few safe checks",
  get_part_info: "Looking up the part",
  search_spare_parts: "Comparing parts prices",
  show_parts: "Finding good prices on parts",
  find_repair_shops: "Finding repair shops nearby",
  find_technicians: "Finding mobile mechanics",
  recommend_actions: "Putting together your options",
  suggest_replies: "Wrapping up",
  prepare_action: "Preparing your PayPal sandbox checkout",
  get_orders: "Checking your PayPal orders",
  prepare_order_change: "Preparing the change to your order",
};

export const TOOLS: OpenAI.Chat.ChatCompletionTool[] = (Object.keys(schemas) as ToolName[]).map((name) => {
  const { $schema, ...parameters } = z.toJSONSchema(schemas[name]) as Record<string, unknown>;
  void $schema;
  return {
    type: "function",
    function: { name, description: DESCRIPTIONS[name], parameters },
  };
});

export interface ToolContext {
  sessionId: string;
  view: ViewContext;
  emit: (e: UiEvent) => void;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export class ToolInputError extends Error {}

function suggest(carId: CarId, bad: string) {
  const words = bad.toLowerCase().split(/[._\s-]+/).filter((w) => w.length > 2);
  const hits = getCar(carId)
    .parts.map((p) => ({ p, score: words.filter((w) => p.id.includes(w) || p.name.toLowerCase().includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x) => x.p.id);
  return hits.length ? ` Did you mean one of: ${hits.join(", ")}?` : "";
}

export function requirePart(carId: CarId, partId: string) {
  const p = getPart(carId, partId);
  if (!p) throw new ToolInputError(`Unknown part_id "${partId}" for ${carId}.${suggest(carId, partId)}`);
  return p;
}

export function partBrief(carId: CarId, partId: string) {
  const p = requirePart(carId, partId);
  return {
    part_id: p.id,
    name: p.name,
    system: p.system,
    purpose: p.purpose,
    price: formatPrice(p.price),
    diy_difficulty: `${p.template_info.diy}/5`,
    common_symptoms: p.template_info.symptoms,
    lifespan: p.template_info.lifespan,
    sold_in_parts_store: p.template_info.purchasable && p.price.partMax > 0,
    shop_specialty: p.template_info.specialty,
  };
}

export const skuBrief = (s: SparePart) => ({ sku: s.sku, tier: s.tier, brand: s.brand, price_usd: s.price, warranty: s.warranty, in_stock: s.inStock, ships_in_days: s.shipDays });
export const shopBrief = (s: RepairShop) => ({
  shop_id: s.id,
  name: s.name,
  specialties: s.specialties,
  rating: s.rating,
  distance_km: s.distanceKm,
  labor_rate_usd_hr: s.laborRate,
  deposit_usd: s.deposit,
  // `slot` is what prepare_action takes; `label` is how to say it (the shop's local time).
  next_slots: s.nextSlots.map((slot) => ({ slot, label: slotLabel(slot, s.timeZone) })),
});
export const technicianBrief = (t: Technician) => ({ technician_id: t.id, name: t.name, skills: t.skills, certified: t.certified, rating: t.rating, callout_fee_usd: t.calloutFee, hourly_rate_usd: t.hourlyRate, eta_minutes: t.etaMinutes });

/** Validate recommended options against the catalog and attach the SKUs, technician or shop they refer to. */
export function buildRecommendations(carId: CarId, input: z.infer<(typeof schemas)["recommend_actions"]>["actions"], loc: { lat: number; lng: number }): RecommendedAction[] {
  return input.map((x) => {
    const part = x.part_id ? requirePart(carId, x.part_id) : undefined;
    const out: RecommendedAction = {
      type: x.type,
      title: x.title,
      why: x.why,
      urgency: x.urgency,
      part: part ? { id: part.id, name: part.name } : undefined,
      steps: x.steps,
      toolsNeeded: x.tools_needed,
      estCost: x.est_cost_usd,
    };
    if (x.type === "buy_part") {
      if (!part) throw new ToolInputError("buy_part needs part_id.");
      const skus = getSpareParts(carId, part.id);
      if (!skus.length) throw new ToolInputError(`${part.name} isn't sold in the parts store; offer reserve_shop instead.`);
      out.skus = skus;
    }
    if (x.type === "book_technician") {
      const t = x.technician_id ? getTechnician(x.technician_id) : undefined;
      if (!t) throw new ToolInputError("book_technician needs a technician_id from find_technicians.");
      out.technician = t;
    }
    if (x.type === "reserve_shop") {
      const s = x.shop_id ? getShop(x.shop_id, loc.lat, loc.lng) : undefined;
      if (!s) throw new ToolInputError("reserve_shop needs a shop_id from find_repair_shops.");
      out.shop = s;
    }
    return out;
  });
}

/** Turn a prepare_action call into a server-validated payload. Throws ToolInputError with a hint for the model. */
export function actionPayload(a: z.infer<typeof PrepareActionS>, location?: { lat: number; lng: number } | null): ActionPayload {
  if (a.kind === "parts") {
    if (!a.sku) throw new ToolInputError("parts needs a sku from search_spare_parts.");
    const sp = findSku(a.sku);
    if (!sp || sp.carId !== a.car_id) throw new ToolInputError(`Unknown sku "${a.sku}" for ${a.car_id}. Call search_spare_parts first.`);
    return { kind: "parts", carId: a.car_id, partId: a.part_id ?? sp.partId, items: [{ sku: sp.sku, quantity: a.quantity ?? 1 }] };
  }
  if (a.kind === "shop_deposit") {
    const shop = a.shop_id ? getShop(a.shop_id, location?.lat, location?.lng) : undefined;
    if (!shop) throw new ToolInputError("shop_deposit needs a shop_id from find_repair_shops.");
    const slot = a.slot ?? shop.nextSlots[0];
    if (!slot || !slotOpen(shop.id, slot, location?.lat, location?.lng)) {
      throw new ToolInputError(`slot must be a \`slot\` value from next_slots: ${shop.nextSlots.map((s) => `${s} (${slotLabel(s, shop.timeZone)})`).join(" | ")}`);
    }
    return { kind: "shop_deposit", carId: a.car_id, partId: a.part_id, shopId: shop.id, slot, issue: a.issue, location: location ?? null };
  }
  const tech = a.technician_id ? getTechnician(a.technician_id) : undefined;
  if (!tech) throw new ToolInputError("technician needs a technician_id from find_technicians.");
  return { kind: "technician_invoice", carId: a.car_id, partId: a.part_id, technicianId: tech.id, when: a.when ?? "As soon as possible", hours: a.hours ?? 1, issue: a.issue };
}

async function exec(name: ToolName, input: unknown, ctx: ToolContext): Promise<unknown> {
  const loc = ctx.view.location ?? DEFAULT_LOCATION;
  switch (name) {
    case "show_diagnosis": {
      const a = schemas.show_diagnosis.parse(input);
      const suspects: Suspect[] = a.suspects.map((s) => {
        const p = requirePart(a.car_id, s.part_id);
        return { partId: p.id, name: p.name, system: p.system, confidence: s.confidence, rationale: s.rationale };
      });
      const total = suspects.reduce((x, s) => x + s.confidence, 0);
      if (total > 1.05) suspects.forEach((s) => (s.confidence = Math.round((s.confidence / total) * 100) / 100));
      ctx.emit({ type: "diagnosis", carId: a.car_id, title: a.title, summary: a.summary, severity: a.severity, driveSafety: a.drive_safety, suspects });
      return { shown: true, normalized: total > 1.05, suspects: suspects.map((s) => ({ part_id: s.partId, confidence: s.confidence })) };
    }
    case "focus_parts": {
      const a = schemas.focus_parts.parse(input);
      const parts = a.part_ids.map((id) => requirePart(a.car_id, id));
      ctx.emit({ type: "focus", carId: a.car_id, partIds: parts.map((p) => p.id), reason: a.reason });
      return { focused: parts.map((p) => p.name) };
    }
    case "request_safety_tests": {
      const a = schemas.request_safety_tests.parse(input);
      ctx.emit({
        type: "safety_tests",
        intro: a.intro,
        tests: a.tests.map((t) => ({ id: t.id, title: t.title, why: t.why, steps: t.steps, safetyNote: t.safety_note, answerOptions: t.answer_options })),
      });
      return { shown: true, note: "The user's answers will arrive in their next message." };
    }
    case "get_part_info": {
      const a = schemas.get_part_info.parse(input);
      return partBrief(a.car_id, a.part_id);
    }
    case "search_spare_parts": {
      const a = schemas.search_spare_parts.parse(input);
      const p = requirePart(a.car_id, a.part_id);
      const skus = getSpareParts(a.car_id, a.part_id);
      if (!skus.length) return { part_id: p.id, available: false, note: "Not sold in the parts store (structural/specialist part). Recommend a shop instead." };
      return { part_id: p.id, part: p.name, skus: skus.map(skuBrief) };
    }
    case "find_repair_shops": {
      const a = schemas.find_repair_shops.parse(input);
      const shops = findShops({ specialty: a.specialty, maxKm: a.max_km, lat: loc.lat, lng: loc.lng });
      return {
        near: ctx.view.location ? "user's location" : DEFAULT_LOCATION.label,
        shops: shops.map(shopBrief),
      };
    }
    case "find_technicians": {
      const a = schemas.find_technicians.parse(input);
      return {
        technicians: findTechnicians(a.skill).map(technicianBrief),
      };
    }
    case "recommend_actions": {
      const a = schemas.recommend_actions.parse(input);
      const actions = buildRecommendations(a.car_id, a.actions, loc);
      ctx.emit({ type: "recommendations", carId: a.car_id, headline: a.headline, actions });
      return { shown: actions.length, note: "The user can pay or book directly from these cards via PayPal." };
    }
    case "show_parts": {
      const a = schemas.show_parts.parse(input);
      const groups = a.part_ids
        .map((id) => requirePart(a.car_id, id))
        .map((p) => ({ part: { id: p.id, name: p.name }, skus: getSpareParts(a.car_id, p.id) }))
        .filter((g) => g.skus.length);
      if (!groups.length) throw new ToolInputError("None of these parts are sold in the parts store. Offer a repair shop instead (find_repair_shops, then recommend_actions).");
      const first = groups[0].skus;
      const pick = first.find((x) => x.tier === (a.pick_tier ?? "OE-Equivalent") && x.inStock) ?? first.find((x) => x.inStock);
      ctx.emit({ type: "parts", carId: a.car_id, headline: a.headline, note: a.note, groups, pick: pick?.sku });
      return {
        shown: groups.map((g) => ({ part: g.part.name, skus: g.skus.map(skuBrief) })),
        pick: pick?.sku,
        note: "The user buys with the Buy button: PayPal sandbox checkout, receipt and live status appear in the chat. Don't call prepare_action for these unless they ask you to in chat.",
      };
    }
    case "suggest_replies": {
      const a = schemas.suggest_replies.parse(input);
      ctx.emit({ type: "replies", replies: a.replies });
      return { shown: true };
    }
    case "prepare_action": {
      const a = schemas.prepare_action.parse(input);
      const action = prepareAction(ctx.sessionId, actionPayload(a, ctx.view.location), { source: "app" });
      const oneTap = !oneTapBlocker(action, ctx.sessionId);
      ctx.emit({ type: "action", action, oneTap });
      return {
        prepared: action.title,
        total_usd: action.amount,
        policy: action.policy,
        one_tap: oneTap,
        note: "Shown as a confirm card. Nothing is charged until the user taps Confirm. Don't say it's paid; call get_orders if they ask.",
      };
    }
    case "get_orders": {
      schemas.get_orders.parse(input ?? {});
      return ordersForAgent(ctx.sessionId);
    }
    case "prepare_order_change": {
      const a = schemas.prepare_order_change.parse(input);
      const action = prepareAction(ctx.sessionId, { kind: a.change, txId: a.order_ref, reason: a.reason }, { source: "app" });
      ctx.emit({ type: "action", action, oneTap: true });
      return {
        prepared: action.title,
        amount_usd: action.amount,
        policy: action.policy,
        note: "Shown as a confirm card. Nothing changes until the user taps it. Don't say it's done; call get_orders if they ask.",
      };
    }
  }
}

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (!(name in schemas)) return { content: `Unknown tool ${name}`, isError: true };
  try {
    const out = await exec(name as ToolName, input, ctx);
    return { content: JSON.stringify(out) };
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { content: `Invalid input: ${e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`, isError: true };
    }
    if (e instanceof ToolInputError || e instanceof CommerceError) return { content: e.message, isError: true };
    console.error("[tool]", name, e);
    return { content: "Tool failed unexpectedly.", isError: true };
  }
}

export function viewContextText(view: ViewContext): string {
  const spec = CAR_SPECS[view.carId];
  const sel = view.selectedPart ? getPart(view.carId, view.selectedPart) : undefined;
  return `<view_context>
car_on_screen: ${spec.make} ${spec.model} (car_id: ${view.carId})
selected_part: ${sel ? `${sel.name} (${sel.id})` : "none"}
location: ${view.location ? `${view.location.lat.toFixed(3)}, ${view.location.lng.toFixed(3)}` : DEFAULT_LOCATION.label}
</view_context>`;
}
