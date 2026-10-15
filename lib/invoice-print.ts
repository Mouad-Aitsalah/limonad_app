import { CREDIT_NOTE_PAYMENT_LABEL } from "@/lib/credit-note-list-rows";
import { reconstructDiscountUnitAmount, unitPriceTTCFromHT } from "@/lib/pos-discount";
import { roundMoney } from "@/lib/money";
import type { CreditNote } from "@/types/credit-note";
import type { SaleDto } from "@/types/operations-dto";

/**
 * The printed invoice (« Imprimer la facture ») as a plain, already-computed document: Factures journalières,
 * Archives des factures and the driver's « Mes ventes du jour » all print THIS model with the same A4 layout
 * (components/ventes/invoice-print.tsx). Pure - no React, no fetch - so the rules are tested directly.
 *
 * Nothing is recomputed into the sale: every amount is the one stored (line totals, HT, VAT, rounding, total),
 * the unit price TTC is the catalogue price through the SAME function as the invoice PDF
 * (unitPriceTTCFromHT) and the per-unit discount is read back from the stored line exactly like the PDF
 * (reconstructDiscountUnitAmount) - it is displayed, never applied a second time.
 */

export type PrintableInvoiceLine = {
  key: string;
  reference: string;
  name: string;
  quantity: number;
  /** Unit price TTC (catalogue, before discount). */
  unitPriceTTC: number;
  /** DH taken off each unit, as recorded (0 = none). */
  discountUnitAmount: number;
  /** The stored line total TTC (discount included). */
  totalTTC: number;
};

export type PrintableInvoice = {
  kind: "SALE" | "CREDIT_NOTE";
  /** « FACTURE » or « AVOIR ». */
  title: string;
  number: string;
  /** ISO date of the document (validation, else creation). */
  date: string;
  statusLabel: string;
  /** Printed in large letters when set (cancelled invoice, reversed credit note, draft). */
  warning: string | null;
  /** « Client » / « Fournisseur » and the party's name. */
  partyLabel: string;
  partyName: string;
  partyCode: string | null;
  /** Who issued it (driver or user) - « Chauffeur » / « Utilisateur ». */
  issuerLabel: string;
  issuerName: string | null;
  truck: string | null;
  /** Credit note only: the invoice it refers to. */
  relatedInvoice: string | null;
  lines: PrintableInvoiceLine[];
  subtotalHT: number | null;
  taxAmount: number | null;
  roundingAmount: number;
  /** Stored total TTC - NEGATIVE for a credit note (money going back, as in the invoice lists). */
  totalTTC: number;
  paymentLabel: string;
  /** Customer sale only: what was paid / left on credit, when not simply the whole amount. */
  paidAmount: number | null;
  creditAmount: number | null;
};

const SALE_PAYMENT_LABELS: Record<string, string> = {
  CASH: "Espèces",
  CARD: "Carte",
  CHECK: "Chèque",
  BANK_TRANSFER: "Virement",
  CREDIT: "Crédit",
  MIXED: "Paiement mixte",
};

const SALE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  VALIDATED: "Validée",
  PARTIALLY_PAID: "Partiellement payée",
  PAID: "Payée",
  CREDIT: "Crédit",
  CANCELLED: "Annulée",
  CREDIT_NOTED: "Avoir émis",
};

const CREDIT_NOTE_STATUS_LABELS: Record<CreditNote["status"], string> = {
  BROUILLON: "Brouillon",
  VALIDE: "Avoir",
  CONTREPASSE: "Avoir annulé",
};

