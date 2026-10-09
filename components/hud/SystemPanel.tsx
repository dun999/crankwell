"use client";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers } from "lucide-react";
import { useMemo, useState } from "react";
import { getCar, getPart } from "@/lib/cars";
import { SYSTEM_IDS, SYSTEM_META, type SystemId } from "@/lib/cars/types";
import { useScene } from "@/lib/store/scene";
import { money } from "../ui";

export function SystemPanel() {
  const carId = useScene((s) => s.carId);
  const hidden = useScene((s) => s.hiddenSystems);
  const isolate = useScene((s) => s.isolate);
  const selected = useScene((s) => s.selected);
  const hovered = useScene((s) => s.hovered);
  const toggleSystem = useScene((s) => s.toggleSystem);
  const setIsolate = useScene((s) => s.setIsolate);
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<SystemId | null>(null);

  const bySystem = useMemo(() => {
    const m = {} as Record<SystemId, ReturnType<typeof getPart>[]>;
    for (const p of getCar(carId).parts) (m[p.system] ??= []).push(getPart(carId, p.id));
    return m;
  }, [carId]);
  const total = getCar(carId).parts.length;

  const toggleExpand = (s: SystemId) => {
    if (expanded === s) {
      setExpanded(null);
      if (isolate?.length === 1 && isolate[0] === s) setIsolate(null);
    } else {
      setExpanded(s);
      // see-through the rest of the car so this system's parts can be pointed at
      setIsolate([s]);
    }
  };

  const scene = useScene.getState();
  return (
    <section className="glass pointer-events-auto flex min-h-0 w-64 flex-col overflow-hidden rounded-2xl" data-hover-anchor>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3.5 py-3 text-left">
        <Layers size={16} className="text-muted" />
        <span className="text-sm font-semibold">Systems</span>
        <span className="text-xs text-muted">{total} parts</span>
        <ChevronDown size={16} className={clsx("ml-auto text-muted transition", !open && "-rotate-90")} />
      </button>
      {open && (
        <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" onMouseLeave={() => scene.hover(null)}>
          {SYSTEM_IDS.filter((s) => bySystem[s]?.length).map((s) => {
            const isHidden = hidden.includes(s);
            const isOpen = expanded === s;
            const parts = bySystem[s];
            return (
              <li key={s}>
                <div className={clsx("group flex items-center gap-1 rounded-xl pr-1 hover:bg-surface-2", isOpen && "bg-surface-2")}>
                  <button
                    type="button"
                    onClick={() => toggleExpand(s)}
                    aria-expanded={isOpen}
                    className={clsx("flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left", isHidden && "opacity-45")}
                    title={isOpen ? "Hide parts" : `Show ${SYSTEM_META[s].label} parts`}
                  >
                    <ChevronRight size={13} className={clsx("shrink-0 text-faint transition", isOpen && "rotate-90")} />
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SYSTEM_META[s].color }} />
                    <span className={clsx("truncate text-[13px]", isOpen && "font-semibold")}>{SYSTEM_META[s].label}</span>
                    <span className="ml-auto text-[11px] tabular-nums text-faint">{parts.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSystem(s)}
                    className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-ink"
                    aria-label={`${isHidden ? "Show" : "Hide"} ${SYSTEM_META[s].label}`}
                  >
                    {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {isOpen && (
                  <ul className="mb-1 ml-[22px] border-l border-line py-0.5 pl-1.5">
                    {parts.map((p) =>
                      p ? (
                        <li key={p.id}>
                          <button
                            type="button"
                            onMouseEnter={() => scene.hover(p.id)}
                            onFocus={() => scene.hover(p.id)}
                            onBlur={() => scene.hover(null)}
                            onClick={() => {
                              scene.select(p.id);
                              scene.focusParts([p.id], false);
                            }}
                            className={clsx(
                              "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition",
                              selected === p.id ? "bg-accent-soft text-accent" : hovered === p.id ? "bg-surface-2 text-ink" : "text-ink/80 hover:bg-surface-2",
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="shrink-0 tabular-nums text-[11px] text-muted">
                              {p.template_info.purchasable && p.price.partMax > 0 ? money(p.price.partMin) + "+" : "shop"}
                            </span>
                          </button>
                        </li>
                      ) : null,
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="border-t border-line px-3.5 py-2 text-[11px] leading-snug text-muted">
        {isolate ? (
          <>
            Seeing through to {isolate.map((s) => SYSTEM_META[s].label).join(", ")} ·{" "}
            <button
              type="button"
              className="font-medium text-accent"
              onClick={() => {
                setIsolate(null);
                setExpanded(null);
              }}
            >
              show whole car
            </button>
          </>
        ) : (
          "Hover any part for what it does and what it costs. Open a system to reach parts hidden inside the car."
        )}
      </div>
    </section>
  );
}
