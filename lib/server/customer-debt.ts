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
 */
export async function computeCustomerDebt(
  db: DebtDb,
  organizationId: string,
  customerId: string,
): Promise<CustomerDebtDto> {
  const [creditAgg, creditNoteAgg, settlementAgg] = await Promise.all([
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
      },
      _sum: { totalTTC: true },
    }),
    db.customerSettlement.aggregate({
      where: { organizationId, customerId, status: "VALIDATED" },
      _sum: { amount: true },
    }),
  ]);

  const creditSalesTotal = roundMoney(creditAgg._sum.creditAmount?.toNumber() ?? 0);
  const creditNotesTotal = roundMoney(creditNoteAgg._sum.totalTTC?.toNumber() ?? 0);
  const settlementsTotal = roundMoney(settlementAgg._sum.amount?.toNumber() ?? 0);
  const debt = Math.max(0, roundMoney(creditSalesTotal - creditNotesTotal - settlementsTotal));

  return { customerId, creditSalesTotal, creditNotesTotal, settlementsTotal, debt };
}
