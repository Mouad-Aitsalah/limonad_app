"use client";

import { useCompanyIdentity } from "@/hooks/use-company-identity";
import { formatCustomerCode } from "@/lib/customer-code";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto } from "@/types/operations-dto";

type ReceiptPrintProps = {
  sale: SaleDto | null;
  paperWidth?: "58" | "80";
};

// Nom affiché sous le logo sur le ticket / la facture imprimée du POS.
// Volontairement figé ici : il ne suit pas le nom de l'organisation
// (identity.tradeName / identity.name) - seul ce ticket doit dire ceci.
const RECEIPT_BRAND_NAME = "AITSALAH STORE";

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

export function ReceiptPrint({ sale, paperWidth = "80" }: ReceiptPrintProps) {
  const { identity } = useCompanyIdentity();

  if (!sale) return null;

  const receiptDate = sale.validatedAt ?? sale.createdAt;
  const articleCount = sale.lines.reduce((sum, line) => sum + line.quantity, 0);
  const customerName = sale.customer?.name ?? "Client Comptoir";
  const customerCode = sale.customer ? formatCustomerCode(sale.customer.code) : null;
  const cashierName = sale.driver?.name ?? sale.createdByUserName;
  const paymentLabel = paymentLabels[sale.paymentMethod] ?? sale.paymentMethod;
  // MIXED sales persist as two Payment rows (CASH + CHECK) - see
  // createMixedPayments in lib/server/sales-shared.ts - so the split shown
  // here always reflects what was actually recorded, never recomputed.
  const cashAmount = sale.payments
    .filter((item) => item.method === "CASH")
    .reduce((sum, item) => sum + item.amount, 0);
  const chequeAmount = sale.payments
    .filter((item) => item.method === "CHECK")
    .reduce((sum, item) => sum + item.amount, 0);
  // A sale still DRAFT has not been collected yet: the payment method on the
  // row is only a placeholder, so the ticket must not look like a paid one.
  const awaitingPayment = sale.status === "DRAFT";

  return (
    <section
      aria-hidden="true"
      className="receipt-print-area hidden"
      data-paper={paperWidth}
    >
      <div className="receipt-print-ticket">
        <header className="receipt-print-header">
          {identity?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={identity.logoUrl}
              alt={RECEIPT_BRAND_NAME}
              className="receipt-print-logo"
            />
          ) : null}
          <p className="receipt-print-brand">{RECEIPT_BRAND_NAME}</p>
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
          {customerCode ? (
            <div>
              <span>N° client : </span>
              <strong>{customerCode}</strong>
            </div>
          ) : null}
        </div>

        {awaitingPayment ? (
  <div className="receipt-print-pending">EN ATTENTE DE RÈGLEMENT</div>
) : null}

        <div className="receipt-print-separator" />

        <div className="receipt-print-grid receipt-print-head">
          <span className="receipt-print-qty">QTE</span>
          <span>DESIGNATION</span>
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
                  <span className="receipt-print-product">{line.productName}</span>
                  <span className="receipt-print-number">
                    {formatReceiptAmount(unitPriceTTC)}
                  </span>
                  <span className="receipt-print-number">
                    {formatReceiptAmount(line.totalTTC)}
                  </span>
                </div>
                {line.discountRate > 0 ? (
                  <p className="receipt-print-discount">Remise : {line.discountRate} %</p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="receipt-print-separator" />

        <div className="receipt-print-total">
          <strong>{formatCurrency(sale.totalTTC)}</strong>
          <span>TOTAL TTC</span>
        </div>

        <div className="receipt-print-separator" />

        <footer className="receipt-print-footer">
          {awaitingPayment ? (
            <p>Statut : EN ATTENTE DE RÈGLEMENT</p>
          ) : (
            <>
              <p>Paiement : {paymentLabel}</p>
              {sale.paymentMethod === "MIXED" ? (
                <>
                  <p>Espèces : {formatCurrency(cashAmount)}</p>
                  <p>Chèque : {formatCurrency(chequeAmount)}</p>
                  <p>Payé : {formatCurrency(sale.paidAmount)}</p>
                  {sale.creditAmount > 0 ? (
                    <p>Reste à crédit : {formatCurrency(sale.creditAmount)}</p>
                  ) : null}
                </>
              ) : null}
              <p>
                Statut :{" "}
                {sale.creditAmount <= 0
                  ? "Réglée"
                  : sale.paidAmount > 0
                    ? "Partiellement réglée"
                    : "À crédit"}
              </p>
            </>
          )}
          <p>Caisse : {cashierName}</p>
          <p>
            {articleCount} Article{articleCount > 1 ? "s" : ""}
          </p>
        </footer>
      </div>
    </section>
  );
}
