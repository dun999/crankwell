"use client";
import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getCar } from "@/lib/cars";
import { useMediaQuery } from "@/lib/hooks";
import type { BuiltCar } from "@/lib/three/assemble";
import { explodeOffset, explodeTarget } from "@/lib/three/explode";
import { useScene } from "@/lib/store/scene";

const CAR_CENTER = new THREE.Vector3(0, 0.6, 0);
const HOME_POS = new THREE.Vector3(7.3, 2.45, 8.1);
const EXPLODED_POS = new THREE.Vector3(8.6, 5.2, 9.4);
const EXPLODED_TARGET = new THREE.Vector3(0, 1.0, 0);

function clampInset(px: number, height: number) {
  return Math.min(Math.max(0, px), height * 0.35);
}

/** Move camera and target down together so the target sits centered above a bottom inset. */
function liftAboveInset(pos: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3, distance: number, tanFull: number, inset: number, height: number) {
  if (!inset || !height) return;
  const worldPerPx = (2 * distance * tanFull) / height;
  const shift = up.clone().multiplyScalar(-(inset / 2) * worldPerPx);
  pos.add(shift);
  target.add(shift);
}

/**
 * Owns the camera. Focus requests from the store (agent diagnosis, part
 * search, inspector) play a two-phase "motion zoom": ease back to an
 * overview on the side of the target, then dive in and frame the parts.
 */
export function CameraRig({ built, story = false }: { built: BuiltCar | null; story?: boolean }) {
  const ref = useRef<CameraControls>(null);
  const three = useThree();
  const { size, camera } = three;
  const focus = useScene((s) => s.focus);
  const resetNonce = useScene((s) => s.resetNonce);
  const explode = useScene((s) => s.explode);
  const explodeSystems = useScene((s) => s.explodeSystems);
  const insetPx = useScene((s) => s.viewInset.bottom);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const busy = useRef(0);
  const lastFocus = useRef(0);

  // The canvas now owns a real layout region. Fit all eight bounds corners
  // to that region, including on resize and when chat opens or collapses.
  useEffect(() => {
    const c = ref.current;
    if (!c || !built || focus || !size.width || !size.height) return;
    ++busy.current;
    const box = new THREE.Box3();
    const off = new THREE.Vector3();
    const assemblies = getCar(built.id).assemblies;
    for (const bp of built.parts) {
      explodeOffset(bp.part, assemblies, explodeTarget(bp.part.system, explode, explodeSystems), off);
      box.union(bp.box.clone().translate(off));
    }
    const target = box.getCenter(new THREE.Vector3());
    const direction = HOME_POS.clone().sub(CAR_CENTER).normalize()
      .lerp(EXPLODED_POS.clone().sub(EXPLODED_TARGET).normalize(), explode).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const tanFull = Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2));
    const inset = clampInset(insetPx, size.height);
    // Fit to the part of the canvas above the floating controls.
    const tanV = tanFull * (size.height - inset) / size.height;
    const tanH = tanFull * size.width / Math.max(1, size.height);
    let distance = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const corner = new THREE.Vector3(x, y, z).sub(target);
      distance = Math.max(distance, Math.abs(corner.dot(right)) / tanH + corner.dot(direction), Math.abs(corner.dot(up)) / tanV + corner.dot(direction));
    }
    const pos = target.clone().addScaledVector(direction, distance * 1.15);
    liftAboveInset(pos, target, up, distance * 1.15, tanFull, inset, size.height);
    c.smoothTime = reducedMotion ? 0 : 0.35;
    void c.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, !reducedMotion);
  }, [built, focus, resetNonce, explode, explodeSystems, size.width, size.height, insetPx, camera, reducedMotion]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !focus || !built || !size.width || !size.height) return;
    const st = useScene.getState();
    const assemblies = getCar(built.id).assemblies;
    const off = new THREE.Vector3();
    const boxes = focus.ids
      .map((id) => built.byId.get(id))
      .filter((bp): bp is NonNullable<typeof bp> => Boolean(bp))
      .map((bp) => {
        explodeOffset(bp.part, assemblies, explodeTarget(bp.part.system, st.explode, st.explodeSystems), off);
        return bp.box.clone().translate(off);
      });
    if (!boxes.length) return;
    // Frame the first part; add the others only if they keep the shot tight.
    const box = boxes[0].clone();
    for (const b of boxes.slice(1)) {
      const merged = box.clone().union(b);
      if (merged.getSize(new THREE.Vector3()).length() < Math.max(1.4, box.getSize(new THREE.Vector3()).length() * 1.6)) box.copy(merged);
    }
    const center = box.getCenter(new THREE.Vector3());
    const extent = box.getSize(new THREE.Vector3()).length();

    let dir = center.clone().sub(CAR_CENTER);
    dir.y = 0;
    if (dir.lengthSq() < 0.04) dir.set(1, 0, 0.7);
    dir.normalize();
    // favour a 3/4 angle: blend in some of the car's forward axis
    dir = dir.add(new THREE.Vector3(Math.sign(center.x || 1) * 0.35, 0, 0)).normalize();
    const camDir = dir.clone().add(new THREE.Vector3(0, 0.62, 0)).normalize();
    const inset = clampInset(insetPx, size.height);
    const dist = THREE.MathUtils.clamp(extent * 1.9 + 1.0, 1.7, 6) * Math.max(1, 0.8 / (size.width / (size.height - inset)));
    // Replay the motion zoom only for a new request, not when the layout changes.
    const fresh = lastFocus.current !== focus.nonce;
    lastFocus.current = focus.nonce;
    const id = ++busy.current;
    (async () => {
      if (fresh && focus.cinematic && !reducedMotion) {
        const ov = CAR_CENTER.clone().add(camDir.clone().setY(0.42).normalize().multiplyScalar(8.2));
        c.smoothTime = 0.45;
        await c.setLookAt(ov.x, ov.y, ov.z, CAR_CENTER.x, CAR_CENTER.y, CAR_CENTER.z, true);
        if (id !== busy.current) return;
      }
      c.smoothTime = 0.7;
      const pos = center.clone().add(camDir.clone().multiplyScalar(dist));
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), camDir).normalize();
      const up = new THREE.Vector3().crossVectors(camDir, right).normalize();
      const tanFull = Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2));
      liftAboveInset(pos, center, up, dist, tanFull, inset, size.height);
      const p = c.setLookAt(pos.x, pos.y, pos.z, center.x, center.y, center.z, !reducedMotion);
      await p;
      if (id === busy.current) c.smoothTime = 0.35;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, built, size.width, size.height, insetPx, reducedMotion]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __controls: ref.current, __three: three });
  });

  // On the landing page the wheel and touch scroll the page; a mouse can still drag to rotate.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.mouseButtons.wheel = story ? CameraControlsImpl.ACTION.NONE : CameraControlsImpl.ACTION.DOLLY;
    c.enabled = !(story && window.matchMedia("(pointer: coarse)").matches);
  }, [story]);

  useFrame(({ invalidate }, dt) => {
    const c = ref.current;
    if (!c) return;
    if (useScene.getState().autoRotate) {
      c.azimuthAngle += Math.min(dt, 0.05) * 0.12;
      invalidate();
    }
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={0.35}
      maxDistance={40}
      maxPolarAngle={Math.PI * 0.495}
      smoothTime={0.35}
      draggingSmoothTime={0.12}
      dollySpeed={0.6}
    />
  );
}
