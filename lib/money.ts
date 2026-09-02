/**
 * F8-B (Phase 2 audit): the one shared implementation for 2-decimal money
 * arithmetic, meant to progressively replace the ~20 local copies of
 * `Math.round(value * 100) / 100` scattered across this codebase (see the
 * F8 audit report for the full list).
 *
 * Why this exists: `Math.round(value * 100) / 100` operates on the IEEE754
 * binary float `value * 100` *before* rounding, and that intermediate
 * multiplication is not always exact - e.g. `1.005 * 100` is really
 * `100.49999999999999`, so `Math.round` rounds it DOWN to 100, giving
 * `roundMoney(1.005) === 1`, not the mathematically correct `1.01`. This
 * module never multiplies by 100 in floating point: it parses the value's
 * own decimal-string representation (via decimal.js-light) and rounds the
 * exact decimal digits, which is immune to that class of error.
 *
 * decimal.js-light was chosen over adding a new dependency: it is already
 * present in package-lock.json as a transitive dependency of `recharts`
 * (already a direct dependency of this app) and has proper `browser`/
 * `module`/`main` entry points, so it works identically on the server and
 * in client components - promoted to an explicit direct dependency in
 * package.json rather than left as an implicit transitive one. It is
 * deliberately NOT `Prisma.Decimal`: importing anything from
 * `@/lib/generated/prisma` into a client component would couple the
 * browser bundle to the Prisma client. This module never mutates the
 * shared/global `Decimal` static config (no `Decimal.config(...)` calls) -
 * every rounding call passes `Decimal.ROUND_HALF_UP` explicitly - so it
 * cannot affect recharts' own use of the same package.
 *
 * Public API returns plain `number`, matching every existing DTO/API
 * contract in this codebase (Sale.totalTTC, CreditNote.taxAmount, etc. are
 * all `number` at the JSON boundary) - callers do not need to know a
 * Decimal was ever involved.
 */
import Decimal from "decimal.js-light";

const ROUNDING = Decimal.ROUND_HALF_UP;

/**
 * F8-D (Phase 2 audit, money-engine hardening): every Sale/Purchase/
 * CreditNote/Payment/TourClosure/Discrepancy money column in the schema is
 * `Decimal(12,2)` - 10 integer digits + 2 decimal places, so Postgres can
 * only actually store `-9999999999.99` to `9999999999.99`. Nothing upstream
 * of this module enforces that: a plausible-looking quantity times a large
 * unit price, or a normal amount plus a large tax rate, can add up past that
 * bound before a value is ever rounded or written. Kept as a plain string
 * literal (not `9999999999.99` as a float) so the boundary itself is never
 * subject to the float-precision class of bug this whole module exists to
 * avoid.
 */
const MONEY_RANGE_MAX = new Decimal("9999999999.99");

/** The exact value of MONEY_RANGE_MAX, for display/logging only - every real
 * range check should go through `isWithinMoneyRange`, not compare against
 * this number directly. */
export const MONEY_RANGE_MAX_NUMBER = 9999999999.99;

/**
 * True iff `value` fits in `Decimal(12,2)` (i.e. `abs(value) <=
 * 9999999999.99`), checked on the value's exact decimal digits via
 * decimal.js-light rather than a float comparison. `NaN`/`Infinity`/`-Infinity`
 * are never "in range" (decimal.js-light itself throws constructing a
 * `Decimal` from any of them, so they are rejected up front instead).
 *
 * Pure and side-effect-free - safe to call from client code too, though in
 * practice only server-side money-writing flows need it (see
 * lib/server/depots.ts#assertMoneyRange, the throwing wrapper those flows
 * actually call).
 */
export function isWithinMoneyRange(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  return new Decimal(value).abs().lte(MONEY_RANGE_MAX);
}

/**
 * Rounds a monetary value to 2 decimal places using round-half-up (ties
 * round away from zero), computed on the value's exact decimal digits -
 * never via `Math.round(value * 100) / 100`.
 *
 *   roundMoney(1.005)  === 1.01   (Math.round(1.005*100)/100 wrongly gives 1)
 *   roundMoney(2.675)  === 2.68
 *   roundMoney(10.075) === 10.08  (Math.round(10.075*100)/100 wrongly gives 10.07)
 */
export function roundMoney(value: number): number {
  return new Decimal(value).toDecimalPlaces(2, ROUNDING).toNumber();
}

/**
 * Adds any number of monetary values with exact decimal arithmetic, then
 * rounds the result to 2 decimal places. Equivalent to
 * `roundMoney(a + b + ...)` but never touches floating-point addition for
 * the individual terms.
 */
export function addMoney(...values: number[]): number {
  const sum = values.reduce(
    (acc: Decimal, value) => acc.plus(value),
    new Decimal(0),
  );
  return sum.toDecimalPlaces(2, ROUNDING).toNumber();
}

/**
 * Subtracts `b` from `a` with exact decimal arithmetic, then rounds the
 * result to 2 decimal places.
 */
export function subtractMoney(a: number, b: number): number {
  return new Decimal(a).minus(b).toDecimalPlaces(2, ROUNDING).toNumber();
}

/**
 * Multiplies a monetary amount by a factor (unit price x quantity, amount
 * x percent/100, ...) with exact decimal arithmetic, then rounds the
 * result to 2 decimal places.
 */
export function multiplyMoney(a: number, b: number): number {
  return new Decimal(a).times(b).toDecimalPlaces(2, ROUNDING).toNumber();
}
