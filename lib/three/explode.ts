import * as THREE from "three";
import type { Assembly, PartInstance, SystemId } from "@/lib/cars/types";
import { clamp, easeInOut } from "./math";

/** Progress of a part that starts moving at `stage` when the global explode value is `t`. */
export const stageProgress = (t: number, stage: number) => easeInOut(clamp((t - stage * 0.55) / 0.45));

export function explodeOffset(
  part: PartInstance,
  assemblies: Record<string, Assembly>,
  t: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  out.set(0, 0, 0);
  if (t <= 0) return out;
  if (part.assembly) {
    const a = assemblies[part.assembly];
    if (a) {
      const k = stageProgress(t, a.stage);
      out.x += a.offset[0] * k;
      out.y += a.offset[1] * k;
      out.z += a.offset[2] * k;
    }
  }
  const k = stageProgress(t, part.stage);
  out.x += part.explode[0] * k;
  out.y += part.explode[1] * k;
  out.z += part.explode[2] * k;
  return out;
}

export function explodeTarget(system: SystemId, explode: number, systems: SystemId[] | null) {
  return !systems || systems.includes(system) ? explode : 0;
}
