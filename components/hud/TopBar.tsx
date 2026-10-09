"use client";
import clsx from "clsx";
import { Monitor, Moon, Receipt, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import Image from "next/image";
import logo from "@/public/brand/crankwell-logo.webp";
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
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3 sm:p-4">
      <div className="glass pointer-events-auto rounded-2xl p-1.5">
        <Image src={logo} alt="Crankwell" unoptimized loading="eager" className="h-auto w-28 rounded-xl bg-white sm:w-36" />
      </div>

      <nav aria-label="Choose a car" className="glass pointer-events-auto hidden items-center gap-1 rounded-2xl p-1 md:flex">
        {CARS.map((id) => {
          const s = CAR_SPECS[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => setCar(id)}
              aria-pressed={carId === id}
              className={clsx(
                "rounded-xl px-4 py-1.5 text-left transition",
                carId === id ? "bg-surface-solid shadow-sm ring-1 ring-line" : "text-muted hover:text-ink",
              )}
            >
              <div className="text-sm font-semibold">
                {s.make} {s.model}
              </div>
              <div className="text-[11px] text-muted">
                {s.engineCode} · {s.drivetrain} · {s.year}
              </div>
            </button>
          );
        })}
      </nav>

      <div className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1">
        <select
          aria-label="Choose a car"
          className="h-9 rounded-xl bg-transparent px-2 text-sm font-medium md:hidden"
          value={carId}
          onChange={(e) => setCar(e.target.value as CarId)}
        >
          {CARS.map((id) => (
            <option key={id} value={id}>
              {CAR_SPECS[id].model}
            </option>
          ))}
        </select>
        <IconButton label="My orders & bookings" onClick={() => openOrders(true)} className="relative">
          <Receipt size={18} />
          {active > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">
              {active}
            </span>
          )}
        </IconButton>
        <IconButton label={mounted ? `Theme: ${theme} (switch to ${next})` : "Theme"} onClick={() => setTheme(next)}>
          {!mounted || theme === "system" ? <Monitor size={18} /> : theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
        </IconButton>
      </div>
    </header>
  );
}
