import * as THREE from "three";
import {
  PartBuilder,
  alignBetween,
  cylX,
  cylY,
  cylZ,
  cylinderBetween,
  extrude,
  helix,
  lathe,
  merge,
  rbox,
  ringShape,
  torus,
  tube,
  tx,
  type V3,
} from "../geom";
import { bool, local, num, points, type Builder } from "./types";

/** Accordion boot along +Y. */
function bellows(r0: number, r1: number, len: number, folds = 7) {
  const prof: [number, number][] = [];
  const n = folds * 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const base = r0 + (r1 - r0) * t;
    prof.push([base + (i % 2 ? 0.006 : 0), t * len]);
  }
  return lathe(prof, 32);
}

export const strut: Builder = (p) => {
  const L = num(p, "length", 0.5);
  const sr = num(p, "spring", 0.07);
  const rear = bool(p, "rear", false);
  const pb = new PartBuilder();
  const bodyTop = L * 0.56;
  const body = cylY(0.026, bodyTop - 0.03, 32);
  body.translate(0, (bodyTop + 0.03) / 2, 0);
  pb.add("steelDark", body);
  const rod = cylY(0.011, L - bodyTop, 20);
  rod.translate(0, (L + bodyTop) / 2, 0);
  pb.add("chrome", rod);
  const boot = bellows(0.019, 0.022, L * 0.33, 8);
  boot.translate(0, bodyTop + 0.005, 0);
  pb.add("rubber", boot);
  const springH = L * 0.54;
  const spring = helix(sr, 0.0105, springH, 5.6);
  spring.translate(0, L * 0.39, 0);
  pb.add("blackGloss", spring);
  for (const [y, r] of [[L * 0.39, sr + 0.018], [L * 0.39 + springH + 0.02, sr + 0.02]] as const) {
    const seat = extrude(ringShape(r, 0.02), 0.008, 0.002, 40);
    seat.rotateX(Math.PI / 2);
    seat.translate(0, y, 0);
    pb.add("steelDark", seat);
  }
  const mount = cylY(0.065, 0.035, 36);
  mount.translate(0, L + 0.01, 0);
  pb.add("rubber", mount);
  const plate = extrude(ringShape(0.075, 0.012, [0, 1, 2].map((i) => ({ x: Math.cos((i / 3) * Math.PI * 2) * 0.055, y: Math.sin((i / 3) * Math.PI * 2) * 0.055, r: 0.006 }))), 0.005, 0.001, 32);
  plate.rotateX(Math.PI / 2);
  plate.translate(0, L + 0.03, 0);
  pb.add("steel", plate);
  if (rear) {
    const eye = cylZ(0.022, 0.04, 20);
    pb.add("steelDark", eye);
  } else {
    const clamp = rbox(0.06, 0.09, 0.07, 0.01);
    clamp.translate(0, 0.045, 0);
    pb.add("steelDark", clamp);
    const bracket = rbox(0.02, 0.05, 0.03, 0.006);
    bracket.translate(0.035, 0.16, 0);
    pb.add("steelDark", bracket);
  }
  return pb.build();
};

export const arm: Builder = (p, ctx) => {
  const [ball, front, rear] = local(ctx, points(p, "points"));
  const pb = new PartBuilder();
  pb.add("steelDark", cylinderBetween(ball, front, 0.02, 16), cylinderBetween(ball, rear, 0.022, 16));
  // gusset web between the legs
  const web = new THREE.BufferGeometry();
  const a = new THREE.Vector3(...ball).lerp(new THREE.Vector3(...front), 0.15);
  const b = new THREE.Vector3(...front).lerp(new THREE.Vector3(...ball), 0.2);
  const c = new THREE.Vector3(...rear).lerp(new THREE.Vector3(...ball), 0.35);
  web.setFromPoints([a, b, c, a, c, b]);
  web.computeVertexNormals();
  pb.add("steelDark", web);
  const fb = cylX(0.03, 0.06, 24);
  fb.translate(...front);
  const rb = cylY(0.035, 0.05, 24);
  rb.translate(...rear);
  pb.add("rubber", fb, rb);
  const bj = new THREE.SphereGeometry(0.026, 20, 14);
  bj.translate(...ball);
  pb.add("steel", bj);
  const bboot = bellows(0.016, 0.022, 0.03, 3);
  bboot.translate(ball[0], ball[1] + 0.015, ball[2]);
  pb.add("rubber", bboot);
  return pb.build();
};

