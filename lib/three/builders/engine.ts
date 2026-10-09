import * as THREE from "three";
import {
  PartBuilder,
  cylX,
  cylY,
  cylZ,
  cylinderBetween,
  extrude,
  helix,
  lathe,
  merge,
  rbox,
  roundedRectShape,
  circlePath,
  taperTube,
  torus,
  tube,
  tx,
  type V3,
} from "../geom";
import { arr, bool, num, type Builder } from "./types";

// Engine-local frame: origin at the crankshaft centerline, +x = intake side
// (front of car), +y up, +z along the crank toward the timing end.

const DECK = 0.25;
const BORE = 0.0405;
const STROKE_R = 0.049;
const ROD = 0.15;

const latheZ = (profile: [number, number][], seg = 48) => {
  const g = lathe(profile, seg);
  g.rotateX(Math.PI / 2);
  return g;
};
const latheX = (profile: [number, number][], seg = 48) => {
  const g = lathe(profile, seg);
  g.rotateZ(-Math.PI / 2);
  return g;
};

/** Grooved belt pulley facing +z. */
function pulley(r: number, w = 0.024, grooves = 6) {
  const prof: [number, number][] = [[r * 0.35, -w / 2], [r + 0.003, -w / 2], [r + 0.003, -w / 2 + 0.002]];
  for (let i = 0; i < grooves; i++) {
    const z0 = -w / 2 + 0.002 + ((w - 0.004) * i) / grooves;
    prof.push([r - 0.002, z0 + (w - 0.004) / grooves / 2], [r + 0.001, z0 + (w - 0.004) / grooves]);
  }
  prof.push([r + 0.003, w / 2], [r * 0.35, w / 2]);
  return latheZ(prof.map(([a, b]) => [a, b]), 64);
}

export const engineBlock: Builder = () => {
  const pb = new PartBuilder();
  const cyl = [-0.138, -0.046, 0.046, 0.138];
  // deck outline with four bores, extruded down from the deck to the crank line
  const deck = roundedRectShape(0.3, 0.47, 0.03);
  for (const z of cyl) deck.holes.push(circlePath(BORE + 0.001, 0, -z, 48, true));
  const upper = extrude(deck, DECK - 0.03, 0.006, 40, true);
  upper.rotateX(-Math.PI / 2);
  upper.translate(0, 0.03, 0);
  pb.add("aluCast", upper);
  // liners visible inside the bores
  for (const z of cyl) {
    // profile runs downward so lathe normals face the bore axis (seen from inside)
    const liner = lathe([[BORE + 0.0006, DECK - 0.002], [BORE + 0.0006, 0.06]], 40);
    liner.translate(0, 0, z);
    pb.add("castIron", liner);
  }
  // crankcase skirt
  const skirt = rbox(0.32, 0.11, 0.48, 0.02);
  skirt.translate(0, -0.02, 0);
  pb.add("aluCast", skirt);
  // water jacket ribs on both long sides
  for (const s of [-1, 1])
    for (let i = 0; i < 5; i++) {
      const rib = rbox(0.012, 0.2, 0.018, 0.004);
      rib.translate(s * 0.153, 0.12, -0.2 + i * 0.1);
      pb.add("aluCast", rib);
    }
  // knock sensor + coolant passage bosses
  const knock = cylX(0.012, 0.02, 16);
  knock.translate(0.16, 0.08, 0.0);
  pb.add("steel", knock);
  // timing cover (aluminum) on the +z end
  const coverShape = new THREE.Shape();
  coverShape.moveTo(-0.15, -0.06);
  coverShape.lineTo(0.15, -0.06);
  coverShape.quadraticCurveTo(0.17, 0.12, 0.15, 0.39);
  coverShape.lineTo(-0.15, 0.39);
  coverShape.quadraticCurveTo(-0.17, 0.12, -0.15, -0.06);
  const cover = extrude(coverShape, 0.032, 0.008, 24, true);
  cover.translate(0, 0, 0.245);
  pb.add("aluCast", cover);
  // crank seal + bolt bosses
  const seal = torus(0.032, 0.006, 8, 32);
  seal.translate(0, 0, 0.28);
  pb.add("rubber", seal);
  const bolts: THREE.BufferGeometry[] = [];
  for (const [x, y] of [[-0.14, 0.0], [0.14, 0.0], [-0.14, 0.2], [0.14, 0.2], [-0.13, 0.36], [0.13, 0.36], [0, 0.38]]) {
    const b = cylZ(0.006, 0.008, 6);
    b.translate(x, y, 0.281);
    bolts.push(b);
  }
  pb.add("steel", merge(bolts));
  return pb.build();
};

