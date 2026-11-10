import * as THREE from "three";
import {
  PartBuilder,
  alignBetween,
  cylX,
  cylY,
  cylZ,
  cylinderBetween,
  extrude,
  lathe,
  merge,
  rbox,
  roundedRectShape,
  circlePath,
  sectorShape,
  tube,
  torus,
  type V3,
} from "../geom";
import type { MatKey } from "../materials";
import { bool, local, num, paths, points, str, type Builder } from "./types";

// ───────────────────────── Cooling ─────────────────────────

export const radiator: Builder = (p) => {
  const W = num(p, "width", 0.68);
  const H = num(p, "height", 0.38);
  const ic = bool(p, "intercooler", false);
  const pb = new PartBuilder();
  const core = new THREE.BoxGeometry(ic ? 0.06 : 0.028, H, W - 0.08);
  const uv = core.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (W / 0.2), uv.getY(i) * (H / 0.2));
  pb.add("radiatorCore", core);
  const tankMat: MatKey = ic ? "aluCast" : "plastic";
  for (const s of [-1, 1]) {
    const tank = rbox(ic ? 0.07 : 0.045, H + 0.02, 0.05, 0.012);
    tank.translate(0, 0, (s * (W - 0.03)) / 2);
    pb.add(tankMat, tank);
  }
  if (!ic) {
    const neck = cylY(0.018, 0.03, 20);
    neck.translate(-0.01, H / 2 + 0.02, -W / 2 + 0.05);
    const cap = cylY(0.022, 0.012, 24);
    cap.translate(-0.01, H / 2 + 0.04, -W / 2 + 0.05);
    pb.add("plastic", neck);
    pb.add("steel", cap);
    const inlet = cylX(0.018, 0.05, 16);
    inlet.translate(-0.04, H / 2 - 0.05, -W / 2 + 0.03);
    const outlet = cylX(0.019, 0.05, 16);
    outlet.translate(-0.04, -H / 2 + 0.05, W / 2 - 0.03);
    pb.add("plastic", inlet, outlet);
    // A/C condenser in front
    const cond = new THREE.BoxGeometry(0.014, H - 0.02, W - 0.1);
    cond.translate(0.035, 0, 0);
    pb.add("radiatorCore", cond);
  } else {
    for (const s of [-1, 1]) {
      const port = cylX(0.028, 0.06, 20);
      port.translate(-0.06, 0, (s * (W - 0.03)) / 2);
      pb.add("aluCast", port);
    }
  }
  return pb.build();
};

export const fans: Builder = (p) => {
  const W = num(p, "width", 0.66);
  const H = num(p, "height", 0.36);
  const pb = new PartBuilder();
  const shroudShape = roundedRectShape(W, H, 0.04);
  const fr = Math.min(H / 2 - 0.02, W / 4 - 0.01);
  const centers = [-W / 4, W / 4];
  for (const c of centers) shroudShape.holes.push(circlePath(fr, c, 0, 48, true));
  const shroud = extrude(shroudShape, 0.035, 0.004, 32);
  shroud.rotateY(Math.PI / 2);
  pb.add("plasticTextured", shroud);
  for (const c of centers) {
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const b = extrude(sectorShape(0.04, fr - 0.01, a, a + 0.55), 0.004, 0, 12);
      b.rotateX(0.0);
      // twist: tilt each blade around its radial axis
      const pos = b.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k);
        const y = pos.getY(k);
        const ang = Math.atan2(y, x) - a;
        pos.setZ(k, pos.getZ(k) + (ang - 0.27) * 0.05);
      }
      b.computeVertexNormals();
      blades.push(b);
    }
    const fan = merge(blades);
    fan.rotateY(Math.PI / 2);
    fan.translate(-0.012, 0, c);
    pb.add("plastic", fan);
    const motor = cylX(0.045, 0.06, 28);
    motor.translate(-0.04, 0, c);
    pb.add("steelDark", motor);
    const hub = cylX(0.04, 0.025, 28);
    hub.translate(-0.01, 0, c);
    pb.add("plastic", hub);
  }
  return pb.build();
};

