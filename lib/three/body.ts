import * as THREE from "three";
import type { CarSpec } from "@/lib/cars/types";
import { clamp, hermite2, lerp, pchip, smoothstep } from "./math";
import { PartBuilder, merge, rbox, roundedRectShape, extrude, tx, type MeshSpec } from "./geom";
import type { MatKey } from "./materials";

/**
 * The body is one analytic surface S(x, v, side):
 *  - x runs along the car (front = +x),
 *  - v walks a half cross-section from the shell's bottom edge (0) up the
 *    side, across the beltline and greenhouse, to the roof centerline (1).
 * Panels are param-space rectangles (optionally slanted) sampled from S,
 * which yields real panel gaps, crisp creases and independent parts.
 */
export const V = {
  SILL: 0.12,
  SHOULDER: 0.4,
  BUMPER: 0.42,
  LAMP_LO: 0.392,
  LAMP_HI: 0.547,
  BELT: 0.55,
  GLASS_LO: 0.557,
  GLASS_HI: 0.722,
  FRAME: 0.737,
  RAIL: 0.75,
} as const;

export type Side = 1 | -1;

export interface BodySurface {
  spec: CarSpec;
  point(x: number, v: number, side: Side, out?: THREE.Vector3): THREE.Vector3;
  normal(x: number, v: number, side: Side, vMin?: number, vMax?: number, out?: THREE.Vector3): THREE.Vector3;
  plan(x: number): number;
  /** x position where the plan-view width factor equals f (front or rear corner) */
  xAtPlan(f: number, end: "front" | "rear"): number;
  warp(x: number): number;
  unwarp(s: number): number;
  edge(x: number): number;
  top(x: number): number;
  belt(x: number): number;
  archR: number;
  archCy: number;
  axles: number[];
}

