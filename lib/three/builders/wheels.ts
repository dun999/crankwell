import * as THREE from "three";
import { PartBuilder, cylZ, extrude, lathe, merge, rbox, ringShape, sectorShape, torus, tx } from "../geom";
import { deg, smoothstep } from "../math";
import { bool, num, str, type Builder } from "./types";

// Wheel-local frame: axle along Z, outward face toward +Z (mirrored for the left side).

/** Lathe around Z instead of Y. */
const latheZ = (profile: [number, number][], seg = 96) => {
  const g = lathe(profile, seg);
  g.rotateX(Math.PI / 2);
  return g;
};

export const tire: Builder = (p) => {
  const R = num(p, "radius", 0.32);
  const W = num(p, "width", 0.225);
  const rim = num(p, "rim", 0.216);
  const pb = new PartBuilder();
  const tw = W * 0.86; // tread width
  const NA = 720;
  const NW = 96;
  const pitches = 68;
  const pos = new Float32Array((NA + 1) * (NW + 1) * 3);
  const uv = new Float32Array((NA + 1) * (NW + 1) * 2);
  const shoulder = (w: number) => {
    const a = Math.abs(w);
    return a > 0.8 ? Math.pow((a - 0.8) / 0.2, 2) * 0.012 : 0;
  };
  const groove = (u: number, w: number) => {
    const a = Math.abs(w);
    let d = 0;
    // four circumferential grooves
    for (const gw of [0.22, 0.6]) if (Math.abs(a - gw) < 0.045) d = Math.max(d, 0.0085 * smoothstep(0.045, 0.03, Math.abs(a - gw)));
    const f = u * pitches;
    // shoulder lugs
    if (a > 0.66) {
      const ph = (f + (w > 0 ? 0.5 : 0)) % 1;
      if (ph < 0.11) d = Math.max(d, 0.0065 * smoothstep(0.66, 0.72, a));
    }
    // angled sipes across the center ribs
    if (a < 0.55) {
      const ph = (f * 1 + a * 1.4 + (w > 0 ? 0.25 : 0)) % 1;
      if (ph < 0.035) d = Math.max(d, 0.003);
    }
    return d;
  };
  let k = 0;
  for (let i = 0; i <= NA; i++) {
    const u = i / NA;
    const ang = u * Math.PI * 2;
    for (let j = 0; j <= NW; j++) {
      const w = (j / NW) * 2 - 1;
      const r = R - groove(u, w) - shoulder(w);
      pos[k * 3] = Math.cos(ang) * r;
      pos[k * 3 + 1] = Math.sin(ang) * r;
      pos[k * 3 + 2] = (w * tw) / 2;
      uv[k * 2] = u * 40;
      uv[k * 2 + 1] = j / NW;
      k++;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < NA; i++)
    for (let j = 0; j < NW; j++) {
      const a = i * (NW + 1) + j;
      const b = a + NW + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const tread = new THREE.BufferGeometry();
  tread.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  tread.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  tread.setIndex(idx);
  tread.computeVertexNormals();
  pb.add("tire", tread);

  // sidewalls: from tread shoulder to bead, bulging past the tread width
  const rs = R - 0.012;
  const side = (s: number): [number, number][] => {
    const pts: [number, number][] = [];
    const n = 28;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const r = rs + (rim + 0.008 - rs) * t;
      const bulge = Math.sin(Math.PI * Math.min(1, t * 1.15)) * (W / 2 - tw / 2 + 0.01);
      const z = s * (tw / 2 + bulge * (1 - t * 0.35) + t * (W / 2 - tw / 2 - 0.006));
      pts.push([r, z]);
    }
    return pts;
  };
  // Lathe normals follow profile direction: outer wall runs tread→bead, inner wall bead→tread.
  pb.add("tire", latheZ(side(1), 160), latheZ(side(-1).reverse(), 160));
  // rim protector ring + raised lettering band
  const ring = torus(rim + 0.03, 0.006, 8, 128);
  ring.translate(0, 0, W / 2 - 0.01);
  pb.add("rubber", ring);
  // embossed text blocks around the sidewall (subtle)
  const blocks: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 64; i++) {
    if (i % 16 > 10) continue;
    const a = (i / 64) * Math.PI * 2;
    const b = rbox(0.012, 0.016, 0.002, 0.0008, 1);
    b.rotateZ(a);
    b.translate(Math.cos(a) * (rim + 0.06), Math.sin(a) * (rim + 0.06), W / 2 + 0.002);
    blocks.push(b);
  }
  pb.add("rubber", merge(blocks));
  return pb.build();
};