export const reservoir: Builder = (p) => {
  const fluid = str(p, "fluid", "brake");
  const brake = fluid === "brake";
  const pb = new PartBuilder();
  const w = brake ? 0.09 : 0.15;
  const h = brake ? 0.065 : 0.1;
  const d = brake ? 0.07 : 0.09;
  const tank = rbox(w, h, d, 0.012);
  pb.add("translucent", tank);
  const level = brake ? 0.62 : 0.55;
  const liquid = rbox(w - 0.008, h * level, d - 0.008, 0.008);
  liquid.translate(0, -h / 2 + (h * level) / 2 + 0.004, 0);
  pb.add(brake ? "fluidBrake" : "fluidCoolant", liquid);
  const cap = cylY(brake ? 0.022 : 0.026, 0.02, 28);
  cap.translate(brake ? -0.015 : 0.03, h / 2 + 0.01, 0);
  pb.add(brake ? "yellow" : "plastic", cap);
  // MIN / MAX marks
  for (const y of [-h * 0.15, h * 0.28]) {
    const m = new THREE.BoxGeometry(0.03, 0.002, 0.001);
    m.translate(0.0, y, d / 2 + 0.001);
    pb.add("plastic", m);
  }
  if (brake) {
    const sensor = rbox(0.018, 0.014, 0.02, 0.003);
    sensor.translate(0.035, 0.0, d / 2);
    pb.add("plasticGray", sensor);
  } else {
    const hose = tube([[w / 2, -h / 3, 0], [w / 2 + 0.05, -h / 2, 0], [w / 2 + 0.08, -h, -0.03]], 0.006);
    pb.add("rubber", hose);
  }
  return pb.build();
};

// ───────────────────────── Brakes (hydraulics) ─────────────────────────

export const booster: Builder = () => {
  const pb = new PartBuilder();
  const prof: [number, number][] = [
    [0.0, -0.075],
    [0.06, -0.074],
    [0.11, -0.06],
    [0.125, -0.02],
    [0.127, 0.0],
    [0.125, 0.02],
    [0.11, 0.06],
    [0.06, 0.074],
    [0.0, 0.075],
  ];
  const body = lathe(prof, 64);
  body.rotateZ(-Math.PI / 2);
  pb.add("blackGloss", body);
  const seam = torus(0.127, 0.004, 8, 64);
  seam.rotateY(Math.PI / 2);
  pb.add("steelDark", seam);
  const check = cylY(0.012, 0.03, 16);
  check.rotateZ(0.6);
  check.translate(0.03, 0.09, 0.05);
  pb.add("plastic", check);
  pb.add("rubber", tube([[0.04, 0.1, 0.06], [0.08, 0.16, 0.12], [0.16, 0.2, 0.25]], 0.009));
  const rod = cylX(0.007, 0.1, 10);
  rod.translate(-0.12, 0, 0);
  pb.add("steel", rod);
  return pb.build();
};

export const masterCylinder: Builder = (p) => {
  const L = num(p, "length", 0.19);
  const pb = new PartBuilder();
  const body = cylX(0.026, L, 32);
  body.translate(L / 2, 0, 0);
  pb.add("aluCast", body);
  const flange = rbox(0.016, 0.09, 0.07, 0.006);
  flange.translate(0.006, 0, 0);
  pb.add("aluCast", flange);
  const tip = lathe([[0.026, 0], [0.02, 0.01], [0, 0.012]], 28);
  tip.rotateZ(-Math.PI / 2);
  tip.translate(L, 0, 0);
  pb.add("aluCast", tip);
  for (const x of [0.05, 0.12]) {
    const port = cylZ(0.008, 0.06, 12);
    port.translate(x, -0.005, 0);
    const nut = cylZ(0.009, 0.012, 6);
    nut.translate(x, -0.005, -0.033);
    pb.add("aluCast", port);
    pb.add("steel", nut);
    const boss = cylY(0.012, 0.03, 16);
    boss.translate(x, 0.03, 0);
    pb.add("aluCast", boss);
  }
  return pb.build();
};

