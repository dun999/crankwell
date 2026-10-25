import { buildLayout } from "./layout";
import { getTemplate } from "./parts-library";
import { CAR_SPECS } from "./specs";
import type { CarId, CarModel, PartInstance, PartTemplate, PriceRange } from "./types";

export * from "./types";
export { CAR_SPECS } from "./specs";

const cache = new Map<CarId, CarModel>();

export const CAR_IDS: CarId[] = ["corolla", "crv"];

export function isCarId(v: unknown): v is CarId {
  return v === "corolla" || v === "crv";
}

export function getCar(id: CarId): CarModel {
  let model = cache.get(id);
  if (!model) {
    model = buildLayout(CAR_SPECS[id]);
    cache.set(id, model);
  }
  return model;
}

export interface PartDetails extends PartInstance {
  template_info: PartTemplate;
  price: PriceRange;
  purpose: string;
}

export function getPart(carId: CarId, partId: string): PartDetails | undefined {
  const part = getCar(carId).parts.find((p) => p.id === partId);
  if (!part) return undefined;
  const tpl = getTemplate(part.template);
  return {
    ...part,
    template_info: tpl,
    price: part.price ?? tpl.price,
    purpose: part.note ? `${tpl.purpose} ${part.note}` : tpl.purpose,
  };
}

const SYSTEM_CODE: Record<CarModel["parts"][number]["system"], string> = {
  body: "BDY", engine: "ENG", intake: "AIR", exhaust: "EXH", cooling: "COL", electrical: "ELC", fuel: "FUL",
  transmission: "TRN", drivetrain: "DRV", brakes: "BRK", suspension: "SUS", steering: "STR", wheels: "WHL", interior: "INT",
};
const codes = new Map<CarId, Map<string, string>>();

/** Short catalog number for a part, e.g. "BRK·04": its system and its place in that system. */
export function partCode(carId: CarId, partId: string): string {
  let m = codes.get(carId);
  if (!m) {
    m = new Map();
    const seen: Record<string, number> = {};
    for (const p of getCar(carId).parts) {
      seen[p.system] = (seen[p.system] ?? 0) + 1;
      m.set(p.id, `${SYSTEM_CODE[p.system]}·${String(seen[p.system]).padStart(2, "0")}`);
    }
    codes.set(carId, m);
  }
  return m.get(partId) ?? "";
}

export function carDisplayName(id: CarId): string {
  const s = CAR_SPECS[id];
  return `${s.make} ${s.model}`;
}

export function formatPrice(p: PriceRange): string {
  const parts = p.partMax > 0 ? `$${p.partMin.toLocaleString()}–$${p.partMax.toLocaleString()}` : "n/a";
  const labor = p.laborMax > 0 ? `$${p.laborMin.toLocaleString()}–$${p.laborMax.toLocaleString()}` : "$0";
  return `parts ${parts}, labor ${labor}${p.unit ? ` (${p.unit})` : ""}`;
}
