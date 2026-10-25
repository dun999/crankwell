"use client";
import clsx from "clsx";
import { ArrowUp, AudioWaveform, BatteryWarning, CreditCard, Disc3, LocateFixed, MessageSquareText, PanelRightClose, ScanSearch, ShieldCheck, Square, SquarePen, ThermometerSun } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import mark from "@/public/brand/crankwell-mark.webp";
import { CAR_SPECS } from "@/lib/cars/specs";
import { useChat, type Block, type ChatMessage } from "@/lib/store/chat";
import { useScene } from "@/lib/store/scene";
import { IconButton } from "../ui";
import { AgentWorking, StepsSummary } from "./Working";
const ReactMarkdown = dynamic(() => import("react-markdown"), { loading: () => <span className="text-muted">Loading message…</span> });
const DiagnosisCard = dynamic(() => import("./Cards").then((m) => m.DiagnosisCard));
const FocusLine = dynamic(() => import("./Cards").then((m) => m.FocusLine));
const RecommendationsCard = dynamic(() => import("./Cards").then((m) => m.RecommendationsCard));
const SafetyTestCard = dynamic(() => import("./Cards").then((m) => m.SafetyTestCard));
const PartsCard = dynamic(() => import("./Cards").then((m) => m.PartsCard));
const Replies = dynamic(() => import("./Cards").then((m) => m.Replies));
const ConfirmCard = dynamic(() => import("./ConfirmCard").then((m) => m.ConfirmCard));
const PreparingCheckout = dynamic(() => import("./Checkout").then((m) => m.PreparingCheckout));

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
      className="chat-panel"
    >
      <header className="flex h-12 shrink-0 items-center gap-0.5 border-b border-line pl-3.5 pr-1.5">
        <div className="relative mr-2 h-7 w-7 shrink-0">
          <Image src={mark} alt="" width={28} height={28} sizes="28px" loading="eager" className="h-7 w-7 rounded-[7px] bg-white object-cover ring-1 ring-line" />
          <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-[1.5px] border-[var(--surface-solid)] bg-ok" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[13.5px] font-semibold tracking-[-0.01em]">Mechanic</div>
          <div className="fig truncate text-[10px]">
            {streaming ? "Working…" : `On the ${spec.model} ${spec.generation.split(" ")[0]}`}
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
      }} className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3.5 py-3.5">
        {!messages.length && <Welcome onPick={(s) => send(s)} />}
        {messages.map((m, i) => (
          <Message key={m.id} message={m} last={i === messages.length - 1} streaming={streaming && i === messages.length - 1} />
        ))}
      </div>

      <form
        className="chat-composer shrink-0 p-2.5 pt-0"
        onSubmit={(e) => {
          e.preventDefault();
          followMessages.current = true;
          void send(draft);
        }}
      >
        <div className="flex items-end gap-1.5 rounded-xl border border-line-strong bg-surface-2 p-1 transition-[background-color,border-color,box-shadow] focus-within:border-accent focus-within:bg-surface-solid">
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
            className="max-h-36 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none placeholder:text-muted sm:text-[13.5px]"
          />
          {streaming ? (
            <IconButton label="Stop" onClick={stop} className="bg-surface-3">
              <Square size={13} className="fill-current" />
            </IconButton>
          ) : (
            <button type="submit" aria-label="Send" disabled={!draft.trim()} className="touch-target grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-ink transition-opacity hover:opacity-90 disabled:opacity-25">
              <ArrowUp size={17} strokeWidth={2.25} />
            </button>
          )}
        </div>
        <div className="mt-1.5 px-1 text-center text-[10.5px] leading-snug text-faint">
          Guidance only. Have a mechanic inspect safety-critical issues.
        </div>
      </form>
    </aside>
  );
}

function Welcome({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="rise space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold leading-tight tracking-[-0.025em]">What&apos;s your car doing?</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Describe a symptom. I&apos;ll point to the likely parts on the model, walk you through safe checks and price the fix.
        </p>
      </div>
      <div>
        <p className="fig mb-1.5">Try a common symptom</p>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s.label} type="button" onClick={() => onPick(s.message)}
              className="group inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-solid px-2.5 py-1 text-left text-[12.5px] font-medium transition-[border-color,background-color] hover:border-line-strong hover:bg-surface-2">
              <s.icon size={14} strokeWidth={1.75} className="shrink-0 text-muted transition-colors group-hover:text-ink" />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <ol className="grid grid-cols-3 border-y border-line">
        {STEPS.map((s, i) => (
          <li key={s.title} className={clsx("px-2 py-2.5", i > 0 && "border-l border-line")}>
            <span className="mono text-[10px] text-faint">0{i + 1}</span>
            <span className="mt-0.5 flex items-center gap-1 text-[12px] font-semibold"><s.icon size={12} strokeWidth={2} className="text-muted" />{s.title}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted">{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Offered after a diagnosis when the mechanic didn't suggest its own next steps.
const NEXT_STEPS = ["Find parts at a good price", "Quick check first", "Find a mechanic nearby"];
const INTERACTIVE = new Set(["replies", "parts", "recommendations", "action", "safety_tests"]);

const Message = memo(function Message({ message: m, last, streaming }: { message: ChatMessage; last: boolean; streaming: boolean }) {
  if (m.role === "user") return (
    <div className="flex justify-end">
      <div className="rise max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-surface-3 px-3 py-1.5 text-[13px] leading-relaxed text-ink">
        {(m.blocks[0] as Extract<Block, { kind: "text" }>)?.text}
      </div>
    </div>
  );
  const ui = m.blocks.flatMap((b) => (b.kind === "ui" ? [b.event] : []));
  const offered = ui.findLast((e) => e.type === "replies");
  const replies = offered?.type === "replies" ? offered.replies : ui.some((e) => e.type === "diagnosis") && !ui.some((e) => INTERACTIVE.has(e.type)) ? NEXT_STEPS : null;
  return (
    <div className="space-y-2.5">
      {!streaming && <StepsSummary blocks={m.blocks} ms={m.ms} />}
      {m.blocks.map((b, i) => <AssistantBlock key={i} b={b} msgId={m.id} idx={i} />)}
      {streaming ? <AgentWorking blocks={m.blocks} startedAt={m.startedAt} /> : last && replies && <Replies replies={replies} />}
    </div>
  );
});

const AssistantBlock = memo(function AssistantBlock({ b, msgId, idx }: { b: Block; msgId: string; idx: number }) {
  switch (b.kind) {
    case "text":
      return (
        <div className="md text-[13px] leading-[1.6] text-ink">
          <ReactMarkdown>{b.text}</ReactMarkdown>
        </div>
      );
    case "error":
      return <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{b.text}</div>;
    case "checkout":
      return <PreparingCheckout b={b} msgId={msgId} idx={idx} />;
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
        case "parts":
          return <PartsCard e={b.event} />;
        case "action":
          return <ConfirmCard e={b.event} />;
      }
  }
  // Tool steps live in the summary line; replies render after the message.
  return null;
});
