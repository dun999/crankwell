"use client";
import type { ColDef, GetRowIdParams, GridApi, ICellRendererParams, IRowNode, RowClickedEvent, StructuredSchemaParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import clsx from "clsx";
import { Crosshair, MessageCircle, Search, Table2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCar, getPart, partCode } from "@/lib/cars";
import { SYSTEM_IDS, SYSTEM_META, type CarId, type SystemId } from "@/lib/cars/types";
import { useMediaQuery } from "@/lib/hooks";
import { useChat } from "@/lib/store/chat";
import { useScene } from "@/lib/store/scene";
import { GridAsk } from "../grid/GridAsk";
import { gridTheme } from "../grid/theme";
import { IconButton, Modal, money } from "../ui";

interface Row {
  id: string;
  code: string;
  name: string;
  system: SystemId;
  partMin: number;
  partMax: number;
  laborMin: number;
  laborMax: number;
  diy: number;
  lifespan: string;
  sold: boolean;
  unit?: string;
  symptoms: string[];
}

const DIY = ["", "Easy", "Basic tools", "Moderate", "Advanced", "Shop only"];

function rowsFor(carId: CarId): Row[] {
  return getCar(carId).parts.map((p) => {
    const d = getPart(carId, p.id)!;
    return {
      id: d.id,
      code: partCode(carId, d.id),
      name: d.name,
      system: d.system,
      partMin: d.price.partMin,
      partMax: d.price.partMax,
      laborMin: d.price.laborMin,
      laborMax: d.price.laborMax,
      diy: d.template_info.diy,
      lifespan: d.template_info.lifespan ?? "",
      sold: d.template_info.purchasable && d.price.partMax > 0,
      unit: d.price.unit,
      symptoms: d.template_info.symptoms,
    };
  });
}

const range = (min: number, max: number) => (max > 0 ? (min === max ? money(min) : `${money(min)}–${money(max)}`) : "—");
/** The typical (midpoint) price: what the price columns filter, sort and total on. 0 = not sold. */
const mid = (min: number, max: number) => (max > 0 ? Math.round((min + max) / 2) : 0);
/** Aggregates arrive as numbers or, for avg, as { value }. */
const aggNumber = (v: unknown) => (typeof v === "number" ? v : typeof v === "object" && v && "value" in v ? Number((v as { value: unknown }).value) : NaN);

function PartCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  const meta = SYSTEM_META[data.system];
  return (
    <span className="flex min-w-0 items-center gap-2.5 leading-tight">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color }} />
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{data.name}</span>
        <span className="block truncate text-[11px] text-muted"><span className="mono text-[10.5px] text-faint">{data.code}</span> · {meta.label}{data.unit ? ` · ${data.unit}` : ""}</span>
      </span>
    </span>
  );
}

function RangeCell({ value, data, node, strong, of }: ICellRendererParams<Row> & { strong?: boolean; of: (d: Row) => [number, number] }) {
  if (node.group) {
    const n = aggNumber(value);
    return Number.isFinite(n) ? <span className={clsx("num w-full text-right", strong ? "font-semibold text-ink" : "text-ink/85")}>{money(Math.round(n))}</span> : null;
  }
  if (!data) return null;
  const [min, max] = of(data);
  return <span className={clsx("num w-full text-right", strong ? "font-semibold text-ink" : max > 0 ? "text-ink/85" : "text-faint")}>{range(min, max)}</span>;
}

function DiyCell({ data, node, value }: ICellRendererParams<Row>) {
  if (node.group) {
    const n = aggNumber(value);
    return Number.isFinite(n) ? <span className="num text-muted">{n.toFixed(1)}/5</span> : null;
  }
  if (!data) return null;
  const color = data.diy >= 4 ? "var(--danger)" : data.diy >= 3 ? "var(--warn)" : "var(--ok)";
  return (
    <span className="flex gap-[3px]" title={DIY[data.diy]} aria-label={`DIY ${DIY[data.diy]}`}>
      {Array.from({ length: 5 }, (_, i) => <span key={i} className="h-1.5 w-2.5 rounded-full" style={{ background: i < data.diy ? color : "var(--border-strong)" }} />)}
    </span>
  );
}