export const cylinderHead: Builder = () => {
  const pb = new PartBuilder();
  const cyl = [-0.138, -0.046, 0.046, 0.138];
  const body = rbox(0.29, 0.1, 0.47, 0.012);
  body.translate(0, 0.05, 0);
  pb.add("aluCast", body);
  // gasket
  const gasket = new THREE.BoxGeometry(0.3, 0.003, 0.47);
  gasket.translate(0, 0.001, 0);
  pb.add("steel", gasket);
  // cam journal saddles
  for (const x of [-0.045, 0.045])
    for (let i = 0; i < 5; i++) {
      const sad = rbox(0.04, 0.03, 0.02, 0.004);
      sad.translate(x, 0.105, -0.2 + i * 0.1);
      pb.add("aluCast", sad);
    }
  // valve springs (16) and spark plug wells
  const springs: THREE.BufferGeometry[] = [];
  for (const z of cyl) {
    for (const x of [-0.04, 0.04])
      for (const dz of [-0.016, 0.016]) {
        const s = helix(0.0105, 0.0022, 0.03, 5, 60);
        s.translate(x, 0.075, z + dz);
        springs.push(s);
      }
    const well = cylY(0.014, 0.04, 20);
    well.translate(0, 0.11, z);
    pb.add("aluCast", well);
  }
  pb.add("steel", merge(springs));
  // intake (+x) and exhaust (-x) port flanges
  for (const z of cyl) {
    const ip = rbox(0.012, 0.04, 0.05, 0.006);
    ip.translate(0.148, 0.04, z);
    const ep = rbox(0.012, 0.035, 0.04, 0.006);
    ep.translate(-0.148, 0.04, z);
    pb.add("castDark", ip, ep);
  }
  return pb.build();
};

export const valveCover: Builder = (p) => {
  const pb = new PartBuilder();
  const crv = p.brand === "crv";
  const shell = rbox(0.27, 0.07, 0.47, 0.03, 4);
  shell.translate(0, 0.035, 0);
  pb.add("engineCover", shell);
  for (let i = 0; i < 6; i++) {
    const rib = rbox(0.008, 0.012, 0.42, 0.003);
    rib.translate(-0.11 + i * 0.044 + (i > 2 ? 0.044 : 0), 0.072, 0);
    if (i === 2 || i === 3) continue;
    pb.add("engineCover", rib);
  }
  // center channel where coils sit
  const channel = rbox(0.07, 0.012, 0.44, 0.004);
  channel.translate(0, 0.068, 0);
  pb.add(crv ? "redPlastic" : "plasticGray", channel);
  const cap = cylY(0.022, 0.018, 28);
  cap.translate(0.085, 0.078, 0.17);
  pb.add(crv ? "plastic" : "yellow", cap);
  const pcv = cylX(0.008, 0.03, 12);
  pcv.translate(-0.13, 0.05, -0.12);
  pb.add("plastic", pcv);
  return pb.build();
};

export const camshafts: Builder = () => {
  const pb = new PartBuilder();
  const lobeShape = new THREE.Shape();
  lobeShape.absarc(0, 0, 0.017, Math.PI * 0.75, Math.PI * 2.25, false);
  lobeShape.quadraticCurveTo(0.012, 0.027, 0, 0.03);
  lobeShape.quadraticCurveTo(-0.012, 0.027, Math.cos(Math.PI * 0.75) * 0.017, Math.sin(Math.PI * 0.75) * 0.017);
  const cyl = [-0.138, -0.046, 0.046, 0.138];
  for (const x of [-0.045, 0.045]) {
    const shaft = cylZ(0.012, 0.47, 20);
    shaft.translate(x, 0, 0);
    pb.add("steel", shaft);
    const lobes: THREE.BufferGeometry[] = [];
    cyl.forEach((z, i) => {
      for (const dz of [-0.016, 0.016]) {
        const l = extrude(lobeShape, 0.012, 0.0015, 16);
        l.rotateZ(i * Math.PI * 0.5 + (x > 0 ? 0.6 : 0));
        l.translate(x, 0, z + dz);
        lobes.push(l);
      }
    });
    pb.add("steel", merge(lobes));
    // VVT phaser + sprocket at the timing end
    const phaser = cylZ(0.042, 0.03, 40);
    phaser.translate(x, 0, 0.25);
    pb.add("aluCast", phaser);
    const spr = gear(0.046, 0.006, 32);
    spr.translate(x, 0, 0.268);
    pb.add("steelDark", spr);
  }
  return pb.build();
};

