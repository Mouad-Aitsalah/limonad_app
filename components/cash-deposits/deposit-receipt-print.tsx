"use client";

import { formatCurrency } from "@/lib/utils";
import type { CashDepositDto } from "@/types/cash-deposits";

type DepositReceiptPrintProps = {
  deposit: CashDepositDto | null;
  paperWidth?: "58" | "80";
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

function formatDenominationLabel(value: number) {
  return `${formatCurrency(value)}`;
}

/**
 * Reuses the exact same print infrastructure as the POS sale receipt
 * (.receipt-print-area / .receipt-print-ticket / .receipt-print-header) -
 * only the line-item grid and totals block are specific to a deposit
 * (Coupure / Qte / Montant instead of a product cart).
 */
export function DepositReceiptPrint({ deposit, paperWidth = "80" }: DepositReceiptPrintProps) {
  if (!deposit) return null;

  return (
    <section aria-hidden="true" className="receipt-print-area hidden" data-paper={paperWidth}>
      <div className="receipt-print-ticket">
        <header className="receipt-print-header">
          <p className="receipt-print-brand">AITSALAHMARKET</p>
          <p>VERSEMENT DE CAISSE</p>
        </header>

        <div className="receipt-print-meta">
          <div>
            <span>N° versement : </span>
            <strong>{deposit.number}</strong>
          </div>
          <div className="receipt-print-right">{formatReceiptDate(deposit.createdAt)}</div>
          <div>
            <span>Caissier : </span>
            <strong>{deposit.createdByUserName}</strong>
          </div>
          <div className="receipt-print-right">{formatReceiptTime(deposit.createdAt)}</div>
          <div>
            <span>POS / Caisse : </span>
            <strong>{deposit.depotName}</strong>
          </div>
        </div>

        <div className="receipt-print-separator" />

        <div className="receipt-print-deposit-grid receipt-print-head">
          <span>Coupure</span>
          <span className="receipt-print-right">Qté</span>
          <span className="receipt-print-right">Montant</span>
        </div>

        <div className="receipt-print-separator" />

        <div className="receipt-print-lines">
          {deposit.denominations.map((line) => (
            <div key={line.denomination} className="receipt-print-deposit-grid">
              <span>{formatDenominationLabel(line.denomination)}</span>
              <span className="receipt-print-right">{line.quantity}</span>
              <span className="receipt-print-right receipt-print-number">
                {formatCurrency(line.amount)}
              </span>
            </div>
          ))}
        </div>

        <div className="receipt-print-separator" />

        <div className="receipt-print-totals">
          <div className="receipt-print-totals-row">
            <span>TOTAL ESPÈCES</span>
            <span>{formatCurrency(deposit.cashTotal)}</span>
          </div>
          <div className="receipt-print-totals-row">
            <span>CHÈQUES</span>
            <span>{formatCurrency(deposit.checkTotal)}</span>
          </div>
          <div className="receipt-print-totals-row receipt-print-totals-grand">
            <span>TOTAL</span>
            <span>{formatCurrency(deposit.total)}</span>
          </div>
        </div>

        <div className="receipt-print-separator" />
      </div>
    </section>
  );
}
