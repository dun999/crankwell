"use client";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { useMounted } from "@/lib/hooks";
import { applyUiEvent, useChat } from "@/lib/store/chat";
import { useScene } from "@/lib/store/scene";

const CarCanvas = dynamic(() => import("./scene/CarCanvas"), { ssr: false });

export function Stage() {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  const progress = useScene((s) => s.progress);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __scene: useScene, __chat: useChat, __applyUi: applyUiEvent });
  }, []);
  const dark = mounted ? resolvedTheme === "dark" : false;
  return (
    <div className="absolute inset-0">
      {mounted && <CarCanvas dark={dark} />}
      {progress && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="glass rounded-2xl px-5 py-4 text-sm">
            <div className="mb-2 font-medium">Building 3D model…</div>
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-[var(--border-strong)]">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <div className="mt-2 text-xs text-muted">
              {progress.done} / {progress.total} parts
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
