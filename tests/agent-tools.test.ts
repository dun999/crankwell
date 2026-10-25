import { describe, expect, it, vi } from "vitest";
import type { UiEvent } from "@/lib/agent/events";
import { encodeSse } from "@/lib/agent/events";
import { TOOLS, runTool } from "@/lib/agent/tools";

const ctx = () => {
  const events: UiEvent[] = [];
  return { events, ctx: { sessionId: "test-session-1", view: { carId: "corolla" as const }, emit: (e: UiEvent) => events.push(e) } };
};

describe("agent tools", () => {
  it("exposes OpenAI function tools as JSON schema", () => {
    const names = TOOLS.map((t) => (t.type === "function" ? t.function.name : ""));
    expect(names).toContain("show_diagnosis");
    for (const t of TOOLS) {
      expect(t.type).toBe("function");
      if (t.type !== "function") continue;
      expect((t.function.parameters as { type?: string }).type).toBe("object");
    }
  });

  it("show_diagnosis emits a UI event and normalizes over-confident totals", async () => {
    const { events, ctx: c } = ctx();
    const r = await runTool(
      "show_diagnosis",
      {
        car_id: "corolla",
        title: "Soft pedal",
        summary: "Likely hydraulic.",
        severity: "high",
        drive_safety: "do_not_drive",
        suspects: [
          { part_id: "brakes.master_cylinder", confidence: 0.9, rationale: "a" },
          { part_id: "brakes.lines", confidence: 0.6, rationale: "b" },
        ],
      },
      c,
    );
    expect(r.isError).toBeFalsy();
    expect(events).toHaveLength(1);
    const e = events[0] as Extract<UiEvent, { type: "diagnosis" }>;
    expect(e.suspects.reduce((a, s) => a + s.confidence, 0)).toBeLessThanOrEqual(1.01);
    expect(e.suspects[0].name).toBe("Brake master cylinder");
  });

  it("rejects unknown part ids with suggestions instead of emitting", async () => {
    const { events, ctx: c } = ctx();
    const r = await runTool("focus_parts", { car_id: "corolla", part_ids: ["brakes.master"], reason: "x" }, c);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("brakes.master_cylinder");
    expect(events).toHaveLength(0);
  });

  it("show_parts emits every SKU with the mechanic's pick and refuses parts the store doesn't sell", async () => {
    const { events, ctx: c } = ctx();
    const r = await runTool("show_parts", { car_id: "corolla", part_ids: ["electrical.battery"], headline: "Batteries", pick_tier: "Value" }, c);
    expect(r.isError).toBeFalsy();
    const e = events[0] as Extract<UiEvent, { type: "parts" }>;
    expect(e.groups[0].part.id).toBe("electrical.battery");
    expect(e.groups[0].skus.map((s) => s.tier)).toEqual(["Value", "OE-Equivalent", "Performance"]);
    expect(e.pick).toBe(e.groups[0].skus[0].sku);
    const none = await runTool("show_parts", { car_id: "corolla", part_ids: ["engine.block"], headline: "h" }, c);
    expect(none.isError).toBe(true);
    expect(events).toHaveLength(1);
  });

  it("suggest_replies emits reply chips", async () => {
    const { events, ctx: c } = ctx();
    const r = await runTool("suggest_replies", { replies: ["Yes, find me a battery", "Quick check first"] }, c);
    expect(r.isError).toBeFalsy();
    expect(events).toEqual([{ type: "replies", replies: ["Yes, find me a battery", "Quick check first"] }]);
  });

  it("returns a validation error for malformed (e.g. truncated) input", async () => {
    const { ctx: c } = ctx();
    const r = await runTool("show_diagnosis", { car_id: "corolla", title: "x" }, c);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/Invalid input/);
  });

  it("recommend_actions requires real technician / shop ids and attaches SKUs", async () => {
    const { events, ctx: c } = ctx();
    const bad = await runTool("recommend_actions", { car_id: "corolla", headline: "h", actions: [{ type: "book_technician", title: "t", why: "w", urgency: "now" }] }, c);
    expect(bad.isError).toBe(true);
    const notSold = await runTool("recommend_actions", { car_id: "corolla", headline: "h", actions: [{ type: "buy_part", title: "t", why: "w", urgency: "now", part_id: "engine.block" }] }, c);
    expect(notSold.isError).toBe(true);
    const ok = await runTool(
      "recommend_actions",
      {
        car_id: "corolla",
        headline: "h",
        actions: [
          { type: "buy_part", title: "t", why: "w", urgency: "soon", part_id: "brakes.pads.fl" },
          { type: "book_technician", title: "t", why: "w", urgency: "now", technician_id: "tech_lin" },
          { type: "reserve_shop", title: "t", why: "w", urgency: "soon", shop_id: "shop_precision_brake" },
        ],
      },
      c,
    );
    expect(ok.isError).toBeFalsy();
    const e = events[0] as Extract<UiEvent, { type: "recommendations" }>;
    expect(e.actions[0].skus).toHaveLength(3);
    expect(e.actions[1].technician?.name).toBe("Lin Chen");
    expect(e.actions[2].shop?.deposit).toBeGreaterThan(0);
  });

  it("encodes Server-Sent Events", () => {
    expect(encodeSse({ event: "text", data: { delta: "hi" } })).toBe('event: text\ndata: {"delta":"hi"}\n\n');
  });
});

vi.mock("@/lib/server/commerce", () => ({ listTransactions: () => [] }));
