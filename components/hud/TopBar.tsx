"use client";
import clsx from "clsx";
import { Monitor, Moon, Receipt, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import Image from "next/image";
import mark from "@/public/brand/crankwell-mark.webp";
import { useMounted } from "@/lib/hooks";
import { CAR_SPECS } from "@/lib/cars/specs";
import type { CarId } from "@/lib/cars/types";
import { useOrders } from "@/lib/store/orders";
import { useScene } from "@/lib/store/scene";
import { IconButton } from "../ui";

const CARS: CarId[] = ["corolla", "crv"];

export function TopBar() {
  const carId = useScene((s) => s.carId);
  const setCar = useScene((s) => s.setCar);
  const { theme, setTheme } = useTheme();
  const openOrders = useOrders((s) => s.setOpen);
  const active = useOrders((s) => s.items.filter((o) => ["APPROVED", "AUTHORIZED", "SENT", "UNPAID"].includes(o.status)).length);
  const mounted = useMounted();
  const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";

  return (
    <header className="app-header">
      <div className="flex shrink-0 items-center gap-2.5" aria-label="Crankwell">
        <Image src={mark} alt="Crankwell" width={34} height={34} sizes="34px" loading="eager" className="rounded-[10px] bg-white shadow-[var(--shadow-sm)] ring-1 ring-line" />
        <span aria-hidden="true" className="hidden text-[17px] font-semibold tracking-[-0.02em] min-[360px]:inline">Crankwell</span>
      </div>
      <nav aria-label="Choose a car" className="hidden items-center gap-0.5 rounded-[14px] bg-surface-3 p-1 md:flex">
        {CARS.map((id) => {
          const s = CAR_SPECS[id];
          return (
            <button key={id} type="button" onClick={() => setCar(id)} aria-pressed={carId === id}
              className={clsx("min-h-11 rounded-[10px] px-4 py-1 text-left transition-[background-color,box-shadow,color] duration-200",
                carId === id ? "bg-surface-solid text-ink shadow-[var(--highlight),var(--shadow-sm)] ring-1 ring-line" : "text-muted hover:text-ink")}>
              <div className="text-[13px] font-semibold tracking-[-0.01em]">{s.make} {s.model}</div>
              <div className="text-[11px] text-muted">{s.engineCode} · {s.drivetrain} · {s.year}</div>
            </button>
          );
        })}
      </nav>
      <select aria-label="Choose a car" className="min-h-11 min-w-0 rounded-xl border border-line bg-surface-solid px-2 text-sm font-medium md:hidden" value={carId} onChange={(e) => setCar(e.target.value as CarId)}>
        {CARS.map((id) => <option key={id} value={id}>{CAR_SPECS[id].model}</option>)}
      </select>
      <div className="flex items-center justify-self-end gap-1.5">
        <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface-solid px-2.5 py-1 text-[11px] font-medium text-muted shadow-[var(--shadow-sm)] lg:inline-flex" title="Payments run in the PayPal sandbox. No real money moves.">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ffc439] ring-2 ring-[#ffc439]/25" /> PayPal sandbox
        </span>
        <IconButton label="My orders & bookings" onClick={() => openOrders(true)} className="relative lg:w-auto lg:gap-2 lg:px-3">
          <Receipt size={18} strokeWidth={1.75} /><span className="hidden text-[13px] font-medium lg:inline">Orders</span>
          {active > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink lg:static lg:h-5 lg:min-w-5">{active}</span>}
        </IconButton>
        <IconButton label={mounted ? `Theme: ${theme} (switch to ${next})` : "Theme"} onClick={() => setTheme(next)}>
          {!mounted || theme === "system" ? <Monitor size={18} strokeWidth={1.75} /> : theme === "dark" ? <Moon size={18} strokeWidth={1.75} /> : <Sun size={18} strokeWidth={1.75} />}
        </IconButton>
      </div>
    </header>
  );
}
