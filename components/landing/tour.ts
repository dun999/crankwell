"use client";
import { applyStep, useStory } from "@/lib/landing/story";

// Scrolling for the landing page: jump to a chapter, or play the whole story
// hands-free (for judges, and for recording the demo video).

/** Where a chapter reads as "current": the middle of the viewport on desktop, lower under the phone figure. */
export const focusLine = () => window.innerHeight * (window.innerWidth >= 1024 ? 0.5 : 0.72);

const chapter = (step: number) => document.querySelector<HTMLElement>(`[data-step="${step}"]`);
/** Scroll position that puts a point `f` of the way through a chapter on the focus line. */
const yFor = (el: HTMLElement, f: number) => el.getBoundingClientRect().top + window.scrollY + el.offsetHeight * f - focusLine();

export function scrollToStep(step: number) {
  const el = chapter(step);
  if (!el) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: Math.max(0, yFor(el, step === 0 ? 0 : 0.3)), behavior: reduced ? "instant" : "smooth" });
}

const aborted = () => new DOMException("Tour stopped", "AbortError");

function glide(to: number, ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const from = window.scrollY;
    const t0 = performance.now();
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const tick = (now: number) => {
      if (signal.aborted) return reject(aborted());
      const t = Math.min(1, (now - t0) / ms);
      window.scrollTo({ top: from + (to - from) * ease(t), behavior: "instant" });
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(aborted());
    }, { once: true });
  });
}

/** How long each chapter holds, in ms, so its animation can finish. */
const DWELL = [1800, 2600, 3800, 4200, 1400, 4600];
let current: AbortController | null = null;

export function stopTour() {
  current?.abort();
}

export async function playTour() {
  current?.abort();
  const ctrl = new AbortController();
  current = ctrl;
  const stop = () => ctrl.abort();
  const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  // Any input from the visitor takes over. Listen after this click has finished.
  const arm = setTimeout(() => events.forEach((e) => window.addEventListener(e, stop, { passive: true })), 80);
  // Start from the plain car, whatever the hero's example was showing.
  if (useStory.getState().step === 0) applyStep(0);
  useStory.setState({ touring: true });
  try {
    const els = [...document.querySelectorAll<HTMLElement>("[data-step]")];
    for (const el of els) {
      const step = Number(el.dataset.step);
      if (step === 4) {
        await glide(yFor(el, 0.08), 1200, ctrl.signal);
        await glide(yFor(el, 0.8), 4600, ctrl.signal);
      } else {
        await glide(Math.max(0, yFor(el, step === 0 ? 0 : 0.3)), step === 0 ? 700 : 1300, ctrl.signal);
      }
      await wait(DWELL[step] ?? 2500, ctrl.signal);
    }
    const next = document.getElementById("paypal");
    if (next) await glide(next.getBoundingClientRect().top + window.scrollY - 56, 1400, ctrl.signal);
  } catch {
    // stopped by the visitor
  } finally {
    clearTimeout(arm);
    events.forEach((e) => window.removeEventListener(e, stop));
    if (current === ctrl) current = null;
    useStory.setState({ touring: false });
  }
}
