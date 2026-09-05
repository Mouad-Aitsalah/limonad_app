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

/**
 * One line of the accounting Journal that touches a customer's auxiliary
 * account - a filtered read of AccountingEntry / AccountingEntryLine, never
 * a copy. Same POSTED+REVERSED scope as /comptabilite/journal.
 */
export type CustomerJournalOperationDto = {
  id: string;
  /** AccountingEntry.date, ISO. */
  date: string;
  entryNumber: string;
  operationNumber: number;
  accountCode: string;
  accountName: string;
  /** The raw AccountingEntryLine.label ("" when none). */
  label: string;
  debit: number;
  credit: number;
};

export type CustomerJournalDto = {
  debt: CustomerDebtDto;
  /** The resolved customer auxiliary account, or null if none exists yet
   * (no ledger operation has ever hit this customer). */
  account: { code: string; name: string } | null;
  /** ONLY the lines that can be reliably attributed to this exact Customer
   * (via Sale.customerId / Payment->Sale.customerId /
   * CustomerSettlement.customerId / CreditNote.customerId, or a contra entry
   * inheriting its original's attribution). Auxiliary account codes are not
   * unique per customer, so accountId alone is never proof of ownership. */
  operations: CustomerJournalOperationDto[];
  /** Debit / credit summed over the ATTRIBUTED lines only (all pages), not
   * the whole auxiliary account; balance = debit - credit. */
  totals: { debit: number; credit: number; balance: number };
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  /** How many POSTED/REVERSED lines sit on the same auxiliary account but
   * could NOT be tied with certainty to this customer (they belong to
   * another customer sharing the account, or carry no reliable customer
   * link - e.g. a manual entry). Shown as a discreet notice, never merged
   * into the table or the totals. */
  notAttributable: { count: number };
};
