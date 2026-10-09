import * as THREE from "three";
import { getCar } from "@/lib/cars";
import type { CarId, PartInstance } from "@/lib/cars/types";
import { createBodySurface, type BodySurface } from "./body";
import { BUILDERS } from "./builders";
import type { MeshSpec } from "./geom";

export interface BuiltPart {
  part: PartInstance;
  meshes: MeshSpec[];
  /** Bounding box in car space at rest (assembled) */
  box: THREE.Box3;
  center: THREE.Vector3;
  triangles: number;
}

export interface BuiltCar {
  id: CarId;
  parts: BuiltPart[];
  byId: Map<string, BuiltPart>;
  surface: BodySurface;
  triangles: number;
}

const cache = new Map<CarId, BuiltCar>();
type Progress = (done: number, total: number) => void;
const pending = new Map<CarId, { promise: Promise<BuiltCar>; listeners: Set<Progress> }>();

export function partMatrix(part: PartInstance): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0])));
  m.compose(new THREE.Vector3(...part.position), q, new THREE.Vector3(1, 1, part.mirror ? -1 : 1));
  return m;
}

export function buildPart(part: PartInstance, surface: BodySurface): BuiltPart {
  const builder = BUILDERS[part.build.kind];
  if (!builder) throw new Error(`No builder for kind "${part.build.kind}" (${part.id})`);
  const meshes = builder(part.build.params ?? {}, { spec: surface.spec, surface, part });
  const box = new THREE.Box3();
  const m = partMatrix(part);
  let triangles = 0;
  for (const ms of meshes) {
    ms.geometry.computeBoundingBox();
    ms.geometry.computeBoundingSphere();
    const b = ms.geometry.boundingBox!.clone().applyMatrix4(m);
    box.union(b);
    const idx = ms.geometry.index;
    triangles += (idx ? idx.count : ms.geometry.attributes.position.count) / 3;
  }
  return { part, meshes, box, center: box.getCenter(new THREE.Vector3()), triangles };
}

/** Build every part of a car, yielding between parts so the UI stays responsive. */
export function buildCar(id: CarId, onProgress?: Progress): Promise<BuiltCar> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  const running = pending.get(id);
  if (running) {
    if (onProgress) running.listeners.add(onProgress);
    return running.promise;
  }
  const listeners = new Set<Progress>(onProgress ? [onProgress] : []);
  // Register before starting so Strict Mode and rapid car switches share
  // the same geometry work, including while that work yields to the UI.
  const promise = Promise.resolve()
    .then(() => assembleCar(id, (done, total) => listeners.forEach((notify) => notify(done, total))))
    .finally(() => pending.delete(id));
  pending.set(id, { promise, listeners });
  return promise;
}

async function assembleCar(id: CarId, onProgress: Progress): Promise<BuiltCar> {
  const model = getCar(id);
  const surface = createBodySurface(model.spec);
  const parts: BuiltPart[] = [];
  onProgress(0, model.parts.length);
  let last = performance.now();
  for (let i = 0; i < model.parts.length; i++) {
    parts.push(buildPart(model.parts[i], surface));
    if (performance.now() - last > 24) {
      onProgress(i + 1, model.parts.length);
      await new Promise((r) => setTimeout(r, 0));
      last = performance.now();
    }
  }
  onProgress(model.parts.length, model.parts.length);
  const built: BuiltCar = {
    id,
    parts,
    byId: new Map(parts.map((p) => [p.part.id, p])),
    surface,
    triangles: parts.reduce((a, p) => a + p.triangles, 0),
  };
  cache.set(id, built);
  return built;
}
