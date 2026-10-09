"use client";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Select } from "@react-three/postprocessing";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Assembly } from "@/lib/cars/types";
import type { BuiltPart } from "@/lib/three/assemble";
import { partMatrix } from "@/lib/three/assemble";
import { confidenceColor } from "@/lib/confidence";
import { explodeOffset, explodeTarget } from "@/lib/three/explode";
import type { MaterialSet } from "@/lib/three/materials";
import { useScene } from "@/lib/store/scene";

const noRaycast = () => null;

interface Props {
  built: BuiltPart;
  materials: MaterialSet;
  xray: THREE.Material;
  glow: Record<string, THREE.Material>;
  assemblies: Record<string, Assembly>;
}

function PartMeshImpl({ built, materials, xray, glow, assemblies }: Props) {
  const { part, meshes } = built;
  const id = part.id;
  const sys = part.system;
  const group = useRef<THREE.Group>(null);
  const t = useRef(0);
  const off = useMemo(() => new THREE.Vector3(), []);
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);

  const hidden = useScene((s) => s.hiddenSystems.includes(sys));
  const ghost = useScene((s) => {
    const isolated = s.isolate && !s.isolate.includes(sys);
    const xrayed = s.xray && (sys === "body" || sys === "interior") && !s.isolate?.includes(sys);
    const highlighted = s.highlights[id] !== undefined || s.selected === id;
    return !highlighted && Boolean(isolated || xrayed);
  });
  const confidence = useScene((s) => s.highlights[id]);
  const rank = useScene((s) => {
    const c = s.highlights[id];
    if (c === undefined) return 0;
    return Object.values(s.highlights).filter((v) => v > c).length;
  });
  const selected = useScene((s) => s.selected === id);
  const hovered = useScene((s) => s.hovered === id);

  // label anchor in the part's local frame
  const labelPos = useMemo(() => {
    const inv = partMatrix(part).invert();
    return built.center.clone().applyMatrix4(inv);
  }, [built.center, part]);

  useLayoutEffect(() => {
    get().gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [built, ghost, hidden, get, invalidate]);

  useFrame(({ gl }, dt) => {
    const g = group.current;
    if (!g) return;
    const st = useScene.getState();
    const target = explodeTarget(sys, st.explode, st.explodeSystems);
    if (t.current === target) return;
    if (Math.abs(t.current - target) > 1e-4) t.current = THREE.MathUtils.damp(t.current, target, 2.2, Math.min(dt, 0.05));
    else t.current = target;
    explodeOffset(part, assemblies, t.current, off);
    g.position.set(part.position[0] + off.x, part.position[1] + off.y, part.position[2] + off.z);
    if (!hidden && !ghost) gl.shadowMap.needsUpdate = true;
    if (t.current !== target) invalidate();
  });

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    useScene.getState().hover(id);
    document.body.style.cursor = "pointer";
  };
  const onOut = () => {
    if (useScene.getState().hovered === id) useScene.getState().hover(null);
    document.body.style.cursor = "";
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    useScene.getState().select(id);
  };

  const glowMat = confidence !== undefined ? glow[confidenceColor(confidence)] : selected || hovered ? glow.selected : null;

  return (
    <group
      ref={group}
      position={part.position}
      rotation={part.rotation ?? [0, 0, 0]}
      scale={[1, 1, part.mirror ? -1 : 1]}
      visible={!hidden}
      userData={{ partId: id }}
    >
      <Select enabled={hovered && !ghost}>
        {meshes.map((m, i) => (
          <mesh
            key={i}
            geometry={m.geometry}
            material={ghost ? xray : materials[m.material]}
            raycast={ghost || hidden ? noRaycast : undefined}
            onPointerOver={ghost ? undefined : onOver}
            onPointerOut={ghost ? undefined : onOut}
            onClick={ghost ? undefined : onClick}
            renderOrder={ghost ? 2 : 0}
            castShadow={!ghost}
          />
        ))}
      </Select>
      {glowMat &&
        meshes.map((m, i) => <mesh key={`g${i}`} geometry={m.geometry} material={glowMat} raycast={noRaycast} renderOrder={3} />)}
      {confidence !== undefined && !hidden && (
        <Html position={labelPos} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="suspect-label" style={{ ["--c" as string]: confidenceColor(confidence), ["--lift" as string]: `${18 + rank * 26}px` }}>
            <span className="dot" />
            <span className="name">{part.name}</span>
            <span className="pct">{Math.round(confidence * 100)}%</span>
          </div>
        </Html>
      )}
    </group>
  );
}

export const PartMesh = memo(PartMeshImpl);
