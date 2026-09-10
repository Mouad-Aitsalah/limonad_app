import { roundMoney } from "@/lib/money";
import type { SaleDto, SaleLineDto } from "@/types/operations-dto";

/**
 * Client-side "print preview" sale.
 *
 * The POS "Imprimer" button must ONLY open the browser print dialog for the
 * ticket the operator is looking at - it must never create/persist a sale,
 * reserve a number for good, touch stock, collect, or switch the cart to
 * read-only. So instead of round-tripping to the server for a DRAFT, both
 * the counter POS and the driver POS build this in-memory `SaleDto` from the
 * live cart and feed it straight to the existing <ReceiptPrint>. No design
 * change to the printed ticket; every field it already showed is filled.
 *
 * Nothing here writes anywhere - it is pure arithmetic over the cart lines.
 */
export type PreviewSaleLineInput = {
  productId: string;
  productReference: string;
  productName: string;
  quantity: number;
  /** Unit price excl. tax, after any per-line manual override. */
  unitPriceHT: number;
  /** Percentage, 0-100. */
  discountRate: number;
  /** VAT percentage, e.g. 20. */
  taxRate: number;
};

export type PreviewSaleInput = {
  /** Commercial reference already shown in the cart header (e.g. "263/2026"). */
  displayNumber: string;
  createdByUserName: string;
  customer?: SaleDto["customer"];
  driver?: SaleDto["driver"];
  truck?: SaleDto["truck"];
  tour?: SaleDto["tour"];
  paymentMethod: string;
  /** BANK_TRANSFER only - the chosen 5141 account, for the ticket line. */
  bankAccount?: { id: string; code: string; name: string } | null;
  lines: PreviewSaleLineInput[];
};

export function buildPreviewSale(input: PreviewSaleInput): SaleDto {
  const now = new Date().toISOString();

  const lines: SaleLineDto[] = input.lines.map((line, index) => {
    const grossHT = roundMoney(line.unitPriceHT * line.quantity);
    const discountAmount = roundMoney(grossHT * (line.discountRate / 100));
    const totalHT = roundMoney(grossHT - discountAmount);
    const taxAmount = roundMoney(totalHT * (line.taxRate / 100));
    const totalTTC = roundMoney(totalHT + taxAmount);
    return {
      id: `preview-${index}`,
      productId: line.productId,
      productReference: line.productReference,
      productName: line.productName,
      quantity: line.quantity,
      unitPriceHT: line.unitPriceHT,
      discountRate: line.discountRate,
      discountAmount,
      taxRate: line.taxRate,
      taxAmount,
      totalHT,
      totalTTC,
    };
  });

  const subtotalHT = roundMoney(
    input.lines.reduce((sum, l) => sum + l.unitPriceHT * l.quantity, 0),
  );
  const discountAmount = roundMoney(
    lines.reduce((sum, l) => sum + l.discountAmount, 0),
  );
  const taxAmount = roundMoney(lines.reduce((sum, l) => sum + l.taxAmount, 0));
  const totalTTC = roundMoney(lines.reduce((sum, l) => sum + l.totalTTC, 0));

  return {
    id: "preview",
    invoiceNumber: input.displayNumber,
    saleYear: null,
    saleNumber: null,
    displayNumber: input.displayNumber,
    posSessionId: null,
    origin: "COUNTER",
    // DRAFT -> <ReceiptPrint> prints it as "EN ATTENTE DE RÈGLEMENT", which
    // is exactly right: nothing has been collected.
    status: "DRAFT",
    customer: input.customer ?? null,
    depot: null,
    driver: input.driver ?? null,
    truck: input.truck ?? null,
    tour: input.tour ?? null,
    subtotalHT,
    discountAmount,
    taxAmount,
    totalTTC,
    stampAmount: 0,
    paidAmount: 0,
    creditAmount: totalTTC,
    paymentMethod: input.paymentMethod,
    bankAccountingAccountId: input.bankAccount?.id ?? null,
    bankAccountingAccountCode: input.bankAccount?.code ?? null,
    bankAccountingAccountName: input.bankAccount?.name ?? null,
    createdByUserName: input.createdByUserName,
    validatedAt: null,
    createdAt: now,
    lines,
    payments: [],
  };
}
