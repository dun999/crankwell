"use client";
import clsx from "clsx";
import { ArrowRight, ArrowUpRight, CalendarCheck, Monitor, Moon, Package, Play, ShieldCheck, Square, Sun, UserRoundCog, Zap } from "lucide-react";
import { useTheme } from "next-themes";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import mark from "@/public/brand/crankwell-mark.webp";
import { CAR_SPECS, getCar, getPart, partCode } from "@/lib/cars";
import { findShops, findTechnicians } from "@/lib/catalog/providers";
import { getSpareParts } from "@/lib/catalog/spare-parts";
import { confidenceColor } from "@/lib/confidence";
import { useMounted } from "@/lib/hooks";
import { CHAPTERS, CHECKS, STORY_CAR, SUSPECTS, applyStep, setStoryExplode, startIntro, stopStory, useStory } from "@/lib/landing/story";
import { useScene } from "@/lib/store/scene";
import { compactMoney, money } from "../ui";
import { Elevation } from "./Elevation";
import { LandingStage } from "./LandingStage";
import { focusLine, playTour, stopTour } from "./tour";
import "./landing.css";

const SYMPTOMS = [
  "My brake pedal feels soft and sinks to the floor",
  "Car won't start, it just clicks",
  "Engine temperature is going into the red",
  "Grinding noise when I brake",
  "Steering wheel shakes above 60 mph",
];
const QUICK = [
  { label: "Soft brake pedal", message: SYMPTOMS[0] },
  { label: "Won't start", message: SYMPTOMS[1] },
  { label: "Overheating", message: SYMPTOMS[2] },
];
const PRICED = ["engine.block", "exhaust.cat", "cooling.radiator", "brakes.master_cylinder", "suspension.strut.fl", "electrical.battery", "wheels.tire.fl", "brakes.pads.fl"];

const pad = (n: number) => String(n).padStart(2, "0");
const range = (lo: number, hi: number) => `${compactMoney(lo)}–${compactMoney(hi).slice(1)}`;

/** Scroll position → chapter → scene state. Chapter 5 also maps its progress to disassembly. */
function useStoryDriver() {
  useEffect(() => {
    startIntro(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    let raf = 0;
    let current = 0;
    const measure = () => {
      raf = 0;
      const line = focusLine();
      let step = 0;
      let progress = 0;
      for (const el of document.querySelectorAll<HTMLElement>("[data-step]")) {
        const r = el.getBoundingClientRect();
        if (r.top > line) break;
        step = Number(el.dataset.step);
        progress = Math.min(1, (line - r.top) / r.height);
      }
      if (step !== current) {
        current = step;
        useStory.setState({ step });
        applyStep(step);
      }
      if (step === 4) setStoryExplode(progress);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
      stopTour();
      stopStory();
    };
  }, []);
}

/** Types out example symptoms in the empty field. */
function useTypewriter(lines: string[]) {
  const [text, setText] = useState(lines[0]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    let line = 0;
    let deleting = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = lines[line];
      if (!deleting && i < full.length) i++;
      else if (!deleting) {
        deleting = true;
        t = setTimeout(tick, 1900);
        return;
      } else if (i > 0) i -= 2;
      else {
        deleting = false;
        line = (line + 1) % lines.length;
        setIndex(line);
      }
      setText(lines[line].slice(0, Math.max(0, i)));
      t = setTimeout(tick, deleting ? 16 : 38);
    };
    t = setTimeout(tick, 2600);
    return () => clearTimeout(t);
  }, [lines]);
  return { text, full: lines[index] };
}

function ThemeButton() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const Icon = !mounted || theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  return (
    <button type="button" onClick={() => setTheme(next)} aria-label={mounted ? `Theme: ${theme} (switch to ${next})` : "Theme"} title="Theme"
      className="touch-target grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-ink">
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}

function TourButton({ className }: { className?: string }) {
  const touring = useStory((s) => s.touring);
  return (
    <button type="button" onClick={() => (touring ? stopTour() : void playTour())} className={clsx("lp-btn lp-btn-ghost", className)}>
      {touring ? <Square size={11} className="fill-current" /> : <Play size={12} className="fill-current" />}
      {touring ? "Stop tour" : "Play the tour"}
    </button>
  );
}

/** Animates a number toward its value. */
function Count({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 900);
      const v = start + (value - start) * (1 - (1 - t) ** 3);
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{Math.round(shown)}{suffix}</>;
}