export const links: Builder = (p, ctx) => {
  const pts = local(ctx, points(p, "segs"));
  const r = num(p, "radius", 0.016);
  const pb = new PartBuilder();
  for (let i = 0; i + 1 < pts.length; i += 2) {
    pb.add("steelDark", cylinderBetween(pts[i], pts[i + 1], r, 14));
    for (const q of [pts[i], pts[i + 1]]) {
      const eye = cylX(r * 1.9, r * 3.2, 18);
      eye.translate(...q);
      pb.add("rubber", eye);
    }
  }
  return pb.build();
};

export const subframe: Builder = (p) => {
  const L = num(p, "length", 0.6);
  const W = num(p, "width", 0.8);
  const front = bool(p, "front", true);
  const pb = new PartBuilder();
  const railH = 0.07;
  for (const s of [-1, 1]) {
    const rail = rbox(L, railH, 0.075, 0.015);
    rail.translate(0, 0, (s * W) / 2);
    pb.add("steelDark", rail);
    for (const x of [-L / 2 + 0.04, L / 2 - 0.04]) {
      const tower = cylY(0.028, 0.11, 18);
      tower.translate(x, railH / 2 + 0.05, (s * W) / 2);
      const bush = cylY(0.036, 0.03, 20);
      bush.translate(x, railH / 2 + 0.105, (s * W) / 2);
      pb.add("steelDark", tower);
      pb.add("rubber", bush);
    }
  }
  for (const x of front ? [L / 2 - 0.05, -L / 2 + 0.06] : [L / 2 - 0.05, -L / 2 + 0.05]) {
    const cross = rbox(0.08, railH * 0.9, W, 0.015);
    cross.translate(x, 0, 0);
    pb.add("steelDark", cross);
  }
  if (front) {
    // rear engine-mount bracket
    const br = rbox(0.1, 0.08, 0.12, 0.012);
    br.translate(-L / 2 + 0.06, 0.06, 0);
    pb.add("steelDark", br);
  }
  return pb.build();
};

export const swaybar: Builder = (p, ctx) => {
  const pts = local(ctx, points(p, "points"));
  const pb = new PartBuilder();
  pb.add("blackGloss", tube(pts, 0.011, { radial: 14, tension: 0.2 }));
  for (const q of [pts[2], pts[pts.length - 3]]) {
    const bush = cylZ(0.022, 0.035, 18);
    bush.translate(...q);
    const clamp = rbox(0.05, 0.012, 0.03, 0.004);
    clamp.translate(q[0], q[1] + 0.022, q[2]);
    pb.add("rubber", bush);
    pb.add("steel", clamp);
  }
  for (const q of [pts[0], pts[pts.length - 1]]) {
    const top: V3 = [q[0], q[1] + 0.15, q[2]];
    pb.add("steel", cylinderBetween(q, top, 0.006, 10));
    for (const e of [q, top]) {
      const ball = new THREE.SphereGeometry(0.014, 12, 10);
      ball.translate(...e);
      pb.add("rubber", ball);
    }
  }
  return pb.build();
};

