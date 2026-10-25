"use client";
import { MousePointerClick } from "lucide-react";
import { useEffect, useRef } from "react";
import { getPart, partCode } from "@/lib/cars";
import { SYSTEM_META } from "@/lib/cars/types";
import { useScene } from "@/lib/store/scene";
import { Dots, money } from "../ui";

const DIY = ["", "Easy", "Basic tools", "Moderate", "Advanced", "Shop only"];

/**
 * Part details card that follows the pointer while hovering a part, either in
 * the 3D view or in the Systems list (then it docks beside the list).
 */
export function HoverTag() {
  const hovered = useScene((s) => (s.hoverQuiet ? null : s.hovered));
  const carId = useScene((s) => s.carId);
  const selected = useScene((s) => s.selected);
  const ref = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0, anchor: null as DOMRect | null });

  useEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const { x, y, anchor } = pointer.current;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = anchor ? anchor.right + 12 : x + 18;
      let top = anchor ? y - 24 : y + 18;
      if (!anchor && left + w > window.innerWidth - 8) left = x - w - 18;
      if (top + h > window.innerHeight - 8) top = (anchor ? window.innerHeight : y) - h - 12;
      el.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
    };
    const move = (e: PointerEvent) => {
      const anchorEl = (e.target as Element | null)?.closest?.("[data-hover-anchor]");
      pointer.current = { x: e.clientX, y: e.clientY, anchor: anchorEl ? anchorEl.getBoundingClientRect() : null };
      place();
    };
    window.addEventListener("pointermove", move);
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    return () => {
      window.removeEventListener("pointermove", move);
      ro.disconnect();
    };
  }, []);

  const part = hovered && hovered !== selected ? getPart(carId, hovered) : undefined;
  const meta = part ? SYSTEM_META[part.system] : undefined;
  const p = part?.price;
  const sold = part ? part.template_info.purchasable && part.price.partMax > 0 : false;

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-40 transition-opacity duration-100"
      style={{ opacity: part ? 1 : 0 }}
      aria-hidden={!part}
      role="tooltip"
    >
      {part && meta && p && (
        <div className="glass w-[284px] rounded-xl p-3 text-xs" style={{ background: "color-mix(in srgb, var(--surface-solid) 96%, transparent)" }}>
          <div className="fig flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
            {partCode(carId, part.id)} · {meta.label}
          </div>
          <div className="mt-1 text-[13px] font-semibold leading-snug">{part.name}</div>
          <p className="mt-2 line-clamp-3 leading-relaxed text-ink/85">{part.purpose}</p>
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            <div className="rounded-md border border-line px-2 py-1.5">
              <div className="text-[10.5px] text-muted">Part cost</div>
              <div className="mono text-[11.5px] font-semibold">{sold ? `${money(p.partMin)}–${money(p.partMax)}` : "Not sold separately"}</div>
            </div>
            <div className="rounded-md border border-line px-2 py-1.5">
              <div className="text-[10.5px] text-muted">{sold ? "Shop labor" : "Repair cost"}</div>
              <div className="mono text-[11.5px] font-semibold">{p.laborMax > 0 ? `${money(p.laborMin)}–${money(p.laborMax)}` : "DIY · free"}</div>
            </div>
          </div>
          {p.unit && <div className="mt-1 text-[10.5px] text-faint">{p.unit} · typical US price, estimate</div>}
          <div className="mt-2 flex items-center gap-1.5 text-muted">
            DIY difficulty
            <Dots value={part.template_info.diy} color={part.template_info.diy >= 4 ? "var(--danger)" : part.template_info.diy >= 3 ? "var(--warn)" : "var(--ok)"} />
            <span className="ml-auto">{DIY[part.template_info.diy]}</span>
          </div>
          <div className="mt-2 flex items-center gap-1 border-t border-line pt-2 text-[11px] font-medium text-accent">
            <MousePointerClick size={12} /> {sold ? "Click for full details & to buy it with PayPal" : "Click for full details"}
          </div>
        </div>
      )}
    </div>
  );
}
