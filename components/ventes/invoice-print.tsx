"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import type { CompanyIdentity } from "@/hooks/use-company-identity";
import { formatSignedCurrency } from "@/lib/currency";
import { formatPrintDate, formatPrintTime, type PrintableInvoice } from "@/lib/invoice-print";
import { formatCurrency } from "@/lib/utils";

type InvoicePrintProps = {
  /** The ONE document to print (null = nothing mounted). */
  invoice: PrintableInvoice | null;
  identity: CompanyIdentity | null;
  /** Called once the browser's print dialog is closed. */
  onDone?: () => void;
};

/**
 * A4 print stylesheet, injected ONLY while an invoice is being printed (same approach as
 * components/achats/purchase-print.tsx), so its `@page` never meets the POS thermal ticket's 80 mm rule.
 * During print every other child of <body> is hidden - menus, sidebar, tables, buttons - and the
 * `visibility` override beats the global "hide everything but the ticket" rule of app/globals.css.
 * Black on white, borders instead of fills: readable on any printer.
 */
export const INVOICE_PRINT_CSS = `
.invoice-print-root { display: none; }

@media print {
  @page { size: A4 portrait; margin: 12mm; }

  html, body {
    background: #fff !important;
    height: auto !important;
    min-height: 0 !important;
  }

  body > *:not(.invoice-print-root) { display: none !important; }

  .invoice-print-root,
  .invoice-print-root * { visibility: visible !important; }

  .invoice-print-root {
    display: block !important;
    position: static !important;
    width: auto !important;
    color: #000;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.4;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .ip-header { display: flex; align-items: flex-start; gap: 5mm; border-bottom: 1.5pt solid #000; padding-bottom: 4mm; margin-bottom: 5mm; }
  .ip-logo { max-height: 20mm; max-width: 45mm; width: auto; height: auto; object-fit: contain; }
  .ip-company { min-width: 0; }
  .ip-company-name { font-size: 16pt; font-weight: 700; }
  .ip-company-line { font-size: 9pt; color: #222; }
  .ip-doc { margin-left: auto; text-align: right; border: 1.2pt solid #000; padding: 2.5mm 4mm; }
  .ip-doc-title { font-size: 15pt; font-weight: 700; letter-spacing: .12em; }
  .ip-doc-number { font-size: 11pt; font-weight: 700; }

  .ip-warning { border: 2pt solid #000; padding: 2.5mm; margin-bottom: 5mm; text-align: center; font-size: 13pt; font-weight: 700; letter-spacing: .08em; }

  .ip-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5mm 10mm; margin-bottom: 6mm; }
  .ip-meta-row { display: flex; gap: 2mm; min-width: 0; }
  .ip-meta-label { color: #333; flex: 0 0 auto; }
  .ip-meta-value { font-weight: 700; overflow-wrap: anywhere; unicode-bidi: plaintext; }

  table.ip-lines { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.ip-lines thead { display: table-header-group; }
  table.ip-lines tr { break-inside: avoid; page-break-inside: avoid; }
  table.ip-lines th, table.ip-lines td { border: 0.6pt solid #000; padding: 1.6mm 2mm; vertical-align: top; }
  table.ip-lines th { font-size: 8.5pt; font-weight: 700; text-align: left; text-transform: uppercase; background: #eee; }
  .ip-col-ref { width: 26mm; }
  .ip-col-qty { width: 15mm; text-align: center !important; }
  .ip-col-pu, .ip-col-total { width: 30mm; text-align: right !important; white-space: nowrap; }
  .ip-name { font-weight: 600; overflow-wrap: anywhere; unicode-bidi: plaintext; }
  .ip-discount { display: block; font-size: 8.5pt; font-weight: 400; font-style: italic; }
  .ip-num { font-variant-numeric: tabular-nums; }

  .ip-bottom { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; margin-top: 5mm; break-inside: avoid; page-break-inside: avoid; }
  .ip-payment div { margin-bottom: 1mm; }
  .ip-payment strong { font-weight: 700; }
  .ip-summary { width: 75mm; border-collapse: collapse; }
  .ip-summary td { padding: 1.2mm 0; }
  .ip-summary td:last-child { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ip-summary tr.ip-grand td { border-top: 1.5pt solid #000; padding-top: 2mm; font-size: 13pt; font-weight: 700; }

  .ip-footer { margin-top: 10mm; padding-top: 3mm; border-top: 0.6pt solid #000; display: flex; justify-content: space-between; font-size: 8.5pt; color: #333; }
}
`;

/**
 * « Imprimer la facture »: renders the ONE selected document in a portal at the end of <body>, then opens
 * the browser's print dialog. Nothing is fetched, written or recomputed here - the document is the already
 * built PrintableInvoice (lib/invoice-print.ts).
 */
