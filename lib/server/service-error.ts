import { isWithinMoneyRange } from "@/lib/money";

// The business error of the server services (HTTP status + per-field messages).
// Lives here, without the "server-only" marker, only so that modules tested
// without Next (import cores) can throw the SAME class; lib/server/depots.ts
// re-exports it, so every existing `instanceof OperationsServiceError` keeps
// matching exactly as before.
export class OperationsServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

// Moved unchanged from lib/server/depots.ts (re-exported there).
/**
 * F8-D: the single gate every money-writing flow (createCounterSale,
 * createDriverSale, createPurchase, credit notes, payments, tour-closure
 * valorisations) calls right after computing an amount and before any
 * Prisma write. Every Sale/Purchase/CreditNote/Payment/TourClosure/
 * Discrepancy money column is `Decimal(12,2)` in Postgres - a value outside
 * [-9999999999.99, 9999999999.99] would otherwise reach the database as a
 * raw, unhandled overflow (Postgres 22003, surfaced by Prisma as P2010) deep
 * inside a transaction, rather than a clean business error. `label` is for
 * server-side diagnostics only (never included in the thrown message, which
 * stays generic on purpose - no internals leak to the client). Delegates the
 * actual comparison to lib/money.ts's Decimal-based `isWithinMoneyRange`, not
 * a fragile float one.
 */
export function assertMoneyRange(value: number, label: string): void {
  if (!isWithinMoneyRange(value)) {
    console.error(`[assertMoneyRange] out-of-range amount rejected: ${label}=${value}`);
    throw new OperationsServiceError(
      "Le montant calcule depasse la limite autorisee.",
      422,
    );
  }
}