function gear(r: number, w: number, teeth: number) {
  const s = new THREE.Shape();
  for (let i = 0; i <= teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? r : r - 0.004;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.holes.push(circlePath(r * 0.3, 0, 0, 16, true));
  return extrude(s, w, 0, 1);
}

export const coils: Builder = (p) => {
  const pb = new PartBuilder();
  for (const z of arr(p, "cyl")) {
    const body = cylY(0.0125, 0.11, 20);
    body.translate(0, -0.05, z);
    const head = rbox(0.055, 0.032, 0.036, 0.008);
    head.translate(0.005, 0.016, z);
    const conn = rbox(0.022, 0.018, 0.026, 0.004);
    conn.translate(0.04, 0.02, z);
    pb.add("plastic", body, head);
    pb.add("plasticGray", conn);
  }
  return pb.build();
};

export const plugs: Builder = (p) => {
  const pb = new PartBuilder();
  for (const z of arr(p, "cyl")) {
    const ins = cylY(0.0065, 0.04, 16);
    ins.translate(0, 0.03, z);
    const hex = cylY(0.0095, 0.012, 6);
    hex.translate(0, 0.004, z);
    const thread = cylY(0.0065, 0.022, 12);
    thread.translate(0, -0.013, z);
    const tip = cylY(0.0018, 0.008, 6);
    tip.translate(0, -0.027, z);
    pb.add("ceramic", ins);
    pb.add("steel", hex, thread);
    pb.add("copper", tip);
  }
  return pb.build();
};

export const piston: Builder = (p) => {
  const pb = new PartBuilder();
  const crank = (num(p, "crank", 0) * Math.PI) / 180;
  const pinY = STROKE_R * Math.cos(crank) + Math.sqrt(ROD * ROD - Math.pow(STROKE_R * Math.sin(crank), 2));
  const crankPin: V3 = [STROKE_R * Math.sin(crank), STROKE_R * Math.cos(crank), 0];
  const r = BORE - 0.0006;
  const prof: [number, number][] = [
    [0, 0.032],
    [r - 0.006, 0.031],
    [r, 0.028],
    [r, 0.024],
    [r - 0.0015, 0.0235],
    [r - 0.0015, 0.0215],
    [r, 0.021],
    [r, 0.017],
    [r - 0.0015, 0.0165],
    [r - 0.0015, 0.0145],
    [r, 0.014],
    [r, 0.01],
    [r - 0.002, 0.0095],
    [r - 0.002, 0.0065],
    [r, 0.006],
    [r - 0.0005, -0.032],
    [r - 0.004, -0.035],
  ];
  const body = lathe(prof, 48);
  body.translate(0, pinY, 0);
  pb.add("aluBrushed", body);
  const rings = [0.0225, 0.0155, 0.008].map((y) => {
    const t = torus(r - 0.0006, 0.0011, 6, 48);
    t.rotateX(Math.PI / 2);
    t.translate(0, pinY + y, 0);
    return t;
  });
  pb.add("steelDark", merge(rings));
  const pin = cylZ(0.0105, 0.068, 20);
  pin.translate(0, pinY, 0);
  pb.add("chrome", pin);
  // connecting rod (I-beam outline)
  const rod = new THREE.Shape();
  const len = pinY - crankPin[1];
  rod.moveTo(-0.016, 0);
  rod.absarc(0, 0, 0.032, Math.PI, Math.PI * 2, false);
  rod.lineTo(0.032, 0.012);
  rod.quadraticCurveTo(0.013, 0.04, 0.011, len - 0.022);
  rod.absarc(0, len, 0.016, -Math.PI * 0.3, Math.PI * 1.3, false);
  rod.lineTo(-0.011, len - 0.022);
  rod.quadraticCurveTo(-0.013, 0.04, -0.032, 0.012);
  rod.lineTo(-0.032, 0);
  rod.holes.push(circlePath(0.0105, 0, len, 20, true));
  rod.holes.push(circlePath(0.024, 0, 0, 32, true));
  const rodG = extrude(rod, 0.021, 0.002, 16);
  const ang = Math.atan2(-(crankPin[0] - 0), pinY - crankPin[1]);
  rodG.rotateZ(ang);
  rodG.translate(crankPin[0], crankPin[1], 0);
  pb.add("steel", rodG);
  // big-end cap bolts
  for (const s of [-1, 1]) {
    const b = cylY(0.0045, 0.03, 8);
    b.translate(crankPin[0] + s * 0.024, crankPin[1] - 0.012, 0);
    pb.add("steelDark", b);
  }
  return pb.build();
};

export const crankshaft: Builder = (p) => {
  const pb = new PartBuilder();
  const cyl = arr(p, "cyl");
  const throws = [0, 180, 180, 0];
  for (const z of [-0.184, -0.092, 0, 0.092, 0.184]) {
    const j = cylZ(0.026, 0.022, 32);
    j.translate(0, 0, z);
    pb.add("chrome", j);
  }
  cyl.forEach((z, i) => {
    const a = (throws[i] * Math.PI) / 180;
    const px = STROKE_R * Math.sin(a);
    const py = STROKE_R * Math.cos(a);
    const pin = cylZ(0.022, 0.022, 28);
    pin.translate(px, py, z);
    pb.add("chrome", pin);
    for (const dz of [-0.023, 0.023]) {
      const web = new THREE.Shape();
      web.absarc(0, STROKE_R, 0.03, 0, Math.PI, false);
      web.lineTo(-0.035, 0);
      web.absarc(0, 0, 0.062, Math.PI, Math.PI * 2, false);
      web.lineTo(0.03, STROKE_R);
      const g = extrude(web, 0.016, 0.002, 20);
      g.rotateZ(-a);
      g.translate(0, 0, z + dz);
      pb.add("steel", g);
    }
  });
  const snout = cylZ(0.018, 0.08, 20);
  snout.translate(0, 0, 0.235);
  pb.add("steel", snout);
  const spr = gear(0.03, 0.01, 22);
  spr.translate(0, 0, 0.255);
  pb.add("steelDark", spr);
  const flange = cylZ(0.04, 0.012, 32);
  flange.translate(0, 0, -0.215);
  pb.add("steel", flange);
  const flex = extrude(
    (() => {
      const s = new THREE.Shape();
      s.absarc(0, 0, 0.13, 0, Math.PI * 2, false);
      s.holes.push(circlePath(0.03, 0, 0, 24, true));
      return s;
    })(),
    0.006,
    0.001,
    64,
  );
  flex.translate(0, 0, -0.232);
  pb.add("steelDark", flex);
  const ring = gear(0.135, 0.008, 96);
  ring.translate(0, 0, -0.232);
  pb.add("steel", ring);
  return pb.build();
};

export const oilPan: Builder = () => {
  const pb = new PartBuilder();
  const upper = rbox(0.31, 0.05, 0.47, 0.012);
  upper.translate(0, -0.02, 0);
  pb.add("aluCast", upper);
  const sump = rbox(0.24, 0.11, 0.28, 0.03, 4);
  sump.translate(-0.02, -0.085, -0.06);
  pb.add("steelDark", sump);
  const plug = cylY(0.009, 0.012, 6);
  plug.translate(-0.02, -0.145, -0.1);
  pb.add("steel", plug);
  const fins: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const f = rbox(0.004, 0.035, 0.24, 0.001);
    f.translate(-0.12 + i * 0.04, -0.06, -0.06);
    fins.push(f);
  }
  pb.add("steelDark", merge(fins));
  return pb.build();
};