export const rim: Builder = (p, ctx) => {
  const r = num(p, "rim", 0.216);
  const W = num(p, "width", 0.225);
  const style = str(p, "style", ctx.spec.id);
  const pb = new PartBuilder();
  const zo = W / 2 - 0.004;
  // barrel (inner + outer surface, closed profile)
  const prof: [number, number][] = [
    [r + 0.013, -zo],
    [r + 0.013, -zo + 0.006],
    [r - 0.004, -zo + 0.016],
    [r - 0.006, -zo * 0.2],
    [r - 0.034, -zo * 0.05],
    [r - 0.034, zo * 0.25],
    [r - 0.006, zo * 0.45],
    [r - 0.004, zo - 0.016],
    [r + 0.013, zo - 0.006],
    [r + 0.013, zo],
    [r + 0.005, zo + 0.002],
    [r - 0.012, zo - 0.012],
    [r - 0.016, zo * 0.45],
    [r - 0.044, zo * 0.25],
    [r - 0.044, -zo * 0.05],
    [r - 0.016, -zo * 0.2],
    [r - 0.014, -zo + 0.016],
    [r + 0.005, -zo - 0.002],
    [r + 0.013, -zo],
  ];
  pb.add("alu", latheZ(prof, 128));
  // lip (machined)
  const lip = torus(r + 0.008, 0.007, 10, 128);
  lip.translate(0, 0, zo - 0.002);
  pb.add("wheelFace", lip);

  const face = zo - 0.034;
  const concave = (rr: number) => -Math.pow(rr / r, 1.6) * 0.03;
  const bend = (g: THREE.BufferGeometry) => {
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const rr = Math.hypot(pos.getX(i), pos.getY(i));
      pos.setZ(i, pos.getZ(i) + face + concave(rr) + 0.012);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  };

  // spokes
  const spokes: THREE.BufferGeometry[] = [];
  const n = style === "crv" ? 5 : 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (style === "crv" ? 0 : Math.PI / n);
    const shape = new THREE.Shape();
    const r0 = 0.072;
    const r1 = r - 0.012;
    if (style === "crv") {
      // twin-blade Y spoke
      for (const off of [-0.022, 0.022]) {
        const s = new THREE.Shape();
        s.moveTo(r0, off - 0.017);
        s.lineTo(r1, off * 2.2 - 0.013);
        s.lineTo(r1, off * 2.2 + 0.013);
        s.lineTo(r0, off + 0.017);
        s.lineTo(r0, off - 0.017);
        const g = extrude(s, 0.024, 0.004, 4);
        // subdivide radially for the concave bend
        const sub = subdivide(g, 3);
        sub.rotateZ(a);
        spokes.push(bend(sub));
      }
      continue;
    }
    const wIn = i % 2 ? 0.03 : 0.024;
    shape.moveTo(r0, -wIn / 2);
    shape.lineTo(r1, -0.015);
    shape.lineTo(r1, 0.015);
    shape.lineTo(r0, wIn / 2);
    shape.lineTo(r0, -wIn / 2);
    const g = subdivide(extrude(shape, 0.022, 0.004, 4), 3);
    g.rotateZ(a);
    spokes.push(bend(g));
  }
  pb.add("wheelFace", merge(spokes));
  // hub disc with lug holes
  const hubDisc = extrude(ringShape(0.085, 0.032, Array.from({ length: 5 }, (_, i) => ({ x: Math.cos((i / 5) * Math.PI * 2) * 0.057, y: Math.sin((i / 5) * Math.PI * 2) * 0.057, r: 0.011 }))), 0.022, 0.005, 32);
  hubDisc.translate(0, 0, face + 0.012);
  pb.add("wheelFace", hubDisc);
  // lug nuts
  const nuts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const nut = cylZ(0.0095, 0.024, 6);
    const dome = new THREE.SphereGeometry(0.0085, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.rotateX(Math.PI / 2);
    dome.translate(0, 0, 0.012);
    const g = merge([nut, dome]);
    g.translate(Math.cos(a) * 0.057, Math.sin(a) * 0.057, face + 0.02);
    nuts.push(g);
  }
  pb.add("chrome", merge(nuts));
  // center cap
  const cap = cylZ(0.031, 0.01, 40);
  cap.translate(0, 0, face + 0.026);
  pb.add("blackGloss", cap);
  const capRing = torus(0.031, 0.002, 6, 48);
  capRing.translate(0, 0, face + 0.031);
  pb.add("chrome", capRing);
  // valve stem
  const stem = cylZ(0.004, 0.03, 8);
  stem.rotateX(-0.6);
  stem.translate(0, -(r - 0.015), zo - 0.03);
  pb.add("rubber", stem);
  return pb.build();
};

