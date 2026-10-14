import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * Lot 2 - which validated CUSTOMER credit notes reduce a customer's debt.
 *
 * Business rule (decided):
 *  - a credit note settled « sur compte » (refundMethod BANK) reduces the debt;
 *  - a credit note refunded in cash (CASH) and validated ON OR AFTER the cutover
 *    does NOT reduce the debt: the cash leaves the till, the credit debt is a
 *    separate matter (500 DH owed, 100 DH refunded in cash: the debt stays 500);
 *  - every credit note validated BEFORE the cutover - and any validated note with
 *    no validation date - keeps the historical treatment: it reduces the debt, so
 *    no existing balance changes retroactively;
 *  - a draft or a reversed note never counts (the callers filter on VALIDATED);
 *  - supplier credit notes are not concerned (the callers filter on CUSTOMER).
 *
 * THE CUTOVER. The constant below is `null` until the date is confirmed, just before
 * the production release: while it is `null` the rule is DORMANT and every figure is
 * exactly what it was before this lot (all validated customer notes reduce the debt).
 * Activating it is a one-line change to an ISO instant in UTC, e.g. "2026-11-02T08:30:00Z" -
 * nothing else. It is compared with CreditNote.validatedAt (the server's clock at
 * validation), NEVER with createdAt (the return date typed by the user).
 *
 * Pure: the browser, the server and the tests import it. The two debt computations
 * (lib/server/customer-debt.ts and lib/server/receivables-core.ts) both build their
 * credit-note filter from here, so they cannot drift apart.
 */
export const CASH_REFUND_DEBT_CUTOVER_ISO: string | null = null;

/**
 * Last validation of a customer credit note that existed when this rule was designed
 * (2026-10-13 14:57:35.233 UTC, production). A cutover earlier than this instant would
 * change a historical balance: it is refused outright.
 */
export const LEGACY_CREDIT_NOTE_VALIDATION_FLOOR = new Date("2026-10-13T14:57:36.000Z");

const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * The cutover as a Date, or null (dormant). Throws on anything that is not a valid UTC
 * instant at or after the floor: evaluated when the module loads, so a mistyped
 * constant stops the build / the tests instead of silently skewing balances.
 */
export function parseCashRefundDebtCutover(iso: string | null): Date | null {
  if (iso === null) return null;
  const instant = new Date(iso);
  if (!ISO_UTC_INSTANT.test(iso) || Number.isNaN(instant.getTime())) {
    throw new Error(`CASH_REFUND_DEBT_CUTOVER_ISO must be an ISO instant in UTC (YYYY-MM-DDTHH:mm:ssZ), got « ${iso} ».`);
  }
  if (instant.getTime() < LEGACY_CREDIT_NOTE_VALIDATION_FLOOR.getTime()) {
    throw new Error(
      `CASH_REFUND_DEBT_CUTOVER_ISO (${iso}) is before the last historical credit note validation (${LEGACY_CREDIT_NOTE_VALIDATION_FLOOR.toISOString()}): it would change an existing balance.`,
    );
  }
  return instant;
}

export const CASH_REFUND_DEBT_CUTOVER: Date | null = parseCashRefundDebtCutover(CASH_REFUND_DEBT_CUTOVER_ISO);

/** The cutover a caller can override (tests, and only tests): `undefined` = the shared constant. */
export type CutoverOption = { cutover?: Date | null };

export function resolveCutover(option: CutoverOption | undefined): Date | null {
  return option?.cutover === undefined ? CASH_REFUND_DEBT_CUTOVER : option.cutover;
}

/** Does this VALIDATED customer credit note reduce the debt? (the pure form of the filter below) */
export function creditNoteReducesDebt(
  note: { refundMethod: "CASH" | "BANK"; validatedAt: Date | null },
  cutover: Date | null = CASH_REFUND_DEBT_CUTOVER,
): boolean {
  if (cutover === null) return true;
  if (note.refundMethod === "BANK") return true;
  if (note.validatedAt === null) return true;
  return note.validatedAt.getTime() < cutover.getTime();
}

/**
 * Prisma filter to AND with { partyType: "CUSTOMER", status: "VALIDATED" }: the notes that
 * reduce the debt. Dormant (null) = no extra condition, the query is the historical one.
 */
export function debtReducingCreditNoteWhere(cutover: Date | null = CASH_REFUND_DEBT_CUTOVER): Prisma.CreditNoteWhereInput {
  if (cutover === null) return {};
  return { OR: [{ refundMethod: "BANK" }, { validatedAt: null }, { validatedAt: { lt: cutover } }] };
}

/** Prisma filter: the VALIDATED cash refunds the rule leaves out of the debt (active cutover only). */
export function cashRefundNotDeductedWhere(cutover: Date): Prisma.CreditNoteWhereInput {
  return { refundMethod: "CASH", validatedAt: { gte: cutover } };
}
