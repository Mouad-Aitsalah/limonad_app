import { currentMonthParam, isValidMonthParam, normalizeWeekParam } from "@/lib/commercial-analysis/period";
import { isValidBusinessDayParam } from "@/lib/business-day";
import {
  NO_SUPPLIER,
  SALES_METRICS,
  UNASSIGNED,
  type CoverageFilters,
  type SalesAnalysisFilters,
  type SalesMetric,
  type SortDirection,
} from "@/types/commercial-analysis";

/**
 * Validation of the filters of the commercial analysis API routes (the server
 * never trusts the query string). A missing value takes its default; a value
 * that is present but invalid is an ERROR (422), never silently replaced - the
 * admin must not read the figures of a filter they did not ask for.
 */

export class AnalysisFilterError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "AnalysisFilterError";
  }
}

type Source = { get(name: string): string | null };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Upper bound of a multiple selection (longer than any real list of users / suppliers: refused). */
export const MAX_SELECTION = 500;

/**
 * A multiple selection sent as ONE comma-separated parameter (?userIds=a,b). Missing or empty = []
 * (= everything); duplicates are removed (a value selected twice never counts twice); every value must
 * be a well-formed id or one of the `extra` tokens, else 422. Whether each id exists in the caller's
 * organisation is checked by the server code against its own lists.
 */
export function readIdList(source: Source, name: string, extra: readonly string[] = []): string[] {
  const raw = source.get(name)?.trim();
  if (!raw) return [];
  const values = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  if (values.length > MAX_SELECTION) throw new AnalysisFilterError("Sélection trop longue.", name);
  for (const value of values) {
    if (!extra.includes(value) && !ID_RE.test(value)) throw new AnalysisFilterError("Filtre invalide.", name);
  }
  return values;
}

function readMetric(source: Source, name: string, fallback: SalesMetric): SalesMetric {
  const value = source.get(name)?.trim();
  if (!value) return fallback;
  if ((SALES_METRICS as readonly string[]).includes(value)) return value as SalesMetric;
  throw new AnalysisFilterError("Indicateur invalide.", name);
}

export function parseSalesFilters(source: Source, now: Date = new Date()): SalesAnalysisFilters {
  const monthValue = source.get("month")?.trim();
  if (monthValue && !isValidMonthParam(monthValue)) throw new AnalysisFilterError("Mois invalide.", "month");
  const metric = readMetric(source, "metric", "revenue");
  const directionValue = source.get("direction")?.trim();
  if (directionValue && directionValue !== "asc" && directionValue !== "desc") {
    throw new AnalysisFilterError("Ordre de tri invalide.", "direction");
  }
  return {
    userIds: readIdList(source, "userIds"),
    month: monthValue || currentMonthParam(now),
    supplierIds: readIdList(source, "supplierIds", [NO_SUPPLIER]),
    metric,
    sort: readMetric(source, "sort", metric),
    direction: (directionValue as SortDirection | undefined) ?? "desc",
  };
}

export function parseCoverageFilters(source: Source, now: Date = new Date()): CoverageFilters {
  const weekValue = source.get("week")?.trim();
  if (weekValue && !isValidBusinessDayParam(weekValue)) throw new AnalysisFilterError("Semaine invalide.", "week");
  return {
    userIds: readIdList(source, "userIds", [UNASSIGNED]),
    week: normalizeWeekParam(weekValue, now),
  };
}
