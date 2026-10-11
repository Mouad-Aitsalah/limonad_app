import { businessDayRangeUtc, getCurrentBusinessDayParam, isValidBusinessDayParam } from "@/lib/business-day";

/**
 * Periods of the commercial analysis (Dashboard -> « Analyse des ventes » and
 * « Couverture commerciale »). Pure and isomorphic.
 *
 * Both follow the application's business-day convention (lib/business-day.ts):
 * a day runs from 02:00 to 02:00 the next day, Africa/Casablanca. So
 *   - a MONTH is [1st 02:00, next month's 1st 02:00[, displayed 01/MM -> last day;
 *   - a WEEK is calendar Monday -> Sunday: [Monday 02:00, next Monday 02:00[.
 * (No weekly business convention exists in the project, hence Monday-Sunday.)
 */

export type AnalysisRange = {
  /** Inclusive UTC lower bound. */
  start: Date;
  /** Exclusive UTC upper bound. */
  end: Date;
  /** First business day, "YYYY-MM-DD". */
  fromDay: string;
  /** Last business day (inclusive), "YYYY-MM-DD". */
  toDay: string;
};

const MONTH_RE = /^(\d{4})-(\d{2})$/;

const pad = (value: number, size = 2) => String(value).padStart(size, "0");
const dayParam = (date: Date) => `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const parseDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const addDays = (day: string, days: number) => {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dayParam(date);
};

export function isValidMonthParam(value: string | null | undefined): value is string {
  if (!value) return false;
  const match = MONTH_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 && year >= 2000 && year <= 2100;
}

/** "YYYY-MM" of the business day `now` falls in. */
export function currentMonthParam(now: Date = new Date()): string {
  return getCurrentBusinessDayParam(now).slice(0, 7);
}

export function monthRange(month: string): AnalysisRange {
  if (!isValidMonthParam(month)) throw new RangeError("Mois invalide.");
  const [year, monthNumber] = month.split("-").map(Number);
  const fromDay = `${pad(year, 4)}-${pad(monthNumber)}-01`;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0));
  const nextFirst = `${pad(monthNumber === 12 ? year + 1 : year, 4)}-${pad(monthNumber === 12 ? 1 : monthNumber + 1)}-01`;
  return {
    start: businessDayRangeUtc(fromDay).start,
    end: businessDayRangeUtc(nextFirst).start,
    fromDay,
    toDay: dayParam(lastDay),
  };
}

/** The Monday of the week containing `day` ("YYYY-MM-DD"). */
export function mondayOf(day: string): string {
  const date = parseDay(day);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - weekday);
  return dayParam(date);
}

export function currentWeekParam(now: Date = new Date()): string {
  return mondayOf(getCurrentBusinessDayParam(now));
}

/** A week param is any valid day: it is normalised to that week's Monday. */
export function normalizeWeekParam(value: string | null | undefined, now: Date = new Date()): string {
  return isValidBusinessDayParam(value) ? mondayOf(value) : currentWeekParam(now);
}

export function weekRange(weekParam: string): AnalysisRange {
  const monday = normalizeWeekParam(weekParam);
  const fromDay = monday;
  const toDay = addDays(monday, 6);
  return {
    start: businessDayRangeUtc(fromDay).start,
    end: businessDayRangeUtc(addDays(monday, 7)).start,
    fromDay,
    toDay,
  };
}

export function shiftWeek(weekParam: string, weeks: number): string {
  return addDays(normalizeWeekParam(weekParam), weeks * 7);
}

/** "01/09/2026" */
export function formatDayFr(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

const MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${year}`;
}

/** The months offered by the picker: the current one and the previous ones, newest first. */
export function recentMonths(count: number, now: Date = new Date()): Array<{ value: string; label: string }> {
  const [year, month] = currentMonthParam(now).split("-").map(Number);
  const out: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const index = year * 12 + (month - 1) - i;
    const value = `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
    out.push({ value, label: monthLabel(value) });
  }
  return out;
}
