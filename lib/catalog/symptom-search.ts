import { formatPrice, getCar, getPart } from "@/lib/cars";
import type { CarId } from "@/lib/cars/types";
import { SYSTEM_META } from "@/lib/cars/types";

// Rank catalog parts against a free-text symptom description. Deliberately simple keyword scoring:
// it gives Claude (over MCP) a grounded short list of real part_ids to reason over, not a diagnosis.

const STOP = new Set("the a an and or my car is it its when i im i'm to of in on at for with but not no very really just like feels feel makes making some".split(" "));

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);

/** Which reference model to use for the user's car (prices and the 3D model come from it). */
export function referenceCar(vehicle: string | undefined, carId?: CarId): CarId {
  if (carId) return carId;
  return /\b(suv|crossover|cr-?v|rav4|pilot|highlander|cx-?5|rogue|tucson|sportage|escape|forester|outback|truck|pickup|van|minivan|4x4|awd)\b/i.test(vehicle ?? "") ? "crv" : "corolla";
}

export interface SuspectHit {
  part_id: string;
  other_positions?: string[];
  name: string;
  system: string;
  matched_symptoms: string[];
  price: string;
  diy_difficulty: string;
  lifespan?: string;
  sold_in_parts_store: boolean;
  score: number;
}

export function findSuspectParts(carId: CarId, symptoms: string, limit = 10): SuspectHit[] {
  const q = new Set(words(symptoms));
  if (!q.size) return [];
  const byTemplate = new Map<string, SuspectHit>();
  for (const inst of getCar(carId).parts) {
    const p = getPart(carId, inst.id)!;
    const seen = byTemplate.get(inst.template);
    if (seen) {
      (seen.other_positions ??= []).push(p.id);
      continue;
    }
    const t = p.template_info;
    const matched = t.symptoms.filter((s) => words(s).some((w) => q.has(w)));
    const nameHits = words(t.name).filter((w) => q.has(w)).length;
    const systemHits = words(SYSTEM_META[p.system].label).filter((w) => q.has(w)).length;
    const purposeHits = words(t.purpose).filter((w) => q.has(w)).length;
    const score = matched.reduce((n, s) => n + words(s).filter((w) => q.has(w)).length * 3, 0) + nameHits * 2 + systemHits + Math.min(purposeHits, 2);
    byTemplate.set(inst.template, {
      part_id: p.id,
      name: t.name,
      system: SYSTEM_META[p.system].label,
      matched_symptoms: matched,
      price: formatPrice(p.price),
      diy_difficulty: `${t.diy}/5`,
      lifespan: t.lifespan,
      sold_in_parts_store: t.purchasable && p.price.partMax > 0,
      score,
    });
  }
  return [...byTemplate.values()]
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
