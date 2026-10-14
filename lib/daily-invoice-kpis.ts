import type { DailyInvoicesKpisDto, DailyMarginDto, DailyRevenueByMethodDto } from "@/types/daily-invoice";

/** Taux de marque for display: « 25,4 % », or « — » when there is no CA HT to divide by. */
export function formatMarkupRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "—";
  return `${rate.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/** Why a margin is partial, in words - null when every line had a reliable cost. */
export function marginPartialNote(margin: DailyMarginDto): string | null {
  if (!margin.partial) return null;
  const parts: string[] = [];
  if (margin.missingCostLines > 0) {
    parts.push(`${margin.missingCostLines} ligne${margin.missingCostLines > 1 ? "s" : ""} sans coût (nul ou non renseigné)`);
  }
  if (margin.approximateCostLines > 0) {
    parts.push(`${margin.approximateCostLines} ligne${margin.approximateCostLines > 1 ? "s" : ""} au coût approximatif (antérieures à l'enregistrement du coût)`);
  }
  return `${parts.join(", ")} exclue${margin.missingCostLines + margin.approximateCostLines > 1 ? "s" : ""} du calcul`;
}

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
