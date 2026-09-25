import { roundMoney } from "@/lib/money";
import { reconstructDiscountUnitAmount, unitPriceTTCFromHT } from "@/lib/pos-discount";

/**
 * The unit price (TTC) PRINTED on an invoice/ticket line - display only.
 *
 * The discount is folded into that price instead of being listed under the
 * line: catalogue price - discount per unit. The discount is read the way
 * every POS-owned display already reads it (reconstructDiscountUnitAmount,
 * from the line's own persisted totalTTC), so what is printed always equals
 * the amount actually charged (quantity x printed price = printed amount).
 * Nothing is recomputed or stored: a line without discount is returned
 * exactly as it was printed before (HT x (1 + VAT)).
 */
export function receiptUnitPriceTTC(line: {
  unitPriceHT: number;
  taxRate: number;
  quantity: number;
  totalTTC: number;
}): number {
  const discountUnitAmount = reconstructDiscountUnitAmount(line);
  if (discountUnitAmount <= 0) return line.unitPriceHT * (1 + line.taxRate / 100);
  return roundMoney(unitPriceTTCFromHT(line.unitPriceHT, line.taxRate) - discountUnitAmount);
}
