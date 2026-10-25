"use client";
import { Crosshair, Focus, MessageCircle, ShoppingCart, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { getPart, partCode } from "@/lib/cars";
import { confidenceColor } from "@/lib/confidence";
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

  const code = partCode(carId, part.id);
  const spec: [string, string][] = [
    ["Part price", p.partMax > 0 ? `${money(p.partMin)}–${money(p.partMax)}` : "Not sold"],
    ["Shop labor", p.laborMax > 0 ? `${money(p.laborMin)}–${money(p.laborMax)}` : "—"],
    ["DIY difficulty", ""],
    ...(tpl.lifespan ? [["Typical life", tpl.lifespan] as [string, string]] : []),
  ];

  return (
    <section className="part-inspector flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Part details">
      <header className="flex shrink-0 items-start gap-2 border-b border-line py-2.5 pl-3.5 pr-1.5">
        <div className="min-w-0 flex-1">
          <div className="fig flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
            {code} · {meta.label}
          </div>
          <h2 className="mt-1 text-[16px] font-semibold leading-snug tracking-[-0.02em]">{part.name}</h2>
        </div>
        <IconButton label="Close part details" onClick={() => scene.select(null)}>
          <X size={16} />
        </IconButton>
      </header>

      <div className="scroll-thin min-h-0 flex-1 space-y-3.5 overflow-y-auto px-3.5 pb-3 pt-3 text-[13px]">
        {confidence !== undefined && (
          <div className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2">
            <span className="fig shrink-0">Suspect</span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
              <div className="h-full rounded-full" style={{ width: `${Math.round(confidence * 100)}%`, background: confidenceColor(confidence) }} />
            </div>
            <span className="mono text-[12px] font-semibold" style={{ color: confidenceColor(confidence) }}>{Math.round(confidence * 100)}%</span>
          </div>
        )}
        <p className="leading-relaxed text-ink/90">{part.purpose}</p>

        <dl className="divide-y divide-[var(--border)] border-y border-line">
          {spec.map(([k, v]) => (
            <div key={k} className="flex min-h-8 items-center justify-between gap-3 py-1.5">
              <dt className="text-muted">{k}</dt>
              <dd className="mono text-right text-[12px]">
                {k === "DIY difficulty" ? (
                  <span className="flex items-center gap-2">
                    <Dots value={tpl.diy} color={tpl.diy >= 4 ? "var(--danger)" : tpl.diy >= 3 ? "var(--warn)" : "var(--ok)"} />
                    <span className="text-muted">{["", "Easy", "Basic tools", "Moderate", "Advanced", "Shop only"][tpl.diy]}</span>
                  </span>
                ) : v}
              </dd>
            </div>
          ))}
        </dl>
        {p.unit && <div className="-mt-2 text-[11px] text-muted">Prices {p.unit}. Typical 2026 US range, estimate.</div>}

        <div>
          <div className="fig mb-1.5">Symptoms when it fails</div>
          <div className="flex flex-wrap gap-1">
            {tpl.symptoms.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </div>
        </div>
        {shopFor === part.id && <div ref={checkout} id="part-purchase-options" tabIndex={-1} aria-label="Part options">
          <PartShop key={`${carId}:${part.id}`} carId={carId} partId={part.id} onClose={() => setShopFor(null)} />
        </div>}
      </div>

      <div className="flex shrink-0 flex-wrap gap-1 border-t border-line px-2 py-2">
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
