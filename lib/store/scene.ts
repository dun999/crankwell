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
  /** part id → diagnosis confidence 0..1 */
  highlights: Record<string, number>;
  focus: FocusRequest | null;
  resetNonce: number;
  quality: Quality;
  autoRotate: boolean;
  progress: { done: number; total: number } | null;
  /** Pixels on the right covered by the chat panel (desktop) */
  rightInset: number;
  /** Pixels at the bottom covered by the chat sheet (mobile) */
  bottomInset: number;

  setCar: (id: CarId) => void;
  setExplode: (v: number, systems?: SystemId[] | null) => void;
  setXray: (v: boolean) => void;
  toggleSystem: (s: SystemId) => void;
  setIsolate: (s: SystemId[] | null) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setHighlights: (h: Record<string, number>) => void;
  focusParts: (ids: string[], cinematic?: boolean) => void;
  resetView: () => void;
  clearDiagnosis: () => void;
  setQuality: (q: Quality) => void;
  setAutoRotate: (v: boolean) => void;
  setProgress: (p: { done: number; total: number } | null) => void;
  setRightInset: (px: number) => void;
  setBottomInset: (px: number) => void;
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
  highlights: {},
  focus: null,
  resetNonce: 0,
  quality: "high",
  autoRotate: false,
  progress: null,
  rightInset: 0,
  bottomInset: 0,

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
  select: (selected) => set({ selected }),
  hover: (hovered) => set((s) => (s.hovered === hovered ? s : { hovered })),
  setHighlights: (highlights) => set({ highlights }),
  focusParts: (ids, cinematic = true) => set((s) => ({ focus: { ids, cinematic, nonce: (s.focus?.nonce ?? 0) + 1 } })),
  resetView: () => set((s) => ({ resetNonce: s.resetNonce + 1, focus: null })),
  clearDiagnosis: () => set((s) => ({ highlights: {}, isolate: null, xray: false, focus: null, resetNonce: s.resetNonce + 1 })),
  setQuality: (quality) => set({ quality }),
  setAutoRotate: (autoRotate) => set({ autoRotate }),
  setProgress: (progress) => set({ progress }),
  setRightInset: (rightInset) => set({ rightInset }),
  setBottomInset: (bottomInset) => set({ bottomInset }),
}));
