/**
 * Dashboard Direction (BI Phase 2B) - period selector shared between the
 * server orchestrator (lib/server/dashboard-direction.ts) and the client
 * period-bar component. Deliberately free of "server-only"/DB imports so
 * both sides can import the SAME preset list and date math without
 * duplicating it - the client only ever uses this to build URLs and to
 * highlight the active preset, never to compute KPI values itself.
 */

export type DirectionPeriodPresetKey =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "month"
  | "prev_month";

export type DirectionPeriodKey = DirectionPeriodPresetKey | "custom";

export const DIRECTION_PERIOD_PRESETS: Array<{ key: DirectionPeriodPresetKey; label: string }> = [
  { key: "today", label: "Aujourd'hui" },
  { key: "yesterday", label: "Hier" },
  { key: "7d", label: "7 jours" },
  { key: "30d", label: "30 jours" },
  { key: "month", label: "Ce mois" },
  { key: "prev_month", label: "Mois precedent" },
];

export const DEFAULT_DIRECTION_PERIOD_KEY: DirectionPeriodKey = "30d";

export type DirectionPeriodResolution = {
  key: DirectionPeriodKey;
  label: string;
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound - every BI helper's own [gte from, lt to) convention. */
  to: Date;
  /** Immediately-preceding window of the exact same length, per the
   * chantier's own comparison rule ("30 jours actuels -> comparer aux 30
   * jours immediatement precedents"), applied uniformly to every preset
   * including "Ce mois" (month-to-date vs the equal-length days right
   * before it) and "Personnalise". */
  previousFrom: Date;
  previousTo: Date;
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + days);
  return clone;
}

/** Parses a "YYYY-MM-DD" search-param value into a local calendar date at
 * midnight, or null if malformed - never trusts the string blindly since it
 * comes straight from the URL. */
function parseDateParam(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function withPreviousWindow(
  key: DirectionPeriodKey,
  label: string,
  from: Date,
  to: Date,
): DirectionPeriodResolution {
  const spanMs = to.getTime() - from.getTime();
  const previousTo = from;
  const previousFrom = new Date(from.getTime() - spanMs);
  return { key, label, from, to, previousFrom, previousTo };
}

/**
 * Reads {period, from, to} the way they arrive from Next.js's
 * `searchParams` (string | string[] | undefined) and resolves the actual
 * date window - never accepts anything else as input, so it is safe to call
 * directly with the raw searchParams object.
 *
 * Precedence: an explicit, valid from+to pair always wins (matches the
 * user's own example `/dashboard?from=2026-08-01&to=2026-08-31` with no
 * `period` param at all) - otherwise falls back to a recognised `period`
 * preset, defaulting to 30 jours.
 */
export function resolveDirectionPeriod(
  params: Record<string, string | string[] | undefined>,
): DirectionPeriodResolution {
  const rawPeriod = typeof params.period === "string" ? params.period : undefined;
  const rawFrom = typeof params.from === "string" ? params.from : undefined;
  const rawTo = typeof params.to === "string" ? params.to : undefined;

  const customFrom = parseDateParam(rawFrom);
  const customTo = parseDateParam(rawTo);
  if (customFrom && customTo && customFrom.getTime() <= customTo.getTime()) {
    const from = startOfDay(customFrom);
    // "date debut + date fin" - inclusive of the end date.
    const to = addDays(startOfDay(customTo), 1);
    return withPreviousWindow("custom", "Personnalise", from, to);
  }

  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);

  const presetKey: DirectionPeriodPresetKey =
    rawPeriod && DIRECTION_PERIOD_PRESETS.some((preset) => preset.key === rawPeriod)
      ? (rawPeriod as DirectionPeriodPresetKey)
      : (DEFAULT_DIRECTION_PERIOD_KEY as DirectionPeriodPresetKey);

  switch (presetKey) {
    case "today":
      return withPreviousWindow("today", "Aujourd'hui", today, tomorrow);
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return withPreviousWindow("yesterday", "Hier", yesterday, today);
    }
    case "7d": {
      const from = addDays(today, -6);
      return withPreviousWindow("7d", "7 jours", from, tomorrow);
    }
    case "month": {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      return withPreviousWindow("month", "Ce mois", from, tomorrow);
    }
    case "prev_month": {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const to = new Date(today.getFullYear(), today.getMonth(), 1);
      return withPreviousWindow("prev_month", "Mois precedent", from, to);
    }
    case "30d":
    default: {
      const from = addDays(today, -29);
      return withPreviousWindow("30d", "30 jours", from, tomorrow);
    }
  }
}

/** Builds the query string for a preset button / custom range, dropping the
 * other period params so switching preset always clears a stale custom
 * range and vice versa. */
export function buildDirectionPeriodQuery(
  next: { period: DirectionPeriodPresetKey } | { from: string; to: string },
): string {
  const searchParams = new URLSearchParams();
  if ("period" in next) {
    searchParams.set("period", next.period);
  } else {
    searchParams.set("from", next.from);
    searchParams.set("to", next.to);
  }
  return `?${searchParams.toString()}`;
}
