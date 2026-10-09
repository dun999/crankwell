import type { BuildParam, CarSpec, PartInstance } from "@/lib/cars/types";
import type { BodySurface } from "../body";
import type { MeshSpec } from "../geom";

export interface BuildCtx {
  spec: CarSpec;
  surface: BodySurface;
  part: PartInstance;
}

export type Params = Record<string, BuildParam>;
export type Builder = (p: Params, ctx: BuildCtx) => MeshSpec[];

export const num = (p: Params, k: string, d: number): number => (typeof p[k] === "number" ? (p[k] as number) : d);
export const bool = (p: Params, k: string, d = false): boolean => (typeof p[k] === "boolean" ? (p[k] as boolean) : d);
export const str = (p: Params, k: string, d: string): string => (typeof p[k] === "string" ? (p[k] as string) : d);
export const arr = (p: Params, k: string): number[] => (Array.isArray(p[k]) ? (p[k] as number[]) : []);

export type P3 = [number, number, number];
export function points(p: Params, k: string): P3[] {
  const a = arr(p, k);
  const out: P3[] = [];
  for (let i = 0; i + 2 < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]]);
  return out;
}
/** Unpack [n, x,y,z × n, n, ...] into polylines. */
export function paths(p: Params, k: string): P3[][] {
  const a = arr(p, k);
  const out: P3[][] = [];
  let i = 0;
  while (i < a.length) {
    const n = a[i++];
    const pts: P3[] = [];
    for (let j = 0; j < n; j++, i += 3) pts.push([a[i], a[i + 1], a[i + 2]]);
    out.push(pts);
  }
  return out;
}

/** World-space points relative to the part origin (for parts built from world paths). */
export function local(ctx: BuildCtx, pts: P3[]): P3[] {
  const o = ctx.part.position;
  return pts.map((q) => [q[0] - o[0], q[1] - o[1], q[2] - o[2]]);
}
