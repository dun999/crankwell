"use client";
import { Layers, RotateCw, ScanEye, Search, SlidersHorizontal, Table2, Undo2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useScene, type Quality } from "@/lib/store/scene";
import { Button, IconButton, Modal } from "../ui";

export function Toolbar({ onSearch, onBrowse }: { onSearch: () => void; onBrowse: () => void }) {
  const explode = useScene((s) => s.explode);
  const xray = useScene((s) => s.xray);
  const autoRotate = useScene((s) => s.autoRotate);
  const quality = useScene((s) => s.quality);
  const guideOpen = useScene((s) => s.guideOpen);
  const [settings, setSettings] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const s = useScene.getState();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        onSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSearch]);

  // When the toolbar floats over the studio, tell the camera how much of the canvas it covers.
  useLayoutEffect(() => {
    const el = bar.current;
    const stage = el?.parentElement?.querySelector(".viewer-stage");
    if (!el || !stage) return;
    const update = () => {
      if (getComputedStyle(el).position !== "absolute") return useScene.getState().setViewInset(0);
      const covered = stage.getBoundingClientRect().bottom - el.getBoundingClientRect().top;
      useScene.getState().setViewInset(Math.max(0, Math.round(covered + 8)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const percent = Math.round(explode * 100);
  return (
    <>
      <nav ref={bar} className="viewer-toolbar" aria-label="Model controls">
        <label className="assembly-control">
          <span className="fig text-ink">Disassembly</span>
          <input aria-label="Disassembly" aria-valuetext={percent === 0 ? "Fully assembled" : percent === 100 ? "Fully disassembled" : `${percent}% disassembled`} type="range" min={0} max={100} step={1} value={percent}
            onChange={(e) => { s.setExplode(Number(e.target.value) / 100, null); s.setIsolate(null); s.resetView(); }}
            className="slider w-full" style={{ ["--fill" as string]: `${percent}%` }} />
          <output aria-hidden="true" className="mono text-right text-[11px] text-muted">{percent}%</output>
        </label>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="viewer-actions">
          <IconButton label="Browse car systems" onClick={onBrowse} className="xl:hidden"><Layers size={17} strokeWidth={1.75} /></IconButton>
          <IconButton label="X-ray body" active={xray} onClick={() => s.setXray(!xray)}><ScanEye size={17} strokeWidth={1.75} /></IconButton>
          <IconButton label="Reset view" onClick={() => s.clearDiagnosis()}><Undo2 size={17} strokeWidth={1.75} /></IconButton>
          <IconButton label="Search parts (Ctrl+K)" onClick={onSearch} className="md:hidden"><Search size={17} strokeWidth={1.75} /></IconButton>
          <IconButton label="Price guide" active={guideOpen} onClick={() => s.setGuideOpen(!guideOpen)}><Table2 size={17} strokeWidth={1.75} /></IconButton>
          <IconButton label="View settings" onClick={() => setSettings(true)}><SlidersHorizontal size={17} strokeWidth={1.75} /></IconButton>
        </div>
      </nav>
      {settings && (
        <Modal label="View settings" className="settings-dialog" onClose={() => setSettings(false)}>
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">View settings</h2>
            <IconButton label="Close view settings" onClick={() => setSettings(false)}><X size={18} /></IconButton>
          </header>
          <div className="space-y-5 p-5 text-sm">
            <label className="flex items-center justify-between gap-3">
              Render quality
              <select aria-label="Render quality" value={quality} onChange={(e) => s.setQuality(e.target.value as Quality)} className="min-h-11 rounded-xl border border-line bg-surface-solid px-3">
                <option value="balanced">Balanced</option><option value="high">High</option><option value="ultra">Ultra</option>
              </select>
            </label>
            <p className="-mt-3 text-xs text-muted">Choose Balanced for smoother movement on phones and slower devices.</p>
            <Button className="w-full justify-between" aria-pressed={autoRotate} onClick={() => s.setAutoRotate(!autoRotate)}>
              <span className="flex items-center gap-2"><RotateCw size={16} /> Auto-rotate</span><span className="text-muted">{autoRotate ? "On" : "Off"}</span>
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
