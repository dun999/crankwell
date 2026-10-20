"use client";
import { Crosshair, Focus, MessageCircle, ShoppingCart, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { getPart } from "@/lib/cars";
import { SYSTEM_META } from "@/lib/cars/types";
import { useChat } from "@/lib/store/chat";
import { useScene } from "@/lib/store/scene";
import { Button, Chip, Dots, IconButton, money } from "../ui";

const PartShop = dynamic(() => import("../commerce/PartShop").then((m) => m.PartShop), { loading: () => <p role="status" className="p-3 text-sm text-muted">Loading part options…</p> });

export function PartInspector({ onNavigate }: { onNavigate?: () => void }) {
  const carId = useScene((s) => s.carId);
  const selected = useScene((s) => s.selected);
  const confidence = useScene((s) => (s.selected ? s.highlights[s.selected] : undefined));
  const [shopFor, setShopFor] = useState<string | null>(null);
  const checkout = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = checkout.current;
    if (!el || shopFor !== selected) return;
    el.focus({ preventScroll: true });
    const show = () => el.scrollIntoView({ block: "start" });
    show();
    const observer = new ResizeObserver(show);
    observer.observe(el);
    return () => observer.disconnect();
  }, [shopFor, selected]);
  if (!selected) return null;
  const part = getPart(carId, selected);
  if (!part) return null;
  const meta = SYSTEM_META[part.system];
  const tpl = part.template_info;
  const p = part.price;
  const scene = useScene.getState();

  return (
    <section className="part-inspector flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Part details">
      <div className="flex shrink-0 items-start gap-2 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <Chip color={meta.color}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
            {meta.label}
          </Chip>
          <h2 className="mt-2 text-[17px] font-semibold leading-snug tracking-[-0.015em]">{part.name}</h2>
        </div>
        <IconButton label="Close part details" onClick={() => scene.select(null)} className="-mr-2 -mt-1">
          <X size={16} />
        </IconButton>
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3 pt-2 text-[13px]">
        {confidence !== undefined && (
          <div className="rounded-xl border border-danger/20 bg-danger/5 px-3 py-2.5">
            <div className="eyebrow">Diagnosis confidence</div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--border-strong)]">
                <div className="h-full rounded-full bg-danger" style={{ width: `${Math.round(confidence * 100)}%` }} />
              </div>
              <span className="font-semibold tabular-nums">{Math.round(confidence * 100)}%</span>
            </div>
          </div>
        )}
        <p className="leading-relaxed text-ink/90">{part.purpose}</p>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-surface-2 px-3 py-2.5">
            <div className="text-[11px] text-muted">Part price</div>
            <div className="font-semibold tabular-nums">{p.partMax > 0 ? `${money(p.partMin)}–${money(p.partMax)}` : "Not sold"}</div>
          </div>
          <div className="rounded-xl bg-surface-2 px-3 py-2.5">
            <div className="text-[11px] text-muted">Shop labor</div>
            <div className="font-semibold tabular-nums">{p.laborMax > 0 ? `${money(p.laborMin)}–${money(p.laborMax)}` : "—"}</div>
          </div>
        </div>
        {p.unit && <div className="-mt-1 text-[11px] text-muted">Prices: {p.unit}. Typical 2026 US market range (estimate).</div>}

        <div className="flex items-center justify-between">
          <span className="text-muted">DIY difficulty</span>
          <span className="flex items-center gap-2">
            <Dots value={tpl.diy} color={tpl.diy >= 4 ? "var(--danger)" : tpl.diy >= 3 ? "var(--warn)" : "var(--ok)"} />
            <span className="text-xs text-muted">{["", "Easy", "Basic tools", "Moderate", "Advanced", "Shop only"][tpl.diy]}</span>
          </span>
        </div>
        {tpl.lifespan && (
          <div className="flex items-center justify-between">
            <span className="text-muted">Typical life</span>
            <span>{tpl.lifespan}</span>
          </div>
        )}
        <div>
          <div className="mb-1.5 text-muted">Common symptoms when it fails</div>
          <div className="flex flex-wrap gap-1.5">
            {tpl.symptoms.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </div>
        </div>
        {shopFor === part.id && <div ref={checkout} id="part-purchase-options" tabIndex={-1} aria-label="Part options">
          <PartShop key={`${carId}:${part.id}`} carId={carId} partId={part.id} onClose={() => setShopFor(null)} />
        </div>}
      </div>

      <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-line px-3 py-2.5">
        <Button size="sm" variant="ghost" onClick={() => { scene.focusParts([part.id], false); onNavigate?.(); }}>
          <Crosshair size={14} /> Focus
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { scene.setIsolate([part.system]); onNavigate?.(); }}>
          <Focus size={14} /> Isolate
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { void useChat.getState().send(`Tell me about the ${part.name} on my ${carId === "crv" ? "CR-V" : "Corolla"}. How do I know if it's failing?`); onNavigate?.(); }}>
          <MessageCircle size={14} /> Ask
        </Button>
        {tpl.purchasable && p.partMax > 0 && (
          <Button size="sm" variant="primary" className="ml-auto" aria-expanded={shopFor === part.id} aria-controls="part-purchase-options" onClick={() => setShopFor(shopFor === part.id ? null : part.id)}>
            <ShoppingCart size={14} /> Buy
          </Button>
        )}
      </div>
    </section>
  );
}
