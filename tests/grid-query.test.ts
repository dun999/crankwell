import { beforeEach, describe, expect, it, vi } from "vitest";

// "Ask" for the grids: the model is mocked; these cover what reaches it and what comes back. The
// answer is cut down to filter/sort/group/aggregation on the grid's own columns.
const llm = vi.hoisted(() => ({ reply: "", calls: [] as { messages: { role: string; content: string }[] }[] }));
vi.mock("@/lib/agent/llm", () => ({
  complete: async (build: (p: unknown) => { messages: { role: string; content: string }[] }) => {
    const req = build({ id: "primary", model: "m", label: "Model" });
    llm.calls.push(req);
    return { provider: { id: "primary", label: "Model" }, completion: { choices: [{ message: { content: llm.reply } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } };
  },
}));

const { GridQueryBody, askGrid, sanitizeAnswer, schemaColumns } = await import("@/lib/server/grid-query");
const { tokensToday } = await import("@/lib/server/telemetry");

const schema = { type: "object", properties: { filter: {}, sort: {} }, $defs: { allColumnIds: { enum: ["part", "price", "system"] } } };

beforeEach(() => {
  llm.calls = [];
});

describe("grid ask", () => {
  it("reads the grid's columns from its schema", () => {
    expect([...schemaColumns(schema)!]).toEqual(["part", "price", "system"]);
    expect(schemaColumns({})).toBeNull();
  });

  it("keeps only known columns and the four features", () => {
    const raw = `Sure! {"state": {"filter": {"filterModel": {"system": {"filterType": "set", "values": ["brakes"]}, "bogus": {"filterType": "text"}}},
      "sort": {"sortModel": [{"colId": "price", "sort": "asc"}, {"colId": "nope", "sort": "desc"}]},
      "columnVisibility": {"hiddenColIds": ["part"]}, "rowGroup": null}, "explanation": "Brake parts, cheapest first"}`;
    const a = sanitizeAnswer(raw, schemaColumns(schema));
    expect(a.state).toEqual({
      filter: { filterModel: { system: { filterType: "set", values: ["brakes"] } } },
      sort: { sortModel: [{ colId: "price", sort: "asc" }] },
      rowGroup: null,
    });
    expect(a.explanation).toBe("Brake parts, cheapest first");
  });

  it("rejects replies that aren't grid state", () => {
    expect(() => sanitizeAnswer("I can't help with that", null)).toThrow(/didn't return a grid view/);
    expect(() => sanitizeAnswer('{"state": {"sort": {"sortModel": "price"}}}', null)).toThrow(/didn't fit/);
  });

  it("validates the request", () => {
    expect(GridQueryBody.safeParse({ grid: "parts", question: "x", schema }).success).toBe(false);
    expect(GridQueryBody.safeParse({ grid: "users", question: "brakes", schema }).success).toBe(false);
    expect(GridQueryBody.safeParse({ grid: "orders", question: "refunds this week", schema }).success).toBe(true);
  });

  it("sends the question, current state and schema, and counts the tokens", async () => {
    llm.reply = '{"state": {"sort": {"sortModel": [{"colId": "price", "sort": "desc"}]}}, "explanation": "Most expensive first"}';
    const before = tokensToday();
    const r = await askGrid({ grid: "parts", question: "most expensive first", schema, state: { filter: { filterModel: { system: { filterType: "set", values: ["brakes"] } } }, scroll: { top: 5 } } });
    expect(r).toMatchObject({ explanation: "Most expensive first", model: "Model", state: { sort: { sortModel: [{ colId: "price", sort: "desc" }] } } });
    const sent = JSON.parse(llm.calls[0].messages[1].content);
    expect(sent.question).toBe("most expensive first");
    expect(sent.current_state).toEqual({ filter: { filterModel: { system: { filterType: "set", values: ["brakes"] } } }, sort: null, rowGroup: null, aggregation: null });
    expect(sent.schema).toEqual(schema);
    expect(tokensToday() - before).toBe(15);
  });

  it("refuses an oversized schema", async () => {
    const big = { ...schema, padding: "x".repeat(70_000) };
    await expect(askGrid({ grid: "parts", question: "brakes", schema: big })).rejects.toThrow(/too large/);
    expect(llm.calls).toHaveLength(0);
  });
});
