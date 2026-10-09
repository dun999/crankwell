// Headless smoke test: build every part of both cars and report sizes / NaNs.
import { buildCar } from "@/lib/three/assemble";

(globalThis as unknown as { performance: Performance }).performance ??= { now: () => Date.now() } as Performance;

async function main() {
  for (const id of ["corolla", "crv"] as const) {
    const t0 = Date.now();
    const car = await buildCar(id);
    let nan = 0;
    const rows: [string, number][] = [];
    for (const p of car.parts) {
      for (const m of p.meshes) {
        const a = m.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { nan++; break; }
      }
      rows.push([p.part.id, Math.round(p.triangles)]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    console.log(`${id}: ${car.parts.length} parts, ${Math.round(car.triangles / 1000)}k tris, ${Date.now() - t0}ms, NaN meshes: ${nan}`);
    console.log("  heaviest:", rows.slice(0, 8).map(([k, v]) => `${k}=${(v / 1000).toFixed(0)}k`).join(" "));
    const b = car.parts.find((p) => p.part.id === "body.shell")!.box;
    console.log("  shell box", b.min.toArray().map((v) => v.toFixed(2)), b.max.toArray().map((v) => v.toFixed(2)));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
