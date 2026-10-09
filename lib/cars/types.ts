// Plain-data car/part model shared by the 3D client and the agent server.
// No three.js imports here: the server builds its catalog from these files.

export type CarId = "corolla" | "crv";

export const SYSTEM_IDS = [
  "body",
  "engine",
  "intake",
  "exhaust",
  "cooling",
  "electrical",
  "fuel",
  "transmission",
  "drivetrain",
  "brakes",
  "suspension",
  "steering",
  "wheels",
  "interior",
] as const;
export type SystemId = (typeof SYSTEM_IDS)[number];

export type Vec3 = [number, number, number];

export interface PriceRange {
  /** Typical part price, USD, low end (aftermarket) */
  partMin: number;
  /** Typical part price, USD, high end (OEM / premium) */
  partMax: number;
  /** Typical shop labor for the replacement, USD */
  laborMin: number;
  laborMax: number;
  /** What the price refers to, e.g. "per axle set" */
  unit?: string;
}

/** Shared description of a kind of part (one template → many instances). */
export interface PartTemplate {
  name: string;
  system: SystemId;
  purpose: string;
  price: PriceRange;
  /** 1 = anyone with basic tools, 5 = specialist shop only */
  diy: 1 | 2 | 3 | 4 | 5;
  symptoms: string[];
  lifespan?: string;
  /** Can be bought as a spare part through the app's parts store */
  purchasable: boolean;
  /** Repair-shop specialty that handles this part */
  specialty: ShopSpecialty;
}

export type ShopSpecialty =
  | "brakes"
  | "engine"
  | "transmission"
  | "electrical"
  | "suspension"
  | "cooling"
  | "exhaust"
  | "tires"
  | "body"
  | "general";

export type BuildParam = number | string | boolean | number[];

export interface BuildSpec {
  kind: string;
  params?: Record<string, BuildParam>;
}

/** One concrete part placed on a specific car. */
export interface PartInstance {
  id: string;
  template: string;
  /** Instance display name, e.g. "Front-left brake caliper" */
  name: string;
  system: SystemId;
  position: Vec3;
  rotation?: Vec3;
  /** Mirror geometry across the car's centerline (left-side parts) */
  mirror?: boolean;
  build: BuildSpec;
  /** Own offset at full explosion, added to its assembly's offset */
  explode: Vec3;
  /** 0..1, when in the disassembly sequence this part starts moving */
  stage: number;
  assembly?: string;
  /** Car-specific detail appended to the template's purpose */
  note?: string;
  /** Car-specific price override (e.g. tire size) */
  price?: PriceRange;
}

export interface Assembly {
  offset: Vec3;
  stage: number;
}

export interface BodyProfile {
  style: "sedan" | "suv";
  xFront: number;
  xRear: number;
  /** Plan-view corner radii at the nose and tail */
  rFront: number;
  rRear: number;
  /** Centerline top surface (bumper → hood → windshield → roof → deck), [x, y] */
  top: [number, number][];
  /** Beltline (window base / fender top), [x, y] */
  belt: [number, number][];
  /** Bottom edge of the shell (bumper lips and sills, before wheel arches), [x, y] */
  edge: [number, number][];
  /** Height of the widest character line below the belt */
  shoulderDrop: number;
  /** Half-widths */
  wMax: number;
  wBelt: number;
  wRoof: number;
  wBottom: number;
  crown: number;
  archGap: number;
  /** Key x stations for panel seams */
  seams: {
    bumperF: number; // front bumper rear edge (at the arch)
    lampF: number; // headlight inner edge
    hoodF: number; // hood leading edge
    cowl: number; // base of windshield / rear of hood
    header: number; // top of windshield
    doorF: number; // front door leading edge
    bPillar: number;
    doorR: number; // rear door trailing edge
    roofRear: number; // rear end of roof panel
    deck: number; // base of rear glass / start of trunk or tailgate
    lampR: number; // taillight inner edge
    bumperR: number; // rear bumper front edge
  };
  paint: string;
  /** Unpainted lower cladding, for SUVs */
  cladding: boolean;
}

export interface CarSpec {
  id: CarId;
  make: string;
  model: string;
  generation: string;
  year: string;
  engine: string;
  engineCode: string;
  power: string;
  transmission: string;
  drivetrain: "FWD" | "AWD";
  dims: {
    length: number;
    width: number;
    height: number;
    wheelbase: number;
    trackF: number;
    trackR: number;
    tireRadius: number;
    tireWidth: number;
    rimRadius: number;
    rotorRadiusF: number;
    rotorRadiusR: number;
  };
  body: BodyProfile;
  turbo: boolean;
  /** Engine assembly origin: crankshaft centerline at the block's midpoint */
  engineOrigin: Vec3;
  rideHeight: number;
}

export interface CarModel {
  spec: CarSpec;
  parts: PartInstance[];
  assemblies: Record<string, Assembly>;
}

export const SYSTEM_META: Record<SystemId, { label: string; color: string }> = {
  body: { label: "Body & glass", color: "#94a3b8" },
  engine: { label: "Engine", color: "#f97316" },
  intake: { label: "Air intake", color: "#f59e0b" },
  exhaust: { label: "Exhaust", color: "#a8a29e" },
  cooling: { label: "Cooling", color: "#06b6d4" },
  electrical: { label: "Electrical", color: "#eab308" },
  fuel: { label: "Fuel", color: "#ec4899" },
  transmission: { label: "Transmission", color: "#10b981" },
  drivetrain: { label: "Drivetrain", color: "#84cc16" },
  brakes: { label: "Brakes", color: "#ef4444" },
  suspension: { label: "Suspension", color: "#8b5cf6" },
  steering: { label: "Steering", color: "#6366f1" },
  wheels: { label: "Wheels & tires", color: "#64748b" },
  interior: { label: "Interior", color: "#14b8a6" },
};
