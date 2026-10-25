"use client";
import { create } from "zustand";
import type { UiEvent } from "@/lib/agent/events";
import type { CarId } from "@/lib/cars/types";
import { applyUiEvent } from "@/lib/store/chat";
import { useScene } from "@/lib/store/scene";

// The landing page tells one diagnosis, start to finish, on the live model.
// Same data shape the agent emits, so the scene reacts exactly as in the app.

export const STORY_CAR: CarId = "corolla";

export const SUSPECTS = [
  { partId: "brakes.master_cylinder", name: "Brake master cylinder", system: "brakes", confidence: 0.38, after: 0.64, rationale: "Internal seal bypass makes the pedal sink slowly while held." },
  { partId: "brakes.lines", name: "Brake lines & hoses", system: "brakes", confidence: 0.27, after: 0.16, rationale: "A leaking line lets fluid escape under pressure." },
  { partId: "brakes.reservoir", name: "Brake fluid reservoir", system: "brakes", confidence: 0.18, after: 0.12, rationale: "Low fluid lets air into the system." },
  { partId: "brakes.caliper.fl", name: "Front-left brake caliper", system: "brakes", confidence: 0.1, after: 0.05, rationale: "A leaking piston seal wets the inner tire." },
] as const;

export const DIAGNOSIS: Extract<UiEvent, { type: "diagnosis" }> = {
  type: "diagnosis",
  carId: STORY_CAR,
  title: "Soft, sinking brake pedal",
  severity: "high",
  driveSafety: "do_not_drive",
  summary: "A pedal that feels soft and sinks usually means a leak in the hydraulic system or a worn master cylinder seal.",
  suspects: SUSPECTS.map((s) => ({ partId: s.partId, name: s.name, system: s.system, confidence: s.confidence, rationale: s.rationale })),
};

export const CHECKS = [
  { title: "Check the brake fluid level", options: ["Between MIN and MAX", "At or below MIN"], pick: 1 },
  { title: "Engine-on pedal hold test", options: ["Stays firm", "Slowly sinks"], pick: 1 },
];

export const CHAPTERS = [
  { id: "describe", label: "Describe", caption: "Fig. 1 — Toyota Corolla E210 · assembly" },
  { id: "see", label: "See through", caption: "Fig. 2 — X-ray · body ghosted" },
  { id: "rank", label: "Rank", caption: "Fig. 3 — Suspects, ranked" },
  { id: "ask", label: "Check", caption: "Fig. 4 — Re-ranked after two checks" },
  { id: "price", label: "Price", caption: "Fig. 5 — Exploded view · 118 parts" },
  { id: "pay", label: "Fix & pay", caption: "Fig. 6 — Replacement · brake master cylinder" },
] as const;

export const useStory = create<{ step: number; touring: boolean }>(() => ({ step: 0, touring: false }));

const INTRO_KEY = "crankwell.intro";
let timers: ReturnType<typeof setTimeout>[] = [];
const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
const clearTimers = () => {
  timers.forEach(clearTimeout);
  timers = [];
};

/** Start of the page: the car flies together from its exploded x-ray, once per visit. */
export function startIntro(reducedMotion: boolean) {
  const s = useScene.getState();
  if (s.carId !== STORY_CAR) s.setCar(STORY_CAR);
  s.resetScene();
  s.setViewInset(0);
  let played = false;
  try {
    played = sessionStorage.getItem(INTRO_KEY) === "1";
  } catch {}
  if (reducedMotion || played) return applyStep(0);
  s.setXray(true);
  s.setExplode(1, null);
  const go = () => {
    try {
      sessionStorage.setItem(INTRO_KEY, "1");
    } catch {}
    later(500, () => useStory.getState().step === 0 && useScene.getState().setExplode(0, null));
    later(2900, () => useStory.getState().step === 0 && applyStep(0));
  };
  if (useScene.getState().ready === STORY_CAR) return go();
  const unsub = useScene.subscribe((st) => {
    if (st.ready !== STORY_CAR) return;
    unsub();
    go();
  });
  timers.push(setTimeout(unsub, 60_000));
}

export function stopStory() {
  clearTimers();
  useScene.getState().resetScene();
}

/** Put the scene in the state a chapter describes. */
export function applyStep(step: number) {
  clearTimers();
  const s = useScene.getState();
  switch (step) {
    case 0:
      s.setHighlights({});
      s.setIsolate(null);
      s.select(null);
      s.setExplode(0, null);
      s.setXray(false);
      s.setAutoRotate(true);
      s.resetView();
      break;
    case 1:
      s.setAutoRotate(false);
      s.setHighlights({});
      s.setIsolate(null);
      s.select(null);
      s.setExplode(0, null);
      s.setXray(true);
      s.resetView();
      break;
    case 2:
      s.setAutoRotate(false);
      s.setXray(true);
      applyUiEvent(DIAGNOSIS);
      break;
    case 3: {
      s.setAutoRotate(false);
      s.setXray(true);
      s.setExplode(0, null);
      s.setIsolate(["brakes"]);
      s.select(null);
      s.setHighlights(Object.fromEntries(SUSPECTS.map((x) => [x.partId, x.confidence])));
      // The answers land in the card first, then the model re-ranks.
      later(1500, () => {
        const sc = useScene.getState();
        sc.setHighlights(Object.fromEntries(SUSPECTS.map((x) => [x.partId, x.after])));
        sc.focusParts([SUSPECTS[0].partId], false);
      });
      break;
    }
    case 4:
      s.setAutoRotate(false);
      s.setHighlights({});
      s.select(null);
      s.setIsolate(null);
      s.setXray(false);
      s.resetView();
      break;
    case 5:
      s.setAutoRotate(false);
      s.setExplode(0, null);
      s.setXray(true);
      s.setIsolate(["brakes"]);
      s.setHighlights({});
      s.select(SUSPECTS[0].partId);
      s.focusParts([SUSPECTS[0].partId], true);
      break;
  }
}

/** Chapter 5 takes the car apart as you scroll through it. */
export function setStoryExplode(progress: number) {
  const t = Math.min(1, Math.max(0, (progress - 0.12) / 0.6));
  const v = Math.round(0.85 * t * t * (3 - 2 * t) * 100) / 100;
  const s = useScene.getState();
  if (Math.abs(s.explode - v) > 0.004) s.setExplode(v, null);
}
