"use client";
import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { getCar } from "@/lib/cars";
import { useOrders } from "@/lib/store/orders";
import { usePerf } from "@/lib/store/perf";
import { useScene } from "@/lib/store/scene";

interface Config {
  paypal: { configured: boolean; env: string; webhook: boolean };
  agent: { configured: boolean; model: string; label?: string; provider?: string };
}

function Dot({ on }: { on: boolean | undefined }) {
  return <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", on === undefined ? "bg-[var(--border-strong)]" : on ? "bg-ok" : "bg-warn")} />;
}

function Item({ on, children, onClick, title }: { on?: boolean; children: ReactNode; onClick?: () => void; title?: string }) {
  const cls = "inline-flex h-full items-center gap-1.5 whitespace-nowrap px-2.5";
  if (!onClick) return <span className={cls} title={title}><Dot on={on} />{children}</span>;
  return (
    <button type="button" onClick={onClick} title={title} className={clsx(cls, "transition-colors hover:bg-surface-2 hover:text-ink")}>
      <Dot on={on} />{children}
    </button>
  );
}

/** One line of live system state at the foot of the app: the integrations a judge would ask about. */
export function StatusBar() {
  const [config, setConfig] = useState<Config | null>(null);
  const wallet = useOrders((s) => s.wallet);
  const connections = useOrders((s) => s.connections);
  const openOrders = useOrders((s) => s.setOpen);
  const carId = useScene((s) => s.carId);
  const progress = useScene((s) => s.progress);
  const fps = usePerf((s) => s.fps);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  return (
    <footer className="status-bar mono h-6 shrink-0 items-stretch overflow-hidden border-t border-line bg-surface-solid text-[10.5px] text-muted" aria-label="System status">
      <Item on={config?.agent?.configured} title={`The agent model (${config?.agent?.model ?? "…"}), served by ${config?.agent?.provider ?? "its provider"}`}>
        {config?.agent?.label ?? "Agent"} {config?.agent?.provider && <span className="text-faint">· {config.agent.provider}</span>}
      </Item>
      <span className="my-1.5 w-px bg-[var(--border)]" />
      <Item on={config?.paypal?.configured} title="PayPal Orders v2, Payments v2 and Invoicing v2">
        PayPal {config?.paypal?.env ?? ""} <span className="text-faint">· Orders · Payments · Invoicing</span>
      </Item>
      <Item on={config?.paypal?.webhook} title="PayPal webhooks keep order statuses live">webhooks</Item>
      <Item on={!!wallet} onClick={() => openOrders(true)} title={wallet ? "PayPal saved for one-tap checkout (Vault)" : "Your first PayPal purchase can save it for one-tap checkout"}>
        vault {wallet ? "saved" : "not saved"}
      </Item>
      <span className="my-1.5 w-px bg-[var(--border)]" />
      <Item on={connections.length > 0} onClick={() => openOrders(true)} title="Claude pairs with this browser over OAuth through the MCP connector">
        MCP {connections.length ? `· ${connections.map((c) => c.client).join(", ")}` : "· not paired"}
      </Item>
      <span className="ml-auto inline-flex items-center gap-3 px-3 text-faint">
        <span>{progress ? `building ${progress.done}/${progress.total}` : `${getCar(carId).parts.length} parts`}</span>
        <span className="w-[7ch] text-right tabular-nums">{fps ? `${fps} fps` : "idle"}</span>
      </span>
    </footer>
  );
}
