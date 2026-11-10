"use client";
import { create } from "zustand";
import type { UiEvent } from "@/lib/agent/events";
import type { CarId, SystemId } from "@/lib/cars/types";
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

/** The hero's examples: the page types a symptom, and the model shows where it would look. */
export const EXAMPLES: { text: string; chip: string; system: SystemId }[] = [
  { text: "My brake pedal feels soft and sinks to the floor", chip: "Soft brake pedal", system: "brakes" },
  { text: "Car won't start, it just clicks", chip: "Won't start", system: "electrical" },
  { text: "Engine temperature is going into the red", chip: "Overheating", system: "cooling" },
  { text: "Steering wheel shakes above 60 mph", chip: "Shakes at speed", system: "wheels" },
];

export const useStory = create<{ step: number; touring: boolean; finding: SystemId | null }>(() => ({ step: 0, touring: false, finding: null }));

const INTRO_KEY = "crankwell.intro";
/** While the car is still flying together, the hero's examples wait. */
let introUntil = 0;
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
    introUntil = performance.now() + 3200;
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
  useStory.setState({ finding: null });
  useScene.getState().resetScene();
}

/**
 * The hero, live: a typed symptom turns the body to glass and leaves its system solid (null puts the
 * car back). Only at the top of the page, once the model is built and the intro has played; says
 * whether the model took it.
 */
export function showFinding(system: SystemId | null) {
  const st = useStory.getState();
  const s = useScene.getState();
  if (st.step !== 0 || st.touring || s.ready !== STORY_CAR || performance.now() < introUntil) return false;
  if (st.finding === system) return true;
  useStory.setState({ finding: system });
  s.setXray(Boolean(system));
  s.setIsolate(system ? [system] : null);
  return true;
}

/** Put the scene in the state a chapter describes. */
export function applyStep(step: number) {
  clearTimers();
  introUntil = 0;
  useStory.setState({ finding: null });
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
