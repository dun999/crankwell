"use client";
import clsx from "clsx";
import { Box, CarFront, Layers, MessageSquareText, Receipt, RotateCcw, ScanEye, Search, Table2, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CAR_SPECS, getCar, getPart, partCode } from "@/lib/cars";
import { SYSTEM_META, type CarId } from "@/lib/cars/types";
import { useChat } from "@/lib/store/chat";
import { useOrders } from "@/lib/store/orders";
import { useScene } from "@/lib/store/scene";
import { IconButton, Modal, money } from "../ui";

interface Item {
  key: string;
  group: "Ask the mechanic" | "Parts" | "Actions";
  label: string;
  hint?: string;
  icon?: LucideIcon;
  color?: string;
  code?: string;
  run: () => void;
}

/** ⌘K command palette: parts, view actions, or a question for the mechanic. */
export function PartSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounting fresh each time it opens resets the query and selection.
  return open ? <SearchDialog onClose={onClose} /> : null;
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const carId = useScene((s) => s.carId);
  const xray = useScene((s) => s.xray);
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

  const items = useMemo<Item[]>(() => {
    const s = useScene.getState();
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (hay: string) => words.every((w) => hay.toLowerCase().includes(w));
    const other: CarId = carId === "corolla" ? "crv" : "corolla";
    const actions: Item[] = [
      { key: "xray", group: "Actions", label: xray ? "Turn off x-ray" : "X-ray the body", hint: "see through the panels", icon: ScanEye, run: () => s.setXray(!xray) },
      { key: "explode", group: "Actions", label: "Disassemble the car", hint: "exploded view", icon: Layers, run: () => { s.setIsolate(null); s.setExplode(0.6, null); s.resetView(); } },
      { key: "assemble", group: "Actions", label: "Reassemble", hint: "put it back together", icon: Box, run: () => { s.setExplode(0, null); s.resetView(); } },
      { key: "guide", group: "Actions", label: "Open the price guide", hint: "every part, part + labor", icon: Table2, run: () => s.setGuideOpen(true) },
      { key: "car", group: "Actions", label: `Switch to ${CAR_SPECS[other].make} ${CAR_SPECS[other].model}`, hint: CAR_SPECS[other].engineCode, icon: CarFront, run: () => s.setCar(other) },
      { key: "reset", group: "Actions", label: "Reset view", hint: "clear diagnosis and isolation", icon: RotateCcw, run: () => s.clearDiagnosis() },
      { key: "orders", group: "Actions", label: "Orders & bookings", hint: "PayPal ledger", icon: Receipt, run: () => useOrders.getState().setOpen(true) },
    ].filter((a) => match(`${a.label} ${a.hint}`)) as Item[];
    const parts: Item[] = getCar(carId)
      .parts.map((p) => getPart(carId, p.id)!)
      .filter((p) => match(`${p.name} ${p.template_info.name} ${SYSTEM_META[p.system].label} ${p.template_info.symptoms.join(" ")} ${partCode(carId, p.id)}`))
      .slice(0, words.length ? 30 : 12)
      .map((p) => ({
        key: p.id,
        group: "Parts",
        label: p.name,
        hint: p.price.partMax > 0 ? `${money(p.price.partMin)}–${money(p.price.partMax)}` : SYSTEM_META[p.system].label,
        color: SYSTEM_META[p.system].color,
        code: partCode(carId, p.id),
        run: () => {
          s.select(p.id);
          s.setIsolate([p.system]);
          s.focusParts([p.id], true);
        },
      }));
    const text = q.trim();
    const ask: Item[] = text ? [{ key: "ask", group: "Ask the mechanic", label: `“${text}”`, hint: "diagnose on the model", icon: MessageSquareText, run: () => void useChat.getState().send(text) }] : [];
    // A sentence is a question for the mechanic, unless it names a part ("12 V battery").
    const named = parts.some((p) => p.label.toLowerCase().includes(text.toLowerCase()));
    return (words.length >= 3 && !named) || (text && !parts.length) ? [...ask, ...parts, ...actions] : words.length ? [...parts, ...actions, ...ask] : [...actions, ...parts];
  }, [q, carId, xray]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    item.run();
    onClose();
  };

  return (
    <Modal label="Search parts and actions" className="search-dialog" onClose={onClose}>
      <div className="flex items-center gap-2 border-b border-line pl-4 pr-2">
        <Search size={15} className="text-muted" />
        <input
          ref={input}
          aria-label="Search parts, actions or ask the mechanic"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.max(0, Math.min(items.length - 1, i + 1))); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter") { e.preventDefault(); run(items[idx]); }
          }}
          placeholder="Search parts, actions, or describe a symptom…"
          className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
        />
        <IconButton label="Close search" onClick={onClose}><X size={17} /></IconButton>
      </div>
      <ul ref={list} className="scroll-thin max-h-[min(60dvh,460px)] overflow-y-auto py-1" role="listbox" aria-label="Results">
        {items.map((it, i) => (
          <li key={it.key} role="presentation">
            {it.group !== items[i - 1]?.group && <div className="fig px-4 pb-1 pt-2.5 text-[10px]">{it.group}</div>}
            <button
              type="button"
              role="option"
              aria-selected={i === idx}
              data-index={i}
              onMouseMove={() => i !== idx && setIdx(i)}
              onClick={() => run(it)}
              className={clsx("flex h-9 w-full items-center gap-2.5 px-4 text-left", i === idx && "bg-surface-2")}
            >
              {it.icon ? (
                <it.icon size={15} strokeWidth={1.75} className={clsx("shrink-0", it.key === "ask" ? "text-agent" : "text-muted")} />
              ) : (
                <span className="grid w-[15px] shrink-0 place-items-center"><span className="h-1.5 w-1.5 rounded-full" style={{ background: it.color }} /></span>
              )}
              {it.code && <span className="mono w-[46px] shrink-0 text-[10.5px] text-faint">{it.code}</span>}
              <span className="min-w-0 flex-1 truncate text-[13px]">{it.label}</span>
              {it.hint && <span className={clsx("shrink-0 text-[11.5px] text-muted", it.group === "Parts" && "mono text-[11px]")}>{it.hint}</span>}
            </button>
          </li>
        ))}
        {!items.length && <li className="px-4 py-6 text-center text-sm text-muted">Nothing matches “{q}”.</li>}
      </ul>
      <div className="fig flex items-center gap-3 border-t border-line px-4 py-2 text-[10px]">
        <span><span className="kbd">↑</span> <span className="kbd">↓</span> move</span>
        <span><span className="kbd">↵</span> open</span>
        <span><span className="kbd">esc</span> close</span>
      </div>
    </Modal>
  );
}
