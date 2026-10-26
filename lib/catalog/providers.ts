import type { RepairShop, Technician } from "@/lib/commerce/types";
import { openSlots } from "./slots";

// Seeded demo data. Shops are placed deterministically around the user's
// location so distances look real; nothing here is a real business.

export const DEFAULT_LOCATION = { lat: 37.377, lng: -121.922, label: "San Jose, CA (demo location)" };

const SHOP_SEEDS = [
  { id: "shop_precision_brake", name: "Precision Brake & Alignment", specialties: ["brakes", "suspension", "tires"], rating: 4.8, reviews: 412, km: 2.1, bearing: 40, street: "Market St", laborRate: 135, deposit: 25 },
  { id: "shop_torque_auto", name: "Torque Auto Repair", specialties: ["engine", "cooling", "electrical", "general"], rating: 4.7, reviews: 1290, km: 3.4, bearing: 120, street: "Alameda Ave", laborRate: 145, deposit: 40 },
  { id: "shop_bayline_transmission", name: "Bayline Transmission & Drivetrain", specialties: ["transmission", "general"], rating: 4.6, reviews: 388, km: 6.2, bearing: 200, street: "Industrial Pkwy", laborRate: 160, deposit: 50 },
  { id: "shop_voltworks", name: "VoltWorks Auto Electric", specialties: ["electrical", "general"], rating: 4.9, reviews: 221, km: 4.0, bearing: 300, street: "Commerce Dr", laborRate: 140, deposit: 30 },
  { id: "shop_quickstop_tire", name: "QuickStop Tire & Brake", specialties: ["tires", "brakes", "suspension"], rating: 4.4, reviews: 2045, km: 1.3, bearing: 260, street: "Stevens Creek Blvd", laborRate: 115, deposit: 25 },
  { id: "shop_hybrid_hub", name: "Hybrid Hub Toyota/Honda Specialists", specialties: ["engine", "electrical", "cooling", "general", "brakes"], rating: 4.9, reviews: 678, km: 5.5, bearing: 80, street: "Saratoga Ave", laborRate: 150, deposit: 35 },
  { id: "shop_exhaust_pros", name: "Muffler & Exhaust Pros", specialties: ["exhaust"], rating: 4.5, reviews: 310, km: 7.8, bearing: 160, street: "Monterey Rd", laborRate: 120, deposit: 25 },
  { id: "shop_collision_works", name: "Collision Works Body Shop", specialties: ["body"], rating: 4.6, reviews: 540, km: 3.9, bearing: 340, street: "Lawrence Expy", laborRate: 125, deposit: 50 },
];

/** Slots are offered at least this far ahead, and still bookable until this close to the time. */
const LISTING_LEAD_MIN = 60;
const BOOKING_LEAD_MIN = 15;
const MON_SAT = [1, 2, 3, 4, 5, 6];
const MON_FRI = [1, 2, 3, 4, 5];

/**
 * The clock shops near (lat, lng) keep: the demo city's real zone (with DST) around the Bay Area, else
 * a whole-hour zone from the longitude, which is close enough for seeded demo shops.
 */
export function zoneFor(lat = DEFAULT_LOCATION.lat, lng = DEFAULT_LOCATION.lng): string {
  if (lat > 32 && lat < 42.5 && lng > -125 && lng < -114) return "America/Los_Angeles";
  const h = Math.max(-12, Math.min(14, Math.round(lng / 15)));
  return h === 0 ? "Etc/GMT" : `Etc/GMT${h > 0 ? "-" : "+"}${Math.abs(h)}`;
}

const slotsFor = (i: number, tz: string, leadMin: number) => openSlots({ tz, openDays: i % 3 === 2 ? MON_FRI : MON_SAT, seed: i, leadMin });

