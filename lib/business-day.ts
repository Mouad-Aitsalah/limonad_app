/**
 * COMDIS "journée commerciale" (business day).
 *
 * A business day does NOT end at midnight - it runs from 02:00 local time to
 * 02:00 the next day, cut in the organisation's timezone (Morocco -
 * Africa/Casablanca, which is UTC+1 most of the year and UTC+0 during
 * Ramadan; the offset is resolved per-instant via Intl, never hard-coded).
 *
 * Business day D  ==  [ D 02:00:00 local , (D+1) 02:00:00 local [
 *                      start inclusive        end EXCLUSIVE
 *
 * e.g. day 2026-09-10:
 *   10/09 23:59 -> day 10/09      11/09 01:59 -> day 10/09
 *   11/09 00:01 -> day 10/09      11/09 02:00 -> day 11/09
 *
 * Pure + isomorphic (no `server-only`): the client uses `formatBusinessDayLabel`
 * / `isValidBusinessDayParam`, the server uses `businessDayRangeUtc` to build
 * the SQL bounds.
 */

export const BUSINESS_DAY_TIME_ZONE = "Africa/Casablanca";
export const BUSINESS_DAY_CUTOFF_HOUR = 2;

const DAY_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidBusinessDayParam(value: string | null | undefined): value is string {
  if (!value || !DAY_PARAM_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

/** Milliseconds `timeZone` is ahead of UTC at the given instant. */
function zoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour === 24 ? 0 : map.hour,
    map.minute,
    map.second,
  );
  return asUtc - at.getTime();
}

/**
 * The UTC instant of a wall-clock time in `timeZone`. Two passes settle the
 * offset (a single pass is wrong across a DST change); the rare ambiguous /
 * skipped hour at a transition resolves to one deterministic side, which is
 * acceptable for a day boundary at 02:00.
 */
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  let offset = zoneOffsetMs(timeZone, new Date(naiveUtc));
  offset = zoneOffsetMs(timeZone, new Date(naiveUtc - offset));
  return new Date(naiveUtc - offset);
}

function wallDatePartsInZone(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(at);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: map.hour === "24" ? 0 : Number(map.hour),
  };
}

function toDayParam(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The business day that `now` currently falls in, as "YYYY-MM-DD". Before
 * 02:00 local it is still the previous calendar day.
 */
export function getCurrentBusinessDayParam(now: Date = new Date()): string {
  const { year, month, day, hour } = wallDatePartsInZone(now, BUSINESS_DAY_TIME_ZONE);
  // Shift to the previous calendar day when we are before the cutoff. Using
  // UTC math on the date parts keeps month/year rollover correct.
  const shifted = new Date(Date.UTC(year, month - 1, day));
  if (hour < BUSINESS_DAY_CUTOFF_HOUR) {
    shifted.setUTCDate(shifted.getUTCDate() - 1);
  }
  return toDayParam(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * UTC [start, end) instants for business day `dayParam` ("YYYY-MM-DD").
 * Falls back to the current business day for an invalid param.
 */
export function businessDayRangeUtc(dayParam: string): { start: Date; end: Date; day: string } {
  const day = isValidBusinessDayParam(dayParam) ? dayParam : getCurrentBusinessDayParam();
  const [year, month, dayNum] = day.split("-").map(Number);

  const start = zonedWallTimeToUtc(year, month, dayNum, BUSINESS_DAY_CUTOFF_HOUR, BUSINESS_DAY_TIME_ZONE);

  const next = new Date(Date.UTC(year, month - 1, dayNum));
  next.setUTCDate(next.getUTCDate() + 1);
  const end = zonedWallTimeToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    BUSINESS_DAY_CUTOFF_HOUR,
    BUSINESS_DAY_TIME_ZONE,
  );

  return { start, end, day };
}

/** "YYYY-MM-DD" -> "DD/MM/YYYY" for display. */
export function formatBusinessDayLabel(dayParam: string): string {
  if (!isValidBusinessDayParam(dayParam)) return dayParam;
  const [year, month, day] = dayParam.split("-");
  return `${day}/${month}/${year}`;
}