function Chapter({ step, title, lead, children }: { step: number; title: ReactNode; lead: ReactNode; children?: ReactNode }) {
  return (
    <article className="lp-ch" data-step={step} id={`ch-${CHAPTERS[step].id}`} aria-labelledby={`ch-${step}-t`}>
      <div className="lp-ch-inner">
        <div className="fig lp-num"><b>{pad(step + 1)}</b> / {pad(CHAPTERS.length)} — {CHAPTERS[step].label}</div>
        <h2 id={`ch-${step}-t`} className="lp-h2">{title}</h2>
        <p className="lp-lead">{lead}</p>
        {children}
      </div>
    </article>
  );
}

type Agent = { label: string; provider: string };

function Hero({ agent }: { agent: Agent }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const { text, full } = useTypewriter(SYMPTOMS);
  const go = (q: string) => router.push(`/app?q=${encodeURIComponent(q.trim())}`);
  return (
    <article className="lp-ch lp-hero" data-step={0} id="ch-describe" aria-labelledby="hero-t">
      <div className="lp-ch-inner">
        <div className="fig lp-num"><b>01</b> / {pad(CHAPTERS.length)} — AI mechanic · PayPal checkout</div>
        <h1 id="hero-t" className="lp-h1 mt-5">
          <span>Tell it what&apos;s wrong.</span>
          <span className="ink">Watch it find it.</span>
        </h1>
        <p className="lp-lead">
          Crankwell diagnoses your car on a <strong>live 3D model</strong>, walks you through checks that are safe to do in the driveway, and pays for the fix with <strong>PayPal</strong>.
        </p>
        <form className="lp-order" onSubmit={(e) => { e.preventDefault(); go(value.trim() || full); }}>
          <label htmlFor="lp-symptom" className="fig">Work order — describe the symptom</label>
          <div className="lp-field">
            <input id="lp-symptom" value={value} onChange={(e) => setValue(e.target.value)} placeholder={text} autoComplete="off" enterKeyHint="go" maxLength={300} />
            <button type="submit" className="lp-btn">Diagnose <ArrowRight size={14} /></button>
          </div>
          <div className="lp-chips">
            {QUICK.map((q) => <button key={q.label} type="button" className="lp-chip" onClick={() => go(q.message)}>{q.label}</button>)}
          </div>
        </form>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <TourButton />
          <span className="fig">or scroll ↓ six steps, one diagnosis</span>
        </div>
        <div className="fig lp-built"><span>{agent.label}</span><span>PayPal Orders · Vault</span><span>MCP for Claude</span><span>Three.js</span></div>
      </div>
    </article>
  );
}

