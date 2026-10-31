"use client";
import type { GridApi, StructuredSchemaParams } from "ag-grid-community";
import clsx from "clsx";
import { Loader2, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { askGrid } from "@/lib/commerce/client";
import { applyAskState, askState, type AskState } from "./theme";

/**
 * Ask a grid in words ("brake parts under $100, cheapest first"). The grid describes itself with the
 * AG Grid AI Toolkit's structured schema; the server's model answers with grid state in that schema.
 */
export function GridAsk({
  grid,
  api,
  columns,
  placeholder,
  reset = {},
  className,
}: {
  grid: "parts" | "orders";
  api: () => GridApi | undefined;
  /** Column descriptions for the model, by colId. */
  columns: StructuredSchemaParams["columns"];
  placeholder: string;
  /** The grid's own state to go back to on Clear (e.g. its default sort). */
  reset?: Partial<AskState>;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ask = async () => {
    const a = api();
    const question = q.trim();
    if (!a || question.length < 2 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const schema = a.getStructuredSchema({ exclude: ["pivot", "columnVisibility", "columnSizing"], columns });
      const r = await askGrid({ grid, question, schema, state: askState(a), today: new Date().toDateString() });
      if (!Object.keys(r.state).length) {
        setErr(r.explanation || "That isn't something this table can show.");
        return;
      }
      const before = askState(a);
      try {
        applyAskState(a, r.state);
      } catch (e) {
        console.warn("[grid ask] couldn't apply", r.state, e);
        applyAskState(a, before);
        setErr("Couldn't show that view. Try rephrasing.");
        return;
      }
      setShown(r.explanation || question);
      setQ("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    const a = api();
    if (a) applyAskState(a, { filter: null, sort: null, rowGroup: null, aggregation: null, ...reset });
    setShown(null);
    setErr(null);
  };

  return (
    <div className={clsx("flex min-w-0 flex-col gap-1", className)}>
      <form
        className="field flex h-8 min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        {busy ? <Loader2 size={14} className="shrink-0 animate-spin text-accent" /> : <Sparkles size={14} className="shrink-0 text-accent" />}
        <input
          aria-label={`Ask the ${grid === "parts" ? "price guide" : "ledger"}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={200}
          placeholder={placeholder}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
        />
      </form>
      {(shown || err) && (
        <div role="status" className={clsx("flex min-w-0 items-center gap-1.5 text-[11.5px]", err ? "text-danger" : "text-muted")}>
          {shown && !err && <Sparkles size={11} className="shrink-0 text-accent" />}
          <span className="min-w-0 truncate">{err ?? shown}</span>
          {shown && (
            <button type="button" onClick={clear} className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1 text-muted hover:text-ink" aria-label="Clear the AI view">
              <X size={11} /> Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
