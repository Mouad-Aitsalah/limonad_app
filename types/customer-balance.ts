/**
 * One row of the "Solde clients" page: a customer, the auxiliary ledger
 * account the Journal / Règlements clients actually use for them
 * (resolveCustomerAuxiliaryCode - never a fresh number), and their real
 * outstanding balance from computeCustomerDebt (the exact figure shown as
 * "Solde à régler" in Règlements clients).
 */
export type CustomerBalanceDto = {
  customerId: string;
  /** Resolved auxiliary account code, e.g. "342114". */
  accountCode: string;
  /** Customer name (also the auxiliary account's name). */
  accountName: string;
  /** computeCustomerDebt(...).debt - max(0, credit sales − credit notes − settlements). */
  balance: number;
  /** Customer.createdBy.fullName, or "-" when unavailable. */
  createdByUserName: string;
};

export type CustomerBalancesPageDto = {
  items: CustomerBalanceDto[];
  page: number;
  pageSize: number;
  /** Rows matching the current filters (debtors, plus settled customers when
   * `includeSettled`). */
  totalCount: number;
  pageCount: number;
  /** Number of customers with balance > 0 among the current search filter. */
  debtorCount: number;
  /** Σ balance over every debtor matching the search (all pages), not just
   * the page. */
  totalOutstanding: number;
};