export const rack: Builder = (p) => {
  const L = num(p, "length", 0.74);
  const pb = new PartBuilder();
  const body = cylZ(0.028, L - 0.22, 32);
  pb.add("aluCast", body);
  for (const s of [-1, 1]) {
    const boot = bellows(0.02, 0.03, 0.1, 6);
    boot.rotateX((s * Math.PI) / 2);
    boot.translate(0, 0, s * (L / 2 - 0.11));
    pb.add("rubber", boot);
    const clamp = rbox(0.06, 0.06, 0.035, 0.008);
    clamp.translate(0, 0.0, s * 0.18);
    pb.add("steelDark", clamp);
  }
  const housing = cylY(0.035, 0.1, 24);
  housing.rotateZ(0.5);
  housing.translate(-0.025, 0.045, -0.26);
  pb.add("aluCast", housing);
  const bulge = cylZ(0.04, 0.12, 24);
  bulge.translate(0, 0, -0.26);
  pb.add("aluCast", bulge);
  return pb.build();
};

export const tieRod: Builder = (p, ctx) => {
  const [a, b] = local(ctx, points(p, "points"));
  const pb = new PartBuilder();
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A).normalize();
  const start = A.clone().addScaledVector(dir, 0.09).toArray() as V3;
  const endBody = B.clone().addScaledVector(dir, -0.045).toArray() as V3;
  pb.add("steel", cylinderBetween(start, endBody, 0.0085, 14));
  const nut = cylinderBetween(B.clone().addScaledVector(dir, -0.07).toArray() as V3, B.clone().addScaledVector(dir, -0.055).toArray() as V3, 0.014, 6);
  pb.add("steel", nut);
  const endPart = cylinderBetween(endBody, B.toArray() as V3, 0.017, 16);
  pb.add("castIron", endPart);
  const stud = cylY(0.008, 0.04, 12);
  stud.translate(b[0], b[1] + 0.025, b[2]);
  pb.add("steel", stud);
  const ball = new THREE.SphereGeometry(0.018, 14, 10);
  ball.translate(...start);
  pb.add("steel", ball);
  return pb.build();
};

export const column: Builder = (p, ctx) => {
  const [pin, fw, wh] = local(ctx, points(p, "points"));
  const pb = new PartBuilder();
  pb.add("steel", cylinderBetween(pin, fw, 0.011, 14));
  for (const q of [pin, fw]) {
    const uj = rbox(0.035, 0.035, 0.035, 0.006);
    uj.translate(...q);
    pb.add("steelDark", uj);
  }
  pb.add("blackGloss", cylinderBetween(fw, wh, 0.03, 24));
  const F = new THREE.Vector3(...fw);
  const W = new THREE.Vector3(...wh);
  const mid = F.clone().lerp(W, 0.45);
  const eps = cylX(0.047, 0.13, 28);
  eps.translate(mid.x, mid.y - 0.05, mid.z + 0.03);
  pb.add("aluCast", eps);
  const shroud = rbox(0.17, 0.11, 0.13, 0.03);
  const sm = F.clone().lerp(W, 0.82);
  shroud.translate(sm.x, sm.y, sm.z);
  pb.add("dash", shroud);
  // stalks
  for (const s of [-1, 1]) {
    const stalk = cylinderBetween([sm.x - 0.06, sm.y + 0.02, sm.z], [sm.x - 0.08, sm.y + 0.04, sm.z + s * 0.14], 0.006, 8);
    pb.add("plastic", stalk);
  }
  return pb.build();
};

export const steeringWheel: Builder = () => {
  const pb = new PartBuilder();
  const rim = torus(0.185, 0.0165, 18, 96);
  rim.rotateX(Math.PI / 2);
  pb.add("leather", rim);
  const hub = lathe([[0, 0.055], [0.06, 0.05], [0.075, 0.025], [0.072, -0.02], [0, -0.03]], 40);
  pb.add("dash", hub);
  const logo = cylY(0.018, 0.004, 24);
  logo.translate(0, 0.056, 0);
  pb.add("chrome", logo);
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const sp = rbox(0.12, 0.016, a === -Math.PI / 2 ? 0.05 : 0.04, 0.007);
    sp.translate(0.125, 0.01, 0);
    sp.rotateY(a);
    pb.add("dash", sp);
  }
  // buttons
  for (const s of [-1, 1]) {
    const btn = rbox(0.035, 0.008, 0.025, 0.004);
    btn.translate(s * 0.12, 0.022, 0.0);
    pb.add("chrome", btn);
  }
  return pb.build();
};

