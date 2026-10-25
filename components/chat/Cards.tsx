"use client";
import clsx from "clsx";
import {
  AlertOctagon,
  AlertTriangle,
  CalendarCheck,
  ChevronDown,
  ClipboardCheck,
  Crosshair,
  Hammer,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserRoundCog,
} from "lucide-react";
import { useState } from "react";
import type { RecommendedAction, UiEvent } from "@/lib/agent/events";
import { SYSTEM_META } from "@/lib/cars/types";
import { confidenceColor } from "@/lib/confidence";
import { useChat } from "@/lib/store/chat";
import { useScene } from "@/lib/store/scene";
import { ShopReserve, TechnicianBook } from "../commerce/Booking";
import { PartShop } from "../commerce/PartShop";
import { Button, money } from "../ui";

type Diagnosis = Extract<UiEvent, { type: "diagnosis" }>;
type Tests = Extract<UiEvent, { type: "safety_tests" }>;
type Recs = Extract<UiEvent, { type: "recommendations" }>;
type Focus = Extract<UiEvent, { type: "focus" }>;

const SEVERITY = {
  low: { label: "Low severity", color: "var(--ok)" },
  moderate: { label: "Moderate", color: "var(--warn)" },
  high: { label: "High severity", color: "var(--danger)" },
  critical: { label: "Critical", color: "var(--danger)" },
};

const DRIVE = {
  safe: { icon: ShieldCheck, text: "OK to drive normally", cls: "border-ok/30 bg-ok/10 text-ok" },
  caution: { icon: ShieldAlert, text: "Drive only if needed, gently and short distances", cls: "border-warn/30 bg-warn/10 text-warn" },
  do_not_drive: { icon: AlertOctagon, text: "Do not drive. Park safely and arrange a repair or tow", cls: "border-danger/30 bg-danger/10 text-danger" },
};

export function FocusLine({ e }: { e: Focus }) {
  return (
    <button
      type="button"
      onClick={() => useScene.getState().focusParts(e.partIds, true)}
      className="flex w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left text-xs text-muted hover:text-ink"
    >
      <Crosshair size={12} className="text-accent" /> {e.reason}
    </button>
  );
}

