import { BUSINESS_DAY_TIME_ZONE } from "@/lib/business-day";

/**
 * Display formats of the /trajets page (map info windows, tour panel, timeline,
 * customers table). Display only: the stored values are never changed.
 *
 * Every moment is shown in the business time zone of the ERP (Africa/Casablanca,
 * lib/business-day.ts) - not in the browser's - so the server-built timeline and
 * the client-built panels always agree:
 *
 *   formatRouteDateTime("2026-10-05T08:45:00Z")  ->  "05 oct. 2026 · 09:45"
 *
 * Framework-free: usable on the server and in client components.
 */

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: BUSINESS_DAY_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: BUSINESS_DAY_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Calendar date stored as midnight UTC (Tour.date): formatted in UTC, never shifted. */
const dayFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "05 oct. 2026 · 09:45" (Casablanca), "-" when absent / invalid. */
export function formatRouteDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "-";
  return `${dateFormatter.format(date)} · ${timeFormatter.format(date)}`;
}

/** "09:45" (Casablanca), "-" when absent / invalid. */
export function formatRouteTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? timeFormatter.format(date) : "-";
}

/** "05 oct. 2026" for a calendar date stored at midnight UTC (Tour.date). */
export function formatRouteDay(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? dayFormatter.format(date) : "-";
}

const CIRCLED_1_TO_20 = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

/** "①".."⑳", then "(21)", "(22)"... - for the plain-text places (map info windows). */
export function formatCommercialStopNumber(value: number): string {
  if (Number.isInteger(value) && value >= 1 && value <= 20) {
    return Array.from(CIRCLED_1_TO_20)[value - 1] ?? `(${value})`;
  }
  return `(${value})`;
}
