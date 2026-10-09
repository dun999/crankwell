import type { CarId, SystemId } from "@/lib/cars/types";
import type { RepairShop, SparePart, Technician } from "@/lib/commerce/types";

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
  | { type: "recommendations"; carId: CarId; headline: string; actions: RecommendedAction[] };

export type StreamEvent =
  | { event: "text"; data: { delta: string } }
  | { event: "progress"; data: { text: string } }
  | { event: "tool"; data: { id: string; name: string; label: string; status: "running" | "done" | "error" } }
  | { event: "ui"; data: UiEvent }
  | { event: "error"; data: { message: string } }
  | { event: "done"; data: { stopReason: string | null } };

export function encodeSse(e: StreamEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

export interface ViewContext {
  carId: CarId;
  selectedPart?: string | null;
  location?: { lat: number; lng: number; label?: string } | null;
}
