"use client";

import { LOADING_TICKET_TITLES, loadingTicketCells, type LoadingTicketInput } from "@/lib/escpos-loading";
import { countedSummary, gapTone, remainingGap } from "@/lib/truck-loading-remaining";

/**
 * Browser / PC fallback of the "Imprimer" button of a loading: an 80 mm ticket
 * with the same content as the Bluetooth ticket (lib/escpos-loading.ts),
 * printed with window.print(). Hidden on screen; the shared print stylesheet
 * (app/globals.css, .receipt-print-area) shows only this area when printing,
 * and draws the dashed column / row separators of [data-document="loading"].
 * The invoice ticket is not involved.
 */
export function LoadingReceiptPrint({ ticket }: { ticket: LoadingTicketInput | null }) {
  if (!ticket) return null;
  const date = new Date(ticket.date);
  const dateLabel = Number.isNaN(date.getTime())
    ? ticket.date
    : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  const { counted, total } = countedSummary(ticket.lines.map((line) => ({ actualRemainingQuantity: line.actualQuantity ?? null })));

  return (
    <section aria-hidden="true" className="receipt-print-area hidden" data-paper="80" data-document="loading">
      <div className="receipt-print-ticket">
        <header className="receipt-print-header">
          <p className="receipt-print-brand">{ticket.brandName ?? "AITSALAH STORE"}</p>
          <p style={{ fontSize: "14px", fontWeight: 700 }}>TRANSFERT DE STOCK</p>
        </header>
        <div className="receipt-print-separator" />
        <div>Date : {dateLabel}</div>
        {ticket.driverName ? <div>Chauffeur : {ticket.driverName}</div> : null}
        {ticket.truckLabel ? <div>Camion : {ticket.truckLabel}</div> : null}
        <div className="receipt-print-separator" />
        <div className="receipt-print-loading-table">
          <div className="receipt-print-loading-row receipt-print-loading-head">
            <span>PRODUIT</span>
            {LOADING_TICKET_TITLES.map(([first, second]) => (
              <span key={`${first}-${second}`} className="receipt-print-number">
                {first ? (
                  <>
                    {first}
                    <br />
                  </>
                ) : null}
                {second}
              </span>
            ))}
          </div>
          {ticket.lines.map((line, index) => {
            const cells = loadingTicketCells(line);
            const tone = gapTone(remainingGap(line.actualQuantity ?? null, line.theoreticalQuantity ?? null));
            return (
              <div key={`${line.productName}-${index}`} className="receipt-print-loading-row" data-gap={tone}>
                <span className="receipt-print-product">{line.productName}</span>
                {cells.map((cell, column) => (
                  <span key={column} className={column === 4 ? "receipt-print-number receipt-print-loading-gap" : "receipt-print-number"}>
                    {cell}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: "1.5mm" }}>
          Produits comptés : {counted} / {total}
        </div>
        <div style={{ fontSize: "8px" }}>Décalage = restant réel - restant théorique (- manque, + surplus)</div>
      </div>
    </section>
  );
}
