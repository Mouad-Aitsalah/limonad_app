/**
 * Restant theorique / restant reel / decalage of a "transfert de stock" line,
 * shared by the /chargements page, the detail page and the printed ticket.
 *
 *  - Restant theorique: the truck stock after the charge initiale (which
 *    replaces the old truck stock), the recharges, the sales and every other
 *    recorded movement - i.e. the truck StockLevel, where each movement is
 *    applied once. On an open fiche it is read live; at the close it is frozen
 *    on the line (theoreticalRemainingQuantity) and shown as frozen.
 *  - Restant reel: a physical count, optional (null = not counted, never 0).
 *  - Decalage = restant reel - restant theorique: negative = manque, 0 =
 *    concordance, positive = surplus; none at all when the count is missing.
 * Quantities are whole units (Int columns), so no rounding is involved.
 */

export type RemainingLine = {
  /** Frozen at the close (null on an open fiche, or never figured). */
  theoreticalRemainingQuantity: number | null;
  /** Live truck stock of the product (null when unknown). */
  truckCurrentQuantity: number | null;
  actualRemainingQuantity: number | null;
};

export type LoadingStatus = "DRAFT" | "VALIDATED" | "CANCELLED" | string;

export function theoreticalRemaining(line: RemainingLine, status: LoadingStatus): number | null {
  if (line.theoreticalRemainingQuantity !== null) return line.theoreticalRemainingQuantity;
  // a cancelled fiche has nothing left to compare
  if (status === "CANCELLED") return null;
  return line.truckCurrentQuantity;
}

export function remainingGap(actual: number | null, theoretical: number | null): number | null {
  if (actual === null || theoretical === null) return null;
  return actual - theoretical;
}

export type GapTone = "missing" | "shortage" | "match" | "surplus";

export function gapTone(gap: number | null): GapTone {
  if (gap === null) return "missing";
  if (gap < 0) return "shortage";
  if (gap > 0) return "surplus";
  return "match";
}

const GAP_TITLES: Record<GapTone, string> = {
  missing: "Restant reel non renseigne",
  shortage: "Manque de stock",
  match: "Concordance",
  surplus: "Surplus",
};

export function gapTitle(gap: number | null): string {
  return GAP_TITLES[gapTone(gap)];
}

/** "+5" surplus, "-5" manque, "0" concordance, the dash when not counted. */
export function formatGap(gap: number | null, dash = "—"): string {
  if (gap === null) return dash;
  return gap > 0 ? `+${gap}` : String(gap);
}

export function formatQuantityOrDash(value: number | null, dash = "—"): string {
  return value === null ? dash : String(value);
}

/** "Produits comptes : 3 / 5" */
export function countedSummary(lines: ReadonlyArray<{ actualRemainingQuantity: number | null }>): { counted: number; total: number } {
  return { counted: lines.filter((line) => line.actualRemainingQuantity !== null).length, total: lines.length };
}
