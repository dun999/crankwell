import * as THREE from "three";
import { buildPanel, grilleGeometry, mirrorGeometry, shellStructure, type PanelName, type Side } from "../body";
import { PartBuilder, extrude, rbox, tube, tx } from "../geom";
import { bool, num, str, type Builder } from "./types";

export const bodyShell: Builder = (_p, ctx) => shellStructure(ctx.surface);

export const panel: Builder = (p, ctx) => buildPanel(ctx.surface, str(p, "panel", "hood") as PanelName, (num(p, "side", 1) as Side) ?? 1);

export const grille: Builder = (_p, ctx) => grilleGeometry(ctx.surface);

export const mirror: Builder = (p, ctx) => mirrorGeometry(ctx.surface, num(p, "side", 1) as Side);

export const dashboard: Builder = (p) => {
  const W = num(p, "width", 1.5);
  const suv = bool(p, "suv", false);
  const pb = new PartBuilder();
  const s = new THREE.Shape();
  s.moveTo(0.24, 0.035);
  s.quadraticCurveTo(0.05, 0.08, -0.09, 0.06);
  s.quadraticCurveTo(-0.17, 0.05, -0.18, -0.02);
  s.quadraticCurveTo(-0.17, -0.1, -0.1, -0.14);
  s.lineTo(-0.04, -0.24);
  s.lineTo(0.22, -0.26);
  s.lineTo(0.26, -0.05);
  s.lineTo(0.24, 0.035);
  const dash = extrude(s, W, 0.02, 24);
  pb.add("dash", dash);
  // instrument binnacle (driver side, -z)
  const bin = rbox(0.14, 0.09, 0.36, 0.04);
  tx(bin, { pos: [-0.06, 0.08, -0.37], rot: [0, 0, 0.2] });
  pb.add("dash", bin);
  const cluster = new THREE.PlaneGeometry(0.3, 0.07);
  cluster.rotateY(-Math.PI / 2);
  cluster.rotateZ(0.25);
  cluster.translate(-0.115, 0.075, -0.37);
  pb.add("blackGloss", cluster);
  // floating touchscreen
  const screen = rbox(0.012, suv ? 0.13 : 0.11, suv ? 0.26 : 0.22, 0.008);
  tx(screen, { pos: [-0.07, 0.13, 0.0], rot: [0, 0, 0.18] });
  pb.add("blackGloss", screen);
  // vents
  for (const z of [-0.6, -0.12, 0.12, 0.6]) {
    const v = rbox(0.01, 0.035, 0.1, 0.006);
    v.translate(-0.165, -0.02, z);
    pb.add("chrome", v);
  }
  // center console down to the floor
  const console = rbox(0.55, 0.2, 0.2, 0.04);
  console.translate(-0.3, -0.33, 0);
  pb.add("dash", console);
  const shifter = tube([[-0.3, -0.22, 0], [-0.32, -0.15, 0]], 0.012);
  pb.add("chrome", shifter);
  return pb.build();
};

export const seat: Builder = (p) => {
  const suv = bool(p, "suv", false);
  const mat = suv ? "leather" : "fabric";
  const pb = new PartBuilder();
  const cushion = rbox(0.5, 0.11, 0.5, 0.045, 4);
  cushion.translate(0, 0.06, 0);
  pb.add(mat, cushion);
  for (const s of [-1, 1]) {
    const bol = rbox(0.42, 0.07, 0.07, 0.03, 3);
    bol.translate(0.0, 0.12, s * 0.22);
    pb.add(mat, bol);
  }
  const back = rbox(0.11, 0.62, 0.48, 0.05, 4);
  tx(back, { pos: [-0.27, 0.4, 0], rot: [0, 0, 0.22] });
  pb.add(mat, back);
  for (const s of [-1, 1]) {
    const bol = rbox(0.1, 0.48, 0.07, 0.03, 3);
    tx(bol, { pos: [-0.25, 0.38, s * 0.22], rot: [0, 0, 0.22] });
    pb.add(mat, bol);
  }
  const head = rbox(0.08, 0.16, 0.26, 0.04, 3);
  tx(head, { pos: [-0.36, 0.82, 0], rot: [0, 0, 0.1] });
  pb.add(mat, head);
  for (const s of [-1, 1]) {
    const post = new THREE.CylinderGeometry(0.005, 0.005, 0.08, 8);
    post.translate(-0.34, 0.73, s * 0.07);
    pb.add("chrome", post);
    const rail = rbox(0.5, 0.02, 0.025, 0.004);
    rail.translate(0, -0.005, s * 0.18);
    pb.add("steelDark", rail);
  }
  return pb.build();
};

export const rearSeat: Builder = (p) => {
  const W = num(p, "width", 1.3);
  const suv = bool(p, "suv", false);
  const mat = suv ? "leather" : "fabric";
  const pb = new PartBuilder();
  const cushion = rbox(0.48, 0.12, W, 0.05, 4);
  cushion.translate(0.05, 0.05, 0);
  pb.add(mat, cushion);
  const back = rbox(0.12, 0.6, W, 0.05, 4);
  tx(back, { pos: [-0.22, 0.38, 0], rot: [0, 0, 0.26] });
  pb.add(mat, back);
  for (const z of [-W / 3, 0, W / 3]) {
    const head = rbox(0.07, 0.13, 0.24, 0.035, 3);
    tx(head, { pos: [-0.31, 0.75, z], rot: [0, 0, 0.18] });
    pb.add(mat, head);
  }
  return pb.build();
};
