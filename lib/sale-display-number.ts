/**
 * THE single commercial reference of a sale, shown identically everywhere the
 * customer sees it: the /ventes "Commande" column, the POS ticket
 * "N° Facture", and the customer ledger (Comptabilité > Règlements clients).
 *
 * A validated sale carries a definitive commercial number (`saleNumber` +
 * `saleYear`) rendered as `saleNumber/saleYear` (e.g. `16/2026`). A sale that
 * has none yet - a still-uncollected DRAFT - falls back to its raw internal
 * `invoiceNumber` (e.g. `BR-20260906-000003` / `VC-20260906-CTR-000003`).
 *
 * This is only a formatter: it never assigns or changes a number.
 */
export function formatSaleDisplayNumber(
  saleNumber: number | null,
  saleYear: number | null,
  invoiceNumber: string,
): string {
  return saleNumber !== null && saleYear !== null
    ? `${saleNumber}/${saleYear}`
    : invoiceNumber;
}
