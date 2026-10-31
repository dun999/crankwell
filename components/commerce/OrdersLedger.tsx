"use client";
import type { ColDef, GetRowIdParams, GridApi, ICellRendererParams, IDetailCellRendererParams, IRowNode, ModelUpdatedEvent, RowHeightParams, StructuredSchemaParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Download, Webhook } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isCarId, carDisplayName } from "@/lib/cars";
import { paidAfterRefunds } from "@/lib/commerce/ops";
import type { Transaction } from "@/lib/commerce/types";
import { GridAsk } from "../grid/GridAsk";
import { gridTheme } from "../grid/theme";
import { money } from "../ui";
import { KIND, StatusPill, statusLabel } from "./txMeta";

const TOTAL_ID = "__total";
const isTotal = (t?: Transaction) => t?.id === TOTAL_ID;

function TypeCell({ data, api }: ICellRendererParams<Transaction>) {
  if (!data) return null;
  if (isTotal(data)) return <span className="font-semibold text-ink">{data.title}</span>;
  const K = KIND[data.kind];
  // On narrow screens the amount column is hidden, so show the amount here.
  const amountShown = api.getColumn("amount")?.isVisible() ?? true;
  return (
    <span className="flex min-w-0 items-center gap-2.5 leading-tight">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-3 text-ink"><K.icon size={14} strokeWidth={1.75} /></span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{data.title}</span>
        <span className="block truncate text-[11px] text-muted">{amountShown ? K.short : `${money(Number(data.amount))} · ${K.short}`}</span>
      </span>
    </span>
  );
}

function StatusCell({ data, node, value }: ICellRendererParams<Transaction>) {
  // Grouped by status: the group row's key.
  if (node.group) return value ? <StatusPill status={value} /> : null;
  if (!data || isTotal(data)) return null;
  const pushed = data.events.some((e) => e.source === "paypal-webhook");
  return (
    <span className="flex items-center gap-1.5">
      <StatusPill status={data.status} />
      {pushed && <span title="Updated by a verified PayPal webhook" className="text-accent"><Webhook size={13} /></span>}
    </span>
  );
}

/** The PayPal object that identifies this transaction now. */
export function reference(tx: Transaction) {
  const p = tx.paypal;
  if (p.refundId) return { label: "Refund", id: p.refundId };
  if (p.invoiceNumber) return { label: "Invoice", id: p.invoiceNumber };
  if (p.captureId) return { label: "Capture", id: p.captureId };
  if (p.authorizationId) return { label: "Auth", id: p.authorizationId };
  if (p.orderId) return { label: "Order", id: p.orderId };
  return null;
}

function RefCell({ data }: ICellRendererParams<Transaction>) {
  if (!data || isTotal(data)) return null;
  const ref = data && reference(data);
  if (!ref) return <span className="text-faint">—</span>;
  return (
    <span className="min-w-0 leading-tight">
      <span className="block text-[10.5px] uppercase tracking-wide text-faint">{ref.label}</span>
      <span className="block truncate font-mono text-[11.5px] text-ink/85">{ref.id}</span>
    </span>
  );
}

