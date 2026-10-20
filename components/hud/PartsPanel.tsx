"use client";
import { X } from "lucide-react";
import { useMediaQuery } from "@/lib/hooks";
import { useScene } from "@/lib/store/scene";
import { IconButton, Modal } from "../ui";
import { PartInspector } from "./PartInspector";
import { SystemPanel } from "./SystemPanel";

export function PartsPanel({ browse, onClose }: { browse: boolean; onClose: () => void }) {
  const wide = useMediaQuery("(min-width: 1280px)");
  const selected = useScene((s) => s.selected);
  const close = () => { useScene.getState().select(null); onClose(); };
  const content = selected ? <PartInspector onNavigate={wide ? undefined : close} /> : <SystemPanel />;
  if (wide) return <aside className="parts-dock card" aria-label="Car parts">{content}</aside>;
  if (!browse && !selected) return null;
  return (
    <Modal label={selected ? "Part details" : "Browse car systems"} className="parts-dialog" onClose={close}>
      {!selected && <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">Browse car systems</h2>
        <IconButton label="Close parts" onClick={close}><X size={18} /></IconButton>
      </div>}
      {content}
    </Modal>
  );
}
