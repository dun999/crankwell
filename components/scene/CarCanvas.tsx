"use client";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, Outline, SMAA, Selection, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useCallback, useState } from "react";
import * as THREE from "three";
import type { BuiltCar } from "@/lib/three/assemble";
import { useScene } from "@/lib/store/scene";
import { CameraRig } from "./CameraRig";
import { CarModel } from "./CarModel";
import { Studio } from "./Studio";
import { RenderActivity } from "./RenderActivity";

export default function CarCanvas({ dark }: { dark: boolean }) {
  const carId = useScene((s) => s.carId);
  const quality = useScene((s) => s.quality);
  const [built, setBuilt] = useState<BuiltCar | null>(null);
  const [dpr, setDpr] = useState(quality === "balanced" ? 1 : 1.5);
  const onBuilt = useCallback((c: BuiltCar) => setBuilt(c), []);
  const [shadowType] = useState<"variance" | "soft" | "percentage">(() =>
    typeof window === "undefined" ? "variance" : ((new URLSearchParams(window.location.search).get("shadow") as "soft") ?? "variance"),
  );
  const [fxOff] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("fxoff") ?? ""));
  const fxOn = (k: string) => !fxOff.split(",").includes(k);
  const [fx] = useState(() => typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0");

  return (
    <Canvas
      flat
      fallback={<div className="grid h-full place-items-center p-6 text-center text-sm text-muted">3D viewing is unavailable in this browser. You can still search parts and ask the mechanic.</div>}
      frameloop="demand"
      shadows={shadowType}
      dpr={quality === "balanced" ? 1 : quality === "ultra" ? [1.5, 2] : [1, dpr]}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false, alpha: false }}
      camera={{ position: [6.4, 2.1, 7.1], fov: 30, near: 0.1, far: 120 }}
      onPointerMissed={() => useScene.getState().select(null)}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NoToneMapping;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
    >
      <RenderActivity quality={quality} onDpr={setDpr} />
      <Studio dark={dark} quality={quality} built={built && built.id === carId ? built : null} />
      <Selection>
        <CarModel carId={carId} dark={dark} onBuilt={onBuilt} />
        <EffectComposer enabled={fx} multisampling={quality === "ultra" ? 4 : 0} enableNormalPass={false} autoClear={false}>
          {fxOn("ao") && quality !== "balanced" ? (
            <N8AO
              halfRes={quality !== "ultra"}
              aoRadius={0.45}
              distanceFalloff={0.6}
              intensity={dark ? 2.2 : 1.8}
              aoSamples={quality === "ultra" ? 24 : 12}
              denoiseSamples={4}
            />
          ) : (
            <></>
          )}
          {fxOn("outline") ? <Outline visibleEdgeColor={0x60a5fa} hiddenEdgeColor={0x1d4ed8} edgeStrength={4} blur xRay width={1200} /> : <></>}
          {fxOn("bloom") ? <Bloom luminanceThreshold={2.4} luminanceSmoothing={0.3} intensity={dark ? 0.8 : 0.35} mipmapBlur /> : <></>}
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
          <SMAA />
        </EffectComposer>
      </Selection>
      <CameraRig built={built && built.id === carId ? built : null} />
    </Canvas>
  );
}