export function createBodySurface(spec: CarSpec): BodySurface {
  const b = spec.body;
  const top = pchip(b.top);
  const belt = pchip(b.belt);
  const edgeBase = pchip(b.edge);
  const R = spec.dims.tireRadius;
  const archR = R + b.archGap;
  const archCy = R - 0.012;
  const axles = [spec.dims.wheelbase / 2, -spec.dims.wheelbase / 2];
  const pF = b.style === "suv" ? 2.6 : 2.3;
  const pR = b.style === "suv" ? 3.4 : 2.45;
  const EPS = 1e-5;

  const plan = (x: number) => {
    if (x > b.xFront - b.rFront) {
      const t = clamp((x - (b.xFront - b.rFront)) / b.rFront);
      return Math.pow(Math.max(0, 1 - Math.pow(t, pF)), 1 / pF);
    }
    if (x < b.xRear + b.rRear) {
      const t = clamp((b.xRear + b.rRear - x) / b.rRear);
      return Math.pow(Math.max(0, 1 - Math.pow(t, pR)), 1 / pR);
    }
    return 1;
  };
  const xAtPlan = (f: number, end: "front" | "rear") => {
    if (end === "front") {
      const t = Math.pow(1 - Math.pow(f, pF), 1 / pF);
      return b.xFront - b.rFront + t * b.rFront;
    }
    const t = Math.pow(1 - Math.pow(f, pR), 1 / pR);
    return b.xRear + b.rRear - t * b.rRear;
  };

  const edge = (x: number) => {
    let e = edgeBase(x);
    for (const ax of axles) {
      const dx = Math.abs(x - ax);
      if (dx < archR) e = Math.max(e, archCy + Math.sqrt(archR * archR - dx * dx));
      else if (dx < archR + 0.018) e = Math.max(e, lerp(archCy, edgeBase(x), (dx - archR) / 0.018));
    }
    return e;
  };

  type P2 = [number, number];
  const section = (x: number) => {
    const e = edge(x);
    const eb = edgeBase(x);
    const tp = top(x);
    const bl = Math.min(belt(x), tp - 0.004);
    const greenH = tp - bl;
    const g = smoothstep(0.03, 0.3, greenH - b.crown);
    const wRE = lerp(b.wBelt - 0.012, b.wRoof, g);
    const p1y = Math.max(e + 0.045, eb + 0.1);
    const sh = Math.max(bl - b.shoulderDrop, p1y + 0.03);
    const blc = Math.max(bl, sh + 0.02);
    const yRE = Math.max(blc + 0.004, tp - b.crown);
    const P0: P2 = [b.wBottom, e];
    const P1: P2 = [lerp(b.wBottom, b.wMax, 0.9), p1y];
    // lower-door character line: a slight concave step that catches light
    const Pc: P2 = [b.wMax - 0.016, lerp(p1y, sh, 0.42)];
    const P2_: P2 = [b.wMax, sh];
    const P3: P2 = [b.wBelt, blc];
    const P4: P2 = [wRE, yRE];
    return { pts: [P0, P1, Pc, P2_, P3], P4, top: Math.max(tp, yRE) };
  };

  const KN = [0, V.SILL, 0.25, V.SHOULDER, V.BELT];
  const sectionPoint = (x: number, v: number): P2 => {
    const s = section(x);
    if (v <= V.BELT) {
      let k = 0;
      const last = KN.length - 1;
      while (k < last - 1 && v > KN[k + 1]) k++;
      const P = s.pts;
      const tan = (i: number): P2 => {
        const a = P[Math.max(0, i - 1)];
        const c = P[Math.min(last, i + 1)];
        const ka = KN[Math.max(0, i - 1)];
        const kc = KN[Math.min(last, i + 1)];
        return [(c[0] - a[0]) / (kc - ka), (c[1] - a[1]) / (kc - ka)];
      };
      const seg = KN[k + 1] - KN[k];
      const m0 = tan(k);
      const m1 = tan(k + 1);
      return hermite2(P[k], [m0[0] * seg, m0[1] * seg], P[k + 1], [m1[0] * seg, m1[1] * seg], (v - KN[k]) / seg);
    }
    if (v <= V.RAIL) {
      const t = (v - V.BELT) / (V.RAIL - V.BELT);
      const a = s.pts[s.pts.length - 1];
      const c = s.P4;
      const dz = c[0] - a[0];
      const dy = c[1] - a[1];
      const len = Math.hypot(dz, dy) || 1;
      const bow = 0.012 * Math.sin(Math.PI * t) * Math.min(1, len / 0.2);
      return [a[0] + dz * t + (dy / len) * bow, a[1] + dy * t - (dz / len) * bow];
    }
    const t = (v - V.RAIL) / (1 - V.RAIL);
    const z = s.P4[0] * (1 - t);
    const y = s.top - (s.top - s.P4[1]) * Math.pow(1 - t, 2.1);
    return [z, y];
  };

  // Nose and tail rake: the faces lean back above bumper height and tuck under below it.
  const noseY = (edgeBase(b.xFront) + top(b.xFront)) * 0.5;
  const tailY = (edgeBase(b.xRear) + top(b.xRear)) * 0.5;
  const rakeF = (y: number) => 0.13 * Math.pow(smoothstep(noseY, top(b.xFront) + 0.05, y), 1.2) + 0.05 * smoothstep(noseY, edgeBase(b.xFront), y);
  const rakeR = (y: number) =>
    (b.style === "suv" ? 0.05 : 0.1) * Math.pow(smoothstep(tailY, top(b.xRear) + 0.05, y), 1.2) + 0.05 * smoothstep(tailY, edgeBase(b.xRear), y);

  const point = (x: number, v: number, side: Side, out = new THREE.Vector3()) => {
    const xc = Math.min(b.xFront, Math.max(b.xRear, x));
    const [z, y] = sectionPoint(xc, clamp(v));
    const f = plan(xc);
    let xx = xc;
    if (xc > b.xFront - b.rFront) xx -= rakeF(y) * Math.pow(1 - f, 0.3);
    else if (xc < b.xRear + b.rRear) xx += rakeR(y) * Math.pow(1 - f, 0.3);
    return out.set(xx, y, side * z * f);
  };

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const normal = (x: number, v: number, side: Side, vMin = 0, vMax = 1, out = new THREE.Vector3()) => {
    const hx = 0.0015;
    const hv = 0.0012;
    const x0 = Math.max(b.xRear + EPS, x - hx);
    const x1 = Math.min(b.xFront - EPS, x + hx);
    const v0 = Math.max(vMin, v - hv);
    const v1 = Math.min(vMax, v + hv);
    point(x1, v, side, _a).sub(point(x0, v, side, _b));
    point(x, v1, side, _c).sub(point(x, v0, side, _d));
    out.crossVectors(_a, _c);
    if (side < 0) out.negate();
    if (out.lengthSq() < 1e-14) {
      // degenerate at the extreme nose/tail: face straight out along x
      out.set(x > 0 ? 1 : -1, 0, 0);
    }
    return out.normalize();
  };

  // Arc-length warp so samples are dense where the plan outline turns fast.
  const N = 3000;
  const xs = new Float64Array(N + 1);
  const ss = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    xs[i] = b.xRear + ((b.xFront - b.xRear) * i) / N;
    if (i > 0) {
      const dx = xs[i] - xs[i - 1];
      const dz = (plan(xs[i]) - plan(xs[i - 1])) * b.wMax;
      const dy = (top(xs[i]) - top(xs[i - 1])) * 0.6;
      ss[i] = ss[i - 1] + Math.sqrt(dx * dx + dz * dz + dy * dy);
    }
  }
  const warp = (x: number) => {
    const f = clamp((x - b.xRear) / (b.xFront - b.xRear)) * N;
    const i = Math.min(N - 1, Math.floor(f));
    return lerp(ss[i], ss[i + 1], f - i);
  };
  const unwarp = (s: number) => {
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ss[mid] > s) hi = mid;
      else lo = mid;
    }
    const t = (s - ss[lo]) / Math.max(1e-9, ss[hi] - ss[lo]);
    return lerp(xs[lo], xs[hi], clamp(t));
  };

  return { spec, point, normal, plan, xAtPlan, warp, unwarp, edge, top, belt, archR, archCy, axles };
}

// ───────────────────────── Patches ─────────────────────────