export function DiagnosisCard({ e }: { e: Diagnosis }) {
  const sev = SEVERITY[e.severity];
  const drive = DRIVE[e.driveSafety];
  const ranked = [...e.suspects].sort((a, b) => b.confidence - a.confidence);
  return (
    <div className="rise overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <ClipboardCheck size={14} className="shrink-0 text-accent" />
        <span className="min-w-0 text-[13px] font-semibold leading-snug">{e.title}</span>
        <span className="stamp ml-auto shrink-0" style={{ color: sev.color }}>
          {sev.label}
        </span>
      </div>
      <div className="space-y-3 p-3">
        <div className={clsx("flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium", drive.cls)}>
          <drive.icon size={14} className="mt-px shrink-0" /> {drive.text}
        </div>
        <p className="text-[13px] leading-relaxed text-ink/90">{e.summary}</p>
        <div>
          <div className="fig mb-1.5 flex justify-between"><span>Fig. 2 — Most likely causes</span><span>Conf.</span></div>
          <ul className="divide-y divide-[var(--border)] border-y border-line">
            {ranked.map((s, i) => (
              <li key={s.partId}>
                <button
                  type="button"
                  onClick={() => {
                    const sc = useScene.getState();
                    sc.select(s.partId);
                    sc.focusParts([s.partId], false);
                  }}
                  className="group w-full px-1 py-2 text-left transition-colors hover:bg-surface-2"
                  title={SYSTEM_META[s.system].label}
                >
                  <div className="flex items-center gap-2">
                    <span className="callout" style={{ color: confidenceColor(s.confidence) }}>{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{s.name}</span>
                    <span className="mono text-[12px] font-semibold" style={{ color: confidenceColor(s.confidence) }}>
                      {Math.round(s.confidence * 100)}%
                    </span>
                  </div>
                  <div className="ml-[26px] mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--border)]">
                    <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${s.confidence * 100}%`, background: confidenceColor(s.confidence) }} />
                  </div>
                  <div className="ml-[26px] mt-1 text-xs leading-snug text-muted">{s.rationale}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function SafetyTestCard({ e, msgId, blockIdx, answers, submitted }: { e: Tests; msgId: string; blockIdx: number; answers?: Record<string, string>; submitted?: boolean }) {
  const setAnswer = useChat((s) => s.setAnswer);
  const submit = useChat((s) => s.submitAnswers);
  const streaming = useChat((s) => s.streaming);
  const answered = Object.keys(answers ?? {}).length;
  return (
    <div className="rise overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <ShieldCheck size={14} className="text-ok" />
        <span className="text-[13px] font-semibold">Safe checks to confirm</span>
        <span className="mono ml-auto text-[10.5px] text-muted">
          {answered}/{e.tests.length} answered
        </span>
      </div>
      <div className="space-y-2 p-3">
        {e.intro && <p className="text-xs text-muted">{e.intro}</p>}
        {e.tests.map((t, i) => (
          <TestItem key={t.id} n={i + 1} t={t} value={answers?.[t.id]} disabled={submitted} onPick={(a) => setAnswer(msgId, blockIdx, t.id, a)} />
        ))}
        <Button variant="primary" className="w-full" disabled={submitted || streaming || answered === 0} onClick={() => submit(msgId, blockIdx)}>
          {submitted ? "Results sent to the mechanic" : `Send ${answered} result${answered === 1 ? "" : "s"} to the mechanic`}
        </Button>
      </div>
    </div>
  );
}

function TestItem({ n, t, value, disabled, onPick }: { n: number; t: Tests["tests"][number]; value?: string; disabled?: boolean; onPick: (a: string) => void }) {
  const [open, setOpen] = useState(n === 1);
  return (
    <div className="rounded-xl border border-line">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
        <span className={clsx("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold", value ? "bg-ok text-white" : "bg-surface-2 text-muted")}>{n}</span>
        <span className="min-w-0 flex-1 text-[13px] font-medium">{t.title}</span>
        {value && <span className="max-w-[40%] truncate text-[11px] text-ok">{value}</span>}
        <ChevronDown size={14} className={clsx("text-muted transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 px-2.5 pb-2.5 text-xs">
          <p className="text-muted">{t.why}</p>
          <ol className="list-decimal space-y-0.5 pl-4 text-ink/90">
            {t.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div className="flex items-start gap-1.5 rounded-lg border border-warn/30 bg-warn/10 px-2 py-1.5 text-warn">
            <AlertTriangle size={12} className="mt-px shrink-0" /> {t.safetyNote}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {t.answerOptions.map((a) => (
              <button
                key={a}
                type="button"
                disabled={disabled}
                onClick={() => onPick(a)}
                className={clsx(
                  "rounded-lg border px-2 py-1 text-left transition disabled:opacity-60",
                  value === a ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-ink/85 hover:border-line-strong",
                )}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ACTION_META = {
  diy: { icon: Hammer, label: "Fix it yourself" },
  buy_part: { icon: ShoppingCart, label: "Buy the part" },
  book_technician: { icon: UserRoundCog, label: "Mobile technician" },
  reserve_shop: { icon: CalendarCheck, label: "Repair shop" },
  tow: { icon: Truck, label: "Tow" },
} as const;

const URGENCY = { now: "Do this now", soon: "Within a few days", when_convenient: "When convenient" };

export function RecommendationsCard({ e }: { e: Recs }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="rise overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-[var(--shadow-sm)]">
      <div className="border-b border-line bg-surface-2 px-3 py-2 text-[13px] font-semibold">{e.headline}</div>
      <ul className="divide-y divide-[var(--border)]">
        {e.actions.map((a, i) => (
          <ActionRow key={i} a={a} carId={e.carId} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
        ))}
      </ul>
    </div>
  );
}

function ActionRow({ a, carId, open, onToggle }: { a: RecommendedAction; carId: Recs["carId"]; open: boolean; onToggle: () => void }) {
  const M = ACTION_META[a.type];
  return (
    <li>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2">
        <span className={clsx("grid h-7 w-7 shrink-0 place-items-center rounded-md", a.urgency === "now" ? "bg-danger/10 text-danger" : "bg-surface-3 text-ink")}>
          <M.icon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="fig block text-[10px]">
            {M.label} · {URGENCY[a.urgency]}
          </span>
          <span className="block text-[13px] font-semibold leading-snug">{a.title}</span>
        </span>
        {a.estCost && (
          <span className="mono shrink-0 pt-3 text-[11.5px] text-ink/85">
            {money(a.estCost.min)}–{money(a.estCost.max)}
          </span>
        )}
        <ChevronDown size={14} className={clsx("mt-3 shrink-0 text-muted transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2.5 px-3 pb-3 text-xs">
          <p className="text-muted">{a.why}</p>
          {a.type === "diy" && (
            <>
              {!!a.toolsNeeded?.length && (
                <div className="flex flex-wrap gap-1">
                  {a.toolsNeeded.map((t) => (
                    <span key={t} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px]">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {!!a.steps?.length && (
                <ol className="list-decimal space-y-1 pl-4 text-ink/90">
                  {a.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              )}
              {a.part && (
                <Button size="sm" variant="ghost" onClick={() => useScene.getState().focusParts([a.part!.id], true)}>
                  <Crosshair size={12} /> Show {a.part.name}
                </Button>
              )}
            </>
          )}
          {a.type === "buy_part" && a.part && <PartShop carId={carId} partId={a.part.id} skus={a.skus} />}
          {a.type === "book_technician" && a.technician && <TechnicianBook tech={a.technician} carId={carId} partId={a.part?.id} issue={a.title} estimate={a.estCost} />}
          {a.type === "reserve_shop" && a.shop && <ShopReserve shop={a.shop} carId={carId} partId={a.part?.id} issue={a.title} />}
          {a.type === "tow" && (
            <div className="rounded-xl border border-line px-2.5 py-2 text-muted">
              Use your insurer or roadside plan (AAA: 1-800-222-4357). Ask for a flatbed to the shop you reserved above.
            </div>
          )}
        </div>
      )}
    </li>
  );
}
