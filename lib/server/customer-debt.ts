import { cashRefundNotDeductedWhere, debtReducingCreditNoteWhere, resolveCutover, type CutoverOption } from "@/lib/credit-note-debt-rule";
import { roundMoney } from "@/lib/money";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { CustomerDebtDto } from "@/types/customer-settlement";

// computeCustomerDebt lives in this module (rather than in customer-settlements.ts,
// which re-exports it unchanged) only so that it can be imported by tests and by
// the receivables core without the "server-only" marker - the code below is the
// exact function that was there, byte for byte in its logic. It never decides who
// may call it: every caller authorises and scopes the organisation first.

/** The real client or an active transaction. */
type DebtDb = Prisma.TransactionClient | typeof import("@/lib/prisma").prisma;

/**
 * The BI/receivables source of truth for one customer:
 *   debt = max(0, creditSalesTotal - creditNotesTotal - settlementsTotal)
 * Takes a `db` (bare prisma or an active tx) so both the read-only
 * getCustomerDebt() and the write path in recordCustomerSettlement() (which
 * must see its own in-flight transaction's prior writes) share one
 * implementation - never two formulas that could drift apart.
 *
 * creditNotesTotal is the total of the VALIDATED customer credit notes THAT REDUCE
 * THE DEBT (lib/credit-note-debt-rule.ts): a cash refund validated on or after the
 * cutover does not - while the cutover is null (dormant) every validated customer
 * credit note counts, exactly as before. `options.cutover` exists for the tests only.
 */
export async function computeCustomerDebt(
  db: DebtDb,
  organizationId: string,
  customerId: string,
  options?: CutoverOption,
): Promise<CustomerDebtDto> {
  const cutover = resolveCutover(options);
  const [creditAgg, creditNoteAgg, settlementAgg, notDeductedAgg] = await Promise.all([
    db.sale.aggregate({
      where: {
        organizationId,
        customerId,
        status: { in: ["CREDIT", "PARTIALLY_PAID"] },
      },
      _sum: { creditAmount: true },
    }),
    db.creditNote.aggregate({
      where: {
        organizationId,
        customerId,
        partyType: "CUSTOMER",
        status: "VALIDATED",
        ...debtReducingCreditNoteWhere(cutover),
      },
      _sum: { totalTTC: true },
    }),
    db.customerSettlement.aggregate({
      where: { organizationId, customerId, status: "VALIDATED" },
      _sum: { amount: true },
    }),
    // Only when the rule is active: the cash refunds it leaves out (information, never part of the formula).
    cutover
      ? db.creditNote.aggregate({
          where: { organizationId, customerId, partyType: "CUSTOMER", status: "VALIDATED", ...cashRefundNotDeductedWhere(cutover) },
          _sum: { totalTTC: true },
        })
      : Promise.resolve(null),
  ]);

  const creditSalesTotal = roundMoney(creditAgg._sum.creditAmount?.toNumber() ?? 0);
  const creditNotesTotal = roundMoney(creditNoteAgg._sum.totalTTC?.toNumber() ?? 0);
  const settlementsTotal = roundMoney(settlementAgg._sum.amount?.toNumber() ?? 0);
  const debt = Math.max(0, roundMoney(creditSalesTotal - creditNotesTotal - settlementsTotal));

  return {
    customerId,
    creditSalesTotal,
    creditNotesTotal,
    settlementsTotal,
    debt,
    ...(notDeductedAgg ? { cashRefundsNotDeductedTotal: roundMoney(notDeductedAgg._sum.totalTTC?.toNumber() ?? 0) } : {}),
  };
}