export const abs: Builder = () => {
  const pb = new PartBuilder();
  const block = rbox(0.11, 0.09, 0.09, 0.008);
  pb.add("aluCast", block);
  const motor = cylX(0.033, 0.07, 28);
  motor.translate(0.085, -0.01, 0);
  pb.add("steelDark", motor);
  const ecu = rbox(0.04, 0.09, 0.09, 0.01);
  ecu.translate(-0.075, 0, 0);
  pb.add("plastic", ecu);
  const conn = rbox(0.02, 0.03, 0.05, 0.004);
  conn.translate(-0.1, 0.02, 0);
  pb.add("plasticGray", conn);
  for (let i = 0; i < 6; i++) {
    const port = cylY(0.006, 0.014, 6);
    port.translate(-0.035 + (i % 3) * 0.035, 0.05, i < 3 ? -0.02 : 0.02);
    pb.add("steel", port);
  }
  const bracket = rbox(0.14, 0.008, 0.11, 0.003);
  bracket.translate(0, -0.05, 0);
  pb.add("steelDark", bracket);
  return pb.build();
};

export const pedal: Builder = (p, ctx) => {
  const [pivot, pad] = local(ctx, points(p, "points"));
  const pb = new PartBuilder();
  pb.add("steelDark", cylinderBetween(pivot, pad, 0.009, 12));
  const padG = rbox(0.018, 0.075, 0.07, 0.008);
  padG.rotateZ(0.5);
  padG.translate(...pad);
  pb.add("rubber", padG);
  const box = rbox(0.06, 0.08, 0.06, 0.008);
  box.translate(pivot[0] + 0.01, pivot[1] + 0.02, pivot[2]);
  pb.add("steelDark", box);
  const sw = cylX(0.008, 0.03, 10);
  sw.translate(pivot[0] - 0.02, pivot[1] - 0.05, pivot[2] + 0.02);
  pb.add("plasticGray", sw);
  const pushrod = cylX(0.005, 0.1, 8);
  pushrod.translate(pivot[0] + 0.07, pivot[1] - 0.04, pivot[2]);
  pb.add("steel", pushrod);
  return pb.build();
};

const TUBE_MAT: Record<string, MatKey> = { steel: "steel", rubber: "rubber", black: "plastic", alu: "alu" };

export const tubes: Builder = (p, ctx) => {
  const r = num(p, "radius", 0.005);
  const mat = TUBE_MAT[str(p, "color", "steel")] ?? "steel";
  const pb = new PartBuilder();
  for (const path of paths(p, "paths")) {
    const pts = local(ctx, path);
    const g = r < 0.008 ? tube(pts, r, { radial: 8, tension: 0.15 }) : tube(pts, r, { radial: 18, tension: 0.4 });
    pb.add(mat, g);
    for (const q of [pts[0], pts[pts.length - 1]]) {
      const fit = new THREE.SphereGeometry(r * (r < 0.008 ? 2.2 : 1.25), 10, 8);
      fit.translate(...q);
      pb.add(r < 0.008 ? "steel" : "steelDark", fit);
    }
    if (r >= 0.012) {
      // hose clamps
      for (const q of [pts[0], pts[pts.length - 1]]) {
        const clamp = torus(r * 1.05, 0.0025, 6, 24);
        clamp.translate(...q);
        pb.add("steel", clamp);
      }
    }
  }
  return pb.build();
};

// ───────────────────────── Electrical ─────────────────────────

