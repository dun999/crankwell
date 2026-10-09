import { describe, expect, it } from "vitest";
import { CAR_IDS, getCar, getPart } from "@/lib/cars";
import { PART_TEMPLATES } from "@/lib/cars/parts-library";
import { BUILDERS } from "@/lib/three/builders";

describe("car catalogs", () => {
  for (const id of CAR_IDS) {
    const car = getCar(id);
    it(`${id}: has a complete machine (100+ parts across all systems)`, () => {
      expect(car.parts.length).toBeGreaterThanOrEqual(110);
      const systems = new Set(car.parts.map((p) => p.system));
      for (const s of ["body", "engine", "brakes", "suspension", "steering", "cooling", "electrical", "fuel", "exhaust", "wheels", "transmission"]) expect(systems).toContain(s);
    });
    it(`${id}: part ids are unique`, () => {
      expect(new Set(car.parts.map((p) => p.id)).size).toBe(car.parts.length);
    });
    it(`${id}: every part has notes, a price and a registered geometry builder`, () => {
      for (const p of car.parts) {
        const d = getPart(id, p.id)!;
        expect(d.purpose.length, p.id).toBeGreaterThan(30);
        expect(d.template_info.symptoms.length, p.id).toBeGreaterThan(0);
        expect(d.price.partMin, p.id).toBeLessThanOrEqual(d.price.partMax);
        expect(d.price.laborMin, p.id).toBeLessThanOrEqual(d.price.laborMax);
        expect(BUILDERS[p.build.kind], `${p.id} → ${p.build.kind}`).toBeTypeOf("function");
        expect(p.explode.every(Number.isFinite), p.id).toBe(true);
        expect(p.position.every(Number.isFinite), p.id).toBe(true);
        if (p.assembly) expect(car.assemblies[p.assembly], p.id).toBeDefined();
      }
    });
  }
  it("CR-V has its turbo and AWD hardware; Corolla does not", () => {
    const crv = getCar("crv").parts.map((p) => p.template);
    const corolla = getCar("corolla").parts.map((p) => p.template);
    for (const t of ["turbocharger", "intercooler", "propshaft", "rear_diff", "ptu"]) {
      expect(crv).toContain(t);
      expect(corolla).not.toContain(t);
    }
  });
  it("templates are all used by at least one car", () => {
    const used = new Set(CAR_IDS.flatMap((id) => getCar(id).parts.map((p) => p.template)));
    for (const t of Object.keys(PART_TEMPLATES)) expect(used, t).toContain(t);
  });
});
