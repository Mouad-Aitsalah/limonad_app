/**
 * Dashboard -> « Créances clients » (admin only). Money in DH, 2 decimals, TTC
 * (the amounts of computeCustomerDebt). Dates "YYYY-MM-DD" are business days
 * (02:00 -> 02:00, Africa/Casablanca).
 */

export type AgingBucketKey = "0-30" | "31-60" | "61-90" | "90+";

export type AgingBuckets = Record<AgingBucketKey, number>;

export type ReceivablesSettings = {
  /** A credit sale's open part is « en retard » when it is older than this many days. */
  overdueDays: number;
  /** true when the organisation never set it (the default is used). */
  isDefault: boolean;
};

export type ReceivablesDebtorRow = {
  customerId: string;
  name: string;
  code: string;
  /** Auxiliary account number (same as « Solde clients » / « Règlements clients »). */
  accountCode: string;
  status: string;
  /** computeCustomerDebt(...).debt */
  balance: number;
  /** Estimated (FIFO) open part older than the configured delay. */
  overdue: number;
  /** Estimated (FIFO) open part older than 30 days. */
  over30: number;
  buckets: AgingBuckets;
  /** Age in days of the oldest still-open (FIFO) credit sale. */
  oldestOpenAgeDays: number | null;
  lastSettlementDay: string | null;
  /** Validated customer credit notes recorded as refunded in cash THAT THE FORMULA DEDUCTS (all of them before the debt cutover - lib/credit-note-debt-rule.ts). */
  cashCreditNotesTotal: number;
};

export type ReceivablesCreditorRow = {
  customerId: string;
  name: string;
  code: string;
  accountCode: string;
  /** Positive amount: |credit sales - credit notes - settlements| when that result is negative. */
  creditBalance: number;
  cashCreditNotesTotal: number;
  /** true when the credit balance is entirely explained by credit notes recorded as cash refunds. */
  explainedByCashCreditNotes: boolean;
};

export type ReceivablesOverviewDto = {
  /** Business day the ages are computed for. */
  asOfDay: string;
  settings: ReceivablesSettings;
  totals: {
    totalOutstanding: number;
    debtorCount: number;
    overdue: number;
    over30: number;
  };
  buckets: Array<{ key: AgingBucketKey; amount: number; customerCount: number }>;
  debtors: ReceivablesDebtorRow[];
  /** debtors.length < totals.debtorCount when the list is capped (KPIs always cover everyone). */
  debtorsTruncated: boolean;
  creditors: {
    count: number;
    total: number;
    rows: ReceivablesCreditorRow[];
  };
  dataNotes: {
    /** Validated customer credit notes with refundMethod CASH, counted in the formula (debtors only). */
    cashCreditNotes: { count: number; total: number };
    /** Present ONLY once the debt cutover is active: the cash refunds validated on or after it, which the formula does NOT deduct. */
    cashRefundsNotDeducted?: { count: number; total: number };
    /** Customers whose FIFO estimate could not be reconciled with their balance (should be 0). */
    agingMismatchCount: number;
  };
};

export type ReceivableMovementKind = "CREDIT_SALE" | "CREDIT_NOTE" | "SETTLEMENT" | "OPENING";

export type ReceivableMovementDto = {
  id: string;
  kind: ReceivableMovementKind;
  day: string;
  reference: string;
  label: string;
  /** + increases what the customer owes (credit sale), - reduces it. */
  amount: number;
  /** Running (unclamped) balance after this movement. */
  balance: number;
  /** CREDIT_SALE: the invoice total and what was paid at the sale (already netted in amount). */
  sale?: { totalTTC: number; paidAtSale: number; status: string; openEstimate: number; ageDays: number };
  /** CREDIT_NOTE details. */
  creditNote?: {
    refundMethod: "CASH" | "BANK";
    originalSaleReference: string | null;
    originalSaleStatus: string | null;
    /**
     * Present ONLY for a cash refund validated on or after the debt cutover: it is listed for transparency
     * but its movement amount is 0 (it does not reduce the debt). Absent = deducted, as before.
     */
    notDeductedFromDebt?: { faceAmount: number };
  };
  /** SETTLEMENT details. */
  settlement?: { method: string; createdByName: string | null };
};

export type CustomerReceivableDetailDto = {
  asOfDay: string;
  settings: ReceivablesSettings;
  customer: { id: string; name: string; code: string; accountCode: string; status: string };
  /** computeCustomerDebt for this customer - the figure of the table. */
  debt: { creditSalesTotal: number; creditNotesTotal: number; settlementsTotal: number; debt: number };
  /** creditSalesTotal - creditNotesTotal - settlementsTotal, before the max(0, ...) */
  rawBalance: number;
  movements: ReceivableMovementDto[];
  /** Older movements folded into an OPENING line (very long histories). */
  movementsTruncated: boolean;
  /** Last running balance === rawBalance (always expected; false = shown, never hidden). */
  reconciled: boolean;
  aging: {
    overdue: number;
    over30: number;
    buckets: AgingBuckets;
  };
  cashCreditNotes: { count: number; total: number };
  /** Present ONLY once the debt cutover is active: the cash refunds of this customer that the formula does NOT deduct. */
  cashRefundsNotDeducted?: { count: number; total: number };
  /** Documents of this customer that the formula does NOT count (shown as counts, for transparency). */
  excluded: {
    draftOrCancelledSales: number;
    nonValidatedCreditNotes: number;
    cancelledSettlements: number;
  };
};
