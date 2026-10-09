"use client";
import { useCallback, useEffect, useState } from "react";
import { useOrders } from "@/lib/store/orders";
import { ChatSidebar } from "./chat/ChatSidebar";
import { OrderToast, OrdersDrawer } from "./commerce/OrdersDrawer";
import { PayPalRoot } from "./commerce/PayPalRoot";
import { HoverTag } from "./hud/HoverTag";
import { PartInspector } from "./hud/PartInspector";
import { PartSearch } from "./hud/PartSearch";
import { SystemPanel } from "./hud/SystemPanel";
import { Toolbar } from "./hud/Toolbar";
import { TopBar } from "./hud/TopBar";
import { Stage } from "./Stage";

export function App() {
  const [search, setSearch] = useState(false);
  const openSearch = useCallback(() => setSearch(true), []);

  useEffect(() => {
    void useOrders.getState().refresh();
    return useOrders.getState().connect();
  }, []);

  return (
    <PayPalRoot>
      <main className="relative h-dvh w-full overflow-hidden">
        <Stage />
        <TopBar />
        <div className="pointer-events-none absolute left-3 top-32 z-10 flex max-h-[calc(100dvh-220px)] flex-col gap-3 max-md:right-3 max-md:max-h-[calc(44dvh-130px)] sm:left-4 md:top-40">
          <div className="hidden min-h-[150px] shrink md:flex">
            <SystemPanel />
          </div>
          <PartInspector />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-2 max-lg:bottom-[calc(56dvh+14px)] lg:bottom-4 lg:pr-[430px]">
          <Toolbar onSearch={openSearch} />
        </div>
        <ChatSidebar />
        <HoverTag />
        <PartSearch open={search} onClose={() => setSearch(false)} />
        <OrdersDrawer />
        <OrderToast />
      </main>
    </PayPalRoot>
  );
}