export function shopsNear(lat = DEFAULT_LOCATION.lat, lng = DEFAULT_LOCATION.lng): RepairShop[] {
  const tz = zoneFor(lat, lng);
  return SHOP_SEEDS.map((s, i) => {
    const rad = (s.bearing * Math.PI) / 180;
    const dLat = (s.km / 111) * Math.cos(rad);
    const dLng = (s.km / (111 * Math.cos((lat * Math.PI) / 180))) * Math.sin(rad);
    return {
      id: s.id,
      name: s.name,
      specialties: s.specialties,
      rating: s.rating,
      reviews: s.reviews,
      distanceKm: s.km,
      address: `${100 + i * 137} ${s.street}`,
      hours: i % 3 === 2 ? "Mon–Fri 7:30–6" : "Mon–Sat 8–6",
      laborRate: s.laborRate,
      deposit: s.deposit,
      nextSlots: slotsFor(i, tz, LISTING_LEAD_MIN).slice(0, 3),
      timeZone: tz,
      lat: lat + dLat,
      lng: lng + dLng,
    };
  });
}

export function findShops(opts: { specialty?: string; maxKm?: number; lat?: number; lng?: number }): RepairShop[] {
  return shopsNear(opts.lat, opts.lng)
    .filter((s) => !opts.specialty || opts.specialty === "general" || s.specialties.includes(opts.specialty) || s.specialties.includes("general"))
    .filter((s) => !opts.maxKm || s.distanceKm <= opts.maxKm)
    .sort((a, b) => Number(b.specialties.includes(opts.specialty ?? "")) - Number(a.specialties.includes(opts.specialty ?? "")) || a.distanceKm - b.distanceKm)
    .slice(0, 4);
}

export const TECHNICIANS: Technician[] = [
  { id: "tech_maria", name: "Maria Gonzalez", initials: "MG", skills: ["brakes", "suspension", "general", "tires"], rating: 4.9, jobs: 640, calloutFee: 59, hourlyRate: 95, etaMinutes: 45, certified: "ASE Master Technician" },
  { id: "tech_dev", name: "Dev Patel", initials: "DP", skills: ["electrical", "engine", "general"], rating: 4.8, jobs: 512, calloutFee: 69, hourlyRate: 105, etaMinutes: 60, certified: "ASE A6/A8 Electrical & Engine Performance" },
  { id: "tech_sam", name: "Sam Okafor", initials: "SO", skills: ["engine", "cooling", "general"], rating: 4.7, jobs: 389, calloutFee: 49, hourlyRate: 90, etaMinutes: 35, certified: "ASE A1 Engine Repair" },
  { id: "tech_lin", name: "Lin Chen", initials: "LC", skills: ["brakes", "electrical", "general"], rating: 4.9, jobs: 801, calloutFee: 65, hourlyRate: 110, etaMinutes: 90, certified: "ASE A5 Brakes, Toyota & Honda trained" },
  { id: "tech_jo", name: "Jo Romero", initials: "JR", skills: ["tires", "suspension", "general"], rating: 4.6, jobs: 270, calloutFee: 39, hourlyRate: 80, etaMinutes: 30, certified: "TIA Tire Service" },
];

export function findTechnicians(skill?: string): Technician[] {
  return TECHNICIANS.filter((t) => !skill || t.skills.includes(skill) || skill === "general")
    .sort((a, b) => a.etaMinutes - b.etaMinutes)
    .slice(0, 3);
}

export function getShop(id: string, lat?: number, lng?: number) {
  return shopsNear(lat, lng).find((s) => s.id === id);
}

/** Can this slot still be booked? Any of the shop's open times counts, not only the three it lists. */
export function slotOpen(shopId: string, slot: string, lat?: number, lng?: number) {
  const i = SHOP_SEEDS.findIndex((s) => s.id === shopId);
  return i >= 0 && slotsFor(i, zoneFor(lat, lng), BOOKING_LEAD_MIN).includes(slot);
}
export function getTechnician(id: string) {
  return TECHNICIANS.find((t) => t.id === id);
}
