"use client";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCar, getPart } from "@/lib/cars";
import { SYSTEM_META } from "@/lib/cars/types";
import { useScene } from "@/lib/store/scene";
import { IconButton, Modal, money } from "../ui";

export function PartSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounting fresh each time it opens resets the query and selection.
  return open ? <SearchDialog onClose={onClose} /> : null;
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const carId = useScene((s) => s.carId);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 10);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

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
    <Modal label="Search parts" className="search-dialog" onClose={onClose}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="text-muted" />
          <input
            ref={input}
            aria-label="Search parts or symptoms"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.max(0, Math.min(results.length - 1, i + 1))); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              if (e.key === "Enter" && results[idx]) { e.preventDefault(); pick(results[idx].id); }
            }}
            placeholder="Search parts or symptoms…"
            className="h-14 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <IconButton label="Close search" onClick={onClose}><X size={18} /></IconButton>
        </div>
        <ul ref={list} className="scroll-thin max-h-[65dvh] overflow-y-auto p-1.5">
          {results.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                data-index={i}
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
    </Modal>
  );
}
