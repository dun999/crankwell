import { Info } from "lucide-react";
import type { Action } from "@/lib/commerce/types";
import { KIND } from "./txMeta";

const fmt = (v: string) => `$${Number(v).toFixed(2)}`;

/** What the agent prepared, priced by the server: line items, total and what happens to the money. */
export function ActionSummary({ action, compact }: { action: Action; compact?: boolean }) {
  const K = KIND[action.kind];
  const held = action.kind === "shop_deposit";
  const later = action.kind === "technician_invoice";
  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-3 text-ink"><K.icon size={18} strokeWidth={1.75} /></span>
        <div className="min-w-0">
          <div className={compact ? "text-sm font-semibold leading-snug" : "text-[17px] font-semibold leading-snug tracking-[-0.01em]"}>{action.title}</div>
          <div className="mt-0.5 text-xs text-muted">{action.summary}</div>
        </div>
      </div>
      <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[13px]">
        {action.lines.map((l) => (
          <div key={l.label} className="flex justify-between gap-3">
            <dt className="min-w-0 text-muted">{l.label}</dt>
            <dd className="num shrink-0">{fmt(l.amount)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-line pt-2 font-semibold">
          <dt>{held ? "Held today" : later ? "Invoice total" : "Total"}</dt>
          <dd className="num">{fmt(action.amount)}</dd>
        </div>
      </dl>
      <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-muted">
        <Info size={12} className="mt-0.5 shrink-0" /> {action.policy}
      </p>
    </div>
  );
}
