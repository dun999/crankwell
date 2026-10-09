import { describe, expect, it } from "vitest";
import { findSku, getSpareParts } from "@/lib/catalog/spare-parts";
import { findShops, findTechnicians } from "@/lib/catalog/providers";

describe("parts store", () => {
  it("offers three tiers with ascending prices for purchasable parts", () => {
    const skus = getSpareParts("corolla", "brakes.pads.fl");
    expect(skus.map((s) => s.tier)).toEqual(["Value", "OE-Equivalent", "Performance"]);
    expect(skus[0].price).toBeLessThan(skus[1].price);
    expect(skus[1].price).toBeLessThan(skus[2].price);
  });
  it("does not sell structural / specialist parts", () => {
    expect(getSpareParts("corolla", "body.shell")).toEqual([]);
    expect(getSpareParts("crv", "engine.block")).toEqual([]);
  });
  it("resolves SKUs back to the catalog (server-side pricing)", () => {
    const sku = getSpareParts("crv", "intake.turbo")[1];
    expect(findSku(sku.sku)).toMatchObject({ price: sku.price, carId: "crv" });
    expect(findSku("FYC-CRV-NOT_A_PART-O")).toBeUndefined();
    expect(findSku("../../etc")).toBeUndefined();
  });
  it("uses car-specific price overrides (tires)", () => {
    const corolla = getSpareParts("corolla", "wheels.tire.fl")[0].price;
    const crv = getSpareParts("crv", "wheels.tire.fl")[0].price;
    expect(crv).toBeGreaterThan(corolla);
  });
});

describe("providers", () => {
  it("ranks shops with the right specialty first and limits results", () => {
    const shops = findShops({ specialty: "brakes" });
    expect(shops.length).toBeLessThanOrEqual(4);
    expect(shops[0].specialties).toContain("brakes");
  });
  it("finds technicians for a skill sorted by ETA", () => {
    const t = findTechnicians("brakes");
    expect(t.length).toBeGreaterThan(0);
    expect(t.every((x) => x.skills.includes("brakes"))).toBe(true);
    expect([...t].sort((a, b) => a.etaMinutes - b.etaMinutes)).toEqual(t);
  });
});