export const cvAxle: Builder = (p, ctx) => {
  const [a, b] = local(ctx, points(p, "points"));
  const L = new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));
  const pb = new PartBuilder();
  const shaft = cylY(0.0135, L - 0.16, 16);
  shaft.translate(0, L / 2, 0);
  pb.add("steelDark", alignBetween(shaft, a, b));
  const inner = cylY(0.042, 0.075, 28);
  inner.translate(0, 0.0375, 0);
  pb.add("steel", alignBetween(inner, a, b));
  const ib = bellows(0.038, 0.016, 0.09, 6);
  ib.translate(0, 0.07, 0);
  pb.add("rubber", alignBetween(ib, a, b));
  const ob = bellows(0.016, 0.042, 0.085, 6);
  ob.translate(0, L - 0.13, 0);
  pb.add("rubber", alignBetween(ob, a, b));
  const bell = lathe([[0, L - 0.06], [0.04, L - 0.055], [0.046, L - 0.03], [0.03, L - 0.005], [0.02, L]], 28);
  pb.add("steel", alignBetween(bell, a, b));
  return pb.build();
};

export const propshaft: Builder = (p, ctx) => {
  const [a, m, b] = local(ctx, points(p, "points"));
  const pb = new PartBuilder();
  pb.add("steelDark", cylinderBetween(a, m, 0.032, 24), cylinderBetween(m, b, 0.034, 24));
  for (const q of [a, m, b]) {
    const j = new THREE.SphereGeometry(0.04, 18, 12);
    j.translate(...q);
    pb.add("steel", j);
  }
  const bearing = rbox(0.06, 0.07, 0.16, 0.01);
  bearing.translate(m[0], m[1] + 0.02, m[2]);
  pb.add("rubber", bearing);
  return pb.build();
};

export const rearDiff: Builder = () => {
  const pb = new PartBuilder();
  const body = new THREE.SphereGeometry(0.1, 36, 24);
  body.scale(1, 0.9, 0.85);
  pb.add("aluCast", body);
  const neck = cylX(0.045, 0.14, 28);
  neck.translate(0.12, 0, 0);
  const flange = cylX(0.055, 0.015, 28);
  flange.translate(0.19, 0, 0);
  pb.add("aluCast", neck);
  pb.add("steel", flange);
  for (const s of [-1, 1]) {
    const clutch = cylZ(0.085, 0.09, 36);
    clutch.translate(-0.01, 0, s * 0.12);
    const out = cylZ(0.04, 0.06, 20);
    out.translate(-0.01, 0, s * 0.19);
    pb.add("aluCast", clutch, out);
  }
  const cover = cylX(0.09, 0.02, 36);
  cover.translate(-0.09, 0, 0);
  pb.add("steelDark", cover);
  const fins: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const f = new THREE.BoxGeometry(0.004, 0.12, 0.004);
    f.translate(-0.06 + i * 0.022, 0.0, 0.085);
    fins.push(f);
  }
  pb.add("aluCast", merge(fins));
  const mount = rbox(0.06, 0.04, 0.32, 0.01);
  mount.translate(0.02, 0.09, 0);
  pb.add("steelDark", mount);
  return pb.build();
};

export const ptu: Builder = () => {
  const pb = new PartBuilder();
  const body = rbox(0.17, 0.15, 0.14, 0.03);
  pb.add("aluCast", body);
  const out = cylX(0.04, 0.08, 24);
  out.translate(-0.11, -0.01, 0.06);
  const fl = cylX(0.05, 0.012, 24);
  fl.translate(-0.15, -0.01, 0.06);
  pb.add("aluCast", out);
  pb.add("steel", fl);
  const rib = rbox(0.02, 0.16, 0.15, 0.005);
  pb.add("aluCast", tx(rib, { pos: [0.04, 0, 0] }));
  return pb.build();
};
