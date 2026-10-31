import "server-only";
import { z } from "zod";
import { complete } from "@/lib/agent/llm";
import { CommerceError } from "./commerce";
import { addUsage } from "./telemetry";

// "Ask" for the AG Grid tables. The browser sends the grid's own structured schema (AG Grid AI
// Toolkit: api.getStructuredSchema) and the question; the model answers with grid state in that
// schema, which the browser applies with api.setState. Only filter, sort, grouping and aggregation
// are asked for; anything else in the answer is dropped, and column ids are checked against the grid.

export const GRIDS = {
  parts: "a parts price guide for one car: each row is a part with its price range, labor, how hard it is to do yourself, and whether the store sells it",
  orders: "the user's PayPal ledger: each row is a parts order, a shop deposit or a technician invoice, with its amount, status and dates",
} as const;

export const GridQueryBody = z.object({
  grid: z.enum(["parts", "orders"]),
  question: z.string().trim().min(2).max(200),
  schema: z.record(z.string(), z.unknown()),
  /** The grid's current filter/sort/group/aggregation, so follow-ups ("now sort by price") build on it. */
  state: z.record(z.string(), z.unknown()).optional(),
  today: z.string().max(40).optional(),
});
export type GridQuery = z.infer<typeof GridQueryBody>;

export const SCHEMA_MAX = 60_000;
const FEATURES = ["filter", "sort", "rowGroup", "aggregation"] as const;

const ColId = z.string().max(60);
const Answer = z.object({
  state: z
    .object({
      filter: z.object({ filterModel: z.record(z.string(), z.unknown()) }).nullable().optional(),
      sort: z.object({ sortModel: z.array(z.object({ colId: ColId, sort: z.enum(["asc", "desc"]) })).max(4) }).nullable().optional(),
      rowGroup: z.object({ groupColIds: z.array(ColId).max(3) }).nullable().optional(),
      aggregation: z.object({ aggregationModel: z.array(z.object({ colId: ColId, aggFunc: z.string().max(20) })).max(10) }).nullable().optional(),
    })
    .default({}),
  explanation: z.string().max(300).default(""),
});
export type GridAnswer = { state: z.infer<typeof Answer>["state"]; explanation: string };

/** The grid's column ids, as listed in the schema AG Grid built. */
export function schemaColumns(schema: Record<string, unknown>): Set<string> | null {
  const defs = (schema.$defs ?? schema.definitions) as Record<string, { enum?: unknown[] }> | undefined;
  const ids = defs?.allColumnIds?.enum;
  return Array.isArray(ids) ? new Set(ids.filter((x): x is string => typeof x === "string")) : null;
}

/** Parse the model's reply and keep only what this grid can apply. */
export function sanitizeAnswer(raw: string, columns: Set<string> | null): GridAnswer {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new CommerceError("The AI didn't return a grid view. Try rephrasing.", 502);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new CommerceError("The AI didn't return a grid view. Try rephrasing.", 502);
  }
  const a = Answer.safeParse(parsed);
  if (!a.success) throw new CommerceError("The AI's grid view didn't fit this table. Try rephrasing.", 502);
  const known = (id: string) => !columns || columns.has(id);
  const s = a.data.state;
  const state: GridAnswer["state"] = {};
  if (s.filter !== undefined) state.filter = s.filter && { filterModel: Object.fromEntries(Object.entries(s.filter.filterModel).filter(([id, m]) => known(id) && m && typeof m === "object")) };
  if (s.sort !== undefined) state.sort = s.sort && { sortModel: s.sort.sortModel.filter((x) => known(x.colId)) };
  if (s.rowGroup !== undefined) state.rowGroup = s.rowGroup && { groupColIds: s.rowGroup.groupColIds.filter(known) };
  if (s.aggregation !== undefined) state.aggregation = s.aggregation && { aggregationModel: s.aggregation.aggregationModel.filter((x) => known(x.colId)) };
  return { state, explanation: a.data.explanation.trim().slice(0, 160) };
}

const SYSTEM = `You set up a data grid (AG Grid) to answer a user's question. Reply with only a JSON object:
{"state": {...}, "explanation": "..."}

- "state" follows the JSON schema you're given. Use only these keys: ${FEATURES.join(", ")}.
- The current state is given. Return the complete state you want for those keys: keep what the question doesn't change, unless the user asks to start over or clear. Use null to clear a key.
- Use only column ids from the schema. Filters must match each column's filter type in the schema. Money is in US dollars.
- Group only when the user asks to group or wants totals or counts per category; when grouping, add a sum (money) or count aggregation if the schema allows it.
- "explanation" is under 12 words and says what the grid now shows, e.g. "Brake parts under $100, cheapest first".
- If the question can't be answered by filtering, sorting or grouping these columns, return "state": {} and say so briefly in "explanation".`;

/** Ask the model for grid state. */
export async function askGrid(q: GridQuery, opts: { signal?: AbortSignal } = {}): Promise<GridAnswer & { model: string }> {
  const schemaJson = JSON.stringify(q.schema);
  if (schemaJson.length > SCHEMA_MAX) throw new CommerceError("Grid schema too large", 413);
  const current = Object.fromEntries(FEATURES.map((k) => [k, q.state?.[k] ?? null]));
  const user = JSON.stringify({ grid: GRIDS[q.grid], today: q.today, question: q.question, current_state: current, schema: q.schema });
  const { provider, completion } = await complete(
    (p) => ({
      model: p.model,
      max_tokens: 4000,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
    { signal: opts.signal },
  );
  const u = completion.usage;
  if (u) addUsage(provider.id, u.prompt_tokens ?? 0, u.completion_tokens ?? 0);
  const answer = sanitizeAnswer(completion.choices[0]?.message?.content ?? "", schemaColumns(q.schema));
  return { ...answer, model: provider.label };
}
