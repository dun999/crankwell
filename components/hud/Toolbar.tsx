"use client";
import clsx from "clsx";
import { Boxes, Combine, Gauge, RotateCw, ScanEye, Search, Undo2 } from "lucide-react";
import { useEffect } from "react";
import { useScene, type Quality } from "@/lib/store/scene";
import { IconButton } from "../ui";

const QUALITIES: Quality[] = ["balanced", "high", "ultra"];

export function Toolbar({ onSearch }: { onSearch: () => void }) {
  const explode = useScene((s) => s.explode);
  const explodeSystems = useScene((s) => s.explodeSystems);
  const xray = useScene((s) => s.xray);
  const autoRotate = useScene((s) => s.autoRotate);
  const quality = useScene((s) => s.quality);
  const s = useScene.getState();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSearch]);

  const fill = `${Math.round(explode * 100)}%`;
  return (
    <div className="glass pointer-events-auto flex max-w-full items-center gap-0.5 rounded-2xl p-1 sm:gap-1 sm:p-1.5">
      <IconButton label="Reassemble" onClick={() => s.setExplode(0, null)} disabled={explode === 0}>
        <Combine size={18} />
      </IconButton>
      <label className="hidden items-center gap-2 px-1 sm:flex">
        <span className="sr-only">Disassembly</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={explode}
          onChange={(e) => s.setExplode(Number(e.target.value), explodeSystems)}
          className="slider w-28 sm:w-40"
          style={{ ["--fill" as string]: fill }}
        />
      </label>
      <button
        type="button"
        onClick={() => s.setExplode(explode > 0.5 ? 0 : 1, null)}
        className="flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-medium text-accent-ink transition hover:brightness-110"
      >
        <Boxes size={16} />
        <span className="hidden sm:inline">{explode > 0.5 ? "Reassemble" : "Disassemble"}</span>
      </button>
      <div className="mx-0.5 h-6 w-px bg-[var(--border)] sm:mx-1" />
      <IconButton label="X-ray body" active={xray} onClick={() => s.setXray(!xray)}>
        <ScanEye size={18} />
      </IconButton>
      <IconButton label="Auto-rotate" className="max-sm:hidden" active={autoRotate} onClick={() => s.setAutoRotate(!autoRotate)}>
        <RotateCw size={18} />
      </IconButton>
      <IconButton
        label={`Render quality: ${quality}`}
        onClick={() => s.setQuality(QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length])}
        className="w-auto gap-1 px-2"
      >
        <Gauge size={18} />
        <span className={clsx("hidden text-xs font-medium capitalize sm:inline")}>{quality}</span>
      </IconButton>
      <IconButton label="Reset view" onClick={() => s.clearDiagnosis()}>
        <Undo2 size={18} />
      </IconButton>
      <IconButton label="Search parts (Ctrl+K)" onClick={onSearch}>
        <Search size={18} />
      </IconButton>
    </div>
  );
}
