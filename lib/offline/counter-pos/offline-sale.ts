"use client";

/**
 * COUNTER POS - turning what is on the POS screen into a local offline sale
 * (Phase 4). Pure functions, no React, no storage: the component gathers its
 * state, these decide whether a sale may be saved offline and what exactly is
 * saved.
 *
 * NO PRICING RULE IS DUPLICATED. The per-line amounts arrive already computed
 * by the POS from lib/pos-discount.ts (`computeDiscountedLineTotals`), exactly
 * as they are shown in the cart; this module only SUMS them the way
 * createCounterSale does (subtotalHT = sum of net HT, tax = sum of line tax,
 * total = subtotal + tax) and refuses anything sales-store would refuse. The
 * ticket is produced by the existing buildPreviewSale.
 *
 * OFFLINE PAYMENT POLICY (a business decision, one constant to change):
 *   CASH            allowed
 *   CHECK           allowed (cheque number kept as the reference)
 *   BANK_TRANSFER   allowed if a 5141 bank account is chosen (the accounts
 *                   come from the cached POS context)
 *   MIXED           allowed ONLY if cash + cheque cover the whole total
 *   CREDIT          NOT allowed. createCounterSale enforces the customer's
 *                   credit ceiling against the real debt, and that can only
 *                   be checked on the server: a credit sale accepted here
 *                   could be refused at sync time AFTER the goods left.
 *                   A MIXED sale that leaves a balance is credit too.
 */

import { addMoney, roundMoney, subtractMoney } from "@/lib/money";
import { buildPreviewSale } from "@/lib/pos-preview-sale";
import type { PosBankAccountOptionDto, SaleDto } from "@/types/operations-dto";
import type { PosPaymentMethodValue } from "@/types/pos";

import type { OfflineSaleInput, OfflineSalePaymentInput } from "./sales-store";
import type {
  CartRecord,
  OfflineSaleWithDetails,
  StoredCartLine,
} from "./schema";

export const OFFLINE_PAYMENT_METHODS: readonly PosPaymentMethodValue[] = [
  "CASH",
  "CHECK",
  "BANK_TRANSFER",
  "MIXED",
];

export function isPaymentMethodAllowedOffline(method: PosPaymentMethodValue): boolean {
  return OFFLINE_PAYMENT_METHODS.includes(method);
}

/** Methods the payment selector must grey out while offline. */
export const OFFLINE_DISABLED_PAYMENT_METHODS: readonly PosPaymentMethodValue[] = ["CREDIT"];

export const OFFLINE_CREDIT_MESSAGE =
  "Le crédit client n'est pas disponible hors connexion : le plafond de crédit ne peut être vérifié qu'à la synchronisation.";

export const OFFLINE_SALE_SAVED_MESSAGE =
  "Vente enregistrée hors connexion — en attente de synchronisation.";

/** The per-line values the POS has already computed (CartLineComputed). */
export type OfflineCartLine = {
  productId: string;
  reference: string;
  designation: string;
  quantity: number;
  unitPriceHT: number;
  tauxTVA: number;
  discountUnitAmount: number;
  priceOverridden?: boolean;
  discountAmount: number;
  netHT: number;
  tvaAmount: number;
  totalTTC: number;
};

export type BuildOfflineSaleParams = {
  depotId: string;
  stockLocationId: string;
  bankAccounts: readonly PosBankAccountOptionDto[];
  lines: readonly OfflineCartLine[];
  customer: { id: string; code: string | null; name: string } | null;
  paymentMethod: PosPaymentMethodValue;
  chequeNumber: string;
  banque: string;
  bankAccountId: string;
  mixedAmounts: { cash: number; cheque: number };
  idempotencyKey: string;
  reservation: { saleNumber: number; saleYear: number } | null;
  soldAt?: string;
  clearCartSlot?: string | null;
};

export type BuildOfflineSaleResult =
  | { ok: true; input: OfflineSaleInput }
  | { ok: false; message: string };

