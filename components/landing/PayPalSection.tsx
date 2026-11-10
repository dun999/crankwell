"use client";
import { CalendarCheck, Package, Radio, ShieldCheck, UserRoundCog, Zap, type LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { getSpareParts } from "@/lib/catalog/spare-parts";
import { STORY_CAR } from "@/lib/landing/story";
import { money } from "../ui";

// The blueprint plate: how money moves. Every flow here is one the app runs against PayPal.

const PRODUCTS = ["Orders v2", "Payments v2", "Vault", "Invoicing v2", "Payouts", "Pay Later", "Webhooks", "Agent Toolkit"];

const RULES = [
  { title: "Priced by the server", body: "The mechanic prepares a proposal from the catalog. The model never sets a price, and an offer expires after 15 minutes." },
  { title: "Confirmed by a person", body: "Nothing is charged until you tap. A double tap can't pay twice, and Claude can't press the button for you." },
  { title: "Settled by PayPal", body: "Capture, hold, invoice, refund or payout: PayPal moves the money, and signed webhooks keep every status live." },
];

const FLOWS: { icon: LucideIcon; title: string; api: string; steps: string[]; note: string }[] = [
  { icon: Package, title: "Buy the part", api: "Orders v2 · capture", steps: ["Priced", "Approved", "Captured", "Shipped"], note: "Pay Later and Pay in 4 on orders of $30 to $1,500. Cancel the order and the capture is refunded." },
  { icon: CalendarCheck, title: "Hold a shop slot", api: "Orders v2 · authorize", steps: ["Deposit held", "Checked in", "Captured"], note: "A hold, not a charge. It's captured when you check in and voided if you cancel." },
  { icon: UserRoundCog, title: "Book a mobile technician", api: "Invoicing v2 · Payouts", steps: ["Invoiced", "Paid", "Job done", "Paid out"], note: "When the job is done, unused labor is refunded to you and the technician's 85% share goes out by Payouts." },
];

const EVENTS = [
  ["PAYMENT.CAPTURE.REFUNDED", "Refund on the order"],
  ["CUSTOMER.DISPUTE.CREATED", "Dispute flagged"],
  ["PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "Technician paid"],
];

function Tile({ icon: Icon, title, api, note, index, children }: { icon: LucideIcon; title: string; api: string; note: string; index: number; children: ReactNode }) {
  return (
    <article className="lp-tile" data-reveal="" style={{ "--d": index % 3 } as CSSProperties}>
      <header>
        <span className="lp-tile-icon"><Icon size={15} /></span>
        <h3>{title}</h3>
        <span className="fig lp-tile-api">{api}</span>
      </header>
      <div className="lp-tile-fig">{children}</div>
      <p>{note}</p>
    </article>
  );
}

export function PayPalSection() {
  const pads = getSpareParts(STORY_CAR, "brakes.pads.fl").find((p) => p.tier === "OE-Equivalent");
  const used = pads?.price ?? 62.99;
  const total = 300;
  return (
    <section id="paypal" className="lp-section lp-blue">
      <div className="lp-wrap">
        <div data-reveal="">
          <div className="fig lp-num"><b>Agent checkout</b></div>
          <h2 className="lp-h2 lp-h2-xl lp-triad"><span>The AI prepares.</span> <span className="text-pay">You tap.</span> <span>PayPal executes.</span></h2>
          <p className="lp-lead">Every way a repair gets paid runs through PayPal, and it doesn&apos;t stop at the sale: the mechanic tracks the shipment, refunds, checks you in at the shop and settles the technician&apos;s job.</p>
        </div>

        <div className="lp-rules" data-reveal="">
          {RULES.map((r, i) => (
            <div key={r.title}>
              <b><i>{String(i + 1).padStart(2, "0")}</i>{r.title}</b>
              <p>{r.body}</p>
            </div>
          ))}
        </div>

        <div className="lp-tiles">
          {FLOWS.map((f, i) => (
            <Tile key={f.title} icon={f.icon} title={f.title} api={f.api} note={f.note} index={i}>
              <ol className="lp-track" style={{ "--n": f.steps.length } as CSSProperties}>
                {f.steps.map((s, k) => <li key={s} style={{ "--i": k } as CSSProperties}>{s}</li>)}
              </ol>
            </Tile>
          ))}

          <Tile icon={Zap} title="One tap after the first" api="Vault" index={3} note="Tick “Save PayPal” on the first approval and Confirm becomes a single tap. Anything over the caps goes back through PayPal approval.">
            <div className="lp-caps">
              <div><b>$500</b><span className="fig">per order</span></div>
              <div><b>$1,000</b><span className="fig">per day</span></div>
            </div>
          </Tile>

          <Tile icon={ShieldCheck} title="A spending limit you approve" api="Vault · signed terms" index={4} note="Within a limit the mechanic can buy parts for you. The terms are signed on the server and checked on every purchase, and each one comes with Undo.">
            <div className="lp-mini">
              <div className="flex items-center gap-2">
                <b className="text-[12.5px] font-semibold">Brake parts · Corolla</b>
                <span className="stamp ml-auto text-ok">Allowed</span>
              </div>
              <div className="mono mt-1.5 text-[11px] text-muted">$150 an order · {money(total)} in total · 7 days</div>
              <div className="lp-bar mt-3"><i style={{ width: `${(used / total) * 100}%`, background: "var(--accent)" }} /></div>
              <div className="mono mt-1.5 flex justify-between text-[10.5px] text-faint"><span>{money(used)} used</span><span>{money(total - used)} left</span></div>
            </div>
          </Tile>

          <Tile icon={Radio} title="It keeps going after the sale" api="Webhooks · Agent Toolkit" index={5} note="Ask “did it ship?” or “is there a dispute?” and the answer comes from PayPal, scoped to your own orders.">
            <ul className="lp-log">
              {EVENTS.map(([event, outcome]) => (
                <li key={event}><i className="live-dot" /><code>{event}</code><span>{outcome}</span></li>
              ))}
            </ul>
          </Tile>
        </div>

        <div className="lp-products" data-reveal="">
          <span className="fig">Eight PayPal products, one conversation</span>
          <ul>{PRODUCTS.map((p) => <li key={p} className="mono">{p}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}