export const timingChain: Builder = () => {
  const pb = new PartBuilder();
  const camY = 0.345;
  const pts: V3[] = [
    [0, -0.034, 0.012],
    [0.034, 0, 0.012],
    [0.07, camY - 0.07, 0.012],
    [0.094, camY, 0.012],
    [0.068, camY + 0.044, 0.012],
    [0, camY + 0.03, 0.012],
    [-0.068, camY + 0.044, 0.012],
    [-0.094, camY, 0.012],
    [-0.06, 0.12, 0.012],
    [-0.034, 0, 0.012],
  ];
  const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)), true, "centripetal");
  const links: THREE.BufferGeometry[] = [];
  const n = 150;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const P = curve.getPointAt(t);
    const T = curve.getTangentAt(t);
    const l = rbox(0.0085, 0.0045, 0.011, 0.0015, 1);
    l.rotateZ(Math.atan2(T.y, T.x));
    l.translate(P.x, P.y, P.z);
    links.push(l);
  }
  pb.add("steelDark", merge(links));
  for (const x of [-0.045, 0.045]) {
    const g = gear(0.045, 0.007, 32);
    g.translate(x, camY, 0.012);
    pb.add("steel", g);
  }
  const cg = gear(0.03, 0.007, 22);
  cg.translate(0, 0, 0.012);
  pb.add("steel", cg);
  // guides
  for (const s of [-1, 1]) {
    const guide = rbox(0.012, 0.26, 0.016, 0.005);
    guide.rotateZ(s * -0.18);
    guide.translate(s * 0.07, 0.17, 0.012);
    pb.add("redPlastic", guide);
  }
  const ten = cylX(0.012, 0.05, 16);
  ten.translate(-0.1, 0.12, 0.012);
  pb.add("steel", ten);
  return pb.build();
};

