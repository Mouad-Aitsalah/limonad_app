import { CREDIT_NOTE_LIST_STATUS, CREDIT_NOTE_PAYMENT_METHOD, CREDIT_NOTE_REVERSED_LIST_STATUS } from "@/lib/credit-note-list-rows";
import type { CreditNote } from "@/types/credit-note";
import type { SaleDto } from "@/types/operations-dto";

/**
 * « Imprimer la facture » prints the POS ticket itself (components/pos/receipt-print.tsx) - there is no
 * other invoice layout. A sale is passed to it as is (the SaleDto from GET /api/sales/[id]). A credit note
 * (« avoir ») is not a sale: this only ADAPTS its stored data to the ticket's input, without recomputing
 * anything and without touching the ticket's layout:
 *
 *  - status CREDIT_NOTE / CREDIT_NOTE_REVERSED (the same markers as the invoice lists) and payment
 *    "REFUND", so the ticket says « N° Avoir », « Paiement : Rembourser », « Statut : Avoir »;
 *  - every amount NEGATIVE, as the invoice lists show an avoir: line totals and the total are the stored
 *    ones with a minus sign; quantities stay the returned quantities;
 *  - the printed unit price is the catalogue price (no discount), or - when the line was discounted - the
 *    price actually refunded per unit, folded like the ticket already does for a discounted sale line.
 */
export function creditNoteToReceiptSale(note: CreditNote): SaleDto {
  const lines = note.lines.map((line, index) => {
    const totalTTC = line.totalTTC ?? 0;
    const factor = 1 + line.taxRate / 100;
    const unitPriceHT =
      line.discountPercent > 0 && line.quantityReturned > 0 ? totalTTC / line.quantityReturned / factor : line.unitPrice;
    return {
      id: line.id ?? `${line.productId}-${index}`,
      productId: line.productId,
      productReference: line.productReference ?? "",
      productName: line.productName ?? "",
      quantity: line.quantityReturned,
      unitPriceHT: -unitPriceHT,
      discountRate: 0,
      discountAmount: 0,
      taxRate: line.taxRate,
      taxAmount: -(line.taxAmount ?? 0),
      totalHT: -(line.totalHT ?? 0),
      totalTTC: -totalTTC,
    };
  });
  const total = note.totalTTC ?? note.lines.reduce((sum, line) => sum + (line.totalTTC ?? 0), 0);
  const party = note.partyType === "client" ? note.customerName : note.supplierName;
  const date = note.validatedAt ?? note.createdAt;
  return {
    id: note.id,
    invoiceNumber: note.number,
    saleYear: null,
    saleNumber: null,
    displayNumber: note.number,
    posSessionId: null,
    origin: "CREDIT_NOTE",
    status: note.status === "CONTREPASSE" ? CREDIT_NOTE_REVERSED_LIST_STATUS : CREDIT_NOTE_LIST_STATUS,
    // The ticket prints the party's name and, when present, its customer code: a supplier has no customer code.
    customer: party ? { id: note.customerId ?? note.supplierId ?? note.id, code: "", name: party } : null,
    driver: note.driverReturnDriverName ? { id: "", name: note.driverReturnDriverName } : null,
    subtotalHT: -lines.reduce((sum, line) => sum - line.totalHT, 0),
    discountAmount: 0,
    taxAmount: -lines.reduce((sum, line) => sum - line.taxAmount, 0),
    totalTTC: -total,
    roundingAmount: -(note.roundingAmount ?? 0),
    stampAmount: 0,
    paidAmount: 0,
    creditAmount: 0,
    paymentMethod: CREDIT_NOTE_PAYMENT_METHOD,
    createdByUserName: note.validatedBy ?? note.createdBy,
    validatedAt: date,
    createdAt: note.createdAt,
    lines,
    payments: [],
  };
}
