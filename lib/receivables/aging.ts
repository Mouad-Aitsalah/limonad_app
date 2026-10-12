import { getCurrentBusinessDayParam } from "@/lib/business-day";
import { roundMoney } from "@/lib/money";
import type { AgingBucketKey, AgingBuckets } from "@/types/receivables";

/**
 * Rules of the Dashboard's « Créances clients » - pure.
 *
 * BALANCE: exactly computeCustomerDebt (lib/server/customer-debt.ts), the
 * reference used by « Solde clients », « Règlements clients », the credit
 * ceiling and the Dashboard KPI:
 *   raw  = Σ creditAmount of CREDIT / PARTIALLY_PAID sales
 *        - Σ totalTTC of VALIDATED customer credit notes
 *        - Σ amount of VALIDATED settlements
 *   debt = max(0, raw)          (raw < 0 = a credit balance, shown apart, never netted)
 * creditAmount is what was left unpaid AT THE SALE: the payments taken at the
 * sale are already out of it, so they are never deducted a second time.
 *
 * AGING (an ESTIMATE): settlements are recorded on the customer's account, not
 * on an invoice. The credit notes and settlements are therefore applied FIFO -
 * to the oldest credit sales first - and what remains open of each credit sale
 * gets the age of that sale. This is a convention for reading the age of the
 * debt, NOT the accounting allocation of the settlements; the balance itself is
 * exact.
 *
 * DATES: a sale's date is soldAt (the real moment of an offline driver sale
 * synced later), else validatedAt, else createdAt - turned into the business
 * day (02:00 -> 02:00, Africa/Casablanca). Age = business days between that day
 * and the reference day.
 */

export const AGING_BUCKETS: ReadonlyArray<{ key: AgingBucketKey; label: string }> = [
  { key: "0-30", label: "0 à 30 jours" },
  { key: "31-60", label: "31 à 60 jours" },
  { key: "61-90", label: "61 à 90 jours" },
  { key: "90+", label: "Plus de 90 jours" },
];

/** The fixed « plus de 30 jours » threshold (independent of the configurable overdue delay). */
export const OVER_30_DAYS = 30;

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (cents: number) => cents / 100;

/** computeCustomerDebt's formula on already-summed totals (each already rounded to cents). */
export function balanceFromTotals(creditSalesTotal: number, creditNotesTotal: number, settlementsTotal: number) {
  const raw = roundMoney(creditSalesTotal - creditNotesTotal - settlementsTotal);
  return { raw, debt: Math.max(0, raw) };
}

/** The business day ("YYYY-MM-DD") an instant belongs to. */
export function businessDayOf(instant: Date): string {
  return getCurrentBusinessDayParam(instant);
}

/** The date of a credit sale for aging and ordering. */
export function saleInstant(sale: { soldAt: Date | null; validatedAt: Date | null; createdAt: Date }): Date {
  return sale.soldAt ?? sale.validatedAt ?? sale.createdAt;
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole days from `fromDay` to `toDay` (0 the same day, never negative). */
export function ageInDays(fromDay: string, toDay: string): number {
  return Math.max(0, Math.round(dayNumber(toDay) - dayNumber(fromDay)));
}

export function bucketForAge(ageDays: number): AgingBucketKey {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  return "90+";
}

/**
 * FIFO: the customer's debt is what remains of the NEWEST credit sales once the
 * credit notes and settlements have paid the oldest ones. `sales` must be in
 * FIFO order (oldest first); returns each sale's open part (0 when fully
 * covered). Sum of the open parts = debt (capped by the total of the sales).
 */
export function allocateFifo<T extends { amount: number }>(sales: readonly T[], debt: number): Array<T & { open: number }> {
  let remaining = Math.max(0, toCents(debt));
  const open = new Array<number>(sales.length).fill(0);
  for (let i = sales.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const part = Math.min(Math.max(0, toCents(sales[i].amount)), remaining);
    open[i] = part;
    remaining -= part;
  }
  return sales.map((sale, i) => ({ ...sale, open: fromCents(open[i]) }));
}

export type OpenPart = { open: number; ageDays: number };

export function emptyBuckets(): AgingBuckets {
  return { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
}

/** Buckets, overdue part (age > overdueDays), part over 30 days, and the age of the oldest open part. */
export function summarizeAging(parts: readonly OpenPart[], overdueDays: number) {
  const bucketCents: Record<AgingBucketKey, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  let overdue = 0;
  let over30 = 0;
  let total = 0;
  let oldest: number | null = null;
  for (const part of parts) {
    const cents = toCents(part.open);
    if (cents <= 0) continue;
    total += cents;
    bucketCents[bucketForAge(part.ageDays)] += cents;
    if (part.ageDays > overdueDays) overdue += cents;
    if (part.ageDays > OVER_30_DAYS) over30 += cents;
    oldest = oldest === null ? part.ageDays : Math.max(oldest, part.ageDays);
  }
  const buckets = emptyBuckets();
  for (const key of Object.keys(bucketCents) as AgingBucketKey[]) buckets[key] = fromCents(bucketCents[key]);
  return { total: fromCents(total), buckets, overdue: fromCents(overdue), over30: fromCents(over30), oldestOpenAgeDays: oldest };
}

/** Exact money sum (cents), for totals over many customers. */
export function sumMoney(values: Iterable<number>): number {
  let cents = 0;
  for (const value of values) cents += toCents(value);
  return fromCents(cents);
}
