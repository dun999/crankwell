// Shop appointment slots: real times in the shop's own time zone, stored as ISO instants so a slot
// means the same moment on the server, in the browser, in PayPal and in Claude. Safe on the client.

const DAY_MS = 86_400_000;
/** Times a bay can open, shop-local [hour, minute]. Shops are partly booked, so each shows half of them. */
const TIMES = [
  [8, 0],
  [9, 30],
  [11, 0],
  [13, 0],
  [14, 30],
  [16, 0],
] as const;
const DAYS_AHEAD = 6;

function wall(tz: string, at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return p;
}

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMinutes(tz: string, at: Date) {
  const p = wall(tz, at);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000) / 60_000;
}

/** The instant a shop-local wall time happens (DST-aware). */
function zonedInstant(tz: string, y: number, m: number, d: number, hh: number, mm: number) {
  const guess = Date.UTC(y, m, d, hh, mm);
  let t = guess - offsetMinutes(tz, new Date(guess)) * 60_000;
  const second = guess - offsetMinutes(tz, new Date(t)) * 60_000;
  if (second !== t) t = second;
  return new Date(t);
}

/**
 * Open slots for the next few days, earliest first. `openDays` uses Date#getDay numbering (0 = Sunday);
 * `seed` decides which half of the day's times this shop has free. Slots start at least `leadMin` from now.
 */
export function openSlots(opts: { tz: string; openDays: readonly number[]; seed: number; leadMin: number; now?: number }): string[] {
  const now = opts.now ?? Date.now();
  const today = wall(opts.tz, new Date(now));
  const out: string[] = [];
  for (let day = 0; day < DAYS_AHEAD; day++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + day));
    if (!opts.openDays.includes(date.getUTCDay())) continue;
    TIMES.forEach(([hh, mm], i) => {
      if ((i + day + opts.seed) % 2) return;
      const t = zonedInstant(opts.tz, date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hh, mm);
      if (t.getTime() >= now + opts.leadMin * 60_000) out.push(t.toISOString());
    });
  }
  return out;
}

const dayKey = (tz: string, d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** "Today 3:30 PM", "Tomorrow 8:00 AM" or "Thu 9:30 AM", in the shop's time. Falls back to the raw value. */
export function slotLabel(slot: string, tz: string, now = Date.now()): string {
  const d = new Date(slot);
  if (Number.isNaN(d.getTime())) return slot;
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
  const k = dayKey(tz, d);
  if (k === dayKey(tz, new Date(now))) return `Today ${time}`;
  if (k === dayKey(tz, new Date(now + DAY_MS))) return `Tomorrow ${time}`;
  return `${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d)} ${time}`;
}

/** A slot as it reads on a receipt or invoice: "Thu, Oct 30, 9:30 AM PDT". */
export function slotDate(slot: string, tz: string): string {
  const d = new Date(slot);
  if (Number.isNaN(d.getTime())) return slot;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
}
