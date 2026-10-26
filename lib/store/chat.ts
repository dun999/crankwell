"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getCar, getPart } from "@/lib/cars";
import type { SystemId } from "@/lib/cars/types";
import type { DiagnosisCase, SafetyTest, TraceSummary, UiEvent } from "@/lib/agent/events";
import type { Action } from "@/lib/commerce/types";
import { sessionReady } from "@/lib/session";
import { useScene } from "./scene";
import { createSelectiveStorage } from "./storage";

export type Block =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; label: string; status: "running" | "done" | "error"; at?: number; ms?: number }
  | { kind: "ui"; event: UiEvent; answers?: Record<string, string>; submitted?: boolean }
  | { kind: "error"; text: string }
  /** Buy tapped on a parts card: becomes the checkout card once the server has priced it. */
  | { kind: "checkout"; sku: string; partId?: string; label: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  blocks: Block[];
  /** Set when the message came from a diagnosis made in Claude (opened via /app?case=). */
  caseId?: string;
  /** When the mechanic started on it, and how long the turn took. */
  startedAt?: number;
  ms?: number;
  /** Which model answered, tokens and tool errors (from the server's turn trace). */
  trace?: TraceSummary;
}

interface ChatState {
  conversationId: string;
  messages: ChatMessage[];
  streaming: boolean;
  open: boolean;
  location: { lat: number; lng: number; label?: string } | null;
  draft: string;
  setDraft: (v: string) => void;
  setOpen: (v: boolean) => void;
  setLocation: (l: ChatState["location"]) => void;
  send: (text: string) => Promise<void>;
  setAnswer: (msgId: string, blockIdx: number, testId: string, answer: string) => void;
  submitAnswers: (msgId: string, blockIdx: number) => void;
  buy: (sku: string, partId: string | undefined, label: string) => void;
  replaceBlock: (msgId: string, blockIdx: number, block: Block) => void;
  openCase: (c: DiagnosisCase, actions: Action[]) => void;
  stop: () => void;
  reset: () => void;
}

let controller: AbortController | null = null;
const uid = () => Math.random().toString(36).slice(2, 10);

/** Drive the 3D scene from agent UI events. */
export function applyUiEvent(e: UiEvent) {
  const scene = useScene.getState();
  if (e.type === "focus" || e.type === "diagnosis") {
    if (e.carId !== scene.carId) scene.setCar(e.carId);
  }
  const s = useScene.getState();
  if (e.type === "focus") {
    const systems = new Set<SystemId>();
    for (const id of e.partIds) {
      const p = getPart(e.carId, id);
      if (p) systems.add(p.system);
    }
    s.setIsolate(systems.size ? [...systems] : null);
    s.select(e.partIds.length === 1 ? e.partIds[0] : null);
    s.focusParts(e.partIds, true);
  } else if (e.type === "diagnosis") {
    const highlights: Record<string, number> = {};
    const systems = new Set<SystemId>();
    for (const sp of e.suspects) {
      highlights[sp.partId] = sp.confidence;
      systems.add(sp.system);
    }
    s.setHighlights(highlights);
    s.setIsolate([...systems]);
    s.select(null);
    s.setExplode(0, null);
    const ranked = [...e.suspects].sort((a, b) => b.confidence - a.confidence);
    // frame the top suspect (and the runner-up only if it's compact and close by — CameraRig decides)
    s.focusParts(ranked.slice(0, Math.min(2, ranked.length)).map((x) => x.partId), true);
  }
}

