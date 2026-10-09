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
  nextSlots: string[];
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
