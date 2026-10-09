"use client";
import clsx from "clsx";
import { ArrowUp, Loader2, LocateFixed, MessageSquareText, PanelRightClose, Sparkles, Square, SquarePen } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import Image from "next/image";
import mark from "@/public/brand/crankwell-mark.webp";
import { CAR_SPECS } from "@/lib/cars/specs";
import { useChat, type Block, type ChatMessage } from "@/lib/store/chat";
import { useScene } from "@/lib/store/scene";
import { IconButton } from "../ui";
import { DiagnosisCard, FocusLine, RecommendationsCard, SafetyTestCard } from "./Cards";

const SUGGESTIONS = [
  "My brake isn't working properly. The pedal feels soft",
  "Car won't start, it just clicks",
  "Engine temperature is going into the red",
  "Grinding noise when I brake",
  "Check engine light is flashing and the car shakes",
];

export function ChatSidebar() {
  const open = useChat((s) => s.open);
  const setOpen = useChat((s) => s.setOpen);
  const messages = useChat((s) => s.messages);
  const streaming = useChat((s) => s.streaming);
  const draft = useChat((s) => s.draft);
  const setDraft = useChat((s) => s.setDraft);
  const send = useChat((s) => s.send);
  const stop = useChat((s) => s.stop);
  const reset = useChat((s) => s.reset);
  const location = useChat((s) => s.location);
  const setLocation = useChat((s) => s.setLocation);
  const carId = useScene((s) => s.carId);
  const panel = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // tell the 3D camera how much of the screen the panel covers
  useLayoutEffect(() => {
    const el = panel.current;
    const set = () => {
      const desktop = window.innerWidth >= 1024;
      const r = el?.getBoundingClientRect();
      useScene.getState().setRightInset(open && r && desktop ? r.width + 24 : 0);
      useScene.getState().setBottomInset(open && r && !desktop ? r.height + 70 : 0);
    };
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, [open]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [draft]);

  const spec = CAR_SPECS[carId];

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass pointer-events-auto fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium"
      >
        <MessageSquareText size={18} className="text-agent" /> Ask the mechanic
      </button>
    );

  return (
    <aside
      ref={panel}
      aria-label="Mechanic chat"
      className={clsx(
        "glass pointer-events-auto fixed z-30 flex flex-col overflow-hidden",
        "inset-x-2 bottom-2 h-[56dvh] rounded-3xl",
        "lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-20 lg:h-auto lg:w-[410px]",
      )}
    >
      <header className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
        <div className="relative h-9 w-9 shrink-0">
          <Image src={mark} alt="" unoptimized loading="eager" className="h-9 w-9 rounded-xl bg-white object-cover" />
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface-solid)] bg-ok" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-sm font-semibold">AI Mechanic</div>
          <div className="truncate text-[11px] text-muted">
            Nemotron · looking at your {spec.make} {spec.model}
          </div>
        </div>
        <IconButton
          label={location ? `Using your location (${location.label ?? "shared"})` : "Use my location for nearby shops"}
          active={!!location}
          onClick={() => {
            if (location) return setLocation(null);
            navigator.geolocation?.getCurrentPosition(
              (p) => setLocation({ lat: p.coords.latitude, lng: p.coords.longitude, label: "your location" }),
              () => setLocation(null),
              { timeout: 8000 },
            );
          }}
        >
          <LocateFixed size={17} />
        </IconButton>
        <IconButton label="New conversation" onClick={reset}>
          <SquarePen size={17} />
        </IconButton>
        <IconButton label="Collapse chat" onClick={() => setOpen(false)}>
          <PanelRightClose size={17} />
        </IconButton>
      </header>

      <div ref={scroller} className="scroll-thin flex-1 space-y-4 overflow-y-auto px-3.5 py-4">
        {!messages.length && <Welcome onPick={(s) => send(s)} />}
        {messages.map((m, i) => (
          <Message key={m.id} message={m} streaming={streaming && i === messages.length - 1} />
        ))}
      </div>

      <form
        className="border-t border-line p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface-solid/80 p-1.5 focus-within:border-accent">
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={1}
            placeholder="Describe what's wrong with your car…"
            className="max-h-36 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-faint"
          />
          {streaming ? (
            <IconButton label="Stop" onClick={stop} className="bg-surface-2">
              <Square size={14} className="fill-current" />
            </IconButton>
          ) : (
            <button type="submit" aria-label="Send" disabled={!draft.trim()} className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-ink transition disabled:opacity-40">
              <ArrowUp size={18} />
            </button>
          )}
        </div>
        <div className="mt-1.5 px-1 text-[10.5px] text-faint">
          Guidance only. For anything safety-critical, have a qualified mechanic inspect the car.
        </div>
      </form>
    </aside>
  );
}

function Welcome({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="space-y-3 pt-2">
      <div className="rounded-2xl border border-line bg-surface-solid/60 p-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles size={16} className="text-agent" /> Hi! Tell me what your car is doing.
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          I&apos;ll point to the parts most likely at fault on the 3D model, walk you through safe checks, and help you fix it yourself, order the part, or
          book a technician or shop. You can pay for any of those with PayPal.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => onPick(s)} className="rounded-xl border border-line px-3 py-2 text-left text-[13px] text-ink/85 transition hover:border-accent hover:text-ink">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Thinking({ blocks }: { blocks: Block[] }) {
  const last = blocks[blocks.length - 1];
  if (last?.kind === "text" && last.text.length) return null;
  const running = [...blocks].reverse().find((b) => b.kind === "tool" && b.status === "running") as Extract<Block, { kind: "tool" }> | undefined;
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-muted">
      <Loader2 size={13} className="animate-spin text-agent" />
      <span className="shimmer font-medium">{running ? running.label : "Thinking…"}</span>
    </div>
  );
}

const Message = memo(function Message({ message: m, streaming }: { message: ChatMessage; streaming: boolean }) {
  if (m.role === "user") return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13.5px] text-accent-ink">
        {(m.blocks[0] as Extract<Block, { kind: "text" }>)?.text}
      </div>
    </div>
  );
  return (
    <div className="space-y-2.5">
      {m.blocks.map((b, i) => <AssistantBlock key={i} b={b} msgId={m.id} idx={i} />)}
      {streaming && <Thinking blocks={m.blocks} />}
    </div>
  );
});

const AssistantBlock = memo(function AssistantBlock({ b, msgId, idx }: { b: Block; msgId: string; idx: number }) {
  switch (b.kind) {
    case "text":
      return (
        <div className="md text-[13.5px] leading-relaxed text-ink">
          <ReactMarkdown>{b.text}</ReactMarkdown>
        </div>
      );
    case "progress":
      return <div className="border-l-2 border-agent/40 pl-2.5 text-xs italic text-muted">{b.text}</div>;
    case "tool":
      return b.status === "running" ? null : (
        <div className="flex items-center gap-1.5 px-1 text-[11px] text-faint">
          <span className={clsx("h-1.5 w-1.5 rounded-full", b.status === "error" ? "bg-danger" : "bg-ok")} />
          {b.label}
        </div>
      );
    case "error":
      return <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{b.text}</div>;
    case "ui":
      switch (b.event.type) {
        case "focus":
          return <FocusLine e={b.event} />;
        case "diagnosis":
          return <DiagnosisCard e={b.event} />;
        case "safety_tests":
          return <SafetyTestCard e={b.event} msgId={msgId} blockIdx={idx} answers={b.answers} submitted={b.submitted} />;
        case "recommendations":
          return <RecommendationsCard e={b.event} />;
      }
  }
  return null;
});
