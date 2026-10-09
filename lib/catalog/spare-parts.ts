import { getCar, getPart } from "@/lib/cars";
import type { CarId } from "@/lib/cars/types";
import type { SparePart } from "@/lib/commerce/types";

// The demo parts store: three tiers per purchasable part, priced from the
// part template's typical market range. Prices here are the single source
// of truth for checkout; the client never sends a price.

const TIERS = [
  { tier: "Value", code: "V", brand: "RoadReady", at: 0.0, warranty: "1 year", shipDays: 4 },
  { tier: "OE-Equivalent", code: "O", brand: "OEM-Spec", at: 0.5, warranty: "2 years", shipDays: 3 },
  { tier: "Performance", code: "P", brand: "Apex Pro", at: 1.0, warranty: "Limited lifetime", shipDays: 2 },
] as const;

const round99 = (n: number) => Math.max(4.99, Math.round(n) - 0.01);

export function getSpareParts(carId: CarId, partId: string): SparePart[] {
  const part = getPart(carId, partId);
  if (!part || !part.template_info.purchasable || part.price.partMax <= 0) return [];
  const { partMin, partMax } = part.price;
  return TIERS.map((t, i) => ({
    sku: `FYC-${carId.toUpperCase()}-${part.template.toUpperCase()}-${t.code}`,
    carId,
    partId,
    template: part.template,
    name: `${t.brand} ${part.template_info.name}`,
    tier: t.tier,
    brand: t.brand,
    price: round99(partMin + (partMax - partMin) * t.at),
    warranty: t.warranty,
    inStock: !(i === 2 && part.template.length % 5 === 0),
    shipDays: t.shipDays,
  }));
}

/** Resolve a SKU back to its catalog entry (used by checkout). */
export function findSku(sku: string): SparePart | undefined {
  const m = /^FYC-(COROLLA|CRV)-([A-Z0-9_]+)-([VOP])$/.exec(sku);
  if (!m) return undefined;
  const carId = m[1].toLowerCase() as CarId;
  // any instance of that template on the car prices the same
  return skuIndex(carId).get(sku);
}

const indexCache = new Map<CarId, Map<string, SparePart>>();
function skuIndex(carId: CarId) {
  let idx = indexCache.get(carId);
  if (!idx) {
    idx = new Map();
    for (const p of getCar(carId).parts) for (const sp of getSpareParts(carId, p.id)) if (!idx.has(sp.sku)) idx.set(sp.sku, sp);
    indexCache.set(carId, idx);
  }
  return idx;
}

export const SHIPPING_FLAT = 7.99;
export const FREE_SHIPPING_OVER = 150;
