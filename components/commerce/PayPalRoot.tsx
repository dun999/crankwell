"use client";
import { PayPalOneTimePaymentButton, PayPalProvider, usePayPal } from "@paypal/react-paypal-js/sdk-v6";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
export const paypalConfigured = Boolean(CLIENT_ID);
export type PayState = { kind: "idle" } | { kind: "working"; text: string } | { kind: "error"; text: string };

/**
 * Mount the SDK provider only with a checkout. The SDK loader shares its
 * script across providers, and the app keeps its state when checkout opens.
 * PayPal button wired to our server: the server creates the order from
 * catalog prices, the buyer approves in the PayPal popup, and the server
 * captures or authorizes it.
 */
export function PayPalPay({
  createOrder,
  onApproved,
  disabled,
}: {
  createOrder: () => Promise<string>;
  onApproved: (orderId: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [state, setState] = useState<PayState>({ kind: "idle" });
  if (!paypalConfigured) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-xs text-muted">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
        <span>
          Checkout is currently unavailable. You can still explore parts and discuss repair options with the mechanic.
        </span>
      </div>
    );
  }
  return (
    <PayPalProvider clientId={CLIENT_ID} environment="sandbox" components={["paypal-payments"]} pageType="checkout">
      <div className="space-y-1.5">
        <PayPalButtonInner
          disabled={disabled || state.kind === "working"}
          createOrder={async () => {
            setState({ kind: "working", text: "Creating PayPal order…" });
            try {
              const orderId = await createOrder();
              setState({ kind: "working", text: "Waiting for approval in PayPal…" });
              return { orderId };
            } catch (e) {
              setState({ kind: "error", text: (e as Error).message });
              throw e;
            }
          }}
          onApprove={async ({ orderId }: { orderId: string }) => {
            setState({ kind: "working", text: "Finalizing payment…" });
            try {
              await onApproved(orderId);
              setState({ kind: "idle" });
            } catch (e) {
              setState({ kind: "error", text: (e as Error).message });
            }
          }}
          onCancel={() => setState({ kind: "idle" })}
          onError={(e: unknown) => setState({ kind: "error", text: e instanceof Error ? e.message : "PayPal error" })}
        />
        {state.kind === "working" && (
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Loader2 size={12} className="animate-spin" /> {state.text}
          </div>
        )}
        {state.kind === "error" && <div className="text-xs text-danger">{state.text}</div>}
      </div>
    </PayPalProvider>
  );
}

function PayPalButtonInner(props: {
  disabled?: boolean;
  createOrder: () => Promise<{ orderId: string }>;
  onApprove: (d: { orderId: string }) => Promise<void>;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  const { loadingStatus, error } = usePayPal();
  if (error) return <div className="text-xs text-danger">PayPal SDK failed to load: {error.message}</div>;
  if (String(loadingStatus).toLowerCase().includes("pending"))
    return (
      <div className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ffc439]/60 text-xs text-black/70">
        <Loader2 size={14} className="animate-spin" /> Loading PayPal…
      </div>
    );
  return (
    <div className={props.disabled ? "pointer-events-none opacity-60" : undefined}>
      <PayPalOneTimePaymentButton
        type="pay"
        presentationMode="auto"
        createOrder={props.createOrder}
        onApprove={props.onApprove}
        onCancel={props.onCancel}
        onError={props.onError}
      />
    </div>
  );
}