function SuspectTable({ values, delta }: { values: number[]; delta?: number[] }) {
  return (
    <table className="lp-table">
      <thead>
        <tr><th>№</th><th>Suspect</th><th className="w-[38%]">Confidence</th><th className="r">%</th>{delta && <th className="r">Δ</th>}</tr>
      </thead>
      <tbody>
        {SUSPECTS.map((s, i) => {
          const c = values[i];
          return (
            <tr key={s.partId}>
              <td className="w-8"><span className="callout" style={{ color: confidenceColor(c) }}>{i + 1}</span></td>
              <td><div className="font-medium leading-tight">{s.name}</div><div className="mono text-[10.5px] text-faint">{partCode(STORY_CAR, s.partId)}</div></td>
              <td><div className="lp-bar"><i style={{ width: `${c * 100}%`, background: confidenceColor(c) }} /></div></td>
              <td className="r mono text-[12.5px] font-semibold" style={{ color: confidenceColor(c) }}><Count value={c * 100} /></td>
              {delta && <td className={clsx("r mono text-[11.5px]", delta[i] > 0 ? "text-danger" : "text-muted")}>{delta[i] > 0 ? "+" : ""}{Math.round(delta[i] * 100)}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RankTable() {
  const on = useStory((s) => s.step >= 2);
  return <SuspectTable values={SUSPECTS.map((s) => (on ? s.confidence : 0))} />;
}

/** The answers arrive one by one, then the table re-ranks (in step with the model). */
function Checks({ on }: { on: boolean }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!on) return;
    const ts = [setTimeout(() => setPhase(1), 450), setTimeout(() => setPhase(2), 1000), setTimeout(() => setPhase(3), 1500)];
    return () => ts.forEach(clearTimeout);
  }, [on]);
  const after = phase >= 3;
  return (
    <>
      <div className="lp-card">
        <div className="lp-card-h"><ShieldCheck size={14} className="text-ok" /> Safe checks to confirm <span className="mono ml-auto text-[10.5px] font-normal text-muted">{Math.min(2, phase)}/2 answered</span></div>
        {CHECKS.map((c, i) => (
          <div key={c.title} className={clsx("flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5", i > 0 && "border-t border-line")}>
            <span className="mono text-[10.5px] text-faint">{pad(i + 1)}</span>
            <span className="min-w-0 flex-1 text-[13px] font-medium">{c.title}</span>
            <span className="flex gap-1.5">
              {c.options.map((o, k) => <span key={o} className="lp-answer inline-flex items-center" data-on={phase > i && k === c.pick}>{o}</span>)}
            </span>
          </div>
        ))}
      </div>
      <SuspectTable values={SUSPECTS.map((s) => (after ? s.after : s.confidence))} delta={after ? SUSPECTS.map((s) => s.after - s.confidence) : SUSPECTS.map(() => 0)} />
    </>
  );
}

function ChecksChapter() {
  const on = useStory((s) => s.step === 3);
  return <Checks key={on ? "on" : "off"} on={on} />;
}

function PriceList() {
  const explode = useScene((s) => s.explode);
  const on = useStory((s) => s.step === 4);
  const total = getCar(STORY_CAR).parts.length;
  return (
    <>
      <div className="lp-readout">
        <span className="fig text-ink">Disassembly</span>
        <div className="lp-bar"><i style={{ width: `${(on ? explode / 0.85 : 0) * 100}%`, background: "var(--accent)", transition: "none" }} /></div>
        <span className="mono w-[4ch] text-right text-[12px]">{Math.round((on ? explode / 0.85 : 0) * 100)}%</span>
      </div>
      <table className="lp-table">
        <caption className="fig">Fig. 5 — Parts list, excerpt ({PRICED.length} of {total})</caption>
        <thead><tr><th>Part no.</th><th>Description</th><th className="r">Part</th><th className="r">Labor</th></tr></thead>
        <tbody>
          {PRICED.map((id) => {
            const p = getPart(STORY_CAR, id);
            if (!p) return null;
            return (
              <tr key={id}>
                <td className="mono w-[64px] text-[11px] text-faint">{partCode(STORY_CAR, id)}</td>
                <td className="truncate">{p.name}</td>
                <td className="r mono whitespace-nowrap text-[12px]">{range(p.price.partMin, p.price.partMax)}</td>
                <td className="r mono whitespace-nowrap text-[12px] text-muted">{p.price.laborMax ? range(p.price.laborMin, p.price.laborMax) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function PayChapter() {
  const on = useStory((s) => s.step === 5);
  const sku = getSpareParts(STORY_CAR, SUSPECTS[0].partId).find((p) => p.tier === "OE-Equivalent")!;
  const tech = findTechnicians("brakes")[0];
  const shop = findShops({ specialty: "brakes" })[0];
  const options = [
    { icon: Package, kind: "Buy the part", title: sku.name, price: money(sku.price), api: "Orders v2 · capture", picked: true },
    { icon: UserRoundCog, kind: "Mobile technician", title: `${tech.name} · here in ${tech.etaMinutes} min`, price: `${money(tech.calloutFee)} call-out`, api: "Invoicing v2" },
    { icon: CalendarCheck, kind: "Reserve a shop", title: shop.name, price: `${money(shop.deposit)} hold`, api: "authorize → capture" },
  ];
  return (
    <>
      <div className="lp-card">
        {options.map((o) => (
          <div key={o.kind} className="lp-option" data-picked={o.picked}>
            <span className={clsx("grid h-7 w-7 place-items-center rounded-md", o.picked ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink")}><o.icon size={14} /></span>
            <span className="min-w-0">
              <span className="fig block text-[9.5px]">{o.kind} · {o.api}</span>
              <span className="block truncate text-[13px] font-medium">{o.title}</span>
            </span>
            <span className="mono text-[12px]">{o.price}</span>
          </div>
        ))}
        <div className="lp-paypal" aria-hidden="true"><span><i>Pay</i><i className="opacity-75">Pal</i></span> · {money(sku.price)}</div>
      </div>
      <div className="lp-ledger" data-on={on}>
        <span className="mono text-[11px] text-faint">ORD·0142</span>
        <span className="truncate">{sku.name}</span>
        <span className="mono text-[12px]">{money(sku.price)}</span>
        <span className="stamp text-ok">Captured</span>
      </div>
      <p className="mt-4 flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
        <Zap size={14} className="mt-0.5 shrink-0 text-accent" />
        <span>The first purchase saves PayPal with <strong className="text-ink">Vault</strong>. After that it&apos;s one tap, capped at $500 an order and $1,000 a day. Webhooks keep every status live.</span>
      </p>
    </>
  );
}

function ClaudeMock() {
  return (
    <div className="lp-window" aria-label="Crankwell inside a Claude conversation (illustration)" role="img">
      <div className="lp-window-bar"><i /><i /><i /><span className="fig ml-2 text-[10px]">Claude · Crankwell connector</span></div>
      <div className="space-y-3 p-4 text-[13px]">
        <div className="ml-auto max-w-[80%] rounded-xl rounded-br-sm bg-surface-3 px-3 py-2">My Corolla&apos;s brake pedal is soft and slowly sinks. What&apos;s wrong?</div>
        <div className="mono space-y-1 border-l border-line-strong pl-2.5 text-[10.5px] text-faint">
          <div><span className="text-ok">▸</span> <span className="text-muted">crankwell · find_suspect_parts</span></div>
          <div><span className="text-ok">▸</span> <span className="text-muted">crankwell · show_diagnosis</span></div>
        </div>
        <div className="overflow-hidden rounded-lg border border-line-strong">
          <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
            <Image src={mark} alt="" width={20} height={20} className="rounded-[5px] bg-white ring-1 ring-line" />
            <span className="text-[12.5px] font-semibold">Soft, sinking brake pedal</span>
            <span className="stamp ml-auto text-danger">Don&apos;t drive</span>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {SUSPECTS.slice(0, 3).map((s, i) => (
              <li key={s.partId} className="flex items-center gap-2 px-3 py-2">
                <span className="callout" style={{ color: confidenceColor(s.confidence) }}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="mono text-[12px] font-semibold" style={{ color: confidenceColor(s.confidence) }}>{Math.round(s.confidence * 100)}%</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 border-t border-line p-2.5">
            <Link href="/app" className="inline-flex h-8 items-center gap-1 rounded-md border border-line-strong px-2.5 text-[12px] font-medium">Open in 3D <ArrowUpRight size={12} /></Link>
            <span className="inline-flex h-8 items-center gap-1 rounded-md bg-pay px-2.5 text-[12px] font-bold text-pay-ink">Confirm · PayPal</span>
          </div>
        </div>
        <p>The highlighted parts are on the 3D model too. Open it to see them, or confirm in the card to order the part.</p>
      </div>
    </div>
  );
}

const specRows = (agent: Agent): [string, ReactNode, string?][] => [
  ["Agent", `${agent.label} on ${agent.provider}`, "Tool calling and streaming: it moves the camera, ranks suspects, asks for checks and prices fixes"],
  ["Payments", "PayPal Orders v2, Payments v2, Invoicing v2", "Capture for parts, authorize → capture/void for shop deposits, invoices for technicians, refunds"],
  ["One-tap", "PayPal Vault", "Saved after the first approval; capped per order and per day"],
  ["Live status", "PayPal webhooks", "Server-sent events push every status change to the ledger"],
  ["Claude", "MCP server + MCP Apps card", "OAuth 2.1 with PKCE pairs Claude with your browser; purchases need a signed confirm in the card"],
  ["3D", "Three.js, React Three Fiber", "Two cars built from code: 118 and 125 parts, no model files"],
  ["Data", "AG Grid", "Price guide linked to the model; orders ledger"],
];

function Specification({ agent }: { agent: Agent }) {
  const spec = CAR_SPECS[STORY_CAR];
  return (
    <section id="spec" className="lp-section">
      <div className="lp-wrap">
        <div className="fig lp-num"><b>Specification</b></div>
        <h2 className="lp-h2 max-w-[18ch]">Every part is code. Every price is real-world.</h2>
        <div className="lp-spec-grid">
          <figure>
            <div className="lp-figure"><Elevation carId={STORY_CAR} className="w-full" /></div>
            <figcaption className="fig mt-2.5">Fig. 7 — {spec.make} {spec.model} {spec.generation}, side elevation · drawn from the spec that builds the 3D model</figcaption>
          </figure>
          <table className="lp-spec">
            <tbody>
              {specRows(agent).map(([k, v, note]) => (
                <tr key={k}><th scope="row">{k}</th><td>{v}{note && <small>{note}</small>}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function Landing({ sandbox, agent }: { sandbox: { email: string; password: string } | null; agent: Agent }) {
  useStoryDriver();
  return (
    <div className="lp">
      <header className="lp-nav">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Crankwell">
          <Image src={mark} alt="" width={28} height={28} sizes="28px" priority className="rounded-[7px] bg-white ring-1 ring-line" />
          <span className="text-[15px] font-semibold tracking-[-0.025em]">Crankwell</span>
        </Link>
        <nav aria-label="Sections" className="hidden items-center gap-5 md:flex">
          <a className="lp-link" href="#ch-see">How it works</a>
          <a className="lp-link" href="#claude">In Claude</a>
          <a className="lp-link" href="#spec">Specification</a>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="fig mr-2 hidden items-center gap-1.5 lg:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-pay" /> PayPal sandbox</span>
          <ThemeButton />
          <Link href="/app" className="lp-btn">Open the garage <ArrowRight size={14} /></Link>
        </div>
      </header>

      <main>
        <section className="lp-story" aria-label="How Crankwell works">
          <LandingStage />
          <div className="lp-chapters">
            <Hero agent={agent} />
            <Chapter step={1} title="It sees through the body." lead={<>The body turns to glass so the parts that matter show. Every system is real geometry you can turn, isolate and take apart, not a photo.</>} />
            <Chapter step={2} title="It ranks what's likely." lead={<>The agent calls its tools and the model answers: suspects light up in place, numbered and scored, and the camera flies to the strongest lead.</>}>
              <RankTable />
            </Chapter>
            <Chapter step={3} title="It asks before it guesses." lead={<>Safe checks you can do in the driveway narrow it down. Two answers, and the ranking moves, on the table and on the car.</>}>
              <ChecksChapter />
            </Chapter>
            <Chapter step={4} title={<>{getCar(STORY_CAR).parts.length} parts. Every one priced.</>} lead={<>Keep scrolling to take the car apart. Each part carries what it does, what it costs and how hard the job is, so the estimate isn&apos;t a guess.</>}>
              <PriceList />
            </Chapter>
            <Chapter step={5} title="Fix it. Pay in one tap." lead={<>Buy the part, book a mobile mechanic or hold a shop slot, each a different PayPal flow, without leaving the conversation.</>}>
              <PayChapter />
            </Chapter>
          </div>
        </section>

        <section id="claude" className="lp-section">
          <div className="lp-wrap lp-two">
            <div>
              <div className="fig lp-num"><b>Also inside Claude</b></div>
              <h2 className="lp-h2">Ask Claude. Crankwell answers on the model.</h2>
              <p className="lp-lead">Add Crankwell as a connector and Claude gets the same tools: diagnose, price, prepare a purchase. Every diagnosis opens in 3D from a link, and nothing is bought until you confirm in the card.</p>
              <dl className="lp-facts">
                <div><dt>Server</dt><dd>MCP over HTTP at <span className="mono text-[12px]">/api/mcp</span></dd></div>
                <div><dt>Pairing</dt><dd>OAuth 2.1, PKCE S256, tied to your browser session</dd></div>
                <div><dt>UI</dt><dd>MCP Apps card, <span className="mono text-[12px]">ui://crankwell/card</span></dd></div>
                <div><dt>Purchases</dt><dd>Confirm is app-only and signed per action</dd></div>
              </dl>
            </div>
            <ClaudeMock />
          </div>
        </section>

        <Specification agent={agent} />
      </main>

      <footer className="lp-foot">
        <div className="fig">End of manual</div>
        <h2 className="mt-4">Your car, explained.</h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          <Link href="/app" className="lp-btn lp-btn-lg">Open the garage <ArrowRight size={16} /></Link>
          <TourButton className="lp-btn-lg" />
        </div>
        {sandbox ? (
          <div className="lp-creds mono text-[12px]">
            <span className="fig col-span-2 mb-1">PayPal sandbox buyer · for testing</span>
            <span className="text-muted">email</span><span>{sandbox.email}</span>
            <span className="text-muted">password</span><span>{sandbox.password}</span>
          </div>
        ) : (
          <p className="fig mt-6">Payments run in the PayPal sandbox · no real money moves</p>
        )}
        <div className="lp-small fig text-[10px]">
          <span>Crankwell · AI mechanic + PayPal</span>
          <span>Guidance only. Have a mechanic inspect safety-critical issues.</span>
        </div>
      </footer>
    </div>
  );
}
