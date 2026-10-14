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
  /** Gross margin HT of the same scope - PRESENT ONLY for a role allowed to see margins (admin);
   * absent otherwise, and no cost is read for those roles. See lib/daily-sales-grouping.ts. */
  margin?: DailyMarginDto;
};

/**
 * Gross margin HT over the lines whose cost is reliable (lib/daily-sales-grouping.ts):
 * marginHT = Σ (totalHT − quantity × unitCostHT), markupRate = marginHT / revenueHT × 100.
 */
export type DailyMarginDto = {
  marginHT: number;
  /** CA HT of the reliable lines - the denominator of the markup rate. */
  revenueHT: number;
  /** Taux de marque in %, null when revenueHT is 0 (shown as « — »). */
  markupRate: number | null;
  /** True when some lines were left out (missing or approximate cost). */
  partial: boolean;
  /** CA HT of every line in the scope. */
  totalRevenueHT: number;
  /** CA HT of the lines left out of the margin. */
  excludedRevenueHT: number;
  /** Lines whose cost is 0 or unknown (the schema cannot tell them apart). */
  missingCostLines: number;
  /** Lines older than the cost snapshot (back-filled, approximate cost). */
  approximateCostLines: number;
};

/** One unit price TTC really applied (after line discount) and what was sold at it. */
export type DailySalesPriceGroupDto = { unitPriceTTC: number; quantity: number; amountTTC: number };

export type DailySalesProductDto = {
  productId: string;
  name: string;
  reference: string;
  /** Highest price first; two different prices are never merged. */
  priceGroups: DailySalesPriceGroupDto[];
  totalQuantity: number;
  /** Σ SaleLine.totalTTC of the product (CA TTC of its lines). */
  totalTTC: number;
  /** Admin only. */
  margin?: DailyMarginDto;
};

export type DailySalesGroupingTotalsDto = {
  productCount: number;
  totalQuantity: number;
  /** Σ SaleLine.totalTTC - the products. */
  linesTotalTTC: number;
  /** Σ Sale.roundingAmount - the commercial rounding, kept on its own line. */
  roundingTotal: number;
  /** Σ Sale.totalTTC - the CA total of the page. */
  revenueTotal: number;
  /** revenueTotal − (linesTotalTTC + roundingTotal); 0 in normal data. */
  reconciliationGap: number;
  reconciled: boolean;
};

export type DailySalesGroupingDto = {
  day: string;
  dayLabel: string;
  /** Number of invoices behind the grouping (same scope as the page). */
  invoiceCount: number;
  products: DailySalesProductDto[];
  totals: DailySalesGroupingTotalsDto;
  /** Admin only. */
  margin?: DailyMarginDto;
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