/** Insert extra vertices along an extruded shape by splitting triangles (simple midpoint subdivision). */
function subdivide(g: THREE.BufferGeometry, times: number): THREE.BufferGeometry {
  let geo = g.index ? g.toNonIndexed() : g;
  for (let t = 0; t < times; t++) {
    const src = geo.attributes.position.array as Float32Array;
    const out = new Float32Array(src.length * 4);
    let o = 0;
    for (let i = 0; i < src.length; i += 9) {
      const a = [src[i], src[i + 1], src[i + 2]];
      const b = [src[i + 3], src[i + 4], src[i + 5]];
      const c = [src[i + 6], src[i + 7], src[i + 8]];
      const ab = a.map((v, k) => (v + b[k]) / 2);
      const bc = b.map((v, k) => (v + c[k]) / 2);
      const ca = c.map((v, k) => (v + a[k]) / 2);
      for (const tri of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) for (const v of tri) for (const x of v) out[o++] = x;
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(out, 3));
  }
  geo.computeVertexNormals();
  return geo;
}

export const rotor: Builder = (p) => {
  const R = num(p, "radius", 0.148);
  const vented = bool(p, "vented", true);
  const pb = new PartBuilder();
  const rIn = R - 0.058;
  const plate = vented ? 0.008 : 0.011;
  const gap = vented ? 0.011 : 0;
  const total = plate * 2 + gap;
  if (vented) {
    for (const s of [-1, 1]) {
      const g = extrude(ringShape(R, rIn), plate, 0.0008, 96);
      g.translate(0, 0, s * (gap / 2 + plate / 2));
      pb.add("rotor", g);
    }
    const vanes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const v = new THREE.BoxGeometry(R - rIn - 0.006, 0.0035, gap + 0.001);
      v.translate((R + rIn) / 2, 0, 0);
      v.rotateZ(a + 0.18);
      vanes.push(v);
    }
    pb.add("castIron", merge(vanes));
  } else {
    pb.add("rotor", extrude(ringShape(R, rIn), plate, 0.0008, 96));
  }
  // hat toward +z (outboard), center bore and lug holes
  const hatH = 0.042;
  const hat = latheZ([
    [rIn + 0.002, total / 2 - 0.002],
    [0.084, total / 2 + 0.006],
    [0.082, hatH],
    [0.08, hatH + 0.002],
    [0.078, hatH + 0.002],
  ], 72);
  pb.add("castIron", hat);
  const face = extrude(
    ringShape(0.08, 0.034, Array.from({ length: 5 }, (_, i) => ({ x: Math.cos((i / 5) * Math.PI * 2) * 0.057, y: Math.sin((i / 5) * Math.PI * 2) * 0.057, r: 0.0075 }))),
    0.007,
    0.001,
    48,
  );
  face.translate(0, 0, hatH);
  pb.add("castIron", face);
  // inner edge rim
  const inner = latheZ([[rIn + 0.004, -total / 2], [rIn - 0.002, -total / 2], [rIn - 0.002, total / 2], [rIn + 0.004, total / 2]].reverse() as [number, number][], 72);
  pb.add("castIron", inner);
  return pb.build();
};

export const caliper: Builder = (p) => {
  const rotorR = num(p, "rotor", 0.148);
  const angle = deg(num(p, "angle", 168));
  const front = bool(p, "front", true);
  const epb = bool(p, "epb", false);
  const pb = new PartBuilder();
  const span = deg(front ? 25 : 21);
  const a0 = angle - span;
  const a1 = angle + span;
  const rr0 = rotorR - 0.062;
  const rr1 = rotorR + 0.018;
  // piston housing (inboard, -z)
  const inner = extrude(sectorShape(rr0, rr1, a0, a1), front ? 0.044 : 0.036, 0.008, 24);
  inner.translate(0, 0, -0.04);
  // fingers (outboard, +z)
  const outer = extrude(sectorShape(rr0 + 0.012, rr1, a0 + 0.06, a1 - 0.06), 0.022, 0.006, 24);
  outer.translate(0, 0, 0.026);
  // bridge over the rotor edge
  const bridge = extrude(sectorShape(rotorR + 0.004, rr1 + 0.004, a0 + 0.1, a1 - 0.1), 0.09, 0.006, 24);
  bridge.translate(0, 0, -0.008);
  pb.add("caliper", inner, outer, bridge);
  // window showing pads
  // pistons bulges on the inside
  for (const off of front ? [-0.38, 0.38] : [0]) {
    const a = angle + off * span;
    const c = cylZ(0.024, 0.016, 32);
    c.translate(Math.cos(a) * (rotorR - 0.025), Math.sin(a) * (rotorR - 0.025), -0.066);
    pb.add("caliper", c);
  }
  // slide pins with boots
  for (const a of [a0 - 0.05, a1 + 0.05]) {
    const pin = cylZ(0.009, 0.07, 16);
    pin.translate(Math.cos(a) * (rotorR - 0.035), Math.sin(a) * (rotorR - 0.035), -0.03);
    const boot = cylZ(0.012, 0.025, 16);
    boot.translate(Math.cos(a) * (rotorR - 0.035), Math.sin(a) * (rotorR - 0.035), -0.002);
    pb.add("steel", pin);
    pb.add("rubber", boot);
  }
  // mounting bracket
  const br = extrude(sectorShape(rotorR - 0.08, rotorR - 0.05, a0 - 0.12, a1 + 0.12), 0.012, 0.002, 24);
  br.translate(0, 0, -0.05);
  pb.add("castIron", br);
  // bleeder + banjo
  const top = angle + (front ? 0.3 : -0.3) * span;
  const bleed = new THREE.CylinderGeometry(0.004, 0.005, 0.02, 10);
  bleed.translate(Math.cos(top) * (rr1 + 0.008), Math.sin(top) * (rr1 + 0.008), -0.05);
  pb.add("steel", bleed);
  const banjo = cylZ(0.008, 0.016, 12);
  banjo.translate(Math.cos(angle) * rr0, Math.sin(angle) * rr0, -0.072);
  pb.add("steel", banjo);
  if (epb) {
    const motor = cylZ(0.03, 0.1, 28);
    motor.translate(Math.cos(angle) * (rotorR - 0.02), Math.sin(angle) * (rotorR - 0.02), -0.11);
    const conn = rbox(0.03, 0.02, 0.025, 0.004);
    conn.translate(Math.cos(angle) * (rotorR + 0.015), Math.sin(angle) * (rotorR + 0.015), -0.13);
    pb.add("plastic", motor, conn);
  }
  return pb.build();
};

