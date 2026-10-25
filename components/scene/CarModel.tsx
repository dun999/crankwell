"use client";
import { Bvh } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { getCar } from "@/lib/cars";
import type { CarId } from "@/lib/cars/types";
import { buildCar, type BuiltCar } from "@/lib/three/assemble";
import { createGlowMaterial, createMaterials, createXrayMaterial, type MaterialSet } from "@/lib/three/materials";
import { useScene } from "@/lib/store/scene";
import { PartMesh } from "./PartMesh";

const materialCache = new Map<CarId, MaterialSet>();
function materialsFor(id: CarId) {
  let m = materialCache.get(id);
  if (!m) {
    const spec = getCar(id).spec;
    m = createMaterials({ paint: spec.body.paint, coolant: id === "corolla" ? "#ff5f9e" : "#3b8cff", wheelDark: id === "crv" });
    materialCache.set(id, m);
  }
  return m;
}

/** Lamps read brighter at night. */
function applyLighting(carId: CarId, dark: boolean) {
  const m = materialsFor(carId);
  (m.ledWhite as THREE.MeshStandardMaterial).emissiveIntensity = dark ? 7 : 4;
  (m.lensRed as THREE.MeshPhysicalMaterial).emissiveIntensity = dark ? 1.2 : 0.3;
}

export function CarModel({ carId, dark, onBuilt }: { carId: CarId; dark: boolean; onBuilt?: (c: BuiltCar) => void }) {
  const [built, setBuilt] = useState<BuiltCar | null>(null);
  const setProgress = useScene((s) => s.setProgress);

  useEffect(() => {
    let alive = true;
    buildCar(carId, (done, total) => alive && setProgress({ done, total })).then((c) => {
      if (!alive) return;
      setProgress(null);
      setBuilt(c);
      onBuilt?.(c);
      useScene.setState({ ready: c.id });
      if (process.env.NODE_ENV !== "production") Object.assign(window, { __ready: c.id });
    });
    return () => {
      alive = false;
      useScene.setState({ ready: null });
    };
  }, [carId, setProgress, onBuilt]);

  const materials = useMemo(() => materialsFor(carId), [carId]);
  const xray = useMemo(() => createXrayMaterial(dark ? "#6fb6f2" : "#2f5a9a", dark ? 0.2 : 0.26), [dark]);
  const glow = useMemo(
    () => ({
      "#ff3b30": createGlowMaterial("#ff3b30"),
      "#ff9f0a": createGlowMaterial("#ff9f0a"),
      "#facc15": createGlowMaterial("#facc15"),
      selected: createGlowMaterial("#3b82f6"),
    }),
    [],
  );
  useEffect(() => () => xray.dispose(), [xray]);
  useEffect(() => () => Object.values(glow).forEach((material) => material.dispose()), [glow]);

  // lights read brighter at night
  useEffect(() => applyLighting(carId, dark), [carId, dark]);

  useFrame(({ clock, invalidate }) => {
    const { selected, hovered, highlights } = useScene.getState();
    if (!selected && !hovered && !Object.keys(highlights).length) return;
    for (const m of Object.values(glow)) (m as THREE.ShaderMaterial).uniforms.uTime.value = clock.elapsedTime;
    invalidate();
  });

  const assemblies = getCar(carId).assemblies;
  if (!built || built.id !== carId) return null;
  return (
    <Bvh firstHitOnly>
      <group name={`car-${carId}`}>
        {built.parts.map((bp) => (
          <PartMesh key={bp.part.id} built={bp} materials={materials} xray={xray} glow={glow} assemblies={assemblies} />
        ))}
      </group>
    </Bvh>
  );
}
