import type { Metadata } from "next";
import { ActionSummary } from "@/components/commerce/ActionSummary";
import { FlowError, FlowShell } from "@/components/flow/FlowShell";
import { PayPanel } from "@/components/flow/PayPanel";
import { getAction } from "@/lib/server/actions";

export const metadata: Metadata = { title: "Checkout · Crankwell" };

/** Checkout link for an action the mechanic prepared (e.g. from Claude). PayPal returns here too. */
export default async function PayPage({ params, searchParams }: PageProps<"/pay/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const action = /^act_[0-9a-f-]{36}$/.test(id) ? getAction(id) : undefined;
  if (!action) {
    return (
      <FlowShell eyebrow="Checkout">
        <FlowError title="Checkout not found">This link is invalid. Ask the mechanic to prepare the order again.</FlowError>
      </FlowShell>
    );
  }
  const notice = sp.done ? ({ kind: "done" } as const) : sp.cancelled ? ({ kind: "cancelled" } as const) : typeof sp.error === "string" ? ({ kind: "error", text: sp.error.slice(0, 200) } as const) : undefined;
  return (
    <FlowShell eyebrow={action.source === "claude" ? "Prepared in Claude" : "Checkout"}>
      <ActionSummary action={action} />
      <PayPanel initial={action} notice={notice} />
    </FlowShell>
  );
}
