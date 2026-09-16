/**
 * INTÉGRATION POS SHELL - redeclared from components/pos/pos-layout.tsx's
 * own CartLineComputed/CartTotals (the exact shape driver-pos-view.tsx
 * builds and CartTable/CartSummary render), NOT imported from that file:
 * pos-layout.tsx itself imports "next/navigation" for the admin POS page,
 * which this shell must never pull in. These two types are pure data
 * shapes with zero behavior - copying them carries none of the "duplicated
 * business logic" risk this integration otherwise avoids everywhere else.
 */
export type CartLineComputed = {
  productId: string;
  designation: string;
  reference: string;
  quantity: number;
  discountUnitAmount: number;
  unitPriceHT: number;
  unitPriceTTC: number;
  tauxTVA: number;
  baseHT: number;
  discountAmount: number;
  netHT: number;
  tvaAmount: number;
  totalTTC: number;
  transferValue: number;
};

export type CartTotals = {
  sousTotalHT: number;
  remise: number;
  tva: number;
  totalTTC: number;
  netAPayer: number;
  transferValue: number;
};
