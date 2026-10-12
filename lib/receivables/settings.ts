import type { ReceivablesSettings } from "@/types/receivables";

/**
 * The « délai de retard » of the Dashboard's « Créances clients » section,
 * chosen by the admin in the app (no code change). Stored for the
 * organisation under the "receivables" key of Organization.productColumnSettings
 * - the organisation's existing JSON settings bag, which already holds the
 * /produits columns ("columns") and the custom table labels ("labels"); each
 * writer only replaces its own key (see lib/server/organization-settings.ts and
 * lib/table-labels/labels.ts#withPageLabels), so no migration is needed.
 *
 *   { ..., "receivables": { "overdueDays": 45 } }
 *
 * The delay has nothing to do with the aging buckets (0-30 / 31-60 / 61-90 /
 * 90+ days) nor with the fixed « plus de 30 jours » indicator.
 */

export const DEFAULT_OVERDUE_DAYS = 30;
export const MIN_OVERDUE_DAYS = 1;
export const MAX_OVERDUE_DAYS = 365;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_OVERDUE_DAYS && value <= MAX_OVERDUE_DAYS;
}

/** Reads the stored settings; anything missing or invalid -> the default. */
export function parseReceivablesSettings(stored: unknown): ReceivablesSettings {
  const raw = isRecord(stored) && isRecord(stored.receivables) ? stored.receivables.overdueDays : undefined;
  return isValidDays(raw) ? { overdueDays: raw, isDefault: false } : { overdueDays: DEFAULT_OVERDUE_DAYS, isDefault: true };
}

export type OverdueDaysValidation = { ok: true; value: number } | { ok: false; message: string };

/** Validates what the admin typed: a whole number of days in range (a numeric string is accepted). */
export function validateOverdueDays(input: unknown): OverdueDaysValidation {
  const value = typeof input === "string" && input.trim() !== "" ? Number(input.trim()) : input;
  if (!isValidDays(value)) {
    return {
      ok: false,
      message: `Le délai doit être un nombre entier de jours entre ${MIN_OVERDUE_DAYS} et ${MAX_OVERDUE_DAYS}.`,
    };
  }
  return { ok: true, value };
}

/** The stored JSON with the receivables settings replaced and every other key (columns, labels, ...) kept. */
export function withReceivablesSettings(stored: unknown, overdueDays: number): Record<string, unknown> {
  const base = isRecord(stored) ? { ...stored } : {};
  base.receivables = { overdueDays };
  return base;
}
