import { formatCustomerCode } from "@/lib/customer-code";
import { receiptUnitPriceTTC } from "@/lib/receipt-line-price";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto } from "@/types/operations-dto";

import type { OrganizationIdentity } from "../lib/organization-identity";

type ShellReceiptPrintProps = {
  sale: SaleDto | null;
  identity: OrganizationIdentity | null;
  offlineReference?: string | null;
};

const RECEIPT_BRAND_NAME = "AITSALAH STORE";

const paymentLabels: Record<string, string> = {
  CASH: "Especes",
  CARD: "Carte",
  CHECK: "Cheque",
  BANK_TRANSFER: "Virement",
  CREDIT: "Credit",
  MIXED: "Paiement mixte",
};

function formatReceiptDate(value: string) {
  return new Intl.DateTimeFormat("fr-MA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(value),
  );
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

/**
 * INTÉGRATION POS SHELL - fork of components/pos/receipt-print.tsx: the
 * ENTIRE markup/CSS-class structure is identical (see src/styles.css's
 * copied @media print rules) - the only change is `identity` is a prop
 * (from lib/organization-identity.ts's Bearer fetch) instead of the web
 * app's cookie-based useCompanyIdentity() hook.
 */
export function ShellReceiptPrint({ sale, identity, offlineReference = null }: ShellReceiptPrintProps) {
  if (!sale) return null;

  const receiptDate = sale.validatedAt ?? sale.createdAt;
  const articleCount = sale.lines.reduce((sum, line) => sum + line.quantity, 0);
  const customerName = sale.customer?.name ?? "Client Comptoir";
  const customerCode = sale.customer ? formatCustomerCode(sale.customer.code) : null;
  const cashierName = sale.driver?.name ?? sale.createdByUserName;
  const paymentLabel = paymentLabels[sale.paymentMethod] ?? sale.paymentMethod;
  const cashAmount = sale.payments.filter((item) => item.method === "CASH").reduce((sum, item) => sum + item.amount, 0);
  const chequeAmount = sale.payments.filter((item) => item.method === "CHECK").reduce((sum, item) => sum + item.amount, 0);
  const awaitingPayment = sale.status === "DRAFT";

  return (
    <section aria-hidden="true" className="receipt-print-area hidden" data-paper="80" data-document="sale">
      <div className="receipt-print-ticket">
        <header className="receipt-print-header">
          {identity?.logoUrl ? (
            <img src={identity.logoUrl} alt={RECEIPT_BRAND_NAME} className="receipt-print-logo" />
          ) : null}
          <p className="receipt-print-brand">{RECEIPT_BRAND_NAME}</p>
        </header>

        <div className="receipt-print-meta">
          <div>
            <span>{offlineReference ? "Reference : " : "N Facture : "}</span>
            <strong>{offlineReference ?? sale.displayNumber}</strong>
          </div>
          <div className="receipt-print-right">{formatReceiptDate(receiptDate)}</div>
          <div>
            <span>Client : </span>
            <strong>{customerName}</strong>
          </div>
          <div className="receipt-print-right">{formatReceiptTime(receiptDate)}</div>
          {customerCode ? (
            <div>
              <span>N client : </span>
              <strong>{customerCode}</strong>
            </div>
          ) : null}
        </div>

        {/* Same as the web ticket: the "EN ATTENTE DE REGLEMENT" box above the
            table is no longer printed (the "Statut" line in the footer still
            says it). Only the offline ticket keeps its own marker. */}
        {offlineReference ? (
          <div className="receipt-print-pending">TICKET HORS CONNEXION</div>
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
            // Price actually charged per unit: the line's discount (rebuilt from
            // the totals really charged) is folded into it - no "Remise" line.
            const unitPriceTTC = receiptUnitPriceTTC(line);
            return (
              <div key={line.id} className="receipt-print-line">
                <div className="receipt-print-grid">
                  <span className="receipt-print-qty">{line.quantity}</span>
                  <span className="receipt-print-product">{line.productName}</span>
                  <span className="receipt-print-number">{formatReceiptAmount(unitPriceTTC)}</span>
                  <span className="receipt-print-number">{formatReceiptAmount(line.totalTTC)}</span>
                </div>
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
            <p>Statut : EN ATTENTE DE REGLEMENT</p>
          ) : (
            <>
              <p>Paiement : {paymentLabel}</p>
              {sale.paymentMethod === "BANK_TRANSFER" && sale.bankAccountingAccountCode ? (
                <p>
                  Compte bancaire : {sale.bankAccountingAccountCode} - {sale.bankAccountingAccountName}
                </p>
              ) : null}
              {sale.paymentMethod === "MIXED" ? (
                <>
                  <p>Especes : {formatCurrency(cashAmount)}</p>
                  <p>Cheque : {formatCurrency(chequeAmount)}</p>
                  <p>Paye : {formatCurrency(sale.paidAmount)}</p>
                  {sale.creditAmount > 0 ? <p>Reste a credit : {formatCurrency(sale.creditAmount)}</p> : null}
                </>
              ) : null}
              <p>
                Statut :{" "}
                {sale.creditAmount <= 0 ? "Reglee" : sale.paidAmount > 0 ? "Partiellement reglee" : "A credit"}
              </p>
            </>
          )}
          <p>Caisse : {cashierName}</p>
          <p>
            {articleCount} Article{articleCount > 1 ? "s" : ""}
          </p>
          {offlineReference ? <p>Numero definitif attribue apres synchronisation.</p> : null}
        </footer>
      </div>
    </section>
  );
}
