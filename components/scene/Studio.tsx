"use client";
import { Environment, Grid, Lightformer, MeshReflectorMaterial } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Quality } from "@/lib/store/scene";
import type { BuiltCar, BuiltPart } from "@/lib/three/assemble";

/** Canvas clear colors. After neutral tone mapping they match --bg in globals.css, so the studio has no visible edge. */
export const STUDIO_BG = { light: "#f5f3ed", dark: "#2a2b2e" };

/** Soft pool of light under the car, fading to transparent. */
function useSpotTexture(dark: boolean) {
  const texture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    const [r, gr, b] = dark ? [30, 39, 54] : [255, 255, 253];
    g.addColorStop(0, `rgba(${r},${gr},${b},${dark ? 0.7 : 0.8})`);
    g.addColorStop(0.45, `rgba(${r},${gr},${b},${dark ? 0.3 : 0.35})`);
    g.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [dark]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** Studio built entirely from local light-formers: no HDRI download. */
export function Studio({ dark, quality, built }: { dark: boolean; quality: Quality; built: BuiltCar | null }) {
  const bg = dark ? STUDIO_BG.dark : STUDIO_BG.light;
  const envBg = dark ? "#07080a" : "#cfccc5";
  const spot = useSpotTexture(dark);
  const floor = useRef<THREE.Group>(null);
  const tracked = useRef<{ car: THREE.Object3D; built: BuiltCar; parts: { node: THREE.Object3D; part: BuiltPart }[] } | null>(null);

  // Run after the part animations (-1). Use their actual positions so the
  // ground never clips descending parts or rises through them on reassembly.
  useFrame(({ scene, gl }) => {
    if (!floor.current) return;
    const car = built && scene.getObjectByName(`car-${built.id}`);
    let y = 0;
    if (car && built) {
      if (tracked.current?.car !== car || tracked.current.built !== built) {
        const parts: { node: THREE.Object3D; part: BuiltPart }[] = [];
        car.traverse((node) => {
          const part = built.byId.get(node.userData.partId);
          if (part) parts.push({ node, part });
        });
        tracked.current = { car, built, parts };
      }
      for (const { node, part } of tracked.current.parts) {
        y = Math.min(y, part.box.min.y + node.position.y - part.part.position[1] - 0.01);
      }
    }
    if (floor.current.position.y !== y) {
      floor.current.position.y = y;
      gl.shadowMap.needsUpdate = true;
    }
  }, -0.5);
  return (
    <>
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, 24, 60]} />
      <ambientLight intensity={dark ? 0.08 : 0.1} />
      <directionalLight
        position={[2.5, 9, 3]}
        intensity={dark ? 1.6 : 1.7}
        color={dark ? "#dbe7ff" : "#ffffff"}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={10}
        shadow-blurSamples={16}
        shadow-camera-left={-4.5}
        shadow-camera-right={4.5}
        shadow-camera-top={4.5}
        shadow-camera-bottom={-4.5}
        shadow-camera-near={1}
        shadow-camera-far={20}
      />
      <directionalLight position={[-6, 4, -5]} intensity={dark ? 0.5 : 0.6} color={dark ? "#8fb4ff" : "#ffffff"} />

      <Environment resolution={512} frames={1} environmentIntensity={dark ? 0.9 : 0.85}>
        <color attach="background" args={[envBg]} />
        {/* overhead softbox */}
        <Lightformer form="rect" intensity={dark ? 3 : 2.4} position={[0, 7, 0]} rotation-x={Math.PI / 2} scale={[12, 5, 1]} />
        {/* long side strips that draw the body lines */}
        <Lightformer form="rect" intensity={dark ? 6 : 4} position={[-7, 2.4, 0]} rotation-y={Math.PI / 2} scale={[16, 0.6, 1]} />
        <Lightformer form="rect" intensity={dark ? 6 : 4} position={[7, 2.4, 0]} rotation-y={-Math.PI / 2} scale={[16, 0.6, 1]} />
        <Lightformer form="rect" intensity={dark ? 2 : 2} position={[0, 1.2, 9]} scale={[14, 2.2, 1]} />
        <Lightformer form="rect" intensity={dark ? 2 : 2} position={[0, 1.2, -9]} rotation-y={Math.PI} scale={[14, 2.2, 1]} />
        <Lightformer form="ring" color={dark ? "#9cc3ff" : "#ffffff"} intensity={dark ? 5 : 3} position={[9, 4, 6]} scale={3.5} target={[0, 0, 0]} />
        <Lightformer form="circle" intensity={dark ? 1.5 : 2} position={[0, -3, 0]} rotation-x={-Math.PI / 2} scale={6} color={dark ? "#1b2230" : "#f5f6f8"} />
      </Environment>

      <group ref={floor} name="studio-floor">
      {quality === "ultra" ? (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
          <circleGeometry args={[60, 96]} />
          <MeshReflectorMaterial
            resolution={1024}
            mirror={dark ? 0.55 : 0.35}
            blur={[400, 120]}
            mixBlur={1.2}
            mixStrength={dark ? 3 : 1.6}
            depthScale={0.6}
            minDepthThreshold={0.6}
            maxDepthThreshold={1.2}
            roughness={0.85}
            metalness={0.2}
            color={dark ? "#0b0f15" : "#e6e3dc"}
          />
        </mesh>
      ) : (
        <>
          {/* Shadow catcher: the floor takes the background color, so only shadows and the light pool show. */}
          <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
            <planeGeometry args={[80, 80]} />
            <shadowMaterial transparent opacity={dark ? 0.45 : 0.2} color={dark ? "#000000" : "#2b2520"} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]} renderOrder={-1}>
            <circleGeometry args={[8.5, 64]} />
            <meshBasicMaterial map={spot} transparent depthWrite={false} fog={false} toneMapped={false} />
          </mesh>
        </>
      )}
      <Grid
        position={[0, 0.004, 0]}
        args={[30, 30]}
        cellSize={0.25}
        cellThickness={0.5}
        cellColor={dark ? "#121b28" : "#dcd8cf"}
        sectionSize={1}
        sectionThickness={0.9}
        sectionColor={dark ? "#1d2b3e" : "#cac5ba"}
        fadeDistance={15}
        fadeStrength={1.8}
        infiniteGrid
      />
      </group>
      <hemisphereLight args={[dark ? "#2a3550" : "#ffffff", dark ? "#050608" : "#cfd4dc", dark ? 0.2 : 0.18]} />
    </>
  );
}
