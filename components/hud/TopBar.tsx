"use client";
import clsx from "clsx";
import { MessageSquareText, Monitor, Moon, Receipt, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import Image from "next/image";
import Link from "next/link";
import mark from "@/public/brand/crankwell-mark.webp";
import { useMounted } from "@/lib/hooks";
import { CAR_SPECS } from "@/lib/cars/specs";
import type { CarId } from "@/lib/cars/types";
import { useChat } from "@/lib/store/chat";
import { useOrders } from "@/lib/store/orders";
import { useScene } from "@/lib/store/scene";
import { IconButton } from "../ui";

const CARS: CarId[] = ["corolla", "crv"];

export function TopBar({ onSearch }: { onSearch: () => void }) {
  const carId = useScene((s) => s.carId);
  const setCar = useScene((s) => s.setCar);
  const { theme, setTheme } = useTheme();
  const openOrders = useOrders((s) => s.setOpen);
  const active = useOrders((s) => s.items.filter((o) => ["APPROVED", "AUTHORIZED", "SENT", "UNPAID"].includes(o.status)).length);
  const chatOpen = useChat((s) => s.open);
  const mounted = useMounted();
  const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const mac = mounted && /Mac|iPhone|iPad/.test(navigator.userAgent);

  return (
    <header className="app-header">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md" aria-label="Crankwell home">
          <Image src={mark} alt="" width={28} height={28} sizes="28px" loading="eager" className="rounded-[7px] bg-white ring-1 ring-line" />
          <span className="hidden text-[15px] font-semibold tracking-[-0.025em] min-[360px]:inline">Crankwell</span>
        </Link>
        <span aria-hidden="true" className="hidden text-[15px] font-light text-line-strong md:inline">/</span>
        <nav aria-label="Choose a car" className="hidden items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5 md:flex">
          {CARS.map((id) => {
            const s = CAR_SPECS[id];
            const on = carId === id;
            return (
              <button key={id} type="button" onClick={() => setCar(id)} aria-pressed={on} title={`${s.make} ${s.model} ${s.generation} · ${s.year}`}
                className={clsx("flex h-8 items-center gap-1.5 rounded-md px-2.5 transition-[background-color,color,box-shadow] duration-150",
                  on ? "bg-surface-solid text-ink shadow-[var(--shadow)] ring-1 ring-line" : "text-muted hover:text-ink")}>
                <span className="text-[13px] font-semibold tracking-[-0.01em]">{s.model}</span>
                <span className="mono text-[10.5px] text-faint">{s.engineCode}</span>
              </button>
            );
          })}
        </nav>
      </div>
      <button type="button" onClick={onSearch} aria-label="Search parts and actions, or ask the mechanic"
        className="hidden h-8 w-[clamp(240px,32vw,440px)] items-center gap-2 rounded-lg border border-line bg-surface-2 pl-2.5 pr-1.5 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink md:flex">
        <Search size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Search parts, systems, or ask the mechanic…</span>
        <span className="kbd">{mac ? "⌘K" : "Ctrl K"}</span>
      </button>
      <select aria-label="Choose a car" className="min-h-11 min-w-0 rounded-lg border border-line bg-surface-solid px-2 text-sm font-medium md:hidden" value={carId} onChange={(e) => setCar(e.target.value as CarId)}>
        {CARS.map((id) => <option key={id} value={id}>{CAR_SPECS[id].model}</option>)}
      </select>
      <div className="flex items-center justify-self-end gap-1">
        <span className="mono hidden items-center gap-1.5 px-2 text-[10.5px] uppercase tracking-[0.06em] text-muted xl:inline-flex" title="Payments run in the PayPal sandbox. No real money moves.">
          <span className="h-1.5 w-1.5 rounded-full bg-pay ring-2 ring-pay/25" /> Sandbox
        </span>
        <IconButton label="My orders & bookings" onClick={() => openOrders(true)} className="relative lg:w-auto lg:gap-1.5 lg:px-2.5">
          <Receipt size={17} strokeWidth={1.75} /><span className="hidden text-[13px] font-medium lg:inline">Orders</span>
          {active > 0 && <span className="mono absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink lg:static lg:h-[18px] lg:min-w-[18px]">{active}</span>}
        </IconButton>
        {!chatOpen && (
          <IconButton label="Ask the mechanic" onClick={() => useChat.getState().setOpen(true)} className="max-lg:hidden lg:w-auto lg:gap-1.5 lg:px-2.5">
            <MessageSquareText size={17} strokeWidth={1.75} className="text-agent" /><span className="text-[13px] font-medium">Mechanic</span>
          </IconButton>
        )}
        <IconButton label={mounted ? `Theme: ${theme} (switch to ${next})` : "Theme"} onClick={() => setTheme(next)}>
          {!mounted || theme === "system" ? <Monitor size={17} strokeWidth={1.75} /> : theme === "dark" ? <Moon size={17} strokeWidth={1.75} /> : <Sun size={17} strokeWidth={1.75} />}
        </IconButton>
      </div>
    </header>
  );
}
