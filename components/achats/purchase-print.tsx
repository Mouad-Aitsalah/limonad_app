"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { useCompanyIdentity } from "@/hooks/use-company-identity";
import { purchasePaymentLabels } from "@/lib/mock-data/purchase-payment-methods";
import {
  computeLineSousTotal,
  computePurchaseTotals,
  DEFAULT_PURCHASE_TVA_RATE,
} from "@/lib/purchase-calculations";
import { formatCurrency } from "@/lib/utils";
import type { Purchase } from "@/types/purchase";

type PurchasePrintProps = {
  /** The persisted purchase to print (DB data - never the live form state). */
  purchase: Purchase | null;
  /** Fallback supplier name when the DTO has none (rare). */
  supplierName?: string;
  /** Called once the browser's print dialog has been closed/finished. */
  onDone?: () => void;
};

// Dedicated A5 print stylesheet. Injected ONLY while a purchase is being
// printed (this component renders nothing otherwise), so its `@page` rule can
// never collide with the POS thermal receipt's `@page { size: 80mm auto }` in
// globals.css - the two are never mounted on the same route. During print,
// every direct child of <body> except the portalled `.purchase-print-root` is
// display:none'd, which is what keeps a normal purchase to a single A5 page
// (no "33 blank sheets" from the app chrome).
const PRINT_CSS = `
.purchase-print-root { display: none; }

@media print {
  @page { size: A5 portrait; margin: 8mm; }

  html, body {
    background: #fff !important;
    height: auto !important;
    min-height: 0 !important;
  }

  body > *:not(.purchase-print-root) { display: none !important; }

  .purchase-print-root {
    display: block !important;
    position: static !important;
    width: auto !important;
    color: #000;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .pp-header {
    display: flex;
    align-items: center;
    gap: 3mm;
    border-bottom: 1.5pt solid #000;
    padding-bottom: 2mm;
    margin-bottom: 3mm;
  }
  .pp-logo { max-height: 14mm; max-width: 40mm; width: auto; height: auto; object-fit: contain; }
  .pp-org { font-size: 14pt; font-weight: 700; letter-spacing: .02em; }
  .pp-doc-title { margin-left: auto; font-size: 13pt; font-weight: 700; letter-spacing: .12em; }

  .pp-meta {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.8mm 3mm;
    margin-bottom: 3mm;
  }
  .pp-meta dt { font-weight: 400; color: #333; }
  .pp-meta dd { margin: 0; font-weight: 600; }

  .pp-credit-flag {
    margin: 2mm 0 3mm;
    border: 1.2pt solid #000;
    padding: 1.4mm 2.5mm;
    font-weight: 700;
    letter-spacing: .06em;
    text-align: center;
  }

  .pp-obs {
    margin: 0 0 3mm;
    padding: 1.4mm 2mm;
    border: 0.6pt solid #666;
  }
  .pp-obs span { font-weight: 700; }

  table.pp-lines {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin-bottom: 3mm;
  }
  table.pp-lines thead { display: table-header-group; }
  table.pp-lines tr { break-inside: avoid; page-break-inside: avoid; }
  table.pp-lines th, table.pp-lines td {
    border: 0.6pt solid #000;
    padding: 1.2mm 1.6mm;
    vertical-align: top;
  }
  table.pp-lines th {
    background: #eee;
    font-weight: 700;
    text-align: left;
    font-size: 8pt;
    white-space: nowrap;
  }
  table.pp-lines th.pp-col-qty,
  table.pp-lines th.pp-col-pu,
  table.pp-lines th.pp-col-rem,
  table.pp-lines th.pp-col-amt { text-align: right; }
  .pp-col-prod  { width: auto; }
  .pp-col-qty   { width: 11mm; text-align: center; }
  .pp-col-pu    { width: 23mm; text-align: right; }
  .pp-col-rem   { width: 17mm; text-align: right; }
  .pp-col-amt   { width: 26mm; text-align: right; }
  td.pp-col-prod { overflow-wrap: anywhere; word-break: break-word; }
  td.pp-col-qty, td.pp-col-pu, td.pp-col-rem, td.pp-col-amt {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* DOUBLE_DISCOUNT_HT: 7 columns, tighter widths for A5 portrait. */
  table.pp-lines th.pp-d-qty,
  table.pp-lines th.pp-d-brut,
  table.pp-lines th.pp-d-r1,
  table.pp-lines th.pp-d-r2,
  table.pp-lines th.pp-d-net,
  table.pp-lines th.pp-d-amt { text-align: right; }
  .pp-d-prod { width: auto; }
  .pp-d-qty  { width: 8mm;  text-align: center; }
  .pp-d-brut { width: 18mm; text-align: right; }
  .pp-d-r1   { width: 11mm; text-align: right; }
  .pp-d-r2   { width: 11mm; text-align: right; }
  .pp-d-net  { width: 18mm; text-align: right; }
  .pp-d-amt  { width: 20mm; text-align: right; }
  td.pp-d-prod { overflow-wrap: anywhere; word-break: break-word; }
  td.pp-d-qty, td.pp-d-brut, td.pp-d-r1, td.pp-d-r2, td.pp-d-net, td.pp-d-amt {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .pp-totals {
    margin-left: auto;
    width: 62mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .pp-totals .pp-row {
    display: flex;
    justify-content: space-between;
    gap: 3mm;
    padding: 0.8mm 0;
  }
  .pp-totals .pp-grand {
    margin-top: 1mm;
    padding-top: 1.4mm;
    border-top: 1.5pt solid #000;
    font-size: 12pt;
    font-weight: 800;
  }

  .pp-footer {
    margin-top: 4mm;
    padding-top: 1.6mm;
    border-top: 0.6pt solid #666;
    font-size: 8pt;
    color: #333;
    display: flex;
    justify-content: space-between;
  }
}
`;

