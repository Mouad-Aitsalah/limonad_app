import { computeDriverLineTotals } from "@/lib/driver-line-totals";
import { roundMoney } from "@/lib/money";

import type { OfflineSaleLineInput, OfflineSaleWithLines } from "./types";

/**
 * PHASE 2.1b - builds the body POSTed to /api/driver/sales/sync for one
 * offline sale. Pure (no SQLite, no fetch) so it can be exercised on its own.
 *
 * DISCOUNT. The driver cart stores the line discount as a percentage
 * (CartLine.discountRate, 0-100) - the same value the online driver POS
 * sends and createDriverSale applies to the HT gross. A sale created by this
 * version snapshots exactly that percentage in `discountSnapshot`, and it is
 * sent as-is.
 *
 * LEGACY SALES. A sale created BEFORE this version has discountSnapshot = 0
 * even when its local ticket was discounted (the discount was applied to the
 * local totals but never recorded). For those lines only, the percentage is
 * reconstructed from the line's own stored totals - the amounts the customer
 * was actually shown - and then VERIFIED: the reconstructed percentage, run
 * through the same rounding sequence createDriverSale uses, must reproduce
 * the stored line totals. When it does not, nothing is guessed: the sale is
 * reported as needing review instead of being sent at a wrong price.
 *
 * `serverLineTotals` below mirrors createDriverSale's per-line sequence
 * (driver-sales.ts) for that verification ONLY. It never decides a price:
 * the server always recomputes, and expectedTotalTTC lets it report any
 * remaining difference.
 */

/**
 * The server rebuilds the unit HT from the signed TTC price
 * (roundMoney(TTC / (1 + tax))), and prices the line TTC-first
 * (lib/driver-line-totals.ts). A line with no discount therefore has stored
 * totals equal to those two figures - only float noise is tolerated. The
 * older comparison with unit HT x quantity alone is kept as a second way to
 * recognise an undiscounted line, but it is NOT sufficient by itself: it
 * differs by a cent from the TTC-first total for some price/quantity pairs
 * (see resolveLineDiscountRate).
 */
const NO_DISCOUNT_EPSILON = 0.005;
/** A reconstructed percentage must reproduce the stored totals to the cent. */
const VERIFY_TOLERANCE = 0.01;

type DiscountResolution = { ok: true; discountRate: number } | { ok: false; message: string };

function serverLineTotals(unitPriceTTC: number, taxRate: number, quantity: number, discountRate: number) {
  const unitPriceHT = roundMoney(unitPriceTTC / (1 + taxRate / 100));
  const { grossHT, totalHT, totalTTC } = computeDriverLineTotals({
    unitPriceHT,
    unitPriceTTC,
    taxRate,
    quantity,
    discountRate,
  });
  return { grossHT, totalHT, totalTTC };
}

export function resolveLineDiscountRate(line: OfflineSaleLineInput): DiscountResolution {
  const unreadable: DiscountResolution = {
    ok: false,
    message: `Remise hors connexion non reconstituable pour "${line.productNameSnapshot}" : verification manuelle requise.`,
  };

  if (!Number.isFinite(line.discountSnapshot) || line.discountSnapshot < 0 || line.discountSnapshot > 100) {
    return unreadable;
  }
  if (line.discountSnapshot > 0) return { ok: true, discountRate: line.discountSnapshot };

  // discountSnapshot is 0: either a genuinely undiscounted line, or a legacy
  // discounted one. Compare the stored HT total with the undiscounted gross.
  // The gross is priced at the price actually applied: the custom price when the
  // driver typed one (0 included - `??`, never `||`), else the catalogue price.
  const appliedUnitPriceTTC = line.customUnitPriceTTC ?? line.unitPriceSnapshot;
  const undiscounted = serverLineTotals(appliedUnitPriceTTC, line.taxRateSnapshot, line.quantity, 0);
  if (undiscounted.grossHT <= 0) return { ok: true, discountRate: 0 };
  // The cart prices a line TTC-first (lib/driver-line-totals.ts): totalTTC = unit TTC x quantity,
  // totalHT = roundMoney(totalTTC / (1 + VAT)). That is NOT unit HT x quantity: for some prices the two
  // differ by one cent (20 DH x 2: 33.33 against 16.67 x 2 = 33.34). A line whose stored totals are exactly
  // what the cart computes with no discount is an undiscounted line - checking it against the HT gross alone
  // wrongly sent it to the reconstruction below, which then refused the sale.
  if (
    Math.abs(line.totalTTC - undiscounted.totalTTC) <= NO_DISCOUNT_EPSILON &&
    Math.abs(line.totalHT - undiscounted.totalHT) <= NO_DISCOUNT_EPSILON
  ) {
    return { ok: true, discountRate: 0 };
  }
  if (Math.abs(line.totalHT - undiscounted.grossHT) <= NO_DISCOUNT_EPSILON) {
    return { ok: true, discountRate: 0 };
  }

  const rate = roundMoney(Math.min(100, Math.max(0, (1 - line.totalHT / undiscounted.grossHT) * 100)));
  const check = serverLineTotals(appliedUnitPriceTTC, line.taxRateSnapshot, line.quantity, rate);
  if (
    Math.abs(check.totalHT - line.totalHT) <= VERIFY_TOLERANCE &&
    Math.abs(check.totalTTC - line.totalTTC) <= VERIFY_TOLERANCE
  ) {
    return { ok: true, discountRate: rate };
  }
  return unreadable;
}

export type SyncSaleBody = {
  clientMutationId: string;
  localReference: string;
  soldAt: string;
  customerId: string | null;
  paymentMethod: OfflineSaleWithLines["paymentMethod"];
  expectedTotalTTC: number;
  /** Commercial rounding of the ticket (lib/sale-rounding.ts), signed; absent on a legacy sale. */
  roundingAmount?: number;
  lines: Array<{
    productId: string;
    quantity: number;
    unitPriceTTC: number;
    priceToken: string | null;
    discountRate: number;
    /** Only when the driver typed a price for the line (0 allowed); absent = catalogue price. */
    customUnitPriceTTC?: number;
  }>;
};

export type SyncPayloadResult = { ok: true; body: SyncSaleBody } | { ok: false; message: string };

export function buildSyncPayload(sale: OfflineSaleWithLines): SyncPayloadResult {
  const lines: SyncSaleBody["lines"] = [];
  for (const line of sale.lines) {
    const discount = resolveLineDiscountRate(line);
    if (!discount.ok) return { ok: false, message: discount.message };
    lines.push({
      productId: line.productId,
      quantity: line.quantity,
      unitPriceTTC: line.unitPriceSnapshot,
      priceToken: line.priceToken,
      discountRate: discount.discountRate,
      ...(line.customUnitPriceTTC != null ? { customUnitPriceTTC: line.customUnitPriceTTC } : {}),
    });
  }
  return {
    ok: true,
    body: {
      clientMutationId: sale.clientMutationId,
      localReference: sale.localReference,
      soldAt: sale.soldAt,
      customerId: sale.customerId,
      paymentMethod: sale.paymentMethod,
      expectedTotalTTC: sale.totalTTC,
      // Only a sale made with the rounding carries one (even 0): the server then
      // applies the rounding. A sale saved before has none and keeps its cent total.
      ...(sale.roundingAmount !== undefined ? { roundingAmount: sale.roundingAmount } : {}),
      lines,
    },
  };
}
