"use client";

import * as React from "react";
import { toast } from "sonner";

import { fetchInvoiceDetail } from "@/components/ventes/invoice-detail-dialog";
import { InvoicePrint } from "@/components/ventes/invoice-print";
import { useCompanyIdentity } from "@/hooks/use-company-identity";
import { creditNoteToPrintableInvoice, saleToPrintableInvoice, type PrintableInvoice } from "@/lib/invoice-print";
import type { CreditNote } from "@/types/credit-note";
import type { SaleHistoryListItemDto } from "@/types/operations-dto";

/**
 * « Imprimer la facture » from Factures journalières and Archives des factures (both render InvoicesTable):
 * loads the ONE selected document through the routes the detail already uses - GET /api/sales/[id]
 * (getSaleById: admin / depot manager / cashier, own organisation) or GET /api/credit-notes/[id] for an avoir
 * row - and prints it. Read only: nothing is created or changed.
 */
export function useInvoicePrint() {
  const { identity } = useCompanyIdentity();
  const [document, setDocument] = React.useState<PrintableInvoice | null>(null);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const busyRef = React.useRef(false);

  const printInvoice = React.useCallback(async (item: SaleHistoryListItemDto) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoadingId(item.id);
    try {
      if (item.kind === "CREDIT_NOTE") {
        const response = await fetch(`/api/credit-notes/${encodeURIComponent(item.id)}`);
        const body = (await response.json().catch(() => ({}))) as { creditNote?: CreditNote; message?: string };
        if (!response.ok || !body.creditNote) throw new Error(body.message ?? "Impossible de charger l'avoir.");
        setDocument(creditNoteToPrintableInvoice(body.creditNote));
      } else {
        const outcome = await fetchInvoiceDetail("/api/sales", encodeURIComponent(item.id));
        if (!outcome.ok) throw new Error(outcome.message);
        setDocument(saleToPrintableInvoice(outcome.sale));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'imprimer la facture.");
    } finally {
      busyRef.current = false;
      setLoadingId(null);
    }
  }, []);

  const clear = React.useCallback(() => setDocument(null), []);
  const printElement = <InvoicePrint invoice={document} identity={identity} onDone={clear} />;

  return { printInvoice, printingId: loadingId, printElement };
}
