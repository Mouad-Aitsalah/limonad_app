import type { SaleHistoryListItemDto } from "@/types/operations-dto";

/** One revenue bucket of the "CA par mode de règlement" breakdown. */
export type DailyRevenueByMethodDto = {
  /** PaymentMethod enum value (CASH, CHECK, BANK_TRANSFER, CARD, MIXED) or
   * the synthetic "CREDIT" bucket. */
  method: string;
  label: string;
  amount: number;
};

export type DailyInvoicesKpisDto = {
  /** Count of sold invoices (status ∉ {DRAFT, CANCELLED}) matching the filters. */
  invoiceCount: number;
  /** Σ Sale.totalTTC over those invoices - CA facturé, not encaissements. */
  revenueTotal: number;
  /** Per-method split: VALIDATED Payment amounts by method, plus a CREDIT
   * bucket = Σ Sale.creditAmount. Sums to `revenueTotal` in normal data. */
  byMethod: DailyRevenueByMethodDto[];
  /** Σ byMethod - shown next to revenueTotal so any modelling gap is visible. */
  breakdownTotal: number;
  /** |breakdownTotal − revenueTotal| < 0.01. */
  reconciled: boolean;
};

export type DailyInvoiceUserOptionDto = { id: string; name: string };

export type DailyInvoicesPageDto = {
  /** Resolved business day "YYYY-MM-DD" (defaulted server-side to the current
   * one when the request omits/!validates it). */
  day: string;
  /** "DD/MM/YYYY". */
  dayLabel: string;
  /** Business-day window actually queried, ISO - for display / debugging. */
  rangeStart: string;
  rangeEnd: string;
  items: SaleHistoryListItemDto[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Same as kpis.invoiceCount - total rows behind the pagination. */
  totalCount: number;
  kpis: DailyInvoicesKpisDto;
  /** Org users, for the multi-select "Utilisateur" filter. */
  userOptions: DailyInvoiceUserOptionDto[];
};
