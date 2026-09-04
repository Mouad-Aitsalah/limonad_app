export type CustomerSettlementStatus = "VALIDATED" | "CANCELLED";

export type CustomerSettlementDto = {
  id: string;
  settlementNumber: string;
  customerId: string;
  customerName: string;
  date: string;
  amount: number;
  method: string;
  reference: string | null;
  note: string | null;
  status: CustomerSettlementStatus;
  createdByUserId: string;
  createdByUserName: string;
  cancelledByUserId: string | null;
  cancelledByUserName: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerSettlementInput = {
  amount: number;
  date?: string;
  method: string;
  reference?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
};

/**
 * BI Phase 2A source of truth for what a customer currently owes - see
 * lib/server/customer-settlements.ts#computeCustomerDebt. NEVER
 * Customer.currentBalance (an operational cache only).
 */
export type CustomerDebtDto = {
  customerId: string;
  /** SUM(Sale.creditAmount) for CREDIT/PARTIALLY_PAID, non-cancelled sales. */
  creditSalesTotal: number;
  /** SUM(VALIDATED customer CreditNote.totalTTC) - see that function's doc
   * comment for why this is subtracted. */
  creditNotesTotal: number;
  /** SUM(VALIDATED CustomerSettlement.amount). */
  settlementsTotal: number;
  /** max(0, creditSalesTotal - creditNotesTotal - settlementsTotal). */
  debt: number;
};