export const battery: Builder = () => {
  const pb = new PartBuilder();
  const W = 0.24;
  const H = 0.19;
  const D = 0.175;
  const caseG = rbox(W, H, D, 0.008);
  pb.add("battery", caseG);
  const lid = new THREE.PlaneGeometry(W - 0.03, D - 0.03);
  lid.rotateX(-Math.PI / 2);
  lid.rotateY(Math.PI / 2);
  lid.translate(0, H / 2 + 0.0015, 0);
  pb.add("batteryLabel", lid);
  for (const [z, mat] of [[-D / 2 + 0.03, "redPlastic"], [D / 2 - 0.03, "plastic"]] as const) {
    const post = cylY(0.009, 0.02, 16);
    post.translate(W / 2 - 0.035, H / 2 + 0.01, z);
    pb.add("gold", post);
    const cover = rbox(0.04, 0.025, 0.04, 0.008);
    cover.translate(W / 2 - 0.035, H / 2 + 0.018, z);
    pb.add(mat, cover);
  }
  const bar = rbox(0.02, 0.012, D + 0.04, 0.004);
  bar.translate(-0.02, H / 2 + 0.006, 0);
  pb.add("steelDark", bar);
  const tray = rbox(W + 0.03, 0.02, D + 0.03, 0.005);
  tray.translate(0, -H / 2 - 0.01, 0);
  pb.add("plasticTextured", tray);
  // cables
  pb.add("redPlastic", tube([[W / 2 - 0.035, H / 2 + 0.03, -D / 2 + 0.03], [W / 2 + 0.05, H / 2 + 0.05, -D / 2], [W / 2 + 0.2, 0.05, 0.1]], 0.008));
  pb.add("plastic", tube([[W / 2 - 0.035, H / 2 + 0.03, D / 2 - 0.03], [W / 2 + 0.02, H / 2 + 0.02, D / 2 + 0.05], [W / 2 + 0.06, -0.1, D / 2 + 0.08]], 0.008));
  return pb.build();
};

export const fuseBox: Builder = () => {
  const pb = new PartBuilder();
  const base = rbox(0.2, 0.07, 0.13, 0.012);
  const lid = rbox(0.205, 0.03, 0.135, 0.012);
  lid.translate(0, 0.045, 0);
  pb.add("plastic", base);
  pb.add("plasticTextured", lid);
  for (const s of [-1, 1]) {
    const latch = rbox(0.02, 0.03, 0.01, 0.003);
    latch.translate(s * 0.07, 0.03, 0.07);
    pb.add("plasticGray", latch);
  }
  return pb.build();
};

export const ecu: Builder = () => {
  const pb = new PartBuilder();
  const body = rbox(0.17, 0.035, 0.14, 0.006);
  pb.add("alu", body);
  const fins: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const f = new THREE.BoxGeometry(0.15, 0.008, 0.003);
    f.translate(0, 0.02, -0.06 + i * 0.015);
    fins.push(f);
  }
  pb.add("alu", merge(fins));
  for (const z of [-0.035, 0.035]) {
    const c = rbox(0.03, 0.03, 0.05, 0.004);
    c.translate(0.095, 0, z);
    pb.add("plastic", c);
  }
  return pb.build();
};

// ───────────────────────── Intake (body side) ─────────────────────────

export const airBox: Builder = (p) => {
  const pb = new PartBuilder();
  const base = rbox(0.3, 0.08, 0.22, 0.03, 4);
  base.translate(0, -0.03, 0);
  const lid = rbox(0.3, 0.06, 0.22, 0.03, 4);
  lid.translate(0, 0.045, 0);
  pb.add("plasticTextured", base);
  pb.add("plastic", lid);
  const seam = rbox(0.305, 0.008, 0.225, 0.004);
  seam.translate(0, 0.012, 0);
  pb.add("plasticGray", seam);
  for (const [x, z] of [[-0.13, -0.09], [0.13, -0.09], [-0.13, 0.09], [0.13, 0.09]]) {
    const clip = rbox(0.02, 0.03, 0.012, 0.003);
    clip.translate(x, 0.015, z + Math.sign(z) * 0.006);
    pb.add("steel", clip);
  }
  const snorkel = rbox(0.1, 0.05, 0.08, 0.02);
  snorkel.translate(0.18, -0.02, -0.04);
  pb.add("plasticTextured", snorkel);
  const duct = points(p, "duct");
  if (duct.length >= 2) {
    // corrugated rubber duct
    const curve = new THREE.CatmullRomCurve3(duct.map((q) => new THREE.Vector3(...q)));
    const g = new THREE.TubeGeometry(curve, 60, 0.034, 20, false);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / 21);
      const k = ring % 3 === 0 ? 0.004 : 0;
      pos.setXYZ(i, pos.getX(i) + nor.getX(i) * k, pos.getY(i) + nor.getY(i) * k, pos.getZ(i) + nor.getZ(i) * k);
    }
    g.computeVertexNormals();
    pb.add("rubber", g);
  }
  return pb.build();
};

