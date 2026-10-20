"use client";
import clsx from "clsx";
import { ArrowUp, AudioWaveform, BatteryWarning, CreditCard, Disc3, Loader2, LocateFixed, MessageSquareText, PanelRightClose, ScanSearch, ShieldCheck, Square, SquarePen, ThermometerSun } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import mark from "@/public/brand/crankwell-mark.webp";
import { CAR_SPECS } from "@/lib/cars/specs";
import { useChat, type Block, type ChatMessage } from "@/lib/store/chat";
import { useScene } from "@/lib/store/scene";
import { IconButton } from "../ui";
const ReactMarkdown = dynamic(() => import("react-markdown"), { loading: () => <span className="text-muted">Loading message…</span> });
const DiagnosisCard = dynamic(() => import("./Cards").then((m) => m.DiagnosisCard));
const FocusLine = dynamic(() => import("./Cards").then((m) => m.FocusLine));
const RecommendationsCard = dynamic(() => import("./Cards").then((m) => m.RecommendationsCard));
const SafetyTestCard = dynamic(() => import("./Cards").then((m) => m.SafetyTestCard));

const SUGGESTIONS = [
  { label: "Soft brake pedal", message: "My brake isn't working properly. The pedal feels soft", icon: Disc3 },
  { label: "Car won't start", message: "Car won't start, it just clicks", icon: BatteryWarning },
  { label: "Engine overheating", message: "Engine temperature is going into the red", icon: ThermometerSun },
  { label: "Grinding when braking", message: "Grinding noise when I brake", icon: AudioWaveform },
];

const STEPS = [
  { icon: ScanSearch, title: "Pinpoint", text: "Likely causes light up on the 3D model" },
  { icon: ShieldCheck, title: "Check safely", text: "Quick checks narrow it down" },
  { icon: CreditCard, title: "Fix & pay", text: "DIY, parts or a pro, paid with PayPal" },
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
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const followMessages = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    // An empty chat shows the welcome from its top; a conversation follows the newest message.
    if (el && followMessages.current) el.scrollTo({ top: messages.length ? el.scrollHeight : 0, behavior: "instant" });
  }, [messages, open]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [draft, open]);

  const spec = CAR_SPECS[carId];

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="chat-launcher"
      >
        <MessageSquareText size={18} className="text-agent" /> Ask the mechanic
      </button>
    );

  return (
    <aside
      aria-label="Mechanic chat"
      className="chat-panel card"
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-line py-2.5 pl-3.5 pr-2">
        <div className="relative mr-1.5 h-9 w-9 shrink-0">
          <Image src={mark} alt="" width={36} height={36} sizes="36px" loading="eager" className="h-9 w-9 rounded-[11px] bg-white object-cover ring-1 ring-line" />
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface-solid)] bg-ok" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[14px] font-semibold tracking-[-0.01em]">AI Mechanic</div>
          <div className="truncate text-[11px] text-muted">
            Looking at your {spec.make} {spec.model}
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

      <div ref={scroller} role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions" onScroll={(e) => {
        const el = e.currentTarget;
        followMessages.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }} className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
        {!messages.length && <Welcome onPick={(s) => send(s)} />}
        {messages.map((m, i) => (
          <Message key={m.id} message={m} streaming={streaming && i === messages.length - 1} />
        ))}
      </div>

      <form
        className="chat-composer shrink-0 p-3 pt-0"
        onSubmit={(e) => {
          e.preventDefault();
          followMessages.current = true;
          void send(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-[18px] border border-line bg-surface-2 p-1.5 transition-[background-color,border-color,box-shadow] focus-within:border-line-strong focus-within:bg-surface-solid focus-within:shadow-[var(--shadow)]">
          <textarea
            ref={input}
            aria-label="Describe your car problem"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                followMessages.current = true;
                void send(draft);
              }
            }}
            rows={1}
            placeholder="Describe a symptom…"
            className="max-h-36 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-base outline-none placeholder:text-muted sm:text-sm"
          />
          {streaming ? (
            <IconButton label="Stop" onClick={stop} className="bg-surface-3">
              <Square size={13} className="fill-current" />
            </IconButton>
          ) : (
            <button type="submit" aria-label="Send" disabled={!draft.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-primary text-primary-ink transition-opacity hover:opacity-90 disabled:opacity-25">
              <ArrowUp size={18} strokeWidth={2.25} />
            </button>
          )}
        </div>
        <div className="mt-2 px-1 text-center text-[11px] leading-snug text-faint">
          Guidance only. Have a mechanic inspect safety-critical issues.
        </div>
      </form>
    </aside>
  );
}

function Welcome({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="rise space-y-5">
      <div className="pt-1">
        <h2 className="text-[19px] font-semibold leading-tight tracking-[-0.025em]">What&apos;s your car doing?</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Describe a symptom. I&apos;ll point to the likely parts on the model, walk you through safe checks and price the fix.
        </p>
      </div>
      <div>
        <p className="eyebrow mb-2">Try a common symptom</p>
        <div className="grid grid-cols-2 gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s.label} type="button" onClick={() => onPick(s.message)}
              className="group flex min-h-11 items-center gap-2.5 rounded-2xl border border-line bg-surface-solid px-3 py-2.5 text-left text-[13px] font-medium shadow-[var(--shadow-sm)] transition-[border-color,background-color] hover:border-line-strong hover:bg-surface-2">
              <s.icon size={16} strokeWidth={1.75} className="shrink-0 text-muted transition-colors group-hover:text-ink" />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <ol className="space-y-1 rounded-2xl bg-surface-2 p-1.5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex items-center gap-3 rounded-xl px-2.5 py-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-surface-solid text-ink shadow-[var(--shadow-sm)] ring-1 ring-line"><s.icon size={15} strokeWidth={1.75} /></span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[12.5px] font-semibold"><span className="mr-1 text-faint tabular-nums">{i + 1}</span>{s.title}</span>
              <span className="block text-[12px] text-muted">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Thinking({ blocks }: { blocks: Block[] }) {
  const last = blocks[blocks.length - 1];
  if (last?.kind === "text" && last.text.length) return null;
  const running = [...blocks].reverse().find((b) => b.kind === "tool" && b.status === "running") as Extract<Block, { kind: "tool" }> | undefined;
  return (
    <div className="flex items-center gap-2 px-0.5 text-xs text-muted">
      <Loader2 size={13} className="animate-spin text-agent" />
      <span className="shimmer font-medium">{running ? running.label : "Thinking…"}</span>
    </div>
  );
}

const Message = memo(function Message({ message: m, streaming }: { message: ChatMessage; streaming: boolean }) {
  if (m.role === "user") return (
    <div className="flex justify-end">
      <div className="rise max-w-[85%] whitespace-pre-wrap rounded-[18px] rounded-br-md bg-surface-3 px-3.5 py-2 text-[13.5px] leading-relaxed text-ink">
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
        <div className="md text-[13.5px] leading-[1.6] text-ink">
          <ReactMarkdown>{b.text}</ReactMarkdown>
        </div>
      );
    case "progress":
      return <div className="border-l-2 border-agent/40 pl-2.5 text-xs text-muted">{b.text}</div>;
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
