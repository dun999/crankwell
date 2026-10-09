"use client";
import { Environment, Grid, Lightformer, MeshReflectorMaterial } from "@react-three/drei";
import type { Quality } from "@/lib/store/scene";

/** Studio built entirely from local light-formers: no HDRI download. */
export function Studio({ dark, quality }: { dark: boolean; quality: Quality }) {
  const bg = dark ? "#0b0d11" : "#e9ecf0";
  const envBg = dark ? "#07080a" : "#c9ced6";
  return (
    <>
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, 22, 48]} />
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

      {quality === "ultra" ? (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
          <circleGeometry args={[18, 64]} />
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
            color={dark ? "#0d0f13" : "#d9dde3"}
          />
        </mesh>
      ) : (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
          <circleGeometry args={[18, 64]} />
          <meshStandardMaterial color={dark ? "#11141a" : "#c3c8cf"} roughness={0.92} metalness={0} envMapIntensity={dark ? 0.4 : 0.12} />
        </mesh>
      )}
      <Grid
        position={[0, 0.004, 0]}
        args={[30, 30]}
        cellSize={0.25}
        cellThickness={0.6}
        cellColor={dark ? "#1c2230" : "#c3c8d0"}
        sectionSize={1}
        sectionThickness={1}
        sectionColor={dark ? "#26324a" : "#aab1bb"}
        fadeDistance={16}
        fadeStrength={1.6}
        infiniteGrid
      />
      <hemisphereLight args={[dark ? "#2a3550" : "#ffffff", dark ? "#050608" : "#cfd4dc", dark ? 0.2 : 0.18]} />
    </>
  );
}
