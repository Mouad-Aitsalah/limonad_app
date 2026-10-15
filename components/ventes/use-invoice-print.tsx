"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { ReceiptPrint } from "@/components/pos/receipt-print";
import { fetchInvoiceDetail } from "@/components/ventes/invoice-detail-dialog";
import { creditNoteToReceiptSale } from "@/lib/invoice-print";
import type { CreditNote } from "@/types/credit-note";
import type { SaleDto, SaleHistoryListItemDto } from "@/types/operations-dto";

/**
 * « Imprimer la facture » from Factures journalières and Archives des factures (both render InvoicesTable):
 * the SAME ticket as the counter POS (admin / cashier) - <ReceiptPrint ruled> kept mounted, then
 * window.print(), exactly like pos-layout.tsx's schedulePrint. Only the selected document is loaded, through
 * the routes the detail already uses: GET /api/sales/[id] (getSaleById: admin / depot manager / cashier, own
 * organisation) or GET /api/credit-notes/[id] for an avoir row (adapted by lib/invoice-print.ts).
 * Read only: nothing is created or changed.
 */
export function useInvoicePrint() {
  const [ticketSale, setTicketSale] = React.useState<SaleDto | null>(null);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const busyRef = React.useRef(false);

  const printInvoice = React.useCallback(async (item: SaleHistoryListItemDto) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoadingId(item.id);
    try {
      let sale: SaleDto;
      if (item.kind === "CREDIT_NOTE") {
        const response = await fetch(`/api/credit-notes/${encodeURIComponent(item.id)}`);
        const body = (await response.json().catch(() => ({}))) as { creditNote?: CreditNote; message?: string };
        if (!response.ok || !body.creditNote) throw new Error(body.message ?? "Impossible de charger l'avoir.");
        sale = creditNoteToReceiptSale(body.creditNote);
      } else {
        const outcome = await fetchInvoiceDetail("/api/sales", encodeURIComponent(item.id));
        if (!outcome.ok) throw new Error(outcome.message);
        sale = outcome.sale;
      }
      // The ticket must be in the page before the print dialog opens (this runs after an await, outside
      // React's event batching), then the same deferred call as the counter POS (pos-layout.tsx schedulePrint).
      flushSync(() => setTicketSale(sale));
      window.setTimeout(() => window.print(), 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'imprimer la facture.");
    } finally {
      busyRef.current = false;
      setLoadingId(null);
    }
  }, []);

  const printElement = <ReceiptPrint ruled sale={ticketSale} />;

  return { printInvoice, printingId: loadingId, printElement };
}