function ActionsCell({ data, context }: ICellRendererParams<Row, unknown, { pick: (id: string) => void; carId: CarId }>) {
  if (!data) return null;
  return (
    <span className="flex items-center gap-0.5" data-row-action>
      <IconButton label={`Show ${data.name} on the car`} className="h-8 w-8" onClick={() => context.pick(data.id)}>
        <Crosshair size={15} strokeWidth={1.75} />
      </IconButton>
      <IconButton label={`Ask the mechanic about the ${data.name}`} className="h-8 w-8"
        onClick={() => void useChat.getState().send(`What does the ${data.name} on my ${context.carId === "crv" ? "CR-V" : "Corolla"} cost to replace, and how do I know if it's failing?`)}>
        <MessageCircle size={15} strokeWidth={1.75} />
      </IconButton>
    </span>
  );
}

const PRICE_AGG = ["avg", "min", "max", "sum"];
const priceCol = (colId: string, headerName: string, of: (d: Row) => [number, number], extra: ColDef<Row> = {}, strong = false): ColDef<Row> => ({
  colId,
  headerName,
  valueGetter: ({ data }) => (data ? mid(...of(data)) : null),
  cellRenderer: RangeCell,
  cellRendererParams: { of, strong },
  // Unsold parts (0) go last whichever way it's sorted.
  comparator: (a: number, b: number, _na, _nb, desc) => (!a === !b ? a - b : !a ? (desc ? -1 : 1) : desc ? 1 : -1),
  filter: "agNumberColumnFilter",
  enableValue: true,
  allowedAggFuncs: PRICE_AGG,
  flex: 1,
  minWidth: 120,
  headerClass: "ag-right-aligned-header",
  getQuickFilterText: () => "",
  ...extra,
});

// Filters are there for Ask; the header shows a filter icon only while one is active.
const DEFAULT_COL: ColDef<Row> = { sortable: true, resizable: true, suppressMovable: true, suppressHeaderFilterButton: true };

/** Column descriptions the "Ask" model reads with the grid's schema. */
const ASK_COLUMNS: StructuredSchemaParams["columns"] = {
  part: { description: "Part name" },
  price: { description: "Typical part price in USD (midpoint of the range); 0 = not sold as a part" },
  labor: { description: "Typical shop labor in USD to replace it" },
  total: { description: "Typical total repair cost in USD, part plus labor" },
  diy: { description: "How hard to replace at home: 1 easy, 2 basic tools, 3 moderate, 4 advanced, 5 shop only" },
  life: { description: "Typical lifespan, free text" },
  system: { description: "Car system the part belongs to", includeSetValues: true },
  store: { description: "Whether the in-app store sells this part", includeSetValues: true },
  partMax: { description: "Highest part price in USD (use for 'under $X'); 0 = not sold" },
  symptoms: { description: "Symptoms a failing part causes, free text" },
};

/** AG Grid parts price guide. Rows drive the 3D view: hover outlines the part, click flies to it. */
export function PriceGuide() {
  const open = useScene((s) => s.guideOpen);
  const docked = useMediaQuery("(min-width: 1024px)");
  if (!open) return null;
  const close = () => useScene.getState().setGuideOpen(false);
  if (docked) return <section className="guide-dock" aria-label="Price guide"><GuideBody docked onClose={close} /></section>;
  return (
    <Modal label="Price guide" className="guide-dialog" onClose={close} focusDialog>
      <GuideBody docked={false} onClose={close} />
    </Modal>
  );
}

