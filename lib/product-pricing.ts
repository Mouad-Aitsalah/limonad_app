import { roundCurrency } from "@/lib/utils";

export function computePriceTTC(basePriceHT: number, taxRate: number) {
  return roundCurrency(basePriceHT * (1 + taxRate / 100));
}

export function computePriceHTFromTTC(priceTTC: number, taxRate: number) {
  const divisor = 1 + taxRate / 100;

  if (!Number.isFinite(priceTTC) || divisor <= 0) {
    return 0;
  }

  return roundCurrency(priceTTC / divisor);
}
