"use client";
import { X } from "lucide-react";
import { useState } from "react";
import type { SystemId } from "@/lib/cars/types";
import { useMediaQuery } from "@/lib/hooks";
import { useScene } from "@/lib/store/scene";
import { IconButton, Modal } from "../ui";
import { PartInspector } from "./PartInspector";
import { SystemPanel, SystemRail } from "./SystemPanel";

export function PartsPanel({ browse, onClose, rail, onRail }: { browse: boolean; onClose: () => void; rail: boolean; onRail: (v: boolean) => void }) {
  const wide = useMediaQuery("(min-width: 1280px)");
  const selected = useScene((s) => s.selected);
  const [initial, setInitial] = useState<SystemId | undefined>();
  const close = () => { useScene.getState().select(null); onClose(); };
  if (wide) {
    // A selected part always gets the full panel, even when the systems are collapsed.
    if (rail && !selected) return (
      <aside className="parts-dock" aria-label="Car parts">
        <SystemRail onOpen={(s) => { setInitial(s); onRail(false); }} />
      </aside>
    );
    return (
      <aside className="parts-dock" aria-label="Car parts">
        {selected ? <PartInspector /> : <SystemPanel key={initial} initial={initial} onRail={() => onRail(true)} />}
      </aside>
    );
  }
  if (!browse && !selected) return null;
  return (
    <Modal label={selected ? "Part details" : "Browse car systems"} className="parts-dialog" onClose={close}>
      {!selected && <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2">
        <h2 className="fig text-ink">Browse car systems</h2>
        <IconButton label="Close parts" onClick={close}><X size={17} /></IconButton>
      </div>}
      {selected ? <PartInspector onNavigate={close} /> : <SystemPanel />}
    </Modal>
  );
}
