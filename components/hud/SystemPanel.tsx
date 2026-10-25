"use client";
import clsx from "clsx";
import { ChevronRight, Eye, EyeOff, PanelLeftClose, PanelLeftOpen, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { getCar, getPart, partCode } from "@/lib/cars";
import { SYSTEM_IDS, SYSTEM_META, type SystemId } from "@/lib/cars/types";
import { useScene } from "@/lib/store/scene";
import { IconButton, compactMoney, money } from "../ui";

type Part = NonNullable<ReturnType<typeof getPart>>;

function useSystems() {
  const carId = useScene((s) => s.carId);
  return useMemo(() => {
    const m = {} as Record<SystemId, Part[]>;
    for (const p of getCar(carId).parts) (m[p.system] ??= []).push(getPart(carId, p.id)!);
    return { carId, bySystem: m, systems: SYSTEM_IDS.filter((s) => m[s]?.length), total: getCar(carId).parts.length };
  }, [carId]);
}

/** Typical repair range for a system: cheapest part + labor to the dearest. */
function repairRange(parts: Part[]) {
  const priced = parts.filter((p) => p.price.partMax > 0 || p.price.laborMax > 0);
  if (!priced.length) return "";
  const lo = Math.min(...priced.map((p) => p.price.partMin + p.price.laborMin));
  const hi = Math.max(...priced.map((p) => p.price.partMax + p.price.laborMax));
  return `${compactMoney(lo)}–${compactMoney(hi).slice(1)}`;
}

export function SystemPanel({ initial, onRail }: { initial?: SystemId; onRail?: () => void }) {
  const { carId, bySystem, systems, total } = useSystems();
  const hidden = useScene((s) => s.hiddenSystems);
  const isolate = useScene((s) => s.isolate);
  const selected = useScene((s) => s.selected);
  const hovered = useScene((s) => s.hovered);
  const toggleSystem = useScene((s) => s.toggleSystem);
  const setIsolate = useScene((s) => s.setIsolate);
  const [expanded, setExpanded] = useState<SystemId | null>(initial ?? null);
  const ranges = useMemo(() => Object.fromEntries(systems.map((s) => [s, repairRange(bySystem[s])])), [systems, bySystem]);

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
    <section className="systems-panel flex min-h-0 flex-1 flex-col overflow-hidden" data-hover-anchor>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line pl-3.5 pr-1.5">
        <h2 className="fig text-ink">Systems</h2>
        <span className="mono text-[10.5px] text-faint">{systems.length} · {total} parts</span>
        <span className="mono ml-auto pr-1 text-[10px] uppercase tracking-[0.06em] text-faint" title="Typical repair cost range: part plus labor">Repair</span>
        {onRail && (
          <IconButton label="Collapse systems" onClick={onRail} className="h-7 w-7">
            <PanelLeftClose size={15} strokeWidth={1.75} />
          </IconButton>
        )}
      </header>
      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1" onMouseLeave={() => scene.hover(null)}>
        {systems.map((s) => {
          const isHidden = hidden.includes(s);
          const isOpen = expanded === s;
          const parts = bySystem[s];
          return (
            <li key={s}>
              <div className={clsx("group flex items-center pr-1 transition-colors hover:bg-surface-2", isOpen && "bg-surface-2")}>
                <button
                  type="button"
                  onClick={() => toggleExpand(s)}
                  aria-expanded={isOpen}
                  className={clsx("flex min-h-[30px] min-w-0 flex-1 items-center gap-2 py-1 pl-2.5 pr-1 text-left", isHidden && "opacity-45")}
                  title={isOpen ? "Hide parts" : `Show ${SYSTEM_META[s].label} parts`}
                >
                  <ChevronRight size={12} className={clsx("shrink-0 text-faint transition-transform", isOpen && "rotate-90")} />
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SYSTEM_META[s].color }} />
                  <span className={clsx("truncate text-[13px]", isOpen ? "font-semibold" : "text-ink/85")}>{SYSTEM_META[s].label}</span>
                  <span className="mono text-[10.5px] text-faint">{parts.length}</span>
                  <span className="mono ml-auto shrink-0 text-[11px] text-muted">{ranges[s]}</span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleSystem(s)}
                  className={clsx("touch-target grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint transition hover:text-ink", isHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                  aria-label={`${isHidden ? "Show" : "Hide"} ${SYSTEM_META[s].label}`}
                >
                  {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              {isOpen && (
                <ul className="mb-1 ml-[21px] border-l border-line py-0.5">
                  {parts.map((p) => (
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
                          "flex min-h-7 w-full items-center gap-2 py-1 pl-2.5 pr-2.5 text-left text-xs transition",
                          selected === p.id ? "bg-accent-soft font-medium text-accent" : hovered === p.id ? "bg-surface-3 text-ink" : "text-ink/80 hover:bg-surface-3",
                        )}
                      >
                        <span className="mono w-[46px] shrink-0 text-[10px] text-faint">{partCode(carId, p.id)}</span>
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="mono shrink-0 text-[10.5px] text-muted">
                          {p.template_info.purchasable && p.price.partMax > 0 ? money(p.price.partMin) + "+" : "shop"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className="shrink-0 border-t border-line text-xs leading-snug text-muted">
        {isolate && (
          <p className="border-b border-line px-3.5 py-2">
            Seeing through to {isolate.map((s) => SYSTEM_META[s].label).join(", ")} ·{" "}
            <button type="button" className="font-medium text-accent" onClick={() => { setIsolate(null); setExpanded(null); }}>
              show whole car
            </button>
          </p>
        )}
        <button type="button" onClick={() => scene.setGuideOpen(true)}
          className="flex h-10 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium text-ink transition-colors hover:bg-surface-2">
          <Table2 size={14} strokeWidth={1.75} className="text-muted" /> Compare all prices
          <span className="fig ml-auto text-[10px]">Price guide</span>
        </button>
      </div>
    </section>
  );
}

/** The collapsed systems panel: one dot per system. */
export function SystemRail({ onOpen }: { onOpen: (s?: SystemId) => void }) {
  const { systems } = useSystems();
  const isolate = useScene((s) => s.isolate);
  return (
    <nav aria-label="Car systems" className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto py-1.5 scroll-thin">
      <IconButton label="Expand systems" onClick={() => onOpen()} className="mb-1 h-8 w-8">
        <PanelLeftOpen size={15} strokeWidth={1.75} />
      </IconButton>
      {systems.map((s) => (
        <button key={s} type="button" title={SYSTEM_META[s].label} aria-label={`Show ${SYSTEM_META[s].label} parts`}
          onClick={() => { useScene.getState().setIsolate([s]); onOpen(s); }}
          className={clsx("flex h-8 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md transition-colors hover:bg-surface-2", isolate?.includes(s) && "bg-surface-2")}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: SYSTEM_META[s].color }} />
          <span className="mono text-[8.5px] uppercase text-faint">{s.slice(0, 3)}</span>
        </button>
      ))}
    </nav>
  );
}