const time = (v: string | Date) => {
  const d = new Date(v);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

/**
 * Date columns hold real Dates: left as ISO strings, AG Grid infers "dateTimeString" and the date
 * filter then matches nothing. Filters compare whole days.
 */
const dayOf = (iso?: string) => (iso ? new Date(new Date(iso).toDateString()) : null);
const dateCol = (key: "createdAt" | "updatedAt"): ColDef<Transaction> => ({
  valueGetter: ({ data }) => (data?.[key] ? new Date(data[key]) : null),
  cellDataType: "date",
  filter: "agDateColumnFilter",
  filterValueGetter: ({ data }) => dayOf(data?.[key]),
  filterParams: {
    comparator: (day: Date, cell: Date | null) => (!cell ? -1 : cell.getTime() < day.getTime() ? -1 : cell.getTime() > day.getTime() ? 1 : 0),
  },
});

interface Flow {
  id: string;
  what: string;
  amount: number;
  ref?: string;
  status?: string;
}

/** Where the money went: line items, the PayPal capture or hold, refunds, the technician's payout. */
export function moneyFlow(tx: Transaction): Flow[] {
  const p = tx.paypal;
  const amount = Number(tx.amount);
  const out: Flow[] = [];
  for (const it of tx.items ?? []) out.push({ id: `item-${it.sku}`, what: `${it.name} × ${it.quantity}`, amount: Number(it.unitPrice) * it.quantity });
  if (p.authorizationId) out.push({ id: "auth", what: tx.status === "VOIDED" ? "Hold released" : "Hold authorized", amount, ref: p.authorizationId });
  if (p.captureId) out.push({ id: "capture", what: tx.kind === "technician_invoice" ? "Invoice paid" : tx.kind === "shop_deposit" ? "Captured at check-in" : "Captured", amount, ref: p.captureId });
  else if (p.invoiceNumber) out.push({ id: "invoice", what: `Invoice · ${statusLabel(tx.status).toLowerCase().replace(/^invoice /, "")}`, amount, ref: p.invoiceNumber });
  else if (p.orderId) out.push({ id: "order", what: `Order · ${statusLabel(tx.status).toLowerCase()}`, amount, ref: p.orderId });
  if (p.refundId) out.push({ id: "refund", what: tx.job ? "Unused labor refunded to you" : "Refunded to you", amount: -(tx.job ? Number(tx.job.refunded) : amount), ref: p.refundId });
  if (tx.payout) {
    out.push({ id: "payout", what: `Paid to ${tx.payout.payee} (technician share)`, amount: Number(tx.payout.amount), ref: tx.payout.batchId, status: tx.payout.status });
    if (tx.payout.fee) out.push({ id: "fee", what: "PayPal Payouts fee (paid by Crankwell)", amount: Number(tx.payout.fee), ref: tx.payout.itemId });
  }
  return out;
}

const FLOW_COLUMNS: ColDef<Flow>[] = [
  { field: "what", headerName: "Money flow", flex: 2, minWidth: 180 },
  { field: "amount", headerName: "Amount", type: "rightAligned", width: 110, cellClass: "num", valueFormatter: ({ value }) => (value == null ? "" : value < 0 ? `−${money(-value)}` : money(value)) },
  { field: "ref", headerName: "PayPal ref", flex: 1.2, minWidth: 150, cellClass: "font-mono text-[11.5px]", valueFormatter: ({ value }) => value ?? "—" },
  { field: "status", headerName: "", width: 110, cellClass: "text-muted", valueFormatter: ({ value }) => (value ? statusLabel(value) : "") },
];

/** Column descriptions the "Ask" model reads with the grid's schema. */
const ASK_COLUMNS: StructuredSchemaParams["columns"] = {
  item: { description: "What was bought or booked" },
  kind: { description: "parts = parts order, shop_deposit = shop reservation deposit, technician_invoice = technician visit invoice", includeSetValues: true },
  amount: { description: "Amount in USD" },
  status: { description: "PayPal status: COMPLETED/CAPTURED/PAID = paid, AUTHORIZED = deposit on hold, REFUNDED, VOIDED = hold released, SENT/UNPAID = invoice awaiting payment, CREATED/APPROVED = checkout not finished", includeSetValues: true },
  ref: { description: "PayPal id: order, capture, authorization, refund or invoice number" },
  updated: { description: "Date of the last change" },
  created: { description: "Date it was created" },
  car: { description: "Which car it's for", includeSetValues: true },
};

// Grid options as constants: new objects on every render would make the grid redraw its rows.
// Filters are there for Ask; the header shows a filter icon only while one is active.
const DEFAULT_COL: ColDef<Transaction> = { sortable: true, resizable: true, suppressMovable: true, suppressHeaderFilterButton: true, enableCellChangeFlash: true };
const ROW_SELECTION = { mode: "singleRow", checkboxes: false, enableClickSelection: true, isRowSelectable: (n: IRowNode<Transaction>) => !isTotal(n.data) } as const;
const isRowMaster = (t: Transaction) => moneyFlow(t).length > 0;
const DETAIL: Partial<IDetailCellRendererParams<Transaction, Flow>> = {
  detailGridOptions: { theme: gridTheme, columnDefs: FLOW_COLUMNS, defaultColDef: { sortable: false, suppressMovable: true }, rowHeight: 32, headerHeight: 28, domLayout: "autoHeight", getRowId: ({ data }: GetRowIdParams<Flow>) => data.id },
  getDetailRowData: (p) => p.successCallback(moneyFlow(p.data)),
};
const AUTO_GROUP: ColDef<Transaction> = { headerName: "Group", minWidth: 170 };
const rowHeight = (p: RowHeightParams<Transaction>) => (p.node.rowPinned ? 38 : 52);
const getRowId = ({ data }: GetRowIdParams<Transaction>) => data.id;
const ASK_RESET = { sort: { sortModel: [{ colId: "updated", sort: "desc" as const }] } };

/** AG Grid ledger of every PayPal order, deposit and invoice in this session. */
export default function OrdersLedger({ items, selectedId, onSelect }: { items: Transaction[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const grid = useRef<AgGridReact<Transaction>>(null);
  const [total, setTotal] = useState<Transaction[]>([]);
  const columns = useMemo<ColDef<Transaction>[]>(() => [
    { colId: "item", headerName: "Item", field: "title", cellRenderer: "agGroupCellRenderer", cellRendererParams: { innerRenderer: TypeCell }, flex: 2, minWidth: 200, filter: "agTextColumnFilter" },
    {
      // Group rows carry the aggregate, which is null for an empty group.
      colId: "amount", headerName: "Amount", valueGetter: ({ data }) => Number(data?.amount ?? 0), valueFormatter: ({ value }) => (value == null ? "" : money(Number(value))), type: "rightAligned", cellClass: "num font-semibold", width: 96, minWidth: 90,
      filter: "agNumberColumnFilter", enableValue: true, allowedAggFuncs: ["sum", "avg", "min", "max", "count"],
    },
    { colId: "status", headerName: "Status", field: "status", cellRenderer: StatusCell, width: 150, minWidth: 140, filter: "agSetColumnFilter", filterParams: { valueFormatter: ({ value }: { value: string }) => statusLabel(value) }, enableRowGroup: true, valueFormatter: ({ value }) => statusLabel(value) },
    { colId: "ref", headerName: "PayPal ref", valueGetter: ({ data }) => (data ? reference(data)?.id ?? "" : ""), cellRenderer: RefCell, flex: 1.3, minWidth: 140, filter: "agTextColumnFilter" },
    { colId: "updated", headerName: "Updated", ...dateCol("updatedAt"), valueFormatter: ({ value }) => (value ? time(value) : ""), cellClass: "num text-muted", width: 118, minWidth: 112, sort: "desc" },
    // Hidden: what "Ask" filters and groups on.
    { colId: "kind", headerName: "Type", field: "kind", hide: true, filter: "agSetColumnFilter", enableRowGroup: true, valueFormatter: ({ value }) => KIND[value as Transaction["kind"]]?.short.split(" · ")[0] ?? value },
    { colId: "car", headerName: "Car", valueGetter: ({ data }) => data?.carId ?? "", hide: true, filter: "agSetColumnFilter", enableRowGroup: true, valueFormatter: ({ value }) => (isCarId(value) ? carDisplayName(value) : value || "—") },
    { colId: "created", headerName: "Created", ...dateCol("createdAt"), hide: true },
  ], []);

  useEffect(() => {
    const api = grid.current?.api;
    const node = selectedId ? api?.getRowNode(selectedId) : undefined;
    if (!api || !node) return;
    node.setSelected(true, true);
    api.ensureNodeVisible(node);
  }, [selectedId, items]);

  // A pinned total over the rows the filters leave: what was paid and stays paid, so refunded orders,
  // released holds and cancelled invoices add nothing.
  const onModelUpdated = useCallback((e: ModelUpdatedEvent<Transaction>) => {
    let n = 0;
    let sum = 0;
    e.api.forEachNodeAfterFilter((node) => {
      if (node.group || !node.data) return;
      n++;
      sum += paidAfterRefunds(node.data);
    });
    setTotal((cur) => {
      const title = `${n} shown · paid after refunds`;
      if (n <= 1) return cur.length ? [] : cur;
      if (cur[0]?.title === title && cur[0]?.amount === sum.toFixed(2)) return cur;
      return [{ id: TOTAL_ID, title, amount: sum.toFixed(2), events: [], paypal: {} } as unknown as Transaction];
    });
  }, []);

  const exportCsv = () =>
    grid.current?.api.exportDataAsCsv({
      fileName: `crankwell-paypal-ledger-${new Date().toLocaleDateString("en-CA")}.csv`,
      columnKeys: ["item", "kind", "car", "amount", "status", "ref", "created", "updated"],
      // Raw values (ISO dates, status codes) so the file is easy to work with; money keeps its cents.
      processCellCallback: ({ value, column }) => (column.getColId() === "amount" ? Number(value).toFixed(2) : value instanceof Date ? value.toISOString() : value),
      skipPinnedBottom: true,
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start gap-2 border-b border-line px-3 py-2">
        <GridAsk
          grid="orders"
          api={() => grid.current?.api as GridApi | undefined}
          columns={ASK_COLUMNS}
          placeholder="Ask: refunds this week, or totals by status"
          reset={ASK_RESET}
          className="flex-1"
        />
        <button type="button" onClick={exportCsv} title="Download the ledger as CSV" className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface-solid px-2.5 text-[12.5px] font-medium text-muted hover:text-ink">
          <Download size={13} /> CSV
        </button>
      </div>
      <div className="ag-theme-crankwell min-h-0 flex-1">
        <AgGridReact<Transaction>
          ref={grid}
          theme={gridTheme}
          rowData={items}
          columnDefs={columns}
          defaultColDef={DEFAULT_COL}
          getRowId={getRowId}
          rowSelection={ROW_SELECTION}
          onRowClicked={(e) => e.data && !isTotal(e.data) && onSelect(e.data.id)}
          onCellKeyDown={(e) => {
            if ((e.event as KeyboardEvent | null | undefined)?.key === "Enter" && e.data && !isTotal(e.data)) onSelect(e.data.id);
          }}
          masterDetail
          isRowMaster={isRowMaster}
          detailRowAutoHeight
          detailCellRendererParams={DETAIL}
          pinnedBottomRowData={total}
          onModelUpdated={onModelUpdated}
          autoGroupColumnDef={AUTO_GROUP}
          suppressAggFuncInHeader
          getRowHeight={rowHeight}
          animateRows
          onGridSizeChanged={(e) => {
            e.api.setColumnsVisible(["ref", "updated"], e.clientWidth >= 640);
            e.api.setColumnsVisible(["amount"], e.clientWidth >= 480);
            e.api.refreshCells({ columns: ["item"], force: true });
          }}
        />
      </div>
    </div>
  );
}
