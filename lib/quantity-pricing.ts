/**
 * Quantity pricing ("tarification automatique selon la quantité") - the ONE
 * rule shared by the counter POS screen and createCounterSale, so the price on
 * screen and the price the server books can never drift apart. Pure, no
 * Prisma, no "server-only": the browser, the server and the tests import it.
 *
 * Q = total quantity of the product in the cart (the counter cart keeps one
 * line per product; the server still sums per product, see
 * sumQuantitiesByProduct). With the organisation setting ON and a product whose
 * four tier values are all set and valid:
 *
 *   0 <= Q < Qped       -> prix détail      (Product.retailPrice)
 *   Qped <= Q < Qgros   -> prix semi-gros   (Product.semiWholesalePrice)
 *   Q >= Qgros          -> prix gros        (Product.salePrice, unchanged)
 *
 * Setting OFF, or a tier missing / invalid -> prix gros, exactly as before.
 * Nothing is ever guessed (no default threshold, no derived price).
 * Every price here is HT, like Product.salePrice.
 */

export type QuantityPriceTier = "RETAIL" | "SEMI_WHOLESALE" | "WHOLESALE";

/** The discreet label shown on the POS cart line. */
export const QUANTITY_PRICE_TIER_LABELS: Record<QuantityPriceTier, string> = {
  RETAIL: "Détail",
  SEMI_WHOLESALE: "Semi-gros",
  WHOLESALE: "Gros",
};

/** A product's four tier values as stored (null = not set). */
export type QuantityTierValues = {
  retailPriceHT: number | null;
  semiWholesalePriceHT: number | null;
  /** Qped: first quantity sold at the semi-wholesale price. */
  semiWholesaleMinQty: number | null;
  /** Qgros: first quantity sold at the wholesale price (Product.salePrice). */
  wholesaleMinQty: number | null;
};

/** A complete and valid tier set - the only shape the rule ever applies. */
export type QuantityTiers = {
  retailPriceHT: number;
  semiWholesalePriceHT: number;
  semiWholesaleMinQty: number;
  wholesaleMinQty: number;
};

function isTierPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** A threshold is a whole quantity of at least 1 (Q is never below 1 in a cart). */
export function isTierThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * The product's tiers when all four are set and unambiguous
 * (prices >= 0, integer thresholds >= 1, Qped < Qgros); null otherwise - the
 * product then keeps its wholesale price.
 */
export function readCompleteQuantityTiers(
  values: Partial<QuantityTierValues> | null | undefined,
): QuantityTiers | null {
  if (!values) return null;
  const { retailPriceHT, semiWholesalePriceHT, semiWholesaleMinQty, wholesaleMinQty } = values;
  if (!isTierPrice(retailPriceHT) || !isTierPrice(semiWholesalePriceHT)) return null;
  if (!isTierThreshold(semiWholesaleMinQty) || !isTierThreshold(wholesaleMinQty)) return null;
  if (semiWholesaleMinQty >= wholesaleMinQty) return null;
  return { retailPriceHT, semiWholesalePriceHT, semiWholesaleMinQty, wholesaleMinQty };
}

export type QuantityPriceResult = {
  unitPriceHT: number;
  /** null = the rule did not apply (setting off or incomplete tiers): the
   *  wholesale price, shown without a tier label, exactly as before. */
  tier: QuantityPriceTier | null;
};

export function resolveQuantityPrice(params: {
  /** Organization.quantityPricingEnabled - read on the server, never trusted from a request. */
  enabled: boolean;
  /** Product.salePrice (HT): the prix gros. */
  wholesalePriceHT: number;
  tiers: Partial<QuantityTierValues> | null | undefined;
  /** Q: total quantity of this product in the cart. */
  quantity: number;
}): QuantityPriceResult {
  const tiers = params.enabled ? readCompleteQuantityTiers(params.tiers) : null;
  if (!tiers) return { unitPriceHT: params.wholesalePriceHT, tier: null };
  if (params.quantity < tiers.semiWholesaleMinQty) {
    return { unitPriceHT: tiers.retailPriceHT, tier: "RETAIL" };
  }
  if (params.quantity < tiers.wholesaleMinQty) {
    return { unitPriceHT: tiers.semiWholesalePriceHT, tier: "SEMI_WHOLESALE" };
  }
  return { unitPriceHT: params.wholesalePriceHT, tier: "WHOLESALE" };
}

/** Q per product: every line of the same product counts towards its tier. */
export function sumQuantitiesByProduct(
  lines: readonly { productId: string; quantity: number }[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
  }
  return totals;
}

/** Decimal-like value of a Prisma row (Product.retailPrice...), without importing Prisma. */
type DecimalLike = { toNumber(): number };

/** The stored tier columns of a Product row, as QuantityTierValues. */
export function quantityTierValuesFromRow(row: {
  retailPrice: DecimalLike | null;
  semiWholesalePrice: DecimalLike | null;
  semiWholesaleMinQty: number | null;
  wholesaleMinQty: number | null;
}): QuantityTierValues {
  return {
    retailPriceHT: row.retailPrice ? row.retailPrice.toNumber() : null,
    semiWholesalePriceHT: row.semiWholesalePrice ? row.semiWholesalePrice.toNumber() : null,
    semiWholesaleMinQty: row.semiWholesaleMinQty,
    wholesaleMinQty: row.wholesaleMinQty,
  };
}
