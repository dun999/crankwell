import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { MatKey } from "./materials";

export type V3 = [number, number, number];
export interface MeshSpec {
  geometry: THREE.BufferGeometry;
  material: MatKey;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export const v3 = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);

/** Apply translate/rotate(XYZ euler)/scale to a geometry in place and return it. */
export function tx(
  g: THREE.BufferGeometry,
  o: { pos?: V3; rot?: V3; scale?: V3 | number } = {},
): THREE.BufferGeometry {
  const s = o.scale === undefined ? [1, 1, 1] : typeof o.scale === "number" ? [o.scale, o.scale, o.scale] : o.scale;
  _e.set(...(o.rot ?? [0, 0, 0]));
  _q.setFromEuler(_e);
  _m.compose(v3(o.pos ?? [0, 0, 0]), _q, new THREE.Vector3(s[0], s[1], s[2]));
  g.applyMatrix4(_m);
  return g;
}

/** Orient a geometry built along +Y so it spans from a to b. */
export function alignBetween(g: THREE.BufferGeometry, a: V3, b: V3): THREE.BufferGeometry {
  const A = v3(a);
  const B = v3(b);
  const dir = B.clone().sub(A);
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  _m.compose(A, _q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

export function cylinderBetween(a: V3, b: V3, r: number, seg = 16, rTop?: number): THREE.BufferGeometry {
  const len = v3(a).distanceTo(v3(b));
  const g = new THREE.CylinderGeometry(rTop ?? r, r, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  return alignBetween(g, a, b);
}

/** Cylinder around the Z axis (wheel-style), centered at z = 0. */
export function cylZ(r: number, depth: number, seg = 32, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, depth, seg, 1, open);
  g.rotateX(Math.PI / 2);
  return g;
}
export function cylX(r: number, depth: number, seg = 32): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, depth, seg);
  g.rotateZ(Math.PI / 2);
  return g;
}
export function cylY(r: number, h: number, seg = 32, rTop?: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop ?? r, r, h, seg);
}

export function rbox(w: number, h: number, d: number, r = 0.01, seg = 3): THREE.BufferGeometry {
  const rr = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  return new RoundedBoxGeometry(w, h, d, seg, rr);
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/** Lathe around Y from [radius, y] profile points. */
export function lathe(profile: [number, number][], seg = 48, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)),
    seg,
    phiStart,
    phiLength,
  );
}

export function tube(points: V3[], r: number, opts: { seg?: number; radial?: number; closed?: boolean; tension?: number } = {}) {
  const pts = points.map(v3);
  const curve = new THREE.CatmullRomCurve3(pts, opts.closed ?? false, "catmullrom", opts.tension ?? 0.35);
  const len = curve.getLength();
  const seg = opts.seg ?? Math.max(8, Math.ceil(len / 0.012));
  return new THREE.TubeGeometry(curve, seg, r, opts.radial ?? 12, opts.closed ?? false);
}

/** Tube whose radius varies along its length (turbo volutes, hoses with bulges). */
export function taperTube(points: V3[], radii: (t: number) => number, seg = 64, radial = 16, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map(v3), closed, "catmullrom", 0.4);
  const frames = curve.computeFrenetFrames(seg, closed);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const P = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = radii(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const nx = Math.cos(a) * N.x + Math.sin(a) * B.x;
      const ny = Math.cos(a) * N.y + Math.sin(a) * B.y;
      const nz = Math.cos(a) * N.z + Math.sin(a) * B.z;
      pos.push(P.x + nx * r, P.y + ny * r, P.z + nz * r);
      nor.push(nx, ny, nz);
      uv.push(t, j / radial);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Coil spring along +Y. */
export function helix(R: number, wire: number, height: number, turns: number, seg = 220) {
  const pts: V3[] = [];
  // Closed, ground ends: the first and last ¾ turn have almost no pitch.
  const te = Math.min(0.2, 0.75 / turns);
  const endH = wire * 2.2;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = t * turns * Math.PI * 2;
    const y =
      t < te
        ? (t / te) * endH
        : t > 1 - te
          ? height - ((1 - t) / te) * endH
          : endH + ((t - te) / (1 - 2 * te)) * (height - 2 * endH);
    pts.push([Math.cos(a) * R, y + wire, Math.sin(a) * R]);
  }
  const curve = new THREE.CatmullRomCurve3(pts.map(v3));
  return new THREE.TubeGeometry(curve, seg * 2, wire, 10, false);
}

export function torus(R: number, r: number, radial = 12, tubular = 48, arc = Math.PI * 2) {
  return new THREE.TorusGeometry(R, r, radial, tubular, arc);
}

/** Extrude a 2D shape along +Z by depth (centered unless `from0`), with optional bevel. */
export function extrude(shape: THREE.Shape, depth: number, bevel = 0, curveSegments = 24, from0 = false) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.9,
    bevelSegments: bevel > 0 ? 3 : 0,
    curveSegments,
  });
  if (!from0) g.translate(0, 0, -(depth - 2 * bevel) / 2);
  else g.translate(0, 0, bevel);
  return g;
}

export function roundedRectShape(w: number, h: number, r: number, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x = cx - w / 2;
  const y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function circlePath(r: number, cx = 0, cy = 0, seg = 32, clockwise = false) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, clockwise);
  void seg;
  return p;
}

export function circleShape(r: number, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  s.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return s;
}

/** Annulus (ring) shape with optional extra circular holes. */
export function ringShape(rOut: number, rIn: number, holes: { x: number; y: number; r: number }[] = []) {
  const s = circleShape(rOut);
  if (rIn > 0) s.holes.push(circlePath(rIn, 0, 0, 48, true));
  for (const h of holes) s.holes.push(circlePath(h.r, h.x, h.y, 12, true));
  return s;
}

/** Annular sector shape (for calipers, pads, fan blades). Angles in radians. */
export function sectorShape(r0: number, r1: number, a0: number, a1: number) {
  const s = new THREE.Shape();
  s.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
  s.absarc(0, 0, r1, a0, a1, false);
  s.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
  s.absarc(0, 0, r0, a1, a0, true);
  return s;
}

/** Ensure geometries share the attribute set (position, normal, uv) and merge. */
export function merge(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = geoms.filter(Boolean);
  if (list.length === 1) return normalize(list[0]);
  const anyNonIndexed = list.some((g) => !g.index);
  const prepared = list.map((g) => {
    let out = normalize(g);
    if (anyNonIndexed && out.index) out = out.toNonIndexed();
    return out;
  });
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error("mergeGeometries failed");
  return merged;
}

function normalize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const n = g.attributes.position.count;
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  g.morphAttributes = {};
  return g;
}

/** Smooth normals across duplicated seam vertices (for extruded/merged shells). */
export function smooth(g: THREE.BufferGeometry, tol = 1e-4) {
  g.deleteAttribute("normal");
  const m = mergeVertices(g, tol);
  m.computeVertexNormals();
  return m;
}

/** Collect mesh specs, merging by material. */
export class PartBuilder {
  private byMat = new Map<MatKey, THREE.BufferGeometry[]>();
  add(material: MatKey, ...geoms: THREE.BufferGeometry[]) {
    const arr = this.byMat.get(material) ?? [];
    arr.push(...geoms);
    this.byMat.set(material, arr);
    return this;
  }
  build(): MeshSpec[] {
    const out: MeshSpec[] = [];
    for (const [material, geoms] of this.byMat) {
      if (!geoms.length) continue;
      out.push({ material, geometry: merge(geoms) });
    }
    return out;
  }
}
