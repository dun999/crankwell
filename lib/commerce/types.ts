// Shared commerce types (server + client).

export type TxKind = "parts" | "shop_deposit" | "technician_invoice";

export type TxStatus =
  | "CREATED"
  | "APPROVED"
  | "COMPLETED"
  | "AUTHORIZED"
  | "CAPTURED"
  | "VOIDED"
  | "REFUNDED"
  /** PayPal pulled the money back (chargeback or dispute lost). */
  | "REVERSED"
  | "DENIED"
  | "FAILED"
  | "DRAFT"
  | "SENT"
  | "UNPAID"
  | "PAID"
  | "CANCELLED";

export interface TxItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: string;
}

export interface TxEvent {
  at: string;
  source: "app" | "paypal-api" | "paypal-webhook";
  type: string;
  note?: string;
  /** A webhook that arrived after the transaction had already moved past it. */
  late?: boolean;
}

/** A buyer dispute on this payment, from CUSTOMER.DISPUTE.* webhooks. */
export interface TxDispute {
  id: string;
  reason?: string;
  status?: string;
  stage?: string;
  outcome?: string;
  amount?: string;
  updatedAt: string;
}

/** Parts shipment, recorded as an Orders v2 tracker on the PayPal capture. */
export interface TxShipment {
  carrier: string;
  trackingNumber: string;
  trackerId: string;
  status: string;
  shippedAt: string;
}

/** A finished technician job: actual hours, and the unused labor refunded to the buyer. */
export interface TxJob {
  completedAt: string;
  hours: number;
  estimatedHours: number;
  refunded: string;
}

/** The technician's share, paid with PayPal Payouts. */
export interface TxPayout {
  batchId: string;
  itemId?: string;
  status: string;
  amount: string;
  fee?: string;
  payee: string;
  receiver: string;
  error?: string;
}

export interface Transaction {
  id: string;
  sessionId: string;
  kind: TxKind;
  status: TxStatus;
  title: string;
  detail?: string;
  amount: string;
  currency: "USD";
  carId?: string;
  partId?: string;
  items?: TxItem[];
  paypal: {
    orderId?: string;
    captureId?: string;
    authorizationId?: string;
    refundId?: string;
    invoiceId?: string;
    invoiceNumber?: string;
    payerViewUrl?: string;
    payerEmail?: string;
  };
  meta?: Record<string, unknown>;
  /** Ship-to, as PayPal has it on the order. */
  shipping?: { name?: string; address: string };
  shipment?: TxShipment;
  job?: TxJob;
  payout?: TxPayout;
  dispute?: TxDispute;
  events: TxEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface SparePart {
  sku: string;
  carId: string;
  partId: string;
  template: string;
  name: string;
  tier: "Value" | "OE-Equivalent" | "Performance";
  brand: string;
  price: number;
  warranty: string;
  inStock: boolean;
  shipDays: number;
}

export interface RepairShop {
  id: string;
  name: string;
  specialties: string[];
  rating: number;
  reviews: number;
  distanceKm: number;
  address: string;
  hours: string;
  laborRate: number;
  deposit: number;
  /** Open appointment times as ISO instants, earliest first. */
  nextSlots: string[];
  /** The shop's clock, for showing slot times (IANA zone). */
  timeZone: string;
  lat: number;
  lng: number;
}

export interface Technician {
  id: string;
  name: string;
  initials: string;
  skills: string[];
  rating: number;
  jobs: number;
  calloutFee: number;
  hourlyRate: number;
  etaMinutes: number;
  certified: string;
}

// ───────────────────────── Agent-prepared actions ─────────────────────────

/** An after-sale change to one of the user's orders (see lib/commerce/ops.ts for when each applies). */
export type ChangeKind = "refund" | "check_in" | "cancel_reservation" | "cancel_invoice" | "remind_invoice" | "complete_job";
export type ActionKind = TxKind | ChangeKind;

/** What the agent proposes. The server prices it from the catalog; only the user can confirm it. */
export type ActionPayload =
  | { kind: "parts"; carId: string; partId: string; items: { sku: string; quantity: number }[] }
  | { kind: "shop_deposit"; carId: string; partId?: string; shopId: string; slot: string; issue?: string; location?: { lat: number; lng: number } | null }
  | { kind: "technician_invoice"; carId: string; partId?: string; technicianId: string; when: string; hours: number; issue?: string; email?: string }
  | { kind: ChangeKind; txId: string; reason?: string; /** complete_job: hours actually worked */ hours?: number };

export type ChangePayload = Extract<ActionPayload, { txId: string }>;

export type ActionStatus = "pending" | "confirming" | "confirmed" | "expired" | "cancelled";

export interface ActionLine {
  label: string;
  amount: string;
}

export interface Action {
  id: string;
  kind: ActionKind;
  status: ActionStatus;
  source: "app" | "claude";
  caseId?: string;
  title: string;
  summary: string;
  lines: ActionLine[];
  amount: string;
  /** "Charged now", "Held, not charged" or "Invoice after the visit". */
  policy: string;
  payload: ActionPayload;
  txId?: string;
  /** How it was confirmed: one tap with saved PayPal, PayPal approval, a sent invoice, or a change to an order. */
  via?: "vault" | "approval" | "invoice" | "change";
  error?: string;
  createdAt: string;
  expiresAt: string;
  /** When the current confirm attempt started, so an interrupted one can be recovered. */
  confirmingSince?: string;
  confirmedAt?: string;
}

/** Saved PayPal for one-tap, as the browser sees it (the vault token stays on the server). */
export interface WalletInfo {
  email?: string;
  savedAt: string;
}