function GuideBody({ docked, onClose }: { docked: boolean; onClose: () => void }) {
  const carId = useScene((s) => s.carId);
  const selected = useScene((s) => s.selected);
  const grid = useRef<AgGridReact<Row>>(null);
  const [query, setQuery] = useState("");
  const [system, setSystem] = useState<SystemId | "all">("all");
  const [soldOnly, setSoldOnly] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const rows = useMemo(() => rowsFor(carId), [carId]);
  const filters = useRef({ system, soldOnly });

  const pick = useCallback((id: string) => {
    const s = useScene.getState();
    const part = getPart(s.carId, id);
    if (!part) return;
    s.select(id);
    s.setIsolate([part.system]);
    s.focusParts([id], true);
    if (!docked) onClose();
  }, [docked, onClose]);

  const columns = useMemo<ColDef<Row>[]>(() => [
    {
      colId: "part", headerName: "Part", field: "name", flex: 2, minWidth: 180, cellRenderer: PartCell, filter: "agTextColumnFilter",
      getQuickFilterText: ({ data }) => `${data.name} ${SYSTEM_META[data.system].label} ${data.symptoms.join(" ")}`,
    },
    priceCol("price", "Part price", (d) => [d.partMin, d.partMax]),
    priceCol("labor", "Labor", (d) => [d.laborMin, d.laborMax]),
    priceCol("total", "Total", (d) => [d.partMin + d.laborMin, d.partMax + d.laborMax], { headerTooltip: "Typical repair: part plus shop labor", flex: 1.1, minWidth: 136 }, true),
    { colId: "diy", headerName: "DIY", field: "diy", cellRenderer: DiyCell, width: 92, minWidth: 92, headerTooltip: "How hard the job is at home, from easy to shop only", filter: "agNumberColumnFilter", enableValue: true, allowedAggFuncs: ["avg", "min", "max"], getQuickFilterText: () => "" },
    { colId: "life", headerName: "Typical life", field: "lifespan", flex: 1.2, minWidth: 130, cellClass: "text-muted", tooltip: true, filter: "agTextColumnFilter" },
    { colId: "actions", headerName: "", width: 84, minWidth: 84, sortable: false, resizable: false, cellRenderer: ActionsCell, cellStyle: { paddingLeft: 4, paddingRight: 8 }, getQuickFilterText: () => "" },
    // Hidden: what "Ask" filters and groups on.
    { colId: "system", headerName: "System", field: "system", hide: true, filter: "agSetColumnFilter", enableRowGroup: true, valueFormatter: ({ value }) => SYSTEM_META[value as SystemId]?.label ?? value, getQuickFilterText: () => "" },
    { colId: "store", headerName: "In store", valueGetter: ({ data }) => (data?.sold ? "sold" : "not sold"), hide: true, filter: "agSetColumnFilter", enableRowGroup: true, getQuickFilterText: () => "" },
    { colId: "partMax", headerName: "Highest part price", field: "partMax", hide: true, filter: "agNumberColumnFilter", getQuickFilterText: () => "" },
    { colId: "symptoms", headerName: "Symptoms", valueGetter: ({ data }) => data?.symptoms.join("; ") ?? "", hide: true, filter: "agTextColumnFilter", getQuickFilterText: () => "" },
  ], []);

  // Apply the system and in-store filters.
  useEffect(() => {
    filters.current = { system, soldOnly };
    grid.current?.api?.onFilterChanged();
  }, [system, soldOnly]);

  // Keep the grid's selection on the part selected anywhere in the app (3D view, search, chat).
  useEffect(() => {
    const api = grid.current?.api;
    if (!api) return;
    if (!selected) return api.deselectAll();
    const node = api.getRowNode(selected);
    if (!node) return;
    node.setSelected(true, true);
    api.ensureNodeVisible(node, "middle");
  }, [selected, rows]);

  const total = rows.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line py-2 pl-3 pr-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Table2 size={15} strokeWidth={1.75} className="shrink-0 text-muted" />
          <h2 className="fig text-ink">Price guide</h2>
          <span className="mono text-[10.5px] text-faint">{shown ?? total}/{total}</span>
        </div>
        <div className="order-last flex min-w-0 basis-full items-center justify-end gap-1.5 sm:order-none sm:ml-auto sm:flex-1 sm:basis-auto">
          <label className="field flex h-8 min-w-[120px] flex-1 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 focus-within:border-accent sm:max-w-[240px]">
            <Search size={14} className="shrink-0 text-muted" />
            <input aria-label="Filter parts or symptoms" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter parts or symptoms" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" />
          </label>
          <select aria-label="System" value={system} onChange={(e) => setSystem(e.target.value as SystemId | "all")} className="h-8 w-[132px] min-w-0 shrink rounded-lg border border-line bg-surface-solid px-2 text-[13px]">
            <option value="all">All systems</option>
            {SYSTEM_IDS.filter((s) => rows.some((r) => r.system === s)).map((s) => <option key={s} value={s}>{SYSTEM_META[s].label}</option>)}
          </select>
          <button type="button" aria-pressed={soldOnly} onClick={() => setSoldOnly(!soldOnly)}
            className={clsx("h-8 shrink-0 whitespace-nowrap rounded-lg border px-3 text-[13px] font-medium transition-colors", soldOnly ? "border-transparent bg-primary text-primary-ink" : "border-line bg-surface-solid text-muted hover:text-ink")}>
            In store
          </button>
        </div>
        <IconButton label="Close price guide" onClick={onClose} className="ml-auto h-9 w-9 sm:ml-0"><X size={17} /></IconButton>
      </header>
      <GridAsk
        grid="parts"
        api={() => grid.current?.api as GridApi | undefined}
        columns={ASK_COLUMNS}
        placeholder="Ask: brake parts I can DIY under $100, cheapest first"
        className="shrink-0 border-b border-line px-3 py-2"
      />
      <div className="ag-theme-crankwell relative min-h-0 flex-1" onMouseLeave={() => useScene.getState().hover(null)}>
        <AgGridReact<Row>
          ref={grid}
          theme={gridTheme}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={DEFAULT_COL}
          getRowId={({ data }: GetRowIdParams<Row>) => data.id}
          context={{ pick, carId }}
          quickFilterText={query}
          cacheQuickFilter
          isExternalFilterPresent={() => filters.current.system !== "all" || filters.current.soldOnly}
          doesExternalFilterPass={(node: IRowNode<Row>) => {
            const { system: sys, soldOnly: sold } = filters.current;
            return !!node.data && (sys === "all" || node.data.system === sys) && (!sold || node.data.sold);
          }}
          rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: false }}
          onRowClicked={(e: RowClickedEvent<Row>) => {
            if ((e.event?.target as Element | null)?.closest("[data-row-action]")) return;
            if (e.data) pick(e.data.id);
          }}
          onCellKeyDown={(e) => {
            const key = (e.event as KeyboardEvent | null | undefined)?.key;
            if (key === "Enter" && e.data) pick(e.data.id);
          }}
          onCellMouseOver={(e) => { if (docked && e.data) useScene.getState().hover(e.data.id, true); }}
          onModelUpdated={(e) => {
            let n = 0;
            e.api.forEachNodeAfterFilter((node) => void (node.group || n++));
            setShown(n);
          }}
          autoGroupColumnDef={{ headerName: "Group", minWidth: 190, flex: 1.4 }}
          suppressAggFuncInHeader
          tooltipShowDelay={400}
          animateRows
          suppressNoRowsOverlay
          alwaysShowVerticalScroll
          onGridSizeChanged={(e) => {
            const w = e.clientWidth;
            e.api.setColumnsVisible(["life"], w >= 960);
            e.api.setColumnsVisible(["actions"], w >= 820);
            e.api.setColumnsVisible(["labor"], w >= 600);
            e.api.setColumnsVisible(["price", "diy"], w >= 480);
          }}
        />
        {shown === 0 && (
          <p role="status" className="pointer-events-none absolute inset-x-0 top-[46%] text-center text-sm text-muted">No parts match these filters.</p>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-3 py-1.5 text-[11px] text-muted">
        <span>Typical 2026 US prices, not quotes. Labor varies by shop.</span>
        <span className="hidden sm:inline">{docked ? "Hover a row to find it on the car · click to fly there" : "Tap a row to see it on the car"}</span>
      </footer>
    </div>
  );
}