export const maf: Builder = () => {
  const pb = new PartBuilder();
  const ring = cylZ(0.04, 0.05, 28);
  pb.add("plastic", ring);
  const head = rbox(0.03, 0.04, 0.03, 0.005);
  head.translate(0, 0.045, 0);
  pb.add("plastic", head);
  const conn = rbox(0.02, 0.018, 0.024, 0.003);
  conn.translate(0.02, 0.06, 0);
  pb.add("plasticGray", conn);
  return pb.build();
};

// ───────────────────────── Fuel ─────────────────────────

export const fuelTank: Builder = () => {
  const pb = new PartBuilder();
  const s = new THREE.Shape();
  const W = 0.56;
  const H = 0.11;
  s.moveTo(-W, -H + 0.03);
  s.quadraticCurveTo(-W, -H, -W + 0.04, -H);
  s.lineTo(-0.15, -H);
  s.quadraticCurveTo(-0.13, -0.01, 0, -0.01);
  s.quadraticCurveTo(0.13, -0.01, 0.15, -H);
  s.lineTo(W - 0.04, -H);
  s.quadraticCurveTo(W, -H, W, -H + 0.03);
  s.lineTo(W - 0.02, H - 0.02);
  s.quadraticCurveTo(W - 0.03, H, W - 0.06, H);
  s.lineTo(-W + 0.06, H);
  s.quadraticCurveTo(-W + 0.03, H, -W + 0.02, H - 0.02);
  s.lineTo(-W, -H + 0.03);
  const tank = extrude(s, 0.6, 0.03, 24);
  tank.rotateY(Math.PI / 2);
  pb.add("plasticTextured", tank);
  for (const x of [-0.18, 0.18]) {
    const strap = rbox(0.035, 0.006, W * 2 + 0.04, 0.002);
    strap.translate(x, -H - 0.008, 0);
    pb.add("steelDark", strap);
  }
  const filler = tube([[0.0, 0.05, -W + 0.05], [-0.1, 0.12, -W - 0.02], [-0.35, 0.25, -W - 0.12]], 0.025);
  pb.add("plastic", filler);
  return pb.build();
};

export const fuelPump: Builder = () => {
  const pb = new PartBuilder();
  const flange = cylY(0.07, 0.014, 40);
  pb.add("plastic", flange);
  const ring = torus(0.075, 0.006, 8, 48);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0.004, 0);
  pb.add("steel", ring);
  const conn = rbox(0.03, 0.025, 0.02, 0.004);
  conn.translate(0.03, 0.02, 0);
  pb.add("plasticGray", conn);
  const fit = cylY(0.007, 0.03, 10);
  fit.translate(-0.03, 0.02, 0.02);
  pb.add("steel", fit);
  const pumpModule = cylY(0.045, 0.16, 32);
  pumpModule.translate(0, -0.09, 0);
  pb.add("plasticGray", pumpModule);
  const pump = cylY(0.02, 0.1, 20);
  pump.translate(0.02, -0.11, 0.01);
  pb.add("steel", pump);
  return pb.build();
};

// ───────────────────────── Exhaust ─────────────────────────

export const catalytic: Builder = (p, ctx) => {
  const [a, b] = local(ctx, points(p, "points"));
  const L = new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));
  const pb = new PartBuilder();
  const prof: [number, number][] = [[0.026, 0], [0.028, 0.02], [0.062, 0.08], [0.064, 0.1], [0.064, L - 0.1], [0.062, L - 0.08], [0.028, L - 0.02], [0.026, L]];
  const body = lathe(prof, 40);
  body.scale(1, 1, 0.75);
  pb.add("exhaust", alignBetween(body, a, b));
  const shield = new THREE.CylinderGeometry(0.075, 0.075, L - 0.16, 32, 1, true, -Math.PI * 0.1, Math.PI * 1.2);
  shield.translate(0, L / 2, 0);
  shield.scale(1, 1, 0.78);
  pb.add("heatShield", alignBetween(shield, a, b));
  const boss = cylY(0.01, 0.02, 6);
  boss.translate(0.0, L * 0.55, 0.05);
  pb.add("steel", alignBetween(boss, a, b));
  return pb.build();
};

