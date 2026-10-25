"use client";
import { create } from "zustand";
import type { CarId, SystemId } from "@/lib/cars/types";

export type Quality = "ultra" | "high" | "balanced";

export interface FocusRequest {
  ids: string[];
  nonce: number;
  /** pull back to an overview first, then dive in */
  cinematic: boolean;
}

export interface SceneState {
  carId: CarId;
  /** Explode target, 0 = assembled, 1 = fully disassembled */
  explode: number;
  /** Restrict disassembly to these systems (null = whole car) */
  explodeSystems: SystemId[] | null;
  xray: boolean;
  hiddenSystems: SystemId[];
  /** Systems shown solid; everything else is ghosted */
  isolate: SystemId[] | null;
  selected: string | null;
  hovered: string | null;
  /** Hover came from a list that already shows the details (no floating card) */
  hoverQuiet: boolean;
  /** part id → diagnosis confidence 0..1 */
  highlights: Record<string, number>;
  focus: FocusRequest | null;
  resetNonce: number;
  quality: Quality;
  autoRotate: boolean;
  progress: { done: number; total: number } | null;
  /** The car whose model has finished building and is on screen. */
  ready: CarId | null;
  /** AG Grid price guide docked under the 3D view */
  guideOpen: boolean;
  /** Pixels of the canvas covered by floating controls; the camera frames the model in the rest. */
  viewInset: { bottom: number };

  setCar: (id: CarId) => void;
  setExplode: (v: number, systems?: SystemId[] | null) => void;
  setXray: (v: boolean) => void;
  toggleSystem: (s: SystemId) => void;
  setIsolate: (s: SystemId[] | null) => void;
  select: (id: string | null) => void;
  hover: (id: string | null, quiet?: boolean) => void;
  setHighlights: (h: Record<string, number>) => void;
  focusParts: (ids: string[], cinematic?: boolean) => void;
  resetView: () => void;
  clearDiagnosis: () => void;
  /** Back to the plain assembled car: no diagnosis, x-ray, isolation or hidden systems. */
  resetScene: () => void;
  setQuality: (q: Quality) => void;
  setAutoRotate: (v: boolean) => void;
  setProgress: (p: { done: number; total: number } | null) => void;
  setGuideOpen: (v: boolean) => void;
  setViewInset: (bottom: number) => void;
}

export const useScene = create<SceneState>((set) => ({
  carId: "corolla",
  explode: 0,
  explodeSystems: null,
  xray: false,
  hiddenSystems: [],
  isolate: null,
  selected: null,
  hovered: null,
  hoverQuiet: false,
  highlights: {},
  focus: null,
  resetNonce: 0,
  quality: typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches ? "balanced" : "high",
  autoRotate: false,
  progress: null,
  ready: null,
  guideOpen: false,
  viewInset: { bottom: 0 },

  setCar: (carId) =>
    set((s) =>
      s.carId === carId
        ? s
        : { carId, selected: null, hovered: null, highlights: {}, focus: null, isolate: null, explode: 0, explodeSystems: null, xray: false, resetNonce: s.resetNonce + 1 },
    ),
  setExplode: (explode, systems) => set((s) => ({ explode, explodeSystems: systems === undefined ? s.explodeSystems : systems })),
  setXray: (xray) => set({ xray }),
  toggleSystem: (sys) =>
    set((s) => ({ hiddenSystems: s.hiddenSystems.includes(sys) ? s.hiddenSystems.filter((x) => x !== sys) : [...s.hiddenSystems, sys] })),
  setIsolate: (isolate) => set({ isolate }),
  select: (selected) => set({ selected, hovered: null }),
  hover: (hovered, quiet = false) => set((s) => (s.hovered === hovered && s.hoverQuiet === quiet ? s : { hovered, hoverQuiet: quiet })),
  setHighlights: (highlights) => set({ highlights }),
  focusParts: (ids, cinematic = true) => set((s) => ({ focus: { ids, cinematic, nonce: (s.focus?.nonce ?? 0) + 1 } })),
  resetView: () => set((s) => ({ resetNonce: s.resetNonce + 1, focus: null })),
  clearDiagnosis: () => set((s) => ({ highlights: {}, isolate: null, xray: false, focus: null, resetNonce: s.resetNonce + 1 })),
  resetScene: () => set((s) => ({ selected: null, hovered: null, highlights: {}, focus: null, isolate: null, explode: 0, explodeSystems: null, xray: false, hiddenSystems: [], autoRotate: false, resetNonce: s.resetNonce + 1 })),
  setQuality: (quality) => set({ quality }),
  setAutoRotate: (autoRotate) => set({ autoRotate }),
  setProgress: (progress) => set({ progress }),
  setGuideOpen: (guideOpen) => set({ guideOpen }),
  setViewInset: (bottom) => set((s) => (s.viewInset.bottom === bottom ? s : { viewInset: { bottom } })),
}));