type XB = number | [number, number];
export interface PatchDef {
  x0: XB;
  x1: XB;
  v0: number;
  v1: number;
  mat: MatKey;
  /** inner face material (painted panels show e-coat on the inside) */
  inner?: MatKey;
  offset?: number;
  /** gaps: [x0, x1] in meters, [v0, v1] in v units */
  gx?: [number, number];
  gv?: [number, number];
  both?: boolean;
  /** sampling density multiplier */
  res?: number;
}

const GX = 0.0028;
const GV = 0.0016;

export function patchGeometry(S: BodySurface, d: PatchDef, side: Side): THREE.BufferGeometry {
  const gx = d.gx ?? [GX, GX];
  const gv = d.gv ?? [d.v0 <= 0 ? 0 : GV, d.v1 >= 1 ? 0 : GV];
  const v0 = d.v0 + gv[0];
  const v1 = d.v1 - gv[1];
  const xb = (x: XB, t: number) => (typeof x === "number" ? x : lerp(x[0], x[1], t));
  const res = d.res ?? 1;
  // sample counts from approximate extents
  const sA = S.warp(Math.min(xb(d.x0, 0), xb(d.x0, 1)));
  const sB = S.warp(Math.max(xb(d.x1, 0), xb(d.x1, 1)));
  const nx = Math.max(4, Math.min(260, Math.ceil(((sB - sA) / 0.014) * res)));
  const nv = Math.max(3, Math.min(140, Math.ceil(((v1 - v0) / 0.0045) * res)));
  const pos = new Float32Array((nx + 1) * (nv + 1) * 3);
  const nor = new Float32Array((nx + 1) * (nv + 1) * 3);
  const uv = new Float32Array((nx + 1) * (nv + 1) * 2);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  let k = 0;
  for (let j = 0; j <= nv; j++) {
    const v = lerp(v0, v1, j / nv);
    const tv = (v - d.v0) / Math.max(1e-6, d.v1 - d.v0);
    const a = xb(d.x0, tv) + gx[0];
    const c = xb(d.x1, tv) - gx[1];
    const wa = S.warp(Math.min(a, c));
    const wc = S.warp(Math.max(a, c));
    for (let i = 0; i <= nx; i++) {
      const x = S.unwarp(lerp(wa, wc, i / nx));
      S.point(x, v, side, p);
      S.normal(x, v, side, d.v0, d.v1, n);
      if (d.offset) p.addScaledVector(n, d.offset);
      pos[k * 3] = p.x;
      pos[k * 3 + 1] = p.y;
      pos[k * 3 + 2] = p.z;
      nor[k * 3] = n.x;
      nor[k * 3 + 1] = n.y;
      nor[k * 3 + 2] = n.z;
      uv[k * 2] = i / nx;
      uv[k * 2 + 1] = j / nv;
      k++;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 2;
      const e = a + nx + 1;
      if (side > 0) idx.push(a, b, c, a, c, e);
      else idx.push(a, c, b, a, e, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function patchesToMeshes(S: BodySurface, defs: PatchDef[], side: Side): MeshSpec[] {
  const pb = new PartBuilder();
  for (const d of defs) {
    const sides: Side[] = d.both ? [1, -1] : [side];
    for (const sd of sides) {
      const g = patchGeometry(S, d, sd);
      pb.add(d.mat, g);
      if (d.inner) pb.add(d.inner, g);
    }
  }
  return pb.build();
}

// ───────────────────────── Panel definitions ─────────────────────────

export type PanelName =
  | "hood"
  | "front_bumper"
  | "rear_bumper"
  | "fender"
  | "door_front"
  | "door_rear"
  | "trunk"
  | "tailgate"
  | "rear_window"
  | "windshield"
  | "headlight"
  | "taillight"
  | "shell";

export function panelDefs(S: BodySurface, name: PanelName): PatchDef[] {
  const b = S.spec.body;
  const sm = b.seams;
  const suv = b.style === "suv";
  const xF = b.xFront;
  const xR = b.xRear;
  const lampIn = S.xAtPlan(0.46, "front");
  const tailIn = S.xAtPlan(suv ? 0.62 : 0.52, "rear");
  const paint = (d: Omit<PatchDef, "mat">): PatchDef => ({ ...d, mat: "paint", inner: "paintInner" });
  const clad = suv ? 0.16 : 0;
  // rear door glass rear edge slants forward toward the roof
  const slant = suv ? 0.1 : 0.19;

  switch (name) {
    case "hood":
      return [paint({ x0: sm.cowl + 0.012, x1: sm.hoodF, v0: V.BELT, v1: 1, both: true })];

    case "front_bumper": {
      const defs: PatchDef[] = [
        paint({ x0: sm.bumperF, x1: sm.lampF, v0: clad, v1: V.BUMPER, gx: [GX, 0], gv: [clad ? 0 : 0, GV], both: true }),
        paint({ x0: sm.lampF, x1: xF, v0: clad, v1: V.LAMP_LO - 0.004, gx: [0, 0], gv: [0, 0], both: true }),
        paint({ x0: lampIn, x1: xF, v0: V.LAMP_LO - 0.004, v1: V.BELT, gx: [0.002, 0], gv: [0, 0], both: true }),
        paint({ x0: sm.hoodF, x1: xF, v0: V.BELT, v1: 1, gx: [GX, 0], gv: [0, 0], both: true }),
      ];
      if (clad) defs.push({ x0: sm.bumperF, x1: xF, v0: 0, v1: clad, gx: [GX, 0], gv: [0, 0.001], mat: "cladding", both: true });
      return defs;
    }

    case "fender":
      return [
        paint({ x0: sm.doorF, x1: sm.bumperF, v0: clad ? clad : 0, v1: V.BELT }),
        paint({ x0: sm.bumperF - 0.004, x1: sm.lampF, v0: V.BUMPER, v1: V.BELT, gx: [0, GX] }),
        ...(clad ? [{ x0: sm.doorF, x1: sm.bumperF, v0: 0, v1: clad, mat: "cladding" as MatKey, gv: [0, 0.001] as [number, number] }] : []),
      ];

    case "headlight":
      return [
        { x0: sm.lampF, x1: lampIn, v0: V.LAMP_LO, v1: V.LAMP_HI, mat: "lensClear", offset: 0.0015, gx: [0.002, 0.002], gv: [0.001, 0.001] },
        { x0: sm.lampF, x1: lampIn, v0: V.LAMP_LO, v1: V.LAMP_HI, mat: "lampHousing", offset: -0.028, gx: [0.004, 0.004], gv: [0.002, 0.002], res: 0.6 },
        { x0: sm.lampF + 0.02, x1: lampIn - 0.004, v0: V.LAMP_HI - 0.022, v1: V.LAMP_HI - 0.012, mat: "ledWhite", offset: -0.006, gx: [0, 0], gv: [0, 0] },
        { x0: sm.lampF + 0.004, x1: sm.lampF + 0.07, v0: V.LAMP_LO + 0.01, v1: V.LAMP_HI - 0.03, mat: "ledAmber", offset: -0.012, gx: [0, 0], gv: [0, 0] },
      ];

    case "taillight":
      return [
        { x0: tailIn, x1: sm.lampR, v0: V.LAMP_LO - (suv ? 0.03 : 0), v1: V.LAMP_HI + (suv ? 0.06 : 0), mat: "lensRed", offset: 0.0015, gx: [0.002, 0.002], gv: [0.001, 0.001] },
        { x0: tailIn + 0.01, x1: sm.lampR - 0.01, v0: V.LAMP_HI - 0.03, v1: V.LAMP_HI - 0.018, mat: "ledRed", offset: -0.004, gx: [0, 0], gv: [0, 0] },
        { x0: tailIn, x1: sm.lampR, v0: V.LAMP_LO - (suv ? 0.03 : 0), v1: V.LAMP_HI + (suv ? 0.06 : 0), mat: "blackGloss", offset: -0.02, gx: [0.004, 0.004], gv: [0.002, 0.002], res: 0.5 },
      ];

    case "door_front":
    case "door_rear": {
      const front = name === "door_front";
      const xa = front ? sm.bPillar + 0.004 : sm.doorR;
      const xb = front ? sm.doorF : sm.bPillar - 0.004;
      const glassX0: XB = front ? xa + 0.032 : [xa + 0.03, xa + 0.03 + slant];
      const glassX1: XB = front ? xb : xb - 0.032;
      const defs: PatchDef[] = [
        paint({ x0: xa, x1: xb, v0: V.SILL + (clad ? 0.06 : 0), v1: V.BELT - 0.004, gv: [GV, 0] }),
        { x0: xa, x1: xb, v0: V.BELT - 0.004, v1: V.GLASS_LO, mat: "blackGloss", offset: 0.0012, gv: [0, 0] },
        { x0: glassX0, x1: glassX1, v0: V.GLASS_LO, v1: V.GLASS_HI, mat: "glass", offset: -0.006, gx: [0, 0], gv: [0, 0] },
        // window frame: top sash + pillar trims
        { x0: front ? xa : (glassX0 as [number, number])[1] - 0.02, x1: xb, v0: V.GLASS_HI, v1: V.FRAME, mat: "blackGloss", gx: [GX, front ? 0.004 : GX], gv: [0, GV] },
        front
          ? { x0: xa, x1: xa + 0.032, v0: V.GLASS_LO, v1: V.GLASS_HI, mat: "blackGloss", gx: [GX, 0], gv: [0, 0] }
          : { x0: xb - 0.032, x1: xb, v0: V.GLASS_LO, v1: V.GLASS_HI, mat: "blackGloss", gx: [0, GX], gv: [0, 0] },
      ];
      if (!front) defs.push({ x0: [xa, xa + slant], x1: [xa + 0.03, xa + 0.03 + slant], v0: V.GLASS_LO, v1: V.GLASS_HI, mat: "blackGloss", gx: [GX, 0], gv: [0, 0] });
      if (clad) defs.push({ x0: xa, x1: xb, v0: V.SILL, v1: V.SILL + 0.06, mat: "cladding", gv: [GV, 0.001] });
      // handle
      return defs;
    }

    case "trunk":
      return [
        paint({ x0: xR, x1: sm.deck, v0: V.BELT, v1: 1, gx: [0, GX], both: true }),
        paint({ x0: xR, x1: tailIn, v0: V.BUMPER, v1: V.BELT + 0.004, gx: [0, 0.002], gv: [GV, 0], both: true }),
      ];

    case "tailgate": {
      const gl = xR + 0.11;
      return [
        paint({ x0: xR, x1: sm.deck, v0: V.BUMPER, v1: 1, gx: [0, GX], both: true }),
        { x0: xR + 0.004, x1: gl, v0: V.GLASS_LO + 0.04, v1: 0.985, mat: "glassDark", offset: 0.0025, gx: [0, 0], gv: [0, 0], both: true },
      ];
    }

    case "rear_bumper": {
      const defs: PatchDef[] = [paint({ x0: xR, x1: sm.bumperR, v0: clad, v1: V.BUMPER, gx: [0, GX], both: true })];
      if (clad) defs.push({ x0: xR, x1: sm.bumperR, v0: 0, v1: clad, mat: "cladding", gx: [0, GX], gv: [0, 0.001], both: true });
      return defs;
    }

    case "windshield":
      return [{ x0: sm.header + 0.004, x1: sm.cowl - 0.03, v0: V.RAIL, v1: 1, mat: "glass", gx: [0, 0], gv: [0.002, 0], both: true }];

    case "rear_window":
      return [{ x0: sm.deck + 0.004, x1: sm.roofRear - 0.004, v0: V.RAIL, v1: 1, mat: "glass", gx: [0, 0], gv: [0.002, 0], both: true }];

    case "shell": {
      const doorTop = sm.doorR + slant + 0.03;
      const defs: PatchDef[] = [
        // sills
        clad
          ? { x0: sm.doorR, x1: sm.doorF, v0: 0, v1: V.SILL, mat: "cladding" as MatKey, gx: [0.002, 0.002], gv: [0, GV], both: true }
          : paint({ x0: sm.doorR, x1: sm.doorF, v0: 0, v1: V.SILL, gx: [0.002, 0.002], both: true }),
        // rear quarters
        paint({ x0: sm.bumperR, x1: sm.doorR, v0: clad, v1: V.BUMPER + 0.002, gx: [0.003, 0.003], both: true }),
        paint({ x0: suv ? sm.deck : sm.lampR, x1: sm.doorR, v0: V.BUMPER, v1: V.BELT, gx: [0.003, 0.003], gv: [0, 0], both: true }),
        // roof + rails + A-pillars
        paint({ x0: sm.roofRear, x1: sm.header + 0.004, v0: V.RAIL, v1: 1, gx: [0.003, 0], gv: [0, 0], both: true }),
        paint({ x0: doorTop - 0.03, x1: sm.cowl - 0.03, v0: V.FRAME, v1: V.RAIL, gx: [0, 0], gv: [0.001, 0], both: true }),
        // cowl cover between windshield and hood
        { x0: sm.cowl - 0.03, x1: sm.cowl + 0.009, v0: V.BELT, v1: 1, mat: "plasticTextured", gx: [0, 0], gv: [0, 0], both: true },
        // B-pillars
        { x0: sm.bPillar - 0.004, x1: sm.bPillar + 0.004, v0: V.SILL, v1: V.FRAME, mat: "blackGloss", gx: [0, 0], gv: [0, 0], offset: -0.004, both: true },
      ];
      if (clad) {
        defs.push({ x0: sm.bumperR, x1: sm.doorR, v0: 0, v1: clad, mat: "cladding", gx: [0.003, 0.003], gv: [0, 0.001], both: true });
      }
      if (suv) {
        // C-pillar, rear quarter glass, D-pillar
        const qg0 = sm.deck + 0.14;
        const qg1 = sm.doorR - 0.07;
        defs.push(
          paint({ x0: [qg1, qg1 + slant * 0.4], x1: [sm.doorR, doorTop - 0.03], v0: V.BELT, v1: V.FRAME, gx: [0, 0.003], gv: [0, 0], both: true }),
          { x0: qg0, x1: [qg1, qg1 + slant * 0.4], v0: V.GLASS_LO, v1: V.GLASS_HI, mat: "glassDark", offset: -0.004, gx: [0, 0], gv: [0, 0], both: true },
          { x0: qg0, x1: [qg1, qg1 + slant * 0.4], v0: V.BELT, v1: V.GLASS_LO, mat: "blackGloss", gx: [0, 0], gv: [0, 0], both: true },
          { x0: qg0, x1: [qg1, qg1 + slant * 0.4], v0: V.GLASS_HI, v1: V.FRAME, mat: "blackGloss", gx: [0, 0], gv: [0, 0], both: true },
          { x0: sm.deck, x1: qg0, v0: V.BELT, v1: V.FRAME, mat: "blackGloss", gx: [0.003, 0], gv: [0, 0], both: true },
          paint({ x0: sm.deck, x1: doorTop - 0.03, v0: V.FRAME, v1: V.RAIL, gx: [0.003, 0], gv: [0.001, 0], both: true }),
        );
      } else {
        // C-pillar
        defs.push(paint({ x0: sm.deck, x1: [sm.doorR, doorTop - 0.03], v0: V.BELT, v1: V.RAIL, gx: [0.003, 0.003], gv: [0, 0], both: true }));
      }
      return defs;
    }
  }
}

export function buildPanel(S: BodySurface, name: PanelName, side: Side): MeshSpec[] {
  const meshes = patchesToMeshes(S, panelDefs(S, name), side);
  if (name === "door_front" || name === "door_rear") {
    const sm = S.spec.body.seams;
    const xa = name === "door_front" ? sm.bPillar : sm.doorR;
    const x = xa + (name === "door_front" ? 0.13 : 0.11);
    meshes.push({ material: "blackGloss", geometry: onSurface(S, rbox(0.13, 0.026, 0.022, 0.009), x, 0.49, side, 0.008) });
  }
  return meshes;
}

/** Place a geometry (built with +z as the surface normal, +x along the car) on the body. */
export function onSurface(S: BodySurface, g: THREE.BufferGeometry, x: number, v: number, side: Side, lift = 0): THREE.BufferGeometry {
  const p = S.point(x, v, side);
  const n = S.normal(x, v, side);
  const t = S.point(x + 0.01, v, side).sub(S.point(x - 0.01, v, side)).normalize();
  const u = new THREE.Vector3().crossVectors(n, t).normalize();
  const tt = new THREE.Vector3().crossVectors(u, n).normalize();
  // Right-handed basis on both sides (local +y points down on the left), so
  // winding stays valid; only y-symmetric details should use this helper.
  const m = new THREE.Matrix4().makeBasis(tt, u, n);
  void side;
  m.setPosition(p.addScaledVector(n, lift));
  g.applyMatrix4(m);
  return g;
}

// ───────────────────────── Shell extras ─────────────────────────

export function shellStructure(S: BodySurface): MeshSpec[] {
  const spec = S.spec;
  const b = spec.body;
  const sm = b.seams;
  const pb = new PartBuilder();
  const floorY = b.edge.find(([x]) => x >= -1.0)![1] + 0.025;
  const wIn = b.wBottom - 0.03;
  const suv = b.style === "suv";

  // wheel-well liners
  for (const ax of S.axles) {
    for (const s of [-1, 1]) {
      const track = ax > 0 ? spec.dims.trackF : spec.dims.trackR;
      const zIn = track / 2 - 0.2;
      const zOut = b.wBottom + 0.02;
      const depth = zOut - zIn;
      // half-cylinder over the wheel: theta range is the +z half, rotated up to +y with the axis along z
      const g = new THREE.CylinderGeometry(S.archR + 0.015, S.archR + 0.015, depth, 40, 1, true, -Math.PI * 0.5, Math.PI);
      g.rotateX(-Math.PI / 2);
      tx(g, { pos: [ax, S.archCy, s * (zIn + depth / 2)] });
      pb.add("plasticTextured", g);
      // inner wall of the well
      const wall = new THREE.CircleGeometry(S.archR + 0.015, 40, 0, Math.PI);
      tx(wall, { pos: [ax, S.archCy, s * zIn], rot: [0, s > 0 ? 0 : Math.PI, 0] });
      pb.add("plasticTextured", wall);
    }
  }

  // floor pan with center tunnel, stepped rear floor over the tank
  const frontFloor = new THREE.BoxGeometry(sm.cowl + 0.42, 0.012, wIn * 2);
  tx(frontFloor, { pos: [(sm.cowl - 0.42) / 2, floorY, 0] });
  const tunnel = rbox(sm.cowl + 0.4, 0.15, 0.27, 0.05);
  tx(tunnel, { pos: [(sm.cowl - 0.4) / 2, floorY + 0.07, 0] });
  const rearFloorY = floorY + (suv ? 0.2 : 0.23);
  const rearLen = -0.42 - (b.xRear + 0.18);
  const rearFloor = new THREE.BoxGeometry(rearLen, 0.012, wIn * 2);
  tx(rearFloor, { pos: [-0.42 - rearLen / 2, rearFloorY, 0] });
  const step = new THREE.BoxGeometry(0.012, rearFloorY - floorY, wIn * 2);
  tx(step, { pos: [-0.42, (floorY + rearFloorY) / 2, 0] });
  pb.add("carpet", frontFloor, rearFloor, step);
  pb.add("eCoat", tunnel);

  // firewall + toe board
  const fwTop = S.belt(sm.cowl) - 0.03;
  const firewall = new THREE.BoxGeometry(0.012, fwTop - floorY - 0.12, (b.wBelt - 0.05) * 2);
  tx(firewall, { pos: [sm.cowl - 0.005, (fwTop + floorY + 0.12) / 2, 0] });
  const toe = new THREE.BoxGeometry(0.2, 0.012, (b.wBelt - 0.08) * 2);
  tx(toe, { pos: [sm.cowl - 0.07, floorY + 0.07, 0], rot: [0, 0, -0.62] });
  pb.add("eCoat", firewall, toe);

  // strut towers
  const R = spec.dims.tireRadius;
  for (const s of [-1, 1]) {
    const tower = new THREE.CylinderGeometry(0.085, 0.11, 0.14, 28, 1, false);
    tx(tower, { pos: [spec.dims.wheelbase / 2 - 0.065, R + 0.47 + (suv ? 0.045 : 0), s * (spec.dims.trackF / 2 - 0.215)] });
    pb.add("eCoat", tower);
    // front frame rails
    const rail = rbox(b.xFront - 0.3 - sm.cowl, 0.09, 0.07, 0.01);
    tx(rail, { pos: [(b.xFront - 0.3 + sm.cowl) / 2, R + 0.05, s * 0.48] });
    pb.add("eCoat", rail);
  }
  // radiator support (upper + lower tie bars)
  const xRad = b.xFront - 0.3;
  const radY = suv ? 0.62 : 0.5;
  const radH = suv ? 0.44 : 0.38;
  const upper = rbox(0.05, 0.05, 1.2, 0.01);
  tx(upper, { pos: [xRad + 0.04, radY + radH / 2 + 0.05, 0] });
  const lower = rbox(0.05, 0.04, 1.0, 0.01);
  tx(lower, { pos: [xRad + 0.04, radY - radH / 2 - 0.05, 0] });
  pb.add("plasticTextured", upper, lower);

  // rear parcel shelf / cargo floor walls
  const parcel = new THREE.BoxGeometry(0.42, 0.01, (b.wBelt - 0.1) * 2);
  tx(parcel, { pos: [sm.roofRear - 0.18, S.belt(sm.roofRear) - 0.02, 0] });
  if (!suv) pb.add("dash", parcel);

  // roof liner (headliner)
  const roofLen = sm.header - sm.roofRear - 0.08;
  const liner = new THREE.BoxGeometry(roofLen, 0.008, b.wRoof * 2 - 0.08);
  tx(liner, { pos: [(sm.header + sm.roofRear) / 2, S.top(0) - 0.06, 0] });
  pb.add("fabric", liner);

  // SUV roof rails
  if (suv) {
    for (const s of [-1, 1] as Side[]) {
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 10; i++) {
        const x = lerp(sm.roofRear + 0.12, sm.header - 0.2, i / 10);
        const p = S.point(x, 0.82, s);
        pts.push([p.x, p.y + 0.035, p.z]);
      }
      const rail = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 60, 0.012, 10, false);
      rail.scale(1, 1, 1);
      pb.add("blackGloss", rail);
      for (const t of [0.04, 0.96]) {
        const x = lerp(sm.roofRear + 0.12, sm.header - 0.2, t);
        const p = S.point(x, 0.82, s);
        const foot = rbox(0.06, 0.04, 0.03, 0.01);
        tx(foot, { pos: [p.x, p.y + 0.015, p.z] });
        pb.add("blackGloss", foot);
      }
    }
  }
  return [...patchesToMeshes(S, panelDefs(S, "shell"), 1), ...pb.build()];
}

/** Front grille following the curved nose. */
export function grilleGeometry(S: BodySurface): MeshSpec[] {
  const b = S.spec.body;
  const suv = b.style === "suv";
  const pb = new PartBuilder();
  const xF = b.xFront;
  const edgeY = S.edge(xF - 0.05);
  // upper grille
  const gw = suv ? 0.82 : 0.64;
  const gh = suv ? 0.2 : 0.07;
  const gy = suv ? S.belt(xF) - 0.08 - gh / 2 + 0.02 : S.belt(xF) - 0.065;
  // lower intake
  const lw = suv ? 0.7 : 0.9;
  const lh = suv ? 0.11 : 0.17;
  const ly = edgeY + lh / 2 + (suv ? 0.12 : 0.06);
  const faceX = frontFaceLookup(S);
  // Wrap flat grille geometry onto the raked, rounded nose: x is measured from the face.
  const curve = (g: THREE.BufferGeometry) => {
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, faceX(pos.getY(i), Math.abs(pos.getZ(i))) + (pos.getX(i) - xF));
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  };
  // Layers sit on top of the (continuous) bumper skin: dark backing, hex mesh, trim ring.
  const roundedRectPath = (w: number, h: number, r: number, y: number, n = 240): [number, number, number][] => {
    const pts: [number, number, number][] = [];
    const per = 2 * (w + h - 4 * r) + 2 * Math.PI * r;
    for (let i = 0; i < n; i++) {
      let d = (i / n) * per;
      const segs: [number, (t: number) => [number, number]][] = [
        [w - 2 * r, (t) => [-w / 2 + r + t, -h / 2]],
        [(Math.PI / 2) * r, (t) => { const a = -Math.PI / 2 + t / r; return [w / 2 - r + Math.cos(a) * r, -h / 2 + r + Math.sin(a) * r]; }],
        [h - 2 * r, (t) => [w / 2, -h / 2 + r + t]],
        [(Math.PI / 2) * r, (t) => { const a = t / r; return [w / 2 - r + Math.cos(a) * r, h / 2 - r + Math.sin(a) * r]; }],
        [w - 2 * r, (t) => [w / 2 - r - t, h / 2]],
        [(Math.PI / 2) * r, (t) => { const a = Math.PI / 2 + t / r; return [-w / 2 + r + Math.cos(a) * r, h / 2 - r + Math.sin(a) * r]; }],
        [h - 2 * r, (t) => [-w / 2, h / 2 - r - t]],
        [(Math.PI / 2) * r, (t) => { const a = Math.PI + t / r; return [-w / 2 + r + Math.cos(a) * r, -h / 2 + r + Math.sin(a) * r]; }],
      ];
      for (const [len, f] of segs) {
        if (d <= len) {
          const [zz, yy] = f(d);
          pts.push([xF + 0.012, y + yy, zz]);
          break;
        }
        d -= len;
      }
    }
    return pts;
  };
  const trim = (w: number, h: number, y: number) => {
    const pts = roundedRectPath(w, h, Math.min(h / 2 - 0.002, 0.03), y);
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)), true), 240, 0.0065, 8, true);
    return curve(g);
  };
  const backing = (w: number, h: number, y: number) => {
    const plate = new THREE.PlaneGeometry(w - 0.006, h - 0.006, 48, 6);
    plate.rotateY(Math.PI / 2);
    plate.translate(xF + 0.003, y, 0);
    return curve(plate);
  };
  pb.add("blackGloss", trim(gw, gh, gy), trim(lw, lh, ly));
  pb.add("plastic", backing(gw, gh, gy), backing(lw, lh, ly));
  // honeycomb inserts
  const cells: THREE.BufferGeometry[] = [];
  const mesh = (w: number, h: number, y: number) => {
    const s = 0.024;
    for (let row = 0; row * s * 0.86 < h - 0.03; row++)
      for (let col = 0; col * s < w - 0.03; col++) {
        const z = -w / 2 + 0.02 + col * s + (row % 2 ? s / 2 : 0);
        const yy = y - h / 2 + 0.02 + row * s * 0.86;
        if (Math.abs(z) > w / 2 - 0.02) continue;
        const hex = new THREE.CylinderGeometry(s * 0.42, s * 0.42, 0.008, 6, 1, true);
        hex.rotateZ(Math.PI / 2);
        hex.translate(xF + 0.007, yy, z);
        cells.push(hex);
      }
  };
  mesh(gw, gh, gy);
  mesh(lw, lh, ly);
  if (cells.length) pb.add("plasticTextured", curve(merge(cells)));
  // license plate
  const plate = new THREE.PlaneGeometry(0.31, 0.105, 24, 2);
  plate.rotateY(Math.PI / 2);
  plate.translate(xF + 0.009, ly + lh / 2 + 0.072, 0);
  pb.add("plate", curve(plate));
  return pb.build();
}

