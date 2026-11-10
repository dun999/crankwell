"use client";
import clsx from "clsx";
import { ViewTransition } from "react";
import { getCar } from "@/lib/cars";
import { SYSTEM_META } from "@/lib/cars/types";
import { CHAPTERS, STORY_CAR, useStory } from "@/lib/landing/story";
import { useScene } from "@/lib/store/scene";
import { Stage } from "../Stage";
import { Elevation } from "./Elevation";
import { scrollToStep } from "./tour";

/** The pinned figure: the live model, its caption and the chapter index. */
export function LandingStage() {
  const step = useStory((s) => s.step);
  const finding = useStory((s) => s.finding);
  const ready = useScene((s) => s.ready === STORY_CAR);
  const progress = useScene((s) => s.progress);
  const caption = finding
    ? `Fig. 1 — Looking at ${SYSTEM_META[finding].label} · ${getCar(STORY_CAR).parts.filter((p) => p.system === finding).length} parts`
    : CHAPTERS[step].caption;
  return (
    <div className="lp-stage-wrap">
      <ViewTransition name="figure" share="morph" default="none">
        <div className="lp-stage crop">
          <span className="crop-b" aria-hidden="true" />
          <div className="lp-canvas">
            <Stage story />
            {/* The hero's example lands: a scan line passes over the car as it turns to glass. */}
            {finding && <div key={finding} className="scan-sweep" aria-hidden="true" />}
          </div>
          <div className={clsx("lp-elevation", ready && "is-hidden")} aria-hidden={ready}>
            <Elevation carId={STORY_CAR} className="lp-draw" />
            <span className="fig">{progress ? `Building model · ${progress.done}/${progress.total} parts` : "Fig. 0 — Side elevation"}</span>
          </div>
          <div className="lp-cap">
            <span key={caption} className="fig rise text-ink">{caption}</span>
            <span className="fig lp-live">Live 3D · drag to rotate</span>
          </div>
          <nav aria-label="Chapters">
            <ol className="lp-index">
              {CHAPTERS.map((c, i) => (
                <li key={c.id}>
                  <button type="button" onClick={() => scrollToStep(i)} aria-current={i === step ? "step" : undefined}>
                    <span>{String(i + 1).padStart(2, "0")}</span> {c.label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <span className="fig lp-count" aria-hidden="true">
            {String(step + 1).padStart(2, "0")} / {String(CHAPTERS.length).padStart(2, "0")}
          </span>
        </div>
      </ViewTransition>
    </div>
  );
}