export function InvoicePrint({ invoice, identity, onDone }: InvoicePrintProps) {
  // Latest callback without re-running the effect: the dialog opens exactly once per document, even if
  // the page re-renders (or passes a new inline onDone) while it is open.
  const onDoneRef = React.useRef(onDone);
  React.useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  React.useEffect(() => {
    if (!invoice) return;
    const handleAfterPrint = () => onDoneRef.current?.();
    window.addEventListener("afterprint", handleAfterPrint, { once: true });
    // Let the portal + <style> paint (and the logo load) before opening the print dialog.
    const timer = window.setTimeout(() => window.print(), 150);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [invoice]);

  if (!invoice || typeof document === "undefined") return null;
  return createPortal(
    <>
      <style dangerouslySetInnerHTML={{ __html: INVOICE_PRINT_CSS }} />
      <InvoicePrintDocument invoice={invoice} identity={identity} />
    </>,
    document.body,
  );
}

/** The printed document itself (also rendered by the tests). */
export function InvoicePrintDocument({ invoice, identity }: { invoice: PrintableInvoice; identity: CompanyIdentity | null }) {
  const companyName = identity?.tradeName?.trim() || identity?.name?.trim() || "";
  const legalName = identity?.tradeName?.trim() && identity?.name?.trim() !== identity?.tradeName?.trim() ? identity?.name?.trim() : null;
  const addressLine = [identity?.address?.trim(), identity?.city?.trim()].filter(Boolean).join(" - ");
  const contactLine = [identity?.phone?.trim() ? `Tél. ${identity.phone.trim()}` : null, identity?.email?.trim() || null]
    .filter(Boolean)
    .join(" - ");
  const meta: Array<[string, string]> = [
    ["Date :", formatPrintDate(invoice.date)],
    ["Heure :", formatPrintTime(invoice.date)],
    [`${invoice.partyLabel} :`, invoice.partyCode ? `${invoice.partyName} (${invoice.partyCode})` : invoice.partyName],
    ...(invoice.issuerName ? [[`${invoice.issuerLabel} :`, invoice.issuerName] as [string, string]] : []),
    ...(invoice.truck ? [["Camion :", invoice.truck] as [string, string]] : []),
    ...(invoice.relatedInvoice ? [["Facture d'origine :", invoice.relatedInvoice] as [string, string]] : []),
    ["Statut :", invoice.statusLabel],
    ["Mode de règlement :", invoice.paymentLabel],
  ];

  return (
    <div className="invoice-print-root" role="document" aria-label={`${invoice.title} ${invoice.number}`} data-invoice-number={invoice.number}>
      <header className="ip-header">
        {identity?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={identity.logoUrl} alt={companyName || "Logo"} className="ip-logo" />
        ) : null}
        <div className="ip-company">
          {companyName ? <div className="ip-company-name">{companyName}</div> : null}
          {legalName ? <div className="ip-company-line">{legalName}</div> : null}
          {addressLine ? <div className="ip-company-line">{addressLine}</div> : null}
          {contactLine ? <div className="ip-company-line">{contactLine}</div> : null}
        </div>
        <div className="ip-doc">
          <div className="ip-doc-title">{invoice.title}</div>
          <div className="ip-doc-number">N° {invoice.number}</div>
        </div>
      </header>

      {invoice.warning ? <div className="ip-warning">{invoice.warning}</div> : null}

      <div className="ip-meta">
        {meta.map(([label, value]) => (
          <div key={label} className="ip-meta-row">
            <span className="ip-meta-label">{label}</span>
            <span className="ip-meta-value">{value}</span>
          </div>
        ))}
      </div>

      <table className="ip-lines">
        <thead>
          <tr>
            <th className="ip-col-ref">Référence</th>
            <th>Désignation</th>
            <th className="ip-col-qty">Qté</th>
            <th className="ip-col-pu">Prix unit. TTC</th>
            <th className="ip-col-total">Total TTC</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.key}>
              <td className="ip-col-ref">{line.reference || "-"}</td>
              <td className="ip-name">
                {line.name}
                {line.discountUnitAmount > 0 ? (
                  <span className="ip-discount">Remise : {formatCurrency(line.discountUnitAmount)} / unité</span>
                ) : null}
              </td>
              <td className="ip-col-qty ip-num">{line.quantity}</td>
              <td className="ip-col-pu ip-num">{formatCurrency(line.unitPriceTTC)}</td>
              <td className="ip-col-total ip-num">{formatCurrency(line.totalTTC)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ip-bottom">
        <div className="ip-payment">
          <div>
            Mode de règlement : <strong>{invoice.paymentLabel}</strong>
          </div>
          {invoice.paidAmount !== null ? (
            <div>
              Payé : <strong>{formatCurrency(invoice.paidAmount)}</strong>
            </div>
          ) : null}
          {invoice.creditAmount !== null ? (
            <div>
              Reste à crédit : <strong>{formatCurrency(invoice.creditAmount)}</strong>
            </div>
          ) : null}
        </div>
        <table className="ip-summary">
          <tbody>
            {invoice.subtotalHT !== null ? (
              <tr>
                <td>Total HT</td>
                <td>{formatCurrency(invoice.subtotalHT)}</td>
              </tr>
            ) : null}
            {invoice.taxAmount !== null ? (
              <tr>
                <td>TVA</td>
                <td>{formatCurrency(invoice.taxAmount)}</td>
              </tr>
            ) : null}
            {invoice.roundingAmount !== 0 ? (
              <tr>
                <td>Arrondi</td>
                <td>{formatSignedCurrency(invoice.roundingAmount)}</td>
              </tr>
            ) : null}
            <tr className="ip-grand">
              <td>Total TTC</td>
              <td>{formatCurrency(invoice.totalTTC)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer className="ip-footer">
        <span>Merci pour votre confiance.</span>
        <span>
          {invoice.title} N° {invoice.number}
        </span>
      </footer>
    </div>
  );
}
