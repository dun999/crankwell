"use client";
import clsx from "clsx";
import dynamic from "next/dynamic";
import { ViewTransition, useCallback, useEffect, useState } from "react";
import { CAR_SPECS, getPart, partCode } from "@/lib/cars";
import { SYSTEM_META } from "@/lib/cars/types";
import { getSessionId } from "@/lib/session";
import { useOrders } from "@/lib/store/orders";
import { useChat } from "@/lib/store/chat";
import { useScene } from "@/lib/store/scene";
import { ChatSidebar } from "./chat/ChatSidebar";
import { OrderToast, OrdersDrawer } from "./commerce/OrdersDrawer";
import { HoverTag } from "./hud/HoverTag";
import { PartsPanel } from "./hud/PartsPanel";
import { PartSearch } from "./hud/PartSearch";
import { StatusBar } from "./hud/StatusBar";
import { Toolbar } from "./hud/Toolbar";
import { TopBar } from "./hud/TopBar";
import { Stage } from "./Stage";

// AG Grid loads only when the price guide opens.
const PriceGuide = dynamic(() => import("./hud/PriceGuide").then((m) => m.PriceGuide), { ssr: false });

const RAIL_KEY = "crankwell.rail";

/** The figure caption always says what the view shows: the car, a section, the suspects or one part. */
function FigureCaption() {
  const carId = useScene((s) => s.carId);
  const suspects = useScene((s) => Object.keys(s.highlights).length);
  const selected = useScene((s) => s.selected);
  const isolate = useScene((s) => s.isolate);
  const focusing = useScene((s) => !!s.focus);
  const spec = CAR_SPECS[carId];
  const part = selected ? getPart(carId, selected) : undefined;
  const busy = suspects > 0 || !!part || !!isolate || focusing;
  const caption = part
    ? `Detail — ${partCode(carId, part.id)} · ${part.name}`
    : suspects
      ? `Fig. 2 — ${suspects} suspect part${suspects === 1 ? "" : "s"}, ranked`
      : isolate
        ? `Section — ${isolate.map((s) => SYSTEM_META[s].label).join(" + ")}`
        : `Fig. 1 — ${spec.make} · ${spec.generation} · ${spec.year}`;
  return (
    <div className="viewer-title" key={carId}>
      <div className="rise">
        <div className="fig">{caption}</div>
        <div className={clsx("overflow-hidden transition-[opacity,max-height] duration-300", busy ? "max-h-0 opacity-0" : "max-h-24")} aria-hidden={busy}>
          <div className="mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.04em] md:text-[32px]">{spec.model}</div>
          <div className="mono mt-2 hidden text-[11px] text-muted sm:block">
            {spec.engineCode} · {spec.power.split(" / ")[0]} · {spec.transmission} · {spec.drivetrain}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A scan line passes over the figure each time a new set of suspects arrives. */
function DiagnosisSweep() {
  const signature = useScene((s) => Object.keys(s.highlights).sort().join(","));
  return signature ? <div key={signature} className="scan-sweep" aria-hidden="true" /> : null;
}

export function App() {
  const [search, setSearch] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [rail, setRail] = useState(false);
  const chatOpen = useChat((s) => s.open);
  const guideOpen = useScene((s) => s.guideOpen);
  const selected = useScene((s) => !!s.selected);
  const openSearch = useCallback(() => setSearch(true), []);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration
      setRail(localStorage.getItem(RAIL_KEY) === "1");
    } catch {}
  }, []);
  const toggleRail = useCallback((v: boolean) => {
    setRail(v);
    try {
      localStorage.setItem(RAIL_KEY, v ? "1" : "0");
    } catch {}
  }, []);

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
    void useOrders.getState().refreshWallet();
    return useOrders.getState().connect();
  }, []);

  // Links into the app: ?case=… replays a diagnosis made in Claude, ?q=… asks the mechanic
  // (the landing page's symptom field). Either way, start from a clean figure and tidy the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("case");
    const q = url.searchParams.get("q")?.trim().slice(0, 500);
    useScene.getState().resetScene();
    if (!id && !q) return;
    url.searchParams.delete("case");
    url.searchParams.delete("q");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (q) {
      void useChat.getState().send(q);
      return;
    }
    fetch(`/api/cases/${encodeURIComponent(id!)}?session=${encodeURIComponent(getSessionId())}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => useChat.getState().openCase(d.case, d.actions ?? []))
      .catch(() => useChat.setState((s) => ({ open: true, messages: [...s.messages, { id: `case-${id}`, role: "assistant", blocks: [{ kind: "error", text: "That diagnosis link isn't valid anymore. Describe the problem here and I'll take another look." }] }] })));
  }, []);

  return (
    <main className="app-shell">
      <h1 className="sr-only">Crankwell — your AI mechanic</h1>
      <TopBar onSearch={openSearch} />
      <div className="workspace" data-chat-open={chatOpen} data-rail={rail && !selected}>
        <PartsPanel browse={browse} onClose={() => setBrowse(false)} rail={rail} onRail={toggleRail} />
        <section className="viewer-panel" aria-label="3D car explorer">
          <div className="viewer-main">
            <ViewTransition name="figure" share="morph" default="none">
              <div className="viewer-stage crop">
                <span className="crop-b" aria-hidden="true" />
                <Stage />
                <FigureCaption />
                <DiagnosisSweep />
                <span className="viewer-hint fig hidden xl:inline">Drag to rotate · scroll to zoom</span>
              </div>
            </ViewTransition>
            <Toolbar onSearch={openSearch} onBrowse={() => setBrowse(true)} />
          </div>
          {guideOpen && <PriceGuide />}
        </section>
        <ChatSidebar />
      </div>
      <StatusBar />
      <HoverTag />
      <PartSearch open={search} onClose={() => setSearch(false)} />
      <OrdersDrawer />
      <OrderToast />
    </main>
  );
}
