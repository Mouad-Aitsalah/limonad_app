import { currentMonthParam, isValidMonthParam, normalizeWeekParam } from "@/lib/commercial-analysis/period";
import { isValidBusinessDayParam } from "@/lib/business-day";
import {
  SALES_METRICS,
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

function readId(source: Source, name: string, extra: readonly string[] = []): string {
  const value = source.get(name)?.trim();
  if (!value) return "all";
  if (value === "all" || extra.includes(value) || ID_RE.test(value)) return value;
  throw new AnalysisFilterError("Filtre invalide.", name);
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
    driverId: readId(source, "driverId"),
    month: monthValue || currentMonthParam(now),
    supplierId: readId(source, "supplierId", ["none"]),
    metric,
    sort: readMetric(source, "sort", metric),
    direction: (directionValue as SortDirection | undefined) ?? "desc",
  };
}

export function parseCoverageFilters(source: Source, now: Date = new Date()): CoverageFilters {
  const weekValue = source.get("week")?.trim();
  if (weekValue && !isValidBusinessDayParam(weekValue)) throw new AnalysisFilterError("Semaine invalide.", "week");
  return {
    driverId: readId(source, "driverId"),
    week: normalizeWeekParam(weekValue, now),
  };
}
