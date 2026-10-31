"use client";
import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  ColumnApiModule,
  CsvExportModule,
  DateFilterModule,
  ExternalFilterModule,
  GridStateModule,
  HighlightChangesModule,
  ModuleRegistry,
  NumberFilterModule,
  PinnedRowModule,
  QuickFilterModule,
  RenderApiModule,
  RowApiModule,
  RowSelectionModule,
  ScrollApiModule,
  TextFilterModule,
  TooltipModule,
  ValidationModule,
  themeQuartz,
  type GridApi,
  type GridState,
  type GridStateKey,
} from "ag-grid-community";
import { AiToolkitModule, LicenseManager, MasterDetailModule, RowGroupingModule, SetFilterModule } from "ag-grid-enterprise";

// Only the modules the grids use, so the lazy grid chunk stays small. Enterprise: the AI Toolkit
// (structured schema for "Ask"), grouping with totals, set filters and master/detail in the ledger.
LicenseManager.setLicenseKey(process.env.NEXT_PUBLIC_AG_GRID_LICENSE ?? "");
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  ClientSideRowModelApiModule,
  ColumnApiModule,
  QuickFilterModule,
  ExternalFilterModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  SetFilterModule,
  GridStateModule,
  RowSelectionModule,
  RowApiModule,
  RenderApiModule,
  ScrollApiModule,
  CellStyleModule,
  TooltipModule,
  CsvExportModule,
  HighlightChangesModule,
  PinnedRowModule,
  RowGroupingModule,
  MasterDetailModule,
  AiToolkitModule,
  ...(process.env.NODE_ENV !== "production" ? [ValidationModule] : []),
]);

/** What "Ask" may change; everything else (column layout, selection, scroll) stays as it is. */
export const ASK_FEATURES = ["filter", "sort", "rowGroup", "aggregation"] as const;
export type AskState = Pick<GridState, (typeof ASK_FEATURES)[number]>;
const KEEP: GridStateKey[] = [
  "columnVisibility",
  "columnSizing",
  "columnOrder",
  "columnPinning",
  "columnGroup",
  "columnHeaderName",
  "focusedCell",
  "pagination",
  "rowPinning",
  "rowSelection",
  "rowGroupExpansion",
  "scroll",
  "sideBar",
  "quickFilter",
  "pivot",
  "cellSelection",
];

export function askState(api: GridApi): AskState {
  const s = api.getState();
  return { filter: s.filter, sort: s.sort, rowGroup: s.rowGroup, aggregation: s.aggregation };
}

/** Apply an Ask answer: keys it sets (null clears) replace the current ones; nothing else moves. */
export function applyAskState(api: GridApi, next: Partial<Record<(typeof ASK_FEATURES)[number], unknown>>) {
  const state: GridState = { ...api.getState() };
  for (const k of ASK_FEATURES) if (k in next) (state as Record<string, unknown>)[k] = next[k] ?? undefined;
  api.setState(state, KEEP);
}

/** Quartz with Crankwell's tokens. The values are CSS variables, so light/dark follow the app theme. */
export const gridTheme = themeQuartz.withParams({
  fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  fontSize: 12.5,
  headerFontSize: 10.5,
  headerFontWeight: 500,
  backgroundColor: "var(--surface-solid)",
  chromeBackgroundColor: "var(--surface-solid)",
  foregroundColor: "var(--text)",
  subtleTextColor: "var(--muted)",
  headerBackgroundColor: "var(--surface-2)",
  headerTextColor: "var(--muted)",
  borderColor: "var(--border)",
  accentColor: "var(--accent)",
  rowHoverColor: "var(--surface-2)",
  selectedRowBackgroundColor: "var(--accent-soft)",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  columnBorder: false,
  headerColumnBorder: false,
  headerColumnResizeHandleColor: "var(--border)",
  iconColor: "var(--faint)",
  iconSize: 13,
  spacing: 5,
  cellHorizontalPadding: 12,
  rowHeight: 34,
  headerHeight: 30,
  tooltipBackgroundColor: "var(--surface-solid)",
  tooltipTextColor: "var(--text)",
  tooltipBorder: true,
  rangeSelectionBorderColor: "var(--border-strong)",
});
