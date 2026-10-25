"use client";
import { create } from "zustand";

/** Frame rate while the 3D view is rendering; 0 when the demand loop is idle. Kept out of the scene store, whose every change re-renders. */
export const usePerf = create<{ fps: number }>(() => ({ fps: 0 }));