export const oilFilter: Builder = () => {
  const pb = new PartBuilder();
  const prof: [number, number][] = [[0, 0.085]];
  for (let i = 0; i <= 20; i++) prof.push([0.036 + (i % 2 ? 0.0015 : 0), 0.08 - i * 0.0035]);
  prof.push([0.034, 0.0], [0.03, -0.003], [0, -0.003]);
  const can = lathe(prof, 40);
  can.rotateZ(-1.2);
  pb.add("bluePlastic", can);
  const base = cylY(0.032, 0.012, 32);
  base.rotateZ(-1.2);
  pb.add("aluCast", base);
  return pb.build();
};

/** Serpentine belt wrapped around the outer hull of the pulleys. */
export const belt: Builder = (p) => {
  const pb = new PartBuilder();
  const a = arr(p, "pulleys");
  const pul: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i + 2 < a.length; i += 3) pul.push({ x: a[i], y: a[i + 1], r: a[i + 2] });
  // hull of centers (gift wrapping)
  const hull: number[] = [];
  let start = 0;
  pul.forEach((q, i) => {
    if (q.x < pul[start].x) start = i;
  });
  let cur = start;
  do {
    hull.push(cur);
    let nxt = (cur + 1) % pul.length;
    for (let i = 0; i < pul.length; i++) {
      const cross = (pul[nxt].x - pul[cur].x) * (pul[i].y - pul[cur].y) - (pul[nxt].y - pul[cur].y) * (pul[i].x - pul[cur].x);
      if (cross < 0) nxt = i;
    }
    cur = nxt;
  } while (cur !== start && hull.length <= pul.length);
  // walk hull counter-clockwise; outside is to the right of travel
  const path: { x: number; y: number; nx: number; ny: number }[] = [];
  const H = hull.length;
  for (let k = 0; k < H; k++) {
    const A = pul[hull[(k - 1 + H) % H]];
    const B = pul[hull[k]];
    const C = pul[hull[(k + 1) % H]];
    const nIn = rightNormal(A, B);
    const nOut = rightNormal(B, C);
    const a0 = Math.atan2(nIn.y, nIn.x);
    let a1 = Math.atan2(nOut.y, nOut.x);
    while (a1 < a0) a1 += Math.PI * 2;
    if (a1 - a0 > Math.PI * 2 - 1e-3) a1 = a0;
    const steps = Math.max(2, Math.ceil((a1 - a0) / 0.08));
    for (let i = 0; i <= steps; i++) {
      const t = a0 + ((a1 - a0) * i) / steps;
      path.push({ x: B.x + Math.cos(t) * (B.r + 0.003), y: B.y + Math.sin(t) * (B.r + 0.003), nx: Math.cos(t), ny: Math.sin(t) });
    }
  }
  if (path.length > 2) {
    const w = 0.022;
    const th = 0.0045;
    const pos: number[] = [];
    const idx: number[] = [];
    path.forEach((q) => {
      for (const [o, z] of [[0, -w / 2], [0, w / 2], [th, w / 2], [th, -w / 2]] as const) pos.push(q.x + q.nx * o, q.y + q.ny * o, z);
    });
    const n = path.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      for (let f = 0; f < 4; f++) {
        const a0 = i * 4 + f;
        const a1 = i * 4 + ((f + 1) % 4);
        const b0 = j * 4 + f;
        const b1 = j * 4 + ((f + 1) % 4);
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    pb.add("rubber", g);
  }
  // crank damper pulley + A/C pulley
  const crank = pul[0];
  const cp = pulley(crank.r, 0.026, 6);
  cp.translate(crank.x, crank.y, 0);
  const damper = cylZ(crank.r - 0.012, 0.012, 48);
  damper.translate(crank.x, crank.y, 0.016);
  pb.add("steelDark", cp, damper);
  const bolt = cylZ(0.012, 0.012, 6);
  bolt.translate(crank.x, crank.y, 0.026);
  pb.add("steel", bolt);
  if (pul[1]) {
    const ac = pulley(pul[1].r, 0.024, 6);
    ac.translate(pul[1].x, pul[1].y, 0);
    const comp = cylZ(0.055, 0.15, 36);
    comp.translate(pul[1].x, pul[1].y, -0.09);
    pb.add("steel", ac);
    pb.add("aluCast", comp);
  }
  return pb.build();
};

function rightNormal(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dy / l, y: -dx / l };
}

export const tensioner: Builder = () => {
  const pb = new PartBuilder();
  const arm = rbox(0.09, 0.03, 0.014, 0.006);
  arm.rotateZ(0.6);
  arm.translate(-0.03, -0.02, -0.01);
  pb.add("aluCast", arm);
  const idler = latheZ([[0.012, -0.013], [0.036, -0.013], [0.04, -0.011], [0.04, 0.011], [0.036, 0.013], [0.012, 0.013]], 48);
  idler.translate(0, 0, 0.015);
  pb.add("steel", idler);
  const spring = cylZ(0.03, 0.04, 28);
  spring.translate(-0.06, -0.045, -0.02);
  pb.add("aluCast", spring);
  return pb.build();
};