export function saleToPrintableInvoice(sale: SaleDto): PrintableInvoice {
  const paymentLabel = SALE_PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod;
  const bank =
    sale.paymentMethod === "BANK_TRANSFER" && sale.bankAccountingAccountName
      ? ` (${sale.bankAccountingAccountName})`
      : "";
  const showSplit = sale.creditAmount > 0 && sale.paidAmount > 0;
  return {
    kind: "SALE",
    title: "FACTURE",
    number: sale.displayNumber,
    date: sale.soldAt ?? sale.validatedAt ?? sale.createdAt,
    statusLabel: SALE_STATUS_LABELS[sale.status] ?? sale.status,
    warning:
      sale.status === "CANCELLED"
        ? "FACTURE ANNULÉE"
        : sale.status === "DRAFT"
          ? "BROUILLON - FACTURE NON VALIDÉE"
          : null,
    partyLabel: "Client",
    partyName: sale.customer?.name ?? "Client comptoir",
    partyCode: sale.customer?.code ?? null,
    issuerLabel: sale.driver ? "Chauffeur" : "Utilisateur",
    issuerName: sale.driver?.name ?? (sale.createdByUserName || null),
    truck: sale.truck ? `${sale.truck.code}${sale.truck.registration ? ` - ${sale.truck.registration}` : ""}` : null,
    relatedInvoice: null,
    lines: sale.lines.map((line) => ({
      key: line.id,
      reference: line.productReference,
      name: line.productName,
      quantity: line.quantity,
      unitPriceTTC: unitPriceTTCFromHT(line.unitPriceHT, line.taxRate),
      discountUnitAmount: reconstructDiscountUnitAmount({
        unitPriceHT: line.unitPriceHT,
        taxRate: line.taxRate,
        quantity: line.quantity,
        totalTTC: line.totalTTC,
      }),
      totalTTC: line.totalTTC,
    })),
    subtotalHT: sale.subtotalHT,
    taxAmount: sale.taxAmount,
    roundingAmount: sale.roundingAmount ?? 0,
    totalTTC: sale.totalTTC,
    paymentLabel: `${paymentLabel}${bank}`,
    paidAmount: showSplit ? sale.paidAmount : null,
    creditAmount: showSplit ? sale.creditAmount : null,
  };
}

/** A credit note, printed with its own number, status and NEGATIVE amounts, payment « Rembourser ». */
export function creditNoteToPrintableInvoice(note: CreditNote): PrintableInvoice {
  const isCustomer = note.partyType === "client";
  const lines = note.lines.map((line, index) => {
    const totalTTC = line.totalTTC ?? 0;
    return {
      key: line.id ?? `${line.productId}-${index}`,
      reference: line.productReference ?? "",
      name: line.productName ?? "",
      quantity: line.quantityReturned,
      unitPriceTTC: unitPriceTTCFromHT(line.unitPrice, line.taxRate),
      discountUnitAmount: line.discountPercent > 0
        ? reconstructDiscountUnitAmount({
            unitPriceHT: line.unitPrice,
            taxRate: line.taxRate,
            quantity: line.quantityReturned,
            totalTTC,
          })
        : 0,
      totalTTC: -totalTTC,
    };
  });
  const totalHT = note.lines.reduce((sum, line) => sum + (line.totalHT ?? 0), 0);
  const taxAmount = note.lines.reduce((sum, line) => sum + (line.taxAmount ?? 0), 0);
  const total = note.totalTTC ?? note.lines.reduce((sum, line) => sum + (line.totalTTC ?? 0), 0);
  return {
    kind: "CREDIT_NOTE",
    title: "AVOIR",
    number: note.number,
    date: note.validatedAt ?? note.returnDate ?? note.createdAt,
    statusLabel: CREDIT_NOTE_STATUS_LABELS[note.status] ?? note.status,
    warning:
      note.status === "CONTREPASSE"
        ? "AVOIR ANNULÉ (CONTRE-PASSÉ)"
        : note.status === "BROUILLON"
          ? "BROUILLON - AVOIR NON VALIDÉ"
          : null,
    partyLabel: isCustomer ? "Client" : "Fournisseur",
    partyName: (isCustomer ? note.customerName : note.supplierName) ?? "-",
    partyCode: isCustomer ? null : (note.supplierCode ?? null),
    issuerLabel: note.driverReturnDriverName ? "Chauffeur" : "Utilisateur",
    issuerName: note.driverReturnDriverName ?? note.validatedBy ?? (note.createdBy || null),
    truck: note.truckLabel ?? null,
    relatedInvoice: note.invoiceNumber ?? null,
    lines,
    subtotalHT: -roundMoney(totalHT),
    taxAmount: -roundMoney(taxAmount),
    roundingAmount: -(note.roundingAmount ?? 0),
    totalTTC: -total,
    paymentLabel: CREDIT_NOTE_PAYMENT_LABEL,
    paidAmount: null,
    creditAmount: null,
  };
}

export function formatPrintDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-MA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

export function formatPrintTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-MA", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}