function formatPurchaseDate(value: Date | string | null): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function PurchasePrint({ purchase, supplierName, onDone }: PurchasePrintProps) {
  const { identity } = useCompanyIdentity();

  React.useEffect(() => {
    // `purchase` is null until a user action sets it (well after mount), so
    // `document` is always available here.
    if (!purchase) return;
    const handleAfterPrint = () => onDone?.();
    window.addEventListener("afterprint", handleAfterPrint, { once: true });
    // Let the portal + <style> paint before opening the print dialog (same
    // deferred pattern as the POS / deposit receipts).
    const timer = window.setTimeout(() => window.print(), 60);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [purchase, onDone]);

  if (!purchase || typeof document === "undefined") return null;

  const orgName = identity?.tradeName?.trim() || identity?.name?.trim() || "";
  const totals = computePurchaseTotals(purchase.lignes, DEFAULT_PURCHASE_TVA_RATE);
  const resolvedSupplier =
    purchase.fournisseurNom?.trim() || supplierName?.trim() || "-";
  const paymentLabel = purchasePaymentLabels[purchase.modeReglement] ?? purchase.modeReglement;
  const isCreditSupplier = purchase.modeReglement === "credit_fournisseur";
  const isDoubleDiscount = purchase.pricingMode === "DOUBLE_DISCOUNT_HT";
  const pricingModeLabel = isDoubleDiscount
    ? "Double remise HT"
    : "Classique TTC";

  // Classic: discount is expressed on the TTC subtotal. Double: total effect
  // of the two successive HT discounts = gross HT - net HT.
  const hasDiscount = isDoubleDiscount
    ? purchase.lignes.some(
        (line) =>
          (line.remise1Percent ?? line.remisePercent ?? 0) > 0 ||
          (line.remise2Percent ?? 0) > 0,
      )
    : purchase.lignes.some((line) => (line.remisePercent ?? 0) > 0);
  const grossHTTotal = purchase.lignes.reduce(
    (sum, line) => sum + (line.prixBrutHT ?? line.prixAchat) * line.quantite,
    0,
  );
  const discountTotal = isDoubleDiscount
    ? Math.max(0, grossHTTotal - totals.totalHT)
    : purchase.lignes.reduce((sum, line) => {
        const unitTTC = line.prixAchatTTC ?? line.prixAchat;
        const gross = unitTTC * line.quantite;
        const net = line.totalTTC ?? computeLineSousTotal(line);
        return sum + Math.max(0, gross - net);
      }, 0);

  const doc = (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="purchase-print-root" role="document" aria-hidden="true">
        <header className="pp-header">
          {identity?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={identity.logoUrl} alt={orgName || "Logo"} className="pp-logo" />
          ) : null}
          {orgName ? <div className="pp-org">{orgName}</div> : null}
          <div className="pp-doc-title">ACHAT</div>
        </header>

        <dl className="pp-meta">
          <dt>N° Achat</dt>
          <dd>{purchase.numero}</dd>
          <dt>Date</dt>
          <dd>{formatPurchaseDate(purchase.date)}</dd>
          <dt>Fournisseur</dt>
          <dd>{resolvedSupplier}</dd>
          <dt>Utilisateur</dt>
          <dd>{purchase.utilisateurNom ?? purchase.utilisateurId}</dd>
          <dt>Type d&apos;achat</dt>
          <dd>{pricingModeLabel}</dd>
          <dt>Mode de règlement</dt>
          <dd>{paymentLabel}</dd>
          {purchase.modeReglement === "banque" && purchase.bankAccountingAccountCode ? (
            <>
              <dt>Compte bancaire</dt>
              <dd>
                {purchase.bankAccountingAccountCode}
                {purchase.bankAccountingAccountName
                  ? ` — ${purchase.bankAccountingAccountName}`
                  : ""}
              </dd>
            </>
          ) : null}
          {purchase.modeReglement === "cheque" && purchase.numeroCheque ? (
            <>
              <dt>N° chèque</dt>
              <dd>{purchase.numeroCheque}</dd>
            </>
          ) : null}
          {purchase.modeReglement === "cheque" && purchase.banque ? (
            <>
              <dt>Banque</dt>
              <dd>{purchase.banque}</dd>
            </>
          ) : null}
          {purchase.datePaiement ? (
            <>
              <dt>{isCreditSupplier ? "Échéance" : "Date de paiement"}</dt>
              <dd>{formatPurchaseDate(purchase.datePaiement)}</dd>
            </>
          ) : null}
        </dl>

        {isCreditSupplier ? (
          <div className="pp-credit-flag">RÈGLEMENT : CRÉDIT FOURNISSEUR</div>
        ) : null}

        {purchase.observation?.trim() ? (
          <p className="pp-obs">
            <span>Observation : </span>
            {purchase.observation}
          </p>
        ) : null}

        {isDoubleDiscount ? (
          <table className="pp-lines">
            <thead>
              <tr>
                <th className="pp-d-prod">PRODUIT</th>
                <th className="pp-d-qty">QTÉ</th>
                <th className="pp-d-brut">PRIX BRUT HT</th>
                <th className="pp-d-r1">REM. 1</th>
                <th className="pp-d-r2">REM. 2</th>
                <th className="pp-d-net">PRIX NET HT</th>
                <th className="pp-d-amt">MONTANT HT</th>
              </tr>
            </thead>
            <tbody>
              {purchase.lignes.map((line, index) => {
                const brutHT = line.prixBrutHT ?? line.prixAchat;
                const r1 = line.remise1Percent ?? line.remisePercent ?? 0;
                const r2 = line.remise2Percent ?? 0;
                const netHT = line.prixNetHT ?? line.prixAchat;
                const amountHT = line.totalHT ?? computeLineSousTotal(line);
                return (
                  <tr key={`${purchase.id}-${line.productId}-${index}`}>
                    <td className="pp-d-prod">{line.productName ?? line.productId}</td>
                    <td className="pp-d-qty">{line.quantite}</td>
                    <td className="pp-d-brut">{formatCurrency(brutHT)}</td>
                    <td className="pp-d-r1">{r1 > 0 ? `${r1} %` : "-"}</td>
                    <td className="pp-d-r2">{r2 > 0 ? `${r2} %` : "-"}</td>
                    <td className="pp-d-net">{formatCurrency(netHT)}</td>
                    <td className="pp-d-amt">{formatCurrency(amountHT)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="pp-lines">
            <thead>
              <tr>
                <th className="pp-col-prod">PRODUIT</th>
                <th className="pp-col-qty">QTÉ</th>
                <th className="pp-col-pu">PRIX TTC</th>
                <th className="pp-col-rem">{"REM. %"}</th>
                <th className="pp-col-amt">MONTANT</th>
              </tr>
            </thead>
            <tbody>
              {purchase.lignes.map((line, index) => {
                const unitTTC = line.prixAchatTTC ?? line.prixAchat;
                const amountTTC = line.totalTTC ?? computeLineSousTotal(line);
                return (
                  <tr key={`${purchase.id}-${line.productId}-${index}`}>
                    <td className="pp-col-prod">{line.productName ?? line.productId}</td>
                    <td className="pp-col-qty">{line.quantite}</td>
                    <td className="pp-col-pu">{formatCurrency(unitTTC)}</td>
                    <td className="pp-col-rem">
                      {(line.remisePercent ?? 0) > 0 ? `${line.remisePercent} %` : "-"}
                    </td>
                    <td className="pp-col-amt">{formatCurrency(amountTTC)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="pp-totals">
          <div className="pp-row">
            <span>Total HT</span>
            <span>{formatCurrency(totals.totalHT)}</span>
          </div>
          <div className="pp-row">
            <span>TVA</span>
            <span>{formatCurrency(totals.totalTVA)}</span>
          </div>
          {hasDiscount && discountTotal > 0 ? (
            <div className="pp-row">
              <span>{isDoubleDiscount ? "Remise (R1 + R2)" : "Remise"}</span>
              <span>- {formatCurrency(discountTotal)}</span>
            </div>
          ) : null}
          <div className="pp-row pp-grand">
            <span>TOTAL TTC</span>
            <span>{formatCurrency(totals.totalTTC)}</span>
          </div>
        </div>

        <div className="pp-footer">
          <span>{orgName}</span>
          <span>Achat {purchase.numero}</span>
        </div>
      </div>
    </>
  );

  return createPortal(doc, document.body);
}