export const pads: Builder = (p) => {
  const rotorR = num(p, "rotor", 0.148);
  const angle = deg(num(p, "angle", 168));
  const span = deg(19);
  const pb = new PartBuilder();
  for (const s of [-1, 1]) {
    const back = extrude(sectorShape(rotorR - 0.054, rotorR - 0.002, angle - span - 0.04, angle + span + 0.04), 0.005, 0.0008, 24);
    back.translate(0, 0, s * 0.028);
    const fr = extrude(sectorShape(rotorR - 0.05, rotorR - 0.005, angle - span, angle + span), 0.009, 0.001, 24);
    fr.translate(0, 0, s * 0.019);
    pb.add("steelDark", back);
    pb.add("castDark", fr);
  }
  // wear indicator tab
  const tab = new THREE.BoxGeometry(0.004, 0.012, 0.012);
  tab.translate(Math.cos(angle + span) * (rotorR - 0.01), Math.sin(angle + span) * (rotorR - 0.01), -0.022);
  pb.add("steel", tab);
  return pb.build();
};

export const hub: Builder = () => {
  const pb = new PartBuilder();
  const flange = extrude(ringShape(0.072, 0.02, Array.from({ length: 5 }, (_, i) => ({ x: Math.cos((i / 5) * Math.PI * 2 + 0.6) * 0.05, y: Math.sin((i / 5) * Math.PI * 2 + 0.6) * 0.05, r: 0.008 }))), 0.012, 0.002, 48);
  flange.translate(0, 0, 0.032);
  pb.add("castIron", flange);
  const pilot = cylZ(0.032, 0.02, 32);
  pilot.translate(0, 0, 0.045);
  pb.add("steel", pilot);
  const body = latheZ([[0.03, 0.026], [0.05, 0.022], [0.052, -0.02], [0.046, -0.05], [0.03, -0.055]], 48);
  pb.add("steel", body);
  const studs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const s = cylZ(0.0062, 0.05, 10);
    s.translate(Math.cos(a) * 0.057, Math.sin(a) * 0.057, 0.06);
    studs.push(s);
  }
  pb.add("gold", merge(studs));
  const tone = torus(0.048, 0.004, 6, 48);
  tone.translate(0, 0, -0.035);
  pb.add("steelDark", tone);
  return pb.build();
};

export const knuckle: Builder = () => {
  const pb = new PartBuilder();
  const boss = extrude(ringShape(0.075, 0.05), 0.05, 0.008, 40);
  const upper = rbox(0.06, 0.16, 0.04, 0.014);
  tx(upper, { pos: [-0.01, 0.13, -0.035], rot: [0.25, 0, 0.08] });
  const clamp = rbox(0.075, 0.05, 0.06, 0.012);
  tx(clamp, { pos: [-0.02, 0.21, -0.055] });
  const lower = rbox(0.05, 0.1, 0.04, 0.012);
  tx(lower, { pos: [0.01, -0.1, -0.015] });
  const arm = rbox(0.15, 0.035, 0.035, 0.01);
  tx(arm, { pos: [-0.13, -0.015, -0.03], rot: [0, 0.15, 0] });
  const ears = rbox(0.03, 0.12, 0.03, 0.008);
  tx(ears, { pos: [-0.075, 0.0, -0.03] });
  pb.add("castIron", boss, upper, clamp, lower, arm, ears);
  return pb.build();
};
