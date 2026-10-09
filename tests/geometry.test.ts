import { describe, expect, it } from "vitest";
import { buildCar } from "@/lib/three/assemble";

describe("procedural geometry", () => {
  for (const id of ["corolla", "crv"] as const) {
    it(`${id}: builds every part with finite vertices inside the car's footprint`, async () => {
      const updates: [number, number][] = [];
      const [car, concurrent] = await Promise.all([
        buildCar(id),
        buildCar(id, (done, total) => updates.push([done, total])),
      ]);
      expect(concurrent).toBe(car);
      expect(await buildCar(id)).toBe(car);
      expect(updates.at(-1)).toEqual([car.parts.length, car.parts.length]);
      expect(car.triangles).toBeGreaterThan(500_000);
      for (const p of car.parts) {
        expect(p.meshes.length, p.part.id).toBeGreaterThan(0);
        for (const m of p.meshes) {
          const a = m.geometry.attributes.position.array as Float32Array;
          for (let i = 0; i < a.length; i += 97) expect(Number.isFinite(a[i]), p.part.id).toBe(true);
        }
        const { min, max } = p.box;
        expect(min.x, p.part.id).toBeGreaterThan(-2.6);
        expect(max.x, p.part.id).toBeLessThan(2.6);
        expect(min.y, p.part.id).toBeGreaterThan(-0.05);
        expect(max.y, p.part.id).toBeLessThan(1.8);
        expect(Math.abs(min.z), p.part.id).toBeLessThan(1.1);
      }
    });
  }
});
