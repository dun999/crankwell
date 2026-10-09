import "server-only";
import type OpenAI from "openai";
import { z } from "zod";
import { formatPrice, getCar, getPart } from "@/lib/cars";
import { CAR_SPECS } from "@/lib/cars/specs";
import type { CarId } from "@/lib/cars/types";
import { DEFAULT_LOCATION, findShops, findTechnicians, getShop, getTechnician } from "@/lib/catalog/providers";
import { getSpareParts } from "@/lib/catalog/spare-parts";
import { listTransactions } from "@/lib/server/commerce";
import type { RecommendedAction, Suspect, UiEvent, ViewContext } from "./events";

const CarIdS = z.enum(["corolla", "crv"]);
const SPECIALTIES = ["brakes", "engine", "transmission", "electrical", "suspension", "cooling", "exhaust", "tires", "body", "general"] as const;

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
  get_orders: z.object({}),
} as const;

export type ToolName = keyof typeof schemas;

const DESCRIPTIONS: Record<ToolName, string> = {
  show_diagnosis:
    "Show the ranked diagnosis on the 3D model: the camera flies to the suspects, other systems are ghosted and each suspect gets a confidence label. Call this as soon as you have hypotheses, and again after test results to update confidences.",
  focus_parts: "Point the 3D camera at one or more parts (for explanations, 'where is X', or DIY steps). Switches car if car_id differs from the one on screen.",
  request_safety_tests:
    "Show a checklist of SAFE checks the user can do to tell the suspects apart (visual, listening, engine-off or idling in Park, walking-pace roll in an empty lot at most). The user's answers arrive as their next message.",
  get_part_info: "Look up a part: purpose, typical price range, DIY difficulty, common failure symptoms, whether it is sold in the parts store.",
  search_spare_parts: "List purchasable SKUs (Value / OE-Equivalent / Performance) with prices for a part. Use before recommending buy_part.",
  find_repair_shops: "Find nearby repair shops for a specialty with rating, distance, labor rate, deposit and open slots. Use before recommending reserve_shop.",
  find_technicians: "Find mobile technicians who can come to the car, with call-out fee, hourly rate and ETA. Use before recommending book_technician.",
  recommend_actions:
    "Show the user's options as cards with built-in PayPal checkout (parts), PayPal invoice (technician) or PayPal deposit authorization (shop). Use exact IDs from the lookup tools.",
  get_orders: "Get the user's PayPal orders, shop reservations and technician invoices with their current status.",
};

export const TOOL_LABELS: Record<ToolName, string> = {
  show_diagnosis: "Ranking likely causes",
  focus_parts: "Pointing at parts on the 3D model",
  request_safety_tests: "Preparing safe checks",
  get_part_info: "Looking up part details",
  search_spare_parts: "Checking parts prices",
  find_repair_shops: "Finding repair shops nearby",
  find_technicians: "Finding mobile technicians",
  recommend_actions: "Putting together your options",
  get_orders: "Checking your PayPal orders",
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

class ToolInputError extends Error {}

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

function requirePart(carId: CarId, partId: string) {
  const p = getPart(carId, partId);
  if (!p) throw new ToolInputError(`Unknown part_id "${partId}" for ${carId}.${suggest(carId, partId)}`);
  return p;
}

function partBrief(carId: CarId, partId: string) {
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
      return { part_id: p.id, part: p.name, skus: skus.map((s) => ({ sku: s.sku, tier: s.tier, brand: s.brand, price_usd: s.price, warranty: s.warranty, in_stock: s.inStock, ships_in_days: s.shipDays })) };
    }
    case "find_repair_shops": {
      const a = schemas.find_repair_shops.parse(input);
      const shops = findShops({ specialty: a.specialty, maxKm: a.max_km, lat: loc.lat, lng: loc.lng });
      return {
        near: ctx.view.location ? "user's location" : DEFAULT_LOCATION.label,
        shops: shops.map((s) => ({ shop_id: s.id, name: s.name, specialties: s.specialties, rating: s.rating, distance_km: s.distanceKm, labor_rate_usd_hr: s.laborRate, deposit_usd: s.deposit, next_slots: s.nextSlots })),
      };
    }
    case "find_technicians": {
      const a = schemas.find_technicians.parse(input);
      return {
        technicians: findTechnicians(a.skill).map((t) => ({ technician_id: t.id, name: t.name, skills: t.skills, certified: t.certified, rating: t.rating, callout_fee_usd: t.calloutFee, hourly_rate_usd: t.hourlyRate, eta_minutes: t.etaMinutes })),
      };
    }
    case "recommend_actions": {
      const a = schemas.recommend_actions.parse(input);
      const actions: RecommendedAction[] = a.actions.map((x) => {
        const part = x.part_id ? requirePart(a.car_id, x.part_id) : undefined;
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
          const skus = getSpareParts(a.car_id, part.id);
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
      ctx.emit({ type: "recommendations", carId: a.car_id, headline: a.headline, actions });
      return { shown: actions.length, note: "The user can pay or book directly from these cards via PayPal." };
    }
    case "get_orders": {
      schemas.get_orders.parse(input ?? {});
      const tx = listTransactions(ctx.sessionId);
      return {
        orders: tx.slice(0, 10).map((t) => ({
          kind: t.kind,
          title: t.title,
          status: t.status,
          amount_usd: t.amount,
          created: t.createdAt,
          last_event: t.events[t.events.length - 1]?.type,
        })),
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
    if (e instanceof ToolInputError) return { content: e.message, isError: true };
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
