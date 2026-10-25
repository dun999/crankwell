import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import mark from "@/public/brand/crankwell-mark.webp";

/** Frame for standalone pages people reach from Claude or PayPal: consent, checkout, receipt. */
export function FlowShell({ children, eyebrow }: { children: ReactNode; eyebrow?: string }) {
  return (
    <main className="flow-page">
      <div className="flow-card card rise">
        <div className="mb-5 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Crankwell home">
            <Image src={mark} alt="" width={30} height={30} sizes="30px" className="rounded-[9px] bg-white shadow-[var(--shadow-sm)] ring-1 ring-line" />
            <span className="text-[16px] font-semibold tracking-[-0.02em]">Crankwell</span>
          </Link>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        </div>
        {children}
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-center text-[11px] text-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-[#ffc439] ring-2 ring-[#ffc439]/25" /> PayPal sandbox · no real money moves
      </p>
    </main>
  );
}

export function FlowError({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h1 className="text-[20px] font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mt-2 text-sm text-muted">{children}</p>
    </div>
  );
}
