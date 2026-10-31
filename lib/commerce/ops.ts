import type { ActionKind, ChangeKind, Transaction } from "./types";

// After-sale changes to an order, and when each is possible. One source of truth for the agent's
// prepare_order_change, the server's checks and the Orders panel's buttons. Safe on the client.

export const CHANGE_KINDS = ["refund", "check_in", "cancel_reservation", "cancel_invoice", "remind_invoice", "complete_job"] as const satisfies readonly ChangeKind[];

export const isChange = (k: ActionKind): k is ChangeKind => (CHANGE_KINDS as readonly string[]).includes(k);

/**
 * What the buyer paid and still has paid: a refunded order, a released hold or a cancelled invoice
 * count as $0, and unused labor refunded after a technician visit comes off.
 */
export function paidAfterRefunds(tx: Pick<Transaction, "status" | "amount" | "job">): number {
  if (tx.status !== "COMPLETED" && tx.status !== "CAPTURED" && tx.status !== "PAID") return 0;
  return Math.round((Number(tx.amount) - Number(tx.job?.refunded ?? 0)) * 100) / 100;
}

/** What can be done to this order right now. */
export function allowedOps(tx: Pick<Transaction, "kind" | "status" | "paypal" | "job">): ChangeKind[] {
  switch (tx.kind) {
    case "parts":
      return tx.status === "COMPLETED" && tx.paypal.captureId ? ["refund"] : [];
    case "shop_deposit":
      if (tx.status === "AUTHORIZED" && tx.paypal.authorizationId) return ["check_in", "cancel_reservation"];
      return tx.status === "CAPTURED" && tx.paypal.captureId ? ["refund"] : [];
    case "technician_invoice":
      if (tx.status === "PAID") return tx.job ? [] : ["complete_job"];
      return (tx.status === "SENT" || tx.status === "UNPAID") && tx.paypal.invoiceId ? ["remind_invoice", "cancel_invoice"] : [];
  }
}

/** How each change reads on cards, receipts and buttons. */
export const CHANGE_COPY: Record<ChangeKind, { ask: string; button: string; done: string; total: string; status: string; tone: "primary" | "danger" }> = {
  refund: { ask: "Ready to refund", button: "Confirm refund", done: "Refund issued", total: "Refund", status: "Refunded to the buyer's PayPal.", tone: "danger" },
  check_in: { ask: "Ready to check in", button: "Check in · capture deposit", done: "Deposit captured", total: "Charged now", status: "Checked in: the held deposit was captured.", tone: "primary" },
  cancel_reservation: { ask: "Cancel this reservation?", button: "Cancel reservation · release hold", done: "Hold released", total: "Released", status: "Reservation cancelled: the hold was released, nothing was charged.", tone: "danger" },
  cancel_invoice: { ask: "Cancel this invoice?", button: "Cancel PayPal invoice", done: "Invoice cancelled", total: "Not charged", status: "The PayPal invoice was cancelled and the visit released.", tone: "danger" },
  remind_invoice: { ask: "Send the invoice again?", button: "Send PayPal reminder", done: "Reminder sent", total: "Still due", status: "PayPal emailed the invoice again.", tone: "primary" },
  complete_job: { ask: "Mark the job done?", button: "Job done · settle with PayPal", done: "Job settled", total: "Back to you", status: "Job done: unused labor refunded to the buyer and the technician paid with PayPal Payouts.", tone: "primary" },
};