export const centerPipe: Builder = (p, ctx) => {
  const pb = new PartBuilder();
  const p1 = local(ctx, points(p, "points"));
  const p2 = local(ctx, points(p, "points2"));
  const res = local(ctx, points(p, "resonator"));
  if (p1.length >= 2) pb.add("exhaust", tube(p1, 0.026, { radial: 16, tension: 0.3 }));
  if (p2.length >= 2) pb.add("exhaust", tube(p2, 0.027, { radial: 16, tension: 0.3 }));
  if (res.length === 2) {
    const L = new THREE.Vector3(...res[0]).distanceTo(new THREE.Vector3(...res[1]));
    const can = lathe([[0.027, 0], [0.05, 0.04], [0.052, 0.06], [0.052, L - 0.06], [0.05, L - 0.04], [0.027, L]], 32);
    pb.add("exhaust", alignBetween(can, res[0], res[1]));
  }
  // flanges and rubber hangers
  for (const q of [p1[p1.length - 1], p2[0]]) {
    if (!q) continue;
    const fl = torus(0.034, 0.008, 8, 24);
    fl.translate(...q);
    pb.add("steelDark", fl);
  }
  for (const q of [p2[2], p2[4]]) {
    if (!q) continue;
    const h = torus(0.018, 0.007, 8, 16);
    h.rotateY(Math.PI / 2);
    h.translate(q[0], q[1] + 0.05, q[2]);
    pb.add("rubber", h);
  }
  return pb.build();
};

export const muffler: Builder = (p) => {
  const tipZ = num(p, "tipZ", 0.46);
  const tipX = num(p, "tipX", -0.6);
  const pb = new PartBuilder();
  const body = lathe([[0, -0.25], [0.12, -0.245], [0.13, -0.23], [0.13, 0.23], [0.12, 0.245], [0, 0.25]], 48);
  body.rotateX(Math.PI / 2);
  body.scale(1, 0.55, 1);
  body.translate(0, 0, 0.05);
  pb.add("exhaust", body);
  pb.add("exhaust", tube([[0.26, 0.02, -0.06], [0.18, 0.01, -0.06], [0.1, 0.0, -0.06]], 0.026));
  const tz = tipZ - 0.18;
  const tip: V3 = [tipX, -0.01, tz];
  pb.add("exhaust", tube([[-0.08, 0.0, tz - 0.02], [(tipX - 0.08) / 2, -0.01, tz], [tipX + 0.05, -0.01, tz], tip], 0.026));
  const finisher = cylinderBetween([tipX + 0.06, -0.012, tz], [tipX - 0.02, -0.014, tz], 0.04, 28);
  pb.add("chrome", finisher);
  const shield = new THREE.BoxGeometry(0.22, 0.004, 0.5);
  shield.translate(0, 0.08, 0.05);
  pb.add("heatShield", shield);
  return pb.build();
};

export const o2Sensors: Builder = (p, ctx) => {
  const pb = new PartBuilder();
  for (const q of local(ctx, points(p, "points"))) {
    const hex = cylY(0.011, 0.012, 6);
    hex.translate(...q);
    const body = cylY(0.007, 0.045, 12);
    body.translate(q[0], q[1] + 0.028, q[2]);
    pb.add("steel", hex, body);
    pb.add("plastic", tube([[q[0], q[1] + 0.05, q[2]], [q[0] + 0.03, q[1] + 0.12, q[2] + 0.02], [q[0] + 0.1, q[1] + 0.18, q[2] - 0.04]], 0.0035));
  }
  return pb.build();
};