export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      conversationId: uid() + uid(),
      messages: [],
      streaming: false,
      open: true,
      location: null,
      draft: "",
      setDraft: (draft) => set({ draft }),
      setOpen: (open) => set({ open }),
      setLocation: (location) => set({ location }),

      send: async (text: string) => {
        const msg = text.trim();
        if (!msg || get().streaming) return;
        const scene = useScene.getState();
        const assistantId = uid();
        set((s) => ({
          streaming: true,
          draft: "",
          open: true,
          messages: [...s.messages, { id: uid(), role: "user", blocks: [{ kind: "text", text: msg }] }, { id: assistantId, role: "assistant", blocks: [], startedAt: Date.now() }],
        }));

        const patch = (fn: (blocks: Block[]) => Block[]) =>
          set((s) => ({ messages: s.messages.map((m) => (m.id === assistantId ? { ...m, blocks: fn(m.blocks) } : m)) }));

        controller = new AbortController();
        try {
          await sessionReady();
          const res = await fetch("/api/agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              conversationId: get().conversationId,
              message: msg,
              view: { carId: scene.carId, selectedPart: scene.selected, location: get().location },
            }),
          });
          if (!res.ok || !res.body) {
            const err = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
            patch((b) => [...b, { kind: "error", text: err.error ?? "Request failed" }]);
            return;
          }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const chunk = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const ev = /^event: (.+)$/m.exec(chunk)?.[1];
              const data = /^data: (.*)$/m.exec(chunk)?.[1];
              if (!ev || data === undefined) continue;
              const d = JSON.parse(data);
              if (ev === "text") {
                patch((b) => {
                  const last = b[b.length - 1];
                  if (last?.kind === "text") return [...b.slice(0, -1), { kind: "text", text: last.text + d.delta }];
                  return [...b, { kind: "text", text: d.delta }];
                });
              } else if (ev === "tool") {
                patch((b) => {
                  const idx = b.findIndex((x) => x.kind === "tool" && x.id === d.id);
                  const prev = idx >= 0 ? (b[idx] as Extract<Block, { kind: "tool" }>) : undefined;
                  const at = prev?.at ?? Date.now();
                  const block: Block = { kind: "tool", id: d.id, name: d.name, label: d.label, status: d.status, at, ms: d.status === "running" ? undefined : Date.now() - at };
                  if (idx >= 0) return b.map((x, k) => (k === idx ? block : x));
                  return [...b, block];
                });
              } else if (ev === "ui") {
                patch((b) => [...b, { kind: "ui", event: d }]);
                applyUiEvent(d);
              } else if (ev === "error") {
                patch((b) => [...b, { kind: "error", text: d.message }]);
              } else if (ev === "done" && d.trace) {
                set((s) => ({ messages: s.messages.map((m) => (m.id === assistantId ? { ...m, trace: d.trace } : m)) }));
              }
            }
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") patch((b) => [...b, { kind: "error", text: "Connection lost. Please try again." }]);
        } finally {
          controller = null;
          set((s) => ({
            streaming: false,
            messages: s.messages.map((m) => (m.id === assistantId ? { ...m, ms: Date.now() - (m.startedAt ?? Date.now()) } : m)),
          }));
        }
      },

      setAnswer: (msgId, blockIdx, testId, answer) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id !== msgId
              ? m
              : {
                  ...m,
                  blocks: m.blocks.map((b, i) => (i === blockIdx && b.kind === "ui" ? { ...b, answers: { ...b.answers, [testId]: answer } } : b)),
                },
          ),
        })),

      submitAnswers: (msgId, blockIdx) => {
        const m = get().messages.find((x) => x.id === msgId);
        const b = m?.blocks[blockIdx];
        if (!b || b.kind !== "ui" || b.event.type !== "safety_tests") return;
        const tests: SafetyTest[] = b.event.tests;
        const lines = tests.map((t) => `- ${t.title}: ${b.answers?.[t.id] ?? "skipped"}`);
        set((s) => ({
          messages: s.messages.map((x) =>
            x.id !== msgId ? x : { ...x, blocks: x.blocks.map((y, i) => (i === blockIdx && y.kind === "ui" ? { ...y, submitted: true } : y)) },
          ),
        }));
        void get().send(`Here are my safety test results:\n${lines.join("\n")}`);
      },

      buy: (sku, partId, label) => {
        if (get().streaming) return;
        set((s) => ({
          open: true,
          messages: [
            ...s.messages,
            { id: uid(), role: "user", blocks: [{ kind: "text", text: `Buy ${label}` }] },
            { id: uid(), role: "assistant", blocks: [{ kind: "checkout", sku, partId, label }] },
          ],
        }));
      },

      replaceBlock: (msgId, blockIdx, block) =>
        set((s) => ({ messages: s.messages.map((m) => (m.id !== msgId ? m : { ...m, blocks: m.blocks.map((b, i) => (i === blockIdx ? block : b)) })) })),

      openCase: (c, actions) => {
        const diagnosis: UiEvent = { type: "diagnosis", carId: c.carId, title: c.title, summary: c.summary, severity: c.severity, driveSafety: c.driveSafety, suspects: c.suspects };
        applyUiEvent(diagnosis);
        if (get().messages.some((m) => m.caseId === c.id)) return set({ open: true });
        const blocks: Block[] = [
          { kind: "text", text: `From Claude: here's the diagnosis${c.vehicle ? ` for your ${c.vehicle}` : ""}. The suspect parts are highlighted on the car.` },
          { kind: "ui", event: diagnosis },
        ];
        if (c.options) blocks.push({ kind: "ui", event: { type: "recommendations", carId: c.carId, headline: c.options.headline, actions: c.options.actions } });
        for (const action of actions.filter((a) => a.status === "pending" || a.status === "confirmed")) blocks.push({ kind: "ui", event: { type: "action", action, oneTap: false } });
        set((s) => ({ open: true, messages: [...s.messages, { id: uid(), role: "assistant", caseId: c.id, blocks }] }));
      },

      stop: () => controller?.abort(),
      reset: () => {
        controller?.abort();
        useScene.getState().clearDiagnosis();
        set({ messages: [], conversationId: uid() + uid(), streaming: false });
      },
    }),
    {
      name: "fyc.chat",
      storage: createSelectiveStorage<Pick<ChatState, "conversationId" | "messages" | "location" | "open">>(),
      partialize: (s) => ({ conversationId: s.conversationId, messages: s.messages, location: s.location, open: s.open }),
    },
  ),
);

export function partLabel(carId: Parameters<typeof getCar>[0], id: string) {
  return getPart(carId, id)?.name ?? id;
}
