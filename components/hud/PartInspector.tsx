"use client";
import { Crosshair, Focus, MessageCircle, ShoppingCart, X } from "lucide-react";
import { useState } from "react";
import { getPart } from "@/lib/cars";
import { SYSTEM_META } from "@/lib/cars/types";
import { useChat } from "@/lib/store/chat";
import { useScene } from "@/lib/store/scene";
import { PartShop } from "../commerce/PartShop";
import { Button, Chip, Dots, IconButton, money } from "../ui";

export function PartInspector() {
  const carId = useScene((s) => s.carId);
  const selected = useScene((s) => s.selected);
  const confidence = useScene((s) => (s.selected ? s.highlights[s.selected] : undefined));
  const [shopFor, setShopFor] = useState<string | null>(null);
  if (!selected) return null;
  const part = getPart(carId, selected);
  if (!part) return null;
  const meta = SYSTEM_META[part.system];
  const tpl = part.template_info;
  const p = part.price;
  const scene = useScene.getState();

  return (
    <section className="glass pointer-events-auto flex min-h-0 w-72 shrink-0 flex-col overflow-hidden rounded-2xl max-md:w-full max-md:shrink" aria-label="Part details">
      <div className="flex items-start gap-2 px-4 pt-3.5">
        <div className="min-w-0 flex-1">
          <Chip color={meta.color}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
            {meta.label}
          </Chip>
          <h2 className="mt-1.5 text-[15px] font-semibold leading-snug">{part.name}</h2>
        </div>
        <IconButton label="Close" onClick={() => scene.select(null)} className="-mr-2 -mt-1">
          <X size={16} />
        </IconButton>
      </div>

      <div className="scroll-thin min-h-0 max-h-[52vh] flex-1 space-y-3 overflow-y-auto px-4 pb-3 pt-2 text-[13px]">
        {confidence !== undefined && (
          <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Diagnosis confidence</div>
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
          <div className="rounded-xl border border-line px-3 py-2">
            <div className="text-[11px] text-muted">Part price</div>
            <div className="font-semibold tabular-nums">{p.partMax > 0 ? `${money(p.partMin)}–${money(p.partMax)}` : "Not sold"}</div>
          </div>
          <div className="rounded-xl border border-line px-3 py-2">
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
        {shopFor === part.id && <PartShop carId={carId} partId={part.id} onClose={() => setShopFor(null)} />}
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2.5">
        <Button size="sm" variant="ghost" onClick={() => scene.focusParts([part.id], false)}>
          <Crosshair size={14} /> Focus
        </Button>
        <Button size="sm" variant="ghost" onClick={() => scene.setIsolate([part.system])}>
          <Focus size={14} /> Isolate
        </Button>
        <Button size="sm" variant="ghost" onClick={() => useChat.getState().send(`Tell me about the ${part.name} on my ${carId === "crv" ? "CR-V" : "Corolla"}. How do I know if it's failing?`)}>
          <MessageCircle size={14} /> Ask
        </Button>
        {tpl.purchasable && p.partMax > 0 && (
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => setShopFor(shopFor ? null : part.id)}>
            <ShoppingCart size={14} /> Buy
          </Button>
        )}
      </div>
    </section>
  );
}
