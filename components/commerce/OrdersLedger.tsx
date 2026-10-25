"use client";
import type { ColDef, GetRowIdParams, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Webhook } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { Transaction } from "@/lib/commerce/types";
import { gridTheme } from "../grid/theme";
import { money } from "../ui";
import { KIND, StatusPill } from "./txMeta";

function TypeCell({ data, api }: ICellRendererParams<Transaction>) {
  if (!data) return null;
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

function StatusCell({ data }: ICellRendererParams<Transaction>) {
  if (!data) return null;
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
  const ref = data && reference(data);
  if (!ref) return <span className="text-faint">—</span>;
  return (
    <span className="min-w-0 leading-tight">
      <span className="block text-[10.5px] uppercase tracking-wide text-faint">{ref.label}</span>
      <span className="block truncate font-mono text-[11.5px] text-ink/85">{ref.id}</span>
    </span>
  );
}

const time = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** AG Grid ledger of every PayPal order, deposit and invoice in this session. */
export default function OrdersLedger({ items, selectedId, onSelect }: { items: Transaction[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const grid = useRef<AgGridReact<Transaction>>(null);
  const columns = useMemo<ColDef<Transaction>[]>(() => [
    { colId: "item", headerName: "Item", field: "title", cellRenderer: TypeCell, flex: 2, minWidth: 200 },
    { colId: "amount", headerName: "Amount", valueGetter: ({ data }) => Number(data?.amount ?? 0), valueFormatter: ({ value }) => money(value), type: "rightAligned", cellClass: "num font-semibold", width: 96, minWidth: 90 },
    { colId: "status", headerName: "Status", field: "status", cellRenderer: StatusCell, width: 150, minWidth: 140 },
    { colId: "ref", headerName: "PayPal ref", valueGetter: ({ data }) => (data ? reference(data)?.id ?? "" : ""), cellRenderer: RefCell, flex: 1.3, minWidth: 140 },
    { colId: "updated", headerName: "Updated", field: "updatedAt", valueFormatter: ({ value }) => time(value), cellClass: "num text-muted", width: 104, minWidth: 100, sort: "desc" },
  ], []);

  useEffect(() => {
    const api = grid.current?.api;
    const node = selectedId ? api?.getRowNode(selectedId) : undefined;
    if (!api || !node) return;
    node.setSelected(true, true);
    api.ensureNodeVisible(node);
  }, [selectedId, items]);

  return (
    <div className="ag-theme-crankwell h-full min-h-0">
      <AgGridReact<Transaction>
        ref={grid}
        theme={gridTheme}
        rowData={items}
        columnDefs={columns}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        getRowId={({ data }: GetRowIdParams<Transaction>) => data.id}
        rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
        onRowClicked={(e) => e.data && onSelect(e.data.id)}
        onCellKeyDown={(e) => {
          if ((e.event as KeyboardEvent | null | undefined)?.key === "Enter" && e.data) onSelect(e.data.id);
        }}
        rowHeight={52}
        animateRows
        onGridSizeChanged={(e) => {
          e.api.setColumnsVisible(["ref", "updated"], e.clientWidth >= 640);
          e.api.setColumnsVisible(["amount"], e.clientWidth >= 480);
          e.api.refreshCells({ columns: ["item"], force: true });
        }}
      />
    </div>
  );
}
