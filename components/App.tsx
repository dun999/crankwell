"use client";
import clsx from "clsx";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { CAR_SPECS } from "@/lib/cars/specs";
import { useOrders } from "@/lib/store/orders";
import { useChat } from "@/lib/store/chat";
import { useScene } from "@/lib/store/scene";
import { ChatSidebar } from "./chat/ChatSidebar";
import { OrderToast, OrdersDrawer } from "./commerce/OrdersDrawer";
import { HoverTag } from "./hud/HoverTag";
import { PartsPanel } from "./hud/PartsPanel";
import { PartSearch } from "./hud/PartSearch";
import { Toolbar } from "./hud/Toolbar";
import { TopBar } from "./hud/TopBar";
import { Stage } from "./Stage";

// AG Grid loads only when the price guide opens.
const PriceGuide = dynamic(() => import("./hud/PriceGuide").then((m) => m.PriceGuide), { ssr: false });

/** Steps aside while the camera is working on parts, so labels stay readable. */
const useBusyView = () => useScene((s) => !!s.focus || !!s.selected || Object.keys(s.highlights).length > 0);

function ViewerTitle() {
  const carId = useScene((s) => s.carId);
  const busy = useBusyView();
  const s = CAR_SPECS[carId];
  return (
    <div className={clsx("viewer-title transition-opacity duration-300", busy && "opacity-0")} key={carId} aria-hidden={busy}>
      <div className="rise">
        <div className="eyebrow">{s.make} · {s.generation}</div>
        <div className="mt-0.5 text-[26px] font-semibold leading-none tracking-[-0.035em] md:text-[34px]">{s.model}</div>
        <div className="mt-1.5 hidden text-xs text-muted sm:block">{s.engineCode} · {s.power.split(" / ")[0]} · {s.transmission} · {s.drivetrain}</div>
      </div>
    </div>
  );
}

function ViewerHint() {
  const busy = useBusyView();
  return <span className={clsx("viewer-hint hidden transition-opacity duration-300 md:inline", busy && "opacity-0")}>Drag to rotate · Scroll to zoom</span>;
}

export function App() {
  const [search, setSearch] = useState(false);
  const [browse, setBrowse] = useState(false);
  const chatOpen = useChat((s) => s.open);
  const guideOpen = useScene((s) => s.guideOpen);
  const openSearch = useCallback(() => setSearch(true), []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    // Safari's keyboard resizes the visual viewport rather than 100dvh.
    const resize = () => {
      if (viewport.scale === 1) document.documentElement.style.setProperty("--app-height", `${viewport.height}px`);
    };
    resize();
    viewport.addEventListener("resize", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);

  useEffect(() => {
    void useOrders.getState().refresh();
    return useOrders.getState().connect();
  }, []);

  return (
    <main className="app-shell">
      <h1 className="sr-only">Crankwell — your AI mechanic</h1>
      <TopBar />
      <div className="workspace" data-chat-open={chatOpen}>
        <PartsPanel browse={browse} onClose={() => setBrowse(false)} />
        <section className="viewer-panel" aria-label="3D car explorer">
          <div className="viewer-main">
            <div className="viewer-stage">
              <Stage />
              <ViewerTitle />
              <ViewerHint />
            </div>
            <Toolbar onSearch={openSearch} onBrowse={() => setBrowse(true)} />
          </div>
          {guideOpen && <PriceGuide />}
        </section>
        <ChatSidebar />
      </div>
      <HoverTag />
      <PartSearch open={search} onClose={() => setSearch(false)} />
      <OrdersDrawer />
      <OrderToast />
    </main>
  );
}
