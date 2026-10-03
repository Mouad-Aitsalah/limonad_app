import type { DailyInvoicesKpisDto, DailyRevenueByMethodDto } from "@/types/daily-invoice";

/**
 * Presentation split of the EXISTING daily-invoices KPIs (no new formula):
 * every figure is read straight from `DailyInvoicesKpisDto`, which the server
 * computes (lib/server/daily-invoices.ts). Only where each figure is shown
 * changes.
 *
 *  - primary:   CA total, Espèces, Crédit
 *  - secondary: Factures (count), Virement, Chèque
 *  - extras:    any other non-zero bucket the server reports (Carte, Mixte, ...)
 *               so a bucket can never silently disappear from the page
 */
export type DailyKpiLayout = {
  primary: { revenueTotal: number; cash: number; credit: number };
  secondary: { invoiceCount: number; transfer: number; check: number };
  extras: DailyRevenueByMethodDto[];
};

const LAID_OUT_METHODS = new Set(["CASH", "CREDIT", "BANK_TRANSFER", "CHECK"]);

function amountOf(kpis: DailyInvoicesKpisDto, method: string): number {
  return kpis.byMethod.find((bucket) => bucket.method === method)?.amount ?? 0;
}

export function layoutDailyKpis(kpis: DailyInvoicesKpisDto): DailyKpiLayout {
  return {
    primary: {
      revenueTotal: kpis.revenueTotal,
      cash: amountOf(kpis, "CASH"),
      credit: amountOf(kpis, "CREDIT"),
    },
    secondary: {
      invoiceCount: kpis.invoiceCount,
      transfer: amountOf(kpis, "BANK_TRANSFER"),
      check: amountOf(kpis, "CHECK"),
    },
    extras: kpis.byMethod.filter((bucket) => !LAID_OUT_METHODS.has(bucket.method)),
  };
}