export const alternator: Builder = () => {
  const pb = new PartBuilder();
  const body = latheZ([[0, -0.08], [0.058, -0.078], [0.066, -0.06], [0.066, 0.05], [0.06, 0.07], [0.02, 0.072]], 48);
  pb.add("aluCast", body);
  const vents: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const v = new THREE.BoxGeometry(0.006, 0.02, 0.05);
    v.translate(Math.cos(a) * 0.066, Math.sin(a) * 0.066, 0.01);
    v.rotateZ(0);
    vents.push(tx(v, {}));
  }
  pb.add("castDark", merge(vents));
  const pu = pulley(0.028, 0.024, 6);
  pu.translate(0, 0, 0.1);
  const shaft = cylZ(0.009, 0.04, 12);
  shaft.translate(0, 0, 0.08);
  pb.add("steel", pu, shaft);
  const term = cylZ(0.008, 0.02, 6);
  term.translate(0.03, 0.03, -0.085);
  pb.add("copper", term);
  const cap = rbox(0.05, 0.04, 0.012, 0.005);
  cap.translate(0, 0, -0.084);
  pb.add("plastic", cap);
  for (const s of [-1, 1]) {
    const ear = rbox(0.03, 0.025, 0.05, 0.006);
    ear.translate(s * 0.07, -0.02, s * 0.03);
    pb.add("aluCast", ear);
  }
  return pb.build();
};

export const starter: Builder = () => {
  const pb = new PartBuilder();
  const motor = cylZ(0.041, 0.13, 36);
  motor.translate(0, 0, -0.04);
  pb.add("steelDark", motor);
  const sol = cylZ(0.026, 0.09, 28);
  sol.translate(0, 0.058, 0.0);
  pb.add("steel", sol);
  const nose = latheZ([[0.042, 0.025], [0.048, 0.04], [0.035, 0.09], [0.02, 0.1]], 32);
  pb.add("aluCast", nose);
  const term = cylZ(0.007, 0.02, 6);
  term.translate(0.02, 0.07, -0.05);
  pb.add("copper", term);
  return pb.build();
};

export const mounts: Builder = (p) => {
  const pb = new PartBuilder();
  const a = arr(p, "points");
  for (let i = 0; i + 2 < a.length; i += 3) {
    const q: V3 = [a[i], a[i + 1], a[i + 2]];
    const rubber = cylY(0.035, 0.05, 28);
    rubber.translate(...q);
    const bracket = rbox(0.09, 0.016, 0.09, 0.005);
    bracket.translate(q[0], q[1] + 0.035, q[2]);
    const base = rbox(0.11, 0.016, 0.07, 0.005);
    base.translate(q[0], q[1] - 0.033, q[2]);
    pb.add("rubber", rubber);
    pb.add("steelDark", bracket, base);
  }
  return pb.build();
};

export const waterPump: Builder = (p) => {
  const pb = new PartBuilder();
  if (bool(p, "electric", false)) {
    const body = cylX(0.04, 0.085, 36);
    const motor = cylX(0.033, 0.06, 32);
    motor.translate(0.07, 0, 0);
    const conn = rbox(0.025, 0.02, 0.03, 0.004);
    conn.translate(0.08, 0.04, 0);
    const outlet = cylY(0.014, 0.05, 16);
    outlet.translate(-0.02, 0.05, 0);
    pb.add("aluCast", body, outlet);
    pb.add("plastic", motor, conn);
  } else {
    const body = rbox(0.1, 0.1, 0.05, 0.015);
    pb.add("aluCast", body);
    const pu = pulley(0.032, 0.024, 6);
    pu.translate(0, 0, 0.055);
    pb.add("steel", pu);
    const hubG = cylZ(0.018, 0.03, 16);
    hubG.translate(0, 0, 0.03);
    pb.add("steel", hubG);
  }
  return pb.build();
};

export const thermostat: Builder = () => {
  const pb = new PartBuilder();
  const housing = rbox(0.06, 0.06, 0.05, 0.012);
  const neck = cylX(0.017, 0.07, 20);
  neck.translate(0.05, 0.01, 0);
  const lip = torus(0.019, 0.003, 6, 24);
  lip.rotateY(Math.PI / 2);
  lip.translate(0.08, 0.01, 0);
  pb.add("aluCast", housing, neck, lip);
  const sensor = cylY(0.006, 0.025, 6);
  sensor.translate(-0.01, 0.04, 0.01);
  pb.add("copper", sensor);
  return pb.build();
};

