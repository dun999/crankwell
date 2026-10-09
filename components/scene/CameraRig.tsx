"use client";
import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getCar } from "@/lib/cars";
import type { BuiltCar } from "@/lib/three/assemble";
import { explodeOffset, explodeTarget } from "@/lib/three/explode";
import { useScene } from "@/lib/store/scene";

const CAR_CENTER = new THREE.Vector3(0, 0.6, 0);
const HOME_POS = new THREE.Vector3(7.3, 2.45, 8.1);
const EXPLODED_POS = new THREE.Vector3(8.6, 5.2, 9.4);
const EXPLODED_TARGET = new THREE.Vector3(0, 1.0, 0);

/**
 * Owns the camera. Focus requests from the store (agent diagnosis, part
 * search, inspector) play a two-phase "motion zoom": ease back to an
 * overview on the side of the target, then dive in and frame the parts.
 */
export function CameraRig({ built }: { built: BuiltCar | null }) {
  const ref = useRef<CameraControls>(null);
  const three = useThree();
  const { size, camera } = three;
  const focus = useScene((s) => s.focus);
  const resetNonce = useScene((s) => s.resetNonce);
  const rightInset = useScene((s) => s.rightInset);
  const bottomInset = useScene((s) => s.bottomInset);
  const busy = useRef(0);

  // Portrait screens are narrow: back the camera off so the whole car fits.
  const fit = (p: THREE.Vector3, target: THREE.Vector3) => {
    const aspect = size.width / size.height;
    const k = Math.max(1, 1.25 / Math.max(0.3, aspect * 1.3));
    return target.clone().add(p.clone().sub(target).multiplyScalar(k));
  };

  // keep the subject centered in the area not covered by the chat panel
  const applyInset = (dist: number, smooth: boolean) => {
    const c = ref.current;
    if (!c) return;
    const cam = camera as THREE.PerspectiveCamera;
    const visibleW = 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (size.width / size.height);
    // panels: chat on the right, systems/inspector on the left (md+ screens)
    const leftInset = size.width >= 768 ? 290 : 0;
    const ox = size.width > 900 ? ((rightInset - leftInset) / 2 / size.width) * visibleW : 0;
    const visibleH = visibleW / (size.width / size.height);
    // mobile: lift the subject above the chat sheet (and the top bar)
    const oy = bottomInset ? ((bottomInset - 60) / 2 / size.height) * visibleH : 0;
    c.setFocalOffset(ox, oy, 0, smooth);
  };

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const id = ++busy.current;
    const home = fit(HOME_POS, CAR_CENTER);
    (async () => {
      await c.setLookAt(home.x, home.y, home.z, CAR_CENTER.x, CAR_CENTER.y, CAR_CENTER.z, true);
      if (id === busy.current) applyInset(home.distanceTo(CAR_CENTER), true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  // Full disassembly spreads parts ~2 m in every direction: pull back to see it all.
  const exploded = useScene((s) => s.explode > 0.5 && !s.explodeSystems && !s.focus);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const tgt = exploded ? EXPLODED_TARGET : CAR_CENTER;
    const pos = fit(exploded ? EXPLODED_POS : HOME_POS, tgt);
    c.smoothTime = 0.8;
    void c.setLookAt(pos.x, pos.y, pos.z, tgt.x, tgt.y, tgt.z, true).then(() => (c.smoothTime = 0.35));
    applyInset(pos.distanceTo(tgt), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploded]);

  useEffect(() => {
    applyInset(ref.current ? ref.current.distance : 8, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightInset, bottomInset, size.width, size.height]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !focus || !built) return;
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
    const dist = THREE.MathUtils.clamp(extent * 1.9 + 1.0, 1.7, 6);
    const id = ++busy.current;
    (async () => {
      if (focus.cinematic) {
        const ov = CAR_CENTER.clone().add(camDir.clone().setY(0.42).normalize().multiplyScalar(8.2));
        c.smoothTime = 0.45;
        await c.setLookAt(ov.x, ov.y, ov.z, CAR_CENTER.x, CAR_CENTER.y, CAR_CENTER.z, true);
        if (id !== busy.current) return;
      }
      c.smoothTime = 0.7;
      const pos = center.clone().add(camDir.multiplyScalar(dist));
      const p = c.setLookAt(pos.x, pos.y, pos.z, center.x, center.y, center.z, true);
      applyInset(dist, true);
      await p;
      if (id === busy.current) c.smoothTime = 0.35;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, built]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __controls: ref.current, __three: three });
  });

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
      maxDistance={16}
      maxPolarAngle={Math.PI * 0.495}
      smoothTime={0.35}
      draggingSmoothTime={0.12}
      dollySpeed={0.6}
    />
  );
}