/** Forward-most surface x at (y, |z|) on the nose, sampled from the body surface. */
function frontFaceLookup(S: BodySurface) {
  const b = S.spec.body;
  const cell = 0.01;
  const ny = 160;
  const nz = 100;
  const grid = new Float32Array(ny * nz).fill(NaN);
  const p = new THREE.Vector3();
  const s0 = S.warp(b.xFront - b.rFront - 0.1);
  const s1 = S.warp(b.xFront);
  for (let i = 0; i <= 260; i++) {
    const x = S.unwarp(lerp(s0, s1, i / 260));
    for (let j = 0; j <= 400; j++) {
      S.point(x, j / 400, 1, p);
      const iy = Math.round(p.y / cell);
      const iz = Math.round(p.z / cell);
      if (iy < 0 || iy >= ny || iz < 0 || iz >= nz) continue;
      const k = iy * nz + iz;
      if (!(grid[k] >= p.x)) grid[k] = p.x;
    }
  }
  return (y: number, z: number) => {
    const iy = Math.round(y / cell);
    const iz = Math.round(z / cell);
    for (let r = 0; r < 12; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          const yy = iy + dy;
          const zz = iz + dz;
          if (yy < 0 || yy >= ny || zz < 0 || zz >= nz) continue;
          const v = grid[yy * nz + zz];
          if (!Number.isNaN(v)) return v;
        }
    return b.xFront;
  };
}

