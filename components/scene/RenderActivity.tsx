"use client";
import { addTail, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { usePerf } from "@/lib/store/perf";
import { useScene, type Quality } from "@/lib/store/scene";

/** Wake for store changes; imperative animations request their next frame. */
export function RenderActivity({ quality, onDpr }: { quality: Quality; onDpr: (dpr: number) => void }) {
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const sample = useRef({ start: 0, frames: 0, averages: [] as number[], refreshRate: 0 });

  useEffect(() => useScene.subscribe(() => invalidate()), [invalidate]);

  useEffect(() => {
    const { gl } = get();
    // Shadows depend on the lights and parts, not on the viewer's camera.
    // PartMesh marks the map dirty when a caster moves or changes visibility.
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    invalidate();
    return () => { gl.shadowMap.autoUpdate = true; };
  }, [get, invalidate, quality]);

  useEffect(() => addTail(() => {
    // An idle demand loop is not a slow GPU. Exclude idle time from the
    // existing 10 × 250 ms adaptive-resolution sampling window.
    sample.current.start = 0;
    sample.current.frames = 0;
    sample.current.averages = [];
    usePerf.setState({ fps: 0 });
  }), []);

  useFrame(() => {
    const s = sample.current;
    const now = performance.now();
    if (!s.frames) s.start = now;
    s.frames++;
    if (now - s.start < 250) return;
    const fps = Math.round((s.frames * 1000) / (now - s.start));
    s.refreshRate = Math.max(s.refreshRate, fps);
    usePerf.setState({ fps });
    s.averages.push(fps);
    s.frames = 0;
    if (s.averages.length < 10) return;
    const [lower, upper] = s.refreshRate > 100 ? [60, 100] : [40, 60];
    if (s.averages.filter((v) => v < lower).length > 7.5) onDpr(1);
    if (s.averages.filter((v) => v >= upper).length > 7.5) onDpr(1.5);
    s.averages = [];
  });

  return null;
}
