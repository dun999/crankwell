"use client";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { Component, useEffect, type ReactNode } from "react";
import { useMounted } from "@/lib/hooks";
import { applyUiEvent, useChat } from "@/lib/store/chat";
import { useScene } from "@/lib/store/scene";

const CarCanvas = dynamic(() => import("./scene/CarCanvas"), {
  ssr: false,
  loading: () => <div role="status" className="fig grid h-full place-items-center">Loading 3D explorer…</div>,
});

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return (
      <div role="status" className="grid h-full place-content-center gap-3 p-6 text-center text-sm">
        <p className="font-medium">3D viewing is unavailable</p>
        <p className="max-w-xs text-muted">You can still browse parts and ask the mechanic.</p>
        <button type="button" className="min-h-11 rounded-xl border border-line bg-surface-solid px-4 font-medium" onClick={() => this.setState({ failed: false })}>Retry 3D view</button>
      </div>
    );
    return this.props.children;
  }
}

export function Stage({ story = false }: { story?: boolean }) {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  const progress = useScene((s) => s.progress);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __scene: useScene, __chat: useChat, __applyUi: applyUiEvent });
  }, []);
  const dark = mounted ? resolvedTheme === "dark" : false;
  return (
    <div className="absolute inset-0">
      {mounted && <SceneBoundary><CarCanvas dark={dark} story={story} /></SceneBoundary>}
      {progress && !story && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="w-56" role="status">
            <div className="fig mb-2 flex justify-between"><span>Building model</span><span>{progress.done}/{progress.total} parts</span></div>
            <div className="h-px w-full bg-[var(--border-strong)]" role="progressbar" aria-label="Building car model" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <div className="h-px bg-accent transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
