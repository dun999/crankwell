"use client";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCar, getPart } from "@/lib/cars";
import { SYSTEM_META } from "@/lib/cars/types";
import { useScene } from "@/lib/store/scene";
import { money } from "../ui";

export function PartSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounting fresh each time it opens resets the query and selection.
  return open ? <SearchDialog onClose={onClose} /> : null;
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const carId = useScene((s) => s.carId);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 10);
    return () => clearTimeout(t);
  }, []);

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return getCar(carId)
      .parts.map((p) => getPart(carId, p.id)!)
      .filter((p) => {
        const hay = `${p.name} ${p.template_info.name} ${SYSTEM_META[p.system].label} ${p.template_info.symptoms.join(" ")}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 40);
  }, [q, carId]);

  const pick = (id: string) => {
    const s = useScene.getState();
    s.select(id);
    s.setIsolate([getPart(carId, id)!.system]);
    s.focusParts([id], true);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/20 px-4 pt-[12vh] backdrop-blur-[2px]" onClick={onClose}>
      <div className="glass w-full max-w-lg overflow-hidden rounded-2xl" role="dialog" aria-label="Search parts" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") setIdx((i) => Math.min(results.length - 1, i + 1));
              if (e.key === "ArrowUp") setIdx((i) => Math.max(0, i - 1));
              if (e.key === "Enter" && results[idx]) pick(results[idx].id);
            }}
            placeholder="Search parts or symptoms… e.g. “caliper”, “squeal”, “battery”"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-line px-1.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <ul className="scroll-thin max-h-[50vh] overflow-y-auto p-1.5">
          {results.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseEnter={() => setIdx(i)}
                onClick={() => pick(p.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${i === idx ? "bg-surface-2" : ""}`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SYSTEM_META[p.system].color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted">{SYSTEM_META[p.system].label}</span>
                </span>
                {p.price.partMax > 0 && <span className="text-xs tabular-nums text-muted">{money(p.price.partMin)}–{money(p.price.partMax)}</span>}
              </button>
            </li>
          ))}
          {!results.length && <li className="px-3 py-6 text-center text-sm text-muted">No parts match “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}