export const intakeManifold: Builder = (p) => {
  const pb = new PartBuilder();
  const cyl = arr(p, "cyl");
  const plenum = rbox(0.1, 0.11, 0.44, 0.04, 4);
  plenum.translate(0.12, 0.045, -0.01);
  pb.add("plastic", plenum);
  const runners: THREE.BufferGeometry[] = [];
  for (const z of cyl) {
    runners.push(tube([[0.1, 0.09, z], [0.05, 0.1, z], [0.005, 0.055, z], [-0.005, -0.01, z]], 0.021, { radial: 16 }));
  }
  pb.add("plastic", merge(runners));
  const flange = rbox(0.012, 0.05, 0.45, 0.005);
  flange.translate(-0.006, -0.01, 0);
  pb.add("plastic", flange);
  const neck = cylinderBetween([0.12, 0.04, -0.2], [0.135, 0.035, -0.225], 0.036, 24);
  pb.add("plastic", neck);
  // sensor + vacuum port
  const map = rbox(0.025, 0.018, 0.03, 0.004);
  map.translate(0.16, 0.08, 0.14);
  pb.add("plasticGray", map);
  return pb.build();
};

export const throttleBody: Builder = () => {
  const pb = new PartBuilder();
  const body = rbox(0.08, 0.085, 0.045, 0.01);
  pb.add("aluCast", body);
  const bore = torus(0.031, 0.004, 8, 32);
  bore.translate(0, 0, -0.023);
  pb.add("alu", bore);
  const plate = cylZ(0.029, 0.002, 32);
  plate.rotateY(0.3);
  pb.add("steel", plate);
  const motor = rbox(0.03, 0.06, 0.05, 0.008);
  motor.translate(0.05, 0.0, 0.005);
  pb.add("plastic", motor);
  const conn = rbox(0.015, 0.02, 0.02, 0.003);
  conn.translate(0.07, 0.03, 0);
  pb.add("plasticGray", conn);
  return pb.build();
};

export const fuelRail: Builder = (p) => {
  const pb = new PartBuilder();
  const rail = cylZ(0.011, 0.46, 18);
  pb.add("steel", rail);
  for (const z of arr(p, "cyl")) {
    const inj = cylinderBetween([0, -0.005, z], [-0.04, -0.045, z], 0.0085, 14);
    const cup = cylY(0.013, 0.015, 14);
    cup.translate(0, -0.008, z);
    const conn = rbox(0.018, 0.016, 0.014, 0.003);
    conn.translate(0.012, -0.02, z);
    pb.add("steel", inj, cup);
    pb.add("plastic", conn);
  }
  const hpp = cylY(0.025, 0.06, 24);
  hpp.translate(-0.02, 0.02, -0.23);
  pb.add("aluCast", hpp);
  return pb.build();
};

export const exhaustManifold: Builder = (p) => {
  const pb = new PartBuilder();
  const cyl = arr(p, "cyl");
  const turbo = bool(p, "turbo", false);
  const flange = rbox(0.014, 0.045, 0.44, 0.005);
  flange.translate(0.012, 0.0, 0);
  pb.add("castDark", flange);
  const prim: THREE.BufferGeometry[] = [];
  if (turbo) {
    for (const z of cyl) prim.push(tube([[0.008, 0, z], [-0.03, -0.02, z * 0.75], [-0.07, -0.07, z * 0.3 - 0.01], [-0.09, -0.1, -0.02]], 0.017, { radial: 14 }));
    pb.add("castDark", merge(prim));
    const shield = new THREE.CylinderGeometry(0.06, 0.06, 0.32, 24, 1, true, Math.PI * 0.9, Math.PI * 0.8);
    shield.rotateX(Math.PI / 2);
    shield.translate(-0.04, -0.03, 0);
    pb.add("heatShield", shield);
    return pb.build();
  }
  for (const z of cyl) prim.push(tube([[0.008, 0, z], [-0.04, -0.02, z * 0.95], [-0.075, -0.12, z * 0.5], [-0.088, -0.25, -0.02]], 0.018, { radial: 14 }));
  pb.add("castDark", merge(prim));
  const coll = cylinderBetween([-0.088, -0.22, -0.02], [-0.09, -0.29, -0.02], 0.03, 20);
  pb.add("castDark", coll);
  const shield = new THREE.CylinderGeometry(0.07, 0.07, 0.42, 28, 1, true, Math.PI * 0.95, Math.PI * 0.75);
  shield.rotateX(Math.PI / 2);
  shield.translate(-0.01, -0.06, 0);
  pb.add("heatShield", shield);
  return pb.build();
};