/** Side mirror attached near the A-pillar base. */
export function mirrorGeometry(S: BodySurface, side: Side): MeshSpec[] {
  const sm = S.spec.body.seams;
  const pb = new PartBuilder();
  const x = sm.doorF - 0.15;
  const v = V.BELT + 0.012;
  const base = S.point(x, v, side);
  const n = S.normal(x, v, side);
  const out = base.clone().addScaledVector(n, 0.03);
  out.y += 0.07;
  // housing: rounded wedge reaching ~17 cm out from the door, glass facing rearward
  const reach = 0.15;
  const cz = out.z + side * (reach / 2);
  const housing = extrude(roundedRectShape(reach, 0.115, 0.045), 0.07, 0.022, 24);
  housing.rotateY(Math.PI / 2);
  housing.translate(out.x + 0.01, out.y, cz);
  pb.add("paint", housing);
  const glass = extrude(roundedRectShape(reach - 0.02, 0.095, 0.035), 0.004, 0, 24);
  glass.rotateY(Math.PI / 2);
  glass.translate(out.x - 0.029, out.y, cz);
  pb.add("chrome", glass);
  const arm = rbox(0.07, 0.035, 0.06, 0.012);
  arm.translate(base.x - 0.005, base.y + 0.04, base.z + side * 0.025);
  pb.add("blackGloss", arm);
  const signal = rbox(0.008, 0.012, 0.16, 0.005);
  signal.translate(out.x + 0.045, out.y - 0.035, cz);
  pb.add("ledAmber", signal);
  return pb.build();
}
