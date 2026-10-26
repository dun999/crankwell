"use client";
import {
  Check,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Crosshair,
  MapPin,
  MessageCircle,
  Package,
  ReceiptText,
  ScanSearch,
  ShieldCheck,
  Tag,
  UserRoundCog,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { createElement, useEffect, useState } from "react";
import type { TraceSummary } from "@/lib/agent/events";
import type { Block } from "@/lib/store/chat";

type Tool = Extract<Block, { kind: "tool" }>;

const ICON: Record<string, LucideIcon> = {
  show_diagnosis: ScanSearch,
  focus_parts: Crosshair,
  request_safety_tests: ShieldCheck,
  get_part_info: Wrench,
  search_spare_parts: Tag,
  show_parts: Package,
  find_repair_shops: MapPin,
  find_technicians: UserRoundCog,
  recommend_actions: ClipboardList,
  suggest_replies: MessageCircle,
  prepare_action: CreditCard,
  get_orders: ReceiptText,
};

// While the model thinks between tools there is nothing concrete to show, so the label cycles.
const BEFORE = ["Reading your symptoms", "Analyzing your car", "Checking common causes"];
const BETWEEN = ["Working out the fix", "Comparing your options", "Almost there"];

const tools = (blocks: Block[]) => blocks.filter((b): b is Tool => b.kind === "tool");
const secs = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`);

/** The mechanic at work: what it is doing now, what it has done, and for how long. */
export function AgentWorking({ blocks, startedAt }: { blocks: Block[]; startedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const last = blocks[blocks.length - 1];
  // The reply is streaming in: the text itself is the progress.
  if (last?.kind === "text" && last.text.length) return null;

  const all = tools(blocks).filter((t) => t.name !== "suggest_replies");
  const running = [...all].reverse().find((t) => t.status === "running");
  const done = all.filter((t) => t.status === "done");
  const elapsed = startedAt ? Math.max(0, now - startedAt) : 0;
  const cycle = done.length ? BETWEEN : BEFORE;
  const label = running?.label ?? cycle[Math.min(cycle.length - 1, Math.floor(elapsed / 3500))];
  const icon = (running && ICON[running.name]) || (done.length ? Wrench : ScanSearch);

  return (
    <div className="agent-working rise">
      <span className="agent-working-icon" aria-hidden>
        {createElement(icon, { key: label, size: 15, strokeWidth: 2, className: "rise" })}
      </span>
      <div className="min-w-0 flex-1 pt-[5px]">
        <div key={label} className="rise">
          <span className="shimmer text-[12.5px] font-medium">{label}…</span>
        </div>
        <div className="agent-working-bar mt-1.5" aria-hidden />
        {done.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {done.slice(-3).map((t) => (
              <li key={t.id} className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <Check size={12} strokeWidth={2.5} className="shrink-0 text-ok" /> {t.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {elapsed >= 1000 && <span className="mono shrink-0 pt-[7px] text-[10.5px] text-faint" aria-hidden>{Math.floor(elapsed / 1000)}s</span>}
    </div>
  );
}

const kTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

/** After the turn: one quiet line that opens the agent trace (model, tools, timings, tokens). */
export function StepsSummary({ blocks, ms, trace }: { blocks: Block[]; ms?: number; trace?: TraceSummary }) {
  const list = tools(blocks).filter((t) => t.name !== "suggest_replies");
  if (!list.length && !trace?.failover && !trace?.offline) return null;
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md py-0.5 text-[11px] text-faint transition-colors hover:text-muted [&::-webkit-details-marker]:hidden">
        <Check size={12} strokeWidth={2.5} className="text-ok" />
        {ms ? `Worked for ${secs(ms)}` : "Done"} · {list.length} step{list.length === 1 ? "" : "s"}
        <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
      </summary>
      {trace && (
        <p className="mono mt-1.5 text-[10.5px] text-faint">
          {trace.offline ? "AI offline · keyword match" : `${trace.model} · ${trace.provider}${trace.failover ? " (fallback)" : ""}`}
          {trace.tokens > 0 && ` · ${kTokens(trace.tokens)} tokens`}
          {trace.llmCalls > 1 && ` · ${trace.llmCalls} model calls`}
          {trace.toolErrors > 0 && ` · ${trace.toolErrors} tool retr${trace.toolErrors === 1 ? "y" : "ies"}`}
        </p>
      )}
      <ol className="mono mt-1.5 space-y-0.5 border-l border-line-strong pl-2.5 text-[10.5px] text-faint">
        {list.map((t) => (
          <li key={t.id} className="flex items-center gap-1.5" title={t.label}>
            <span className={t.status === "error" ? "text-danger" : "text-ok"}>{t.status === "error" ? "✕" : "▸"}</span>
            <span className="text-muted">{t.name}</span>
            <span className="min-w-0 truncate">· {t.label}</span>
            {t.ms !== undefined && <span className="ml-auto shrink-0 pl-2 tabular-nums">{secs(t.ms)}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}