export const cvt: Builder = (p) => {
  const pb = new PartBuilder();
  const awd = bool(p, "awd", false);
  const bell = latheZ([[0.17, 0.0], [0.165, -0.03], [0.15, -0.09], [0.12, -0.1]], 64);
  pb.add("aluCast", bell);
  const flange = latheZ([[0.13, 0.0], [0.178, 0.0], [0.178, -0.012], [0.13, -0.012]].reverse() as [number, number][], 64);
  pb.add("aluCast", flange);
  const caseG = rbox(0.3, 0.29, 0.2, 0.05, 4);
  caseG.translate(-0.01, 0.02, -0.18);
  pb.add("aluCast", caseG);
  const pulleyCase = cylZ(0.12, 0.08, 48);
  pulleyCase.translate(0.04, 0.08, -0.3);
  const pulleyCase2 = cylZ(0.1, 0.08, 48);
  pulleyCase2.translate(-0.08, -0.02, -0.3);
  pb.add("aluCast", pulleyCase, pulleyCase2);
  // differential lobe on the axle line
  const diff = cylZ(0.085, 0.16, 40);
  diff.translate(-0.15, -0.07, -0.13);
  pb.add("aluCast", diff);
  for (let i = 0; i < 6; i++) {
    const rib = rbox(0.01, 0.24, 0.012, 0.003);
    rib.translate(-0.12 + i * 0.05, 0.02, -0.07);
    pb.add("aluCast", rib);
  }
  const pan = rbox(0.24, 0.02, 0.16, 0.006);
  pan.translate(-0.02, -0.13, -0.18);
  pb.add("steelDark", pan);
  // cooler lines
  pb.add("steel", tube([[0.1, 0.1, -0.28], [0.18, 0.12, -0.22], [0.25, 0.08, -0.1]], 0.006), tube([[0.1, 0.06, -0.28], [0.18, 0.06, -0.22], [0.25, 0.04, -0.1]], 0.006));
  const breather = cylY(0.006, 0.05, 8);
  breather.translate(0.05, 0.18, -0.2);
  pb.add("rubber", breather);
  if (awd) {
    const out = cylX(0.04, 0.06, 20);
    out.translate(-0.17, -0.07, -0.02);
    pb.add("aluCast", out);
  }
  return pb.build();
};

export const turbo: Builder = () => {
  const pb = new PartBuilder();
  // turbine (hot) side at +z, compressor (cold) side at -z; shaft along z
  const volute = (zc: number, r0: number, r1: number, t0: number, t1: number) => {
    const pts: V3[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 1.7 + 0.3;
      const rr = r0 + (r1 - r0) * (i / 24);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr, zc]);
    }
    return taperTube(pts, (t) => t0 + (t1 - t0) * t, 64, 16);
  };
  pb.add("castDark", volute(0.045, 0.05, 0.07, 0.016, 0.033));
  const tcore = cylZ(0.045, 0.05, 32);
  tcore.translate(0, 0, 0.045);
  pb.add("castDark", tcore);
  const tout = cylinderBetween([-0.03, -0.04, 0.07], [-0.06, -0.15, 0.08], 0.03, 24);
  pb.add("castDark", tout);
  pb.add("aluCast", volute(-0.065, 0.048, 0.065, 0.014, 0.03));
  const ccore = cylZ(0.05, 0.045, 32);
  ccore.translate(0, 0, -0.065);
  pb.add("aluCast", ccore);
  const inlet = latheZ([[0.034, -0.085], [0.034, -0.13], [0.038, -0.135], [0.038, -0.14]], 32);
  pb.add("aluCast", inlet);
  const wheel = latheZ([[0.004, -0.088], [0.026, -0.09], [0.012, -0.11]], 24);
  pb.add("aluBrushed", wheel);
  const chra = cylZ(0.03, 0.05, 28);
  chra.translate(0, 0, -0.012);
  pb.add("steel", chra);
  const outlet = cylinderBetween([0.04, 0.06, -0.07], [0.01, 0.03, -0.11], 0.024, 20);
  pb.add("aluCast", outlet);
  // wastegate actuator
  const can = cylX(0.03, 0.04, 28);
  can.translate(0.07, -0.02, -0.06);
  pb.add("steel", can);
  pb.add("steel", cylinderBetween([0.06, -0.02, -0.05], [0.04, -0.04, 0.05], 0.003, 6));
  // oil + coolant lines
  pb.add("steel", tube([[0, 0.03, -0.012], [0.02, 0.1, -0.01], [0.06, 0.16, 0.02]], 0.004));
  pb.add("steel", tube([[0, -0.03, -0.012], [0.03, -0.1, -0.02], [0.08, -0.12, -0.02]], 0.0055));
  return pb.build();
};

export const ENGINE_HELPERS = { pulley, gear, latheX };
void torus;
