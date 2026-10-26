import type { CarId, SystemId } from "@/lib/cars/types";
import type { Action, Mandate, RepairShop, SparePart, Technician } from "@/lib/commerce/types";

// Events the agent route streams to the browser (Server-Sent Events).

export type Severity = "low" | "moderate" | "high" | "critical";
export type DriveSafety = "safe" | "caution" | "do_not_drive";

export interface Suspect {
  partId: string;
  name: string;
  system: SystemId;
  confidence: number;
  rationale: string;
}

export interface SafetyTest {
  id: string;
  title: string;
  why: string;
  steps: string[];
  safetyNote: string;
  answerOptions: string[];
}

export type ActionType = "diy" | "buy_part" | "book_technician" | "reserve_shop" | "tow";

export interface RecommendedAction {
  type: ActionType;
  title: string;
  why: string;
  urgency: "now" | "soon" | "when_convenient";
  part?: { id: string; name: string };
  skus?: SparePart[];
  technician?: Technician;
  shop?: RepairShop;
  steps?: string[];
  toolsNeeded?: string[];
  estCost?: { min: number; max: number };
}

/** A part the mechanic suggests buying, with every SKU the store sells for it. */
export interface PartOffer {
  part: { id: string; name: string };
  skus: SparePart[];
}

export type UiEvent =
  | { type: "focus"; carId: CarId; partIds: string[]; reason: string }
  | {
      type: "diagnosis";
      carId: CarId;
      title: string;
      summary: string;
      severity: Severity;
      driveSafety: DriveSafety;
      suspects: Suspect[];
    }
  | { type: "safety_tests"; intro: string; tests: SafetyTest[] }
  | { type: "recommendations"; carId: CarId; headline: string; actions: RecommendedAction[] }
  | { type: "action"; action: Action; oneTap: boolean }
  | { type: "mandate"; mandate: Mandate }
  /** Parts with prices and Buy buttons; `pick` is the SKU the mechanic recommends. */
  | { type: "parts"; carId: CarId; headline: string; note?: string; groups: PartOffer[]; pick?: string }
  /** Tappable replies under the mechanic's message. */
  | { type: "replies"; replies: string[] };

/** A diagnosis saved for a deep link (/app?case=<id>), e.g. one made in Claude through the MCP connector. */
export interface DiagnosisCase {
  id: string;
  source: "claude" | "app";
  carId: CarId;
  /** The user's own car when it differs from the reference model, e.g. "2017 Honda Civic". */
  vehicle?: string;
  title: string;
  summary: string;
  severity: Severity;
  driveSafety: DriveSafety;
  suspects: Suspect[];
  options?: { headline: string; actions: RecommendedAction[] };
  createdAt: string;
}

export type StreamEvent =
  | { event: "text"; data: { delta: string } }
  | { event: "tool"; data: { id: string; name: string; label: string; status: "running" | "done" | "error" } }
  | { event: "ui"; data: UiEvent }
  | { event: "error"; data: { message: string } }
  | { event: "done"; data: { stopReason: string | null; trace?: TraceSummary } };

/** How the turn ran, for the agent trace under the reply. */
export interface TraceSummary {
  provider: string;
  model: string;
  failover: boolean;
  offline?: boolean;
  llmCalls: number;
  tokens: number;
  toolErrors: number;
}

export function encodeSse(e: StreamEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

export interface ViewContext {
  carId: CarId;
  selectedPart?: string | null;
  location?: { lat: number; lng: number; label?: string } | null;
}