export function buildOfflineSaleInput(params: BuildOfflineSaleParams): BuildOfflineSaleResult {
  const { lines, paymentMethod } = params;
  if (lines.length === 0) return { ok: false, message: "Ajoutez au moins un produit." };

  if (paymentMethod === "CREDIT") return { ok: false, message: OFFLINE_CREDIT_MESSAGE };
  if (!isPaymentMethodAllowedOffline(paymentMethod)) {
    return { ok: false, message: "Ce mode de règlement n'est pas disponible hors connexion." };
  }

  // The same sums createCounterSale makes from its lines.
  const subtotalHT = addMoney(...lines.map((line) => line.netHT));
  const taxAmount = addMoney(...lines.map((line) => line.tvaAmount));
  const discountAmount = addMoney(...lines.map((line) => line.discountAmount));
  const totalTTC = addMoney(subtotalHT, taxAmount);

  let reference: string | null = null;
  let bankAccountingAccountId: string | null = null;
  let payments: OfflineSalePaymentInput[];

  if (paymentMethod === "CASH") {
    payments = [{ method: "CASH", amount: totalTTC }];
  } else if (paymentMethod === "CHECK") {
    reference = params.chequeNumber.trim() || null;
    payments = [{ method: "CHECK", amount: totalTTC, reference }];
  } else if (paymentMethod === "BANK_TRANSFER") {
    const account = params.bankAccounts.find((item) => item.id === params.bankAccountId);
    if (!params.bankAccountId || !account) {
      return {
        ok: false,
        message: "Veuillez sélectionner le compte bancaire qui a reçu le virement.",
      };
    }
    bankAccountingAccountId = account.id;
    reference = params.banque.trim() || null;
    payments = [{ method: "BANK_TRANSFER", amount: totalTTC }];
  } else {
    // MIXED
    const cash = roundMoney(params.mixedAmounts.cash);
    const cheque = roundMoney(params.mixedAmounts.cheque);
    if (!(cash >= 0) || !(cheque >= 0) || cash + cheque <= 0) {
      return { ok: false, message: "Saisissez un montant en espèces ou en chèque." };
    }
    const paid = addMoney(cash, cheque);
    if (paid > totalTTC) return { ok: false, message: "Le montant saisi dépasse le total à régler." };
    if (subtractMoney(totalTTC, paid) !== 0) {
      return {
        ok: false,
        message:
          "Hors connexion, le paiement mixte doit couvrir la totalité du total : le reste à crédit n'est pas disponible.",
      };
    }
    payments = [];
    if (cash > 0) payments.push({ method: "CASH", amount: cash });
    if (cheque > 0) payments.push({ method: "CHECK", amount: cheque });
  }

  const paidAmount = addMoney(...payments.map((payment) => payment.amount));

  return {
    ok: true,
    input: {
      depotId: params.depotId,
      stockLocationId: params.stockLocationId,
      customer: params.customer,
      paymentMethod,
      reference,
      bankAccountingAccountId,
      lines: lines.map((line) => ({
        productId: line.productId,
        productReference: line.reference,
        productName: line.designation,
        quantity: line.quantity,
        unitPriceHT: line.unitPriceHT,
        taxRate: line.tauxTVA,
        discountUnitAmount: line.discountUnitAmount,
        priceOverridden: line.priceOverridden === true,
        discountAmount: line.discountAmount,
        totalHT: line.netHT,
        taxAmount: line.tvaAmount,
        totalTTC: line.totalTTC,
      })),
      payments,
      totals: {
        subtotalHT,
        discountAmount,
        taxAmount,
        totalTTC,
        paidAmount,
        creditAmount: subtractMoney(totalTTC, paidAmount),
      },
      idempotencyKey: params.idempotencyKey,
      reservedSaleNumber: params.reservation?.saleNumber ?? null,
      reservedSaleYear: params.reservation?.saleYear ?? null,
      soldAt: params.soldAt,
      clearCartSlot: params.clearCartSlot ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Ticket
// ---------------------------------------------------------------------------

/**
 * The ticket for a saved offline sale, as the SaleDto the existing
 * <ReceiptPrint> renders. Totals come from buildPreviewSale (the same
 * function the cart's own "Imprimer" uses), not from a second computation.
 *
 * Its number is the LOCAL reference: pass that same value as ReceiptPrint's
 * `offlineReference`, which prints "Référence" and "Numéro définitif attribué
 * après synchronisation". An offline ticket never carries an official number.
 */
export function ticketFromOfflineSale(
  sale: OfflineSaleWithDetails,
  options: {
    cashierName: string;
    bankAccount?: { id: string; code: string; name: string } | null;
  },
): SaleDto {
  const preview = buildPreviewSale({
    displayNumber: sale.localReference,
    createdByUserName: options.cashierName,
    customer: sale.customerId
      ? { id: sale.customerId, code: sale.customerCode ?? "", name: sale.customerName ?? "" }
      : null,
    paymentMethod: sale.paymentMethod,
    bankAccount: options.bankAccount ?? null,
    lines: sale.lines.map((line) => ({
      productId: line.productId,
      productReference: line.productReference,
      productName: line.productName,
      quantity: line.quantity,
      unitPriceHT: line.unitPriceHT,
      discountUnitAmount: line.discountUnitAmount,
      taxRate: line.taxRate,
    })),
  });
  return {
    ...preview,
    id: sale.localId,
    // Money WAS received at the counter; whether the server knows yet is a
    // separate matter that the offline note on the ticket states.
    status: sale.creditAmount > 0 ? (sale.paidAmount > 0 ? "PARTIALLY_PAID" : "CREDIT") : "PAID",
    paidAmount: sale.paidAmount,
    creditAmount: sale.creditAmount,
    createdAt: sale.soldAt,
    payments: sale.payments.map((payment) => ({
      id: payment.id,
      paymentNumber: "",
      amount: payment.amount,
      method: payment.method,
      status: "VALIDATED",
      reference: payment.reference,
      receivedAt: sale.soldAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Cart <-> local record
// ---------------------------------------------------------------------------

export type CartSnapshot = {
  lines: readonly StoredCartLine[];
  customerId: string | null;
  paymentMethod: PosPaymentMethodValue;
  chequeNumber: string;
  banque: string;
  bankAccountId: string;
  mixedAmounts: { cash: number; cheque: number };
  idempotencyKey: string;
  reservation: { saleNumber: number; saleYear: number } | null;
};

/** What saveCart stores for the POS's current cart. */
export function cartInputFromSnapshot(snapshot: CartSnapshot) {
  return {
    lines: snapshot.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      discountUnitAmount: line.discountUnitAmount,
      priceOverrideHT: line.priceOverrideHT ?? null,
    })),
    customerId: snapshot.customerId,
    paymentMethod: snapshot.paymentMethod,
    chequeNumber: snapshot.chequeNumber,
    banque: snapshot.banque,
    bankAccountId: snapshot.bankAccountId,
    mixedCash: snapshot.mixedAmounts.cash,
    mixedCheque: snapshot.mixedAmounts.cheque,
    idempotencyKey: snapshot.idempotencyKey,
    reservedSaleNumber: snapshot.reservation?.saleNumber ?? null,
    reservedSaleYear: snapshot.reservation?.saleYear ?? null,
  };
}

/** The POS state a stored cart restores. `priceOverrideHT` is only set when a
 *  manual price was stored (CartLine's optional field, never `null`). */
export function snapshotFromCartRecord(record: CartRecord): CartSnapshot & {
  lines: Array<{ productId: string; quantity: number; discountUnitAmount: number; priceOverrideHT?: number }>;
} {
  return {
    lines: record.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      discountUnitAmount: line.discountUnitAmount,
      ...(line.priceOverrideHT != null ? { priceOverrideHT: line.priceOverrideHT } : {}),
    })),
    customerId: record.customerId,
    paymentMethod: record.paymentMethod,
    chequeNumber: record.chequeNumber,
    banque: record.banque,
    bankAccountId: record.bankAccountId,
    mixedAmounts: { cash: record.mixedCash, cheque: record.mixedCheque },
    idempotencyKey: record.idempotencyKey,
    reservation:
      record.reservedSaleNumber != null && record.reservedSaleYear != null
        ? { saleNumber: record.reservedSaleNumber, saleYear: record.reservedSaleYear }
        : null,
  };
}
