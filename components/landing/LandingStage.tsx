"use client";
import clsx from "clsx";
import { ViewTransition } from "react";
import { CHAPTERS, STORY_CAR, useStory } from "@/lib/landing/story";
import { useScene } from "@/lib/store/scene";
import { Stage } from "../Stage";
import { Elevation } from "./Elevation";
import { scrollToStep } from "./tour";

/** The pinned figure: the live model, its caption and the chapter index. */
export function LandingStage() {
  const step = useStory((s) => s.step);
  const ready = useScene((s) => s.ready === STORY_CAR);
  const progress = useScene((s) => s.progress);
  return (
    <div className="lp-stage-wrap">
      <ViewTransition name="figure" share="morph" default="none">
        <div className="lp-stage crop">
          <span className="crop-b" aria-hidden="true" />
          <Stage story />
          <div className={clsx("lp-elevation", ready && "is-hidden")} aria-hidden={ready}>
            <Elevation carId={STORY_CAR} className="lp-draw" />
            <span className="fig">{progress ? `Building model · ${progress.done}/${progress.total} parts` : "Fig. 0 — Side elevation"}</span>
          </div>
          <div className="lp-stage-top">
            <span key={step} className="fig rise text-ink">{CHAPTERS[step].caption}</span>
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
