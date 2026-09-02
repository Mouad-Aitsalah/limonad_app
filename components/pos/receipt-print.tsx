"use client";

import { formatCurrency } from "@/lib/utils";
import type { SaleDto } from "@/types/operations-dto";

type ReceiptPrintProps = {
  sale: SaleDto | null;
  paperWidth?: "58" | "80";
};

const paymentLabels: Record<string, string> = {
  CASH: "Espèces",
  CARD: "Carte",
  CHECK: "Chèque",
  BANK_TRANSFER: "Virement",
  CREDIT: "Crédit",
  MIXED: "Paiement mixte",
};

function formatReceiptDate(value: string) {
  return new Intl.DateTimeFormat("fr-MA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatReceiptTime(value: string) {
  return new Intl.DateTimeFormat("fr-MA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatReceiptAmount(value: number) {
  return formatCurrency(value).replace(/\s?DH$/, "");
}

export function formatReceiptInvoiceNumber(invoiceNumber: string) {
  const lastNumericPart = invoiceNumber.match(/(\d+)(?!.*\d)/)?.[1];
  if (!lastNumericPart) return invoiceNumber;

  const withoutLeadingZeroes = lastNumericPart.replace(/^0+(?=\d)/, "");
  return withoutLeadingZeroes.padStart(2, "0");
}

export function ReceiptPrint({
  sale,
  paperWidth = "80",
}: ReceiptPrintProps) {
  if (!sale) return null;

  const receiptDate = sale.validatedAt ?? sale.createdAt;
  const articleCount = sale.lines.reduce((sum, line) => sum + line.quantity, 0);
  const customerName = sale.customer?.name ?? "Client Comptoir";
  const cashierName = sale.driver?.name ?? sale.createdByUserName;
  const paymentLabel = paymentLabels[sale.paymentMethod] ?? sale.paymentMethod;

  return (
    <section
      aria-hidden="true"
      className="receipt-print-area hidden"
      data-paper={paperWidth}
    >
      <div className="receipt-print-ticket">
        <header className="receipt-print-header">
          <p className="receipt-print-brand">AITSALAHMARKET</p>
        </header>

        <div className="receipt-print-meta">
          <div>
            <span>N° Facture : </span>
            <strong>{formatReceiptInvoiceNumber(sale.invoiceNumber)}</strong>
          </div>
          <div className="receipt-print-right">{formatReceiptDate(receiptDate)}</div>
          <div>
            <span>Client : </span>
            <strong>{customerName}</strong>
          </div>
          <div className="receipt-print-right">{formatReceiptTime(receiptDate)}</div>
        </div>

        <div className="receipt-print-separator" />

        <div className="receipt-print-grid receipt-print-head">
          <span className="receipt-print-qty">Qté</span>
          <span>Désignation</span>
          <span className="receipt-print-number">Prix TTC</span>
          <span className="receipt-print-number">Montant</span>
        </div>

        <div className="receipt-print-separator" />

        <div className="receipt-print-lines">
          {sale.lines.map((line) => {
            const unitPriceTTC = line.unitPriceHT * (1 + line.taxRate / 100);

            return (
              <div key={line.id} className="receipt-print-line">
                <div className="receipt-print-grid">
                  <span className="receipt-print-qty">{line.quantity}</span>
                  <span className="receipt-print-product">
                    {line.productName}
                  </span>
                  <span className="receipt-print-number">
                    {formatReceiptAmount(unitPriceTTC)}
                  </span>
                  <span className="receipt-print-number">
                    {formatReceiptAmount(line.totalTTC)}
                  </span>
                </div>
                {line.discountRate > 0 ? (
                  <p className="receipt-print-discount">
                    Remise : {line.discountRate} %
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="receipt-print-separator" />

        <div className="receipt-print-total">
          <strong>{formatCurrency(sale.totalTTC)}</strong>
          <span>MONTANT TTC À PAYER</span>
        </div>

        <div className="receipt-print-tax">
          <span>Total HT : {formatCurrency(sale.subtotalHT)}</span>
          <span>TVA : {formatCurrency(sale.taxAmount)}</span>
        </div>

        <div className="receipt-print-separator" />

        <footer className="receipt-print-footer">
          <p>Paiement : {paymentLabel}</p>
          <p>Caisse : {cashierName}</p>
          <p>
            {articleCount} Article{articleCount > 1 ? "s" : ""}
          </p>
        </footer>
      </div>
    </section>
  );
}
