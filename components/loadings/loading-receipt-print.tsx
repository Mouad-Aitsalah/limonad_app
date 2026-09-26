"use client";

import type { LoadingTicketInput } from "@/lib/escpos-loading";

/**
 * Browser / PC fallback of the "Imprimer" button of a loading: an 80 mm ticket
 * with the same content as the Bluetooth ticket (lib/escpos-loading.ts),
 * printed with window.print(). Hidden on screen; the shared print stylesheet
 * (app/globals.css, .receipt-print-area) shows only this area when printing.
 * The invoice ticket is not involved.
 */
export function LoadingReceiptPrint({ ticket }: { ticket: LoadingTicketInput | null }) {
  if (!ticket) return null;
  const date = new Date(ticket.date);
  const dateLabel = Number.isNaN(date.getTime())
    ? ticket.date
    : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  const grid = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 16mm 20mm", gap: "1mm" } as const;

  return (
    <section aria-hidden="true" className="receipt-print-area hidden" data-paper="80" data-document="loading">
      <div className="receipt-print-ticket">
        <header className="receipt-print-header">
          <p className="receipt-print-brand">{ticket.brandName ?? "AITSALAH STORE"}</p>
          <p style={{ fontSize: "14px", fontWeight: 700 }}>CHARGEMENT</p>
        </header>
        <div className="receipt-print-separator" />
        <div>Date : {dateLabel}</div>
        {ticket.driverName ? <div>Chauffeur : {ticket.driverName}</div> : null}
        {ticket.truckLabel ? <div>Camion : {ticket.truckLabel}</div> : null}
        <div className="receipt-print-separator" />
        <div style={{ ...grid, fontWeight: 700 }}>
          <span>PRODUIT</span>
          <span className="receipt-print-number">CHARGE</span>
          <span className="receipt-print-number">RECHARGE</span>
        </div>
        <div className="receipt-print-separator" />
        <div className="receipt-print-lines">
          {ticket.lines.map((line, index) => (
            <div key={`${line.productName}-${index}`} style={{ ...grid, fontSize: "13px" }}>
              <span className="receipt-print-product">{line.productName}</span>
              <span className="receipt-print-number">{line.initialQuantity}</span>
              <span className="receipt-print-number">{line.reloadedQuantity}</span>
            </div>
          ))}
        </div>
        <div className="receipt-print-separator" />
      </div>
    </section>
  );
}
