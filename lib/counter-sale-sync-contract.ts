import { z } from "zod";

import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import type { CounterSaleInput } from "@/types/operations-dto";

/**
 * PHASE 5 - the wire contract of POST /api/sales/sync and the rebuild of the
 * CounterSaleInput from it. Free of server-only imports so it can be unit
 * tested; used by lib/server/counter-sales-sync.ts.
 */

const money = z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER);

export const counterSaleSyncSchema = z.object({
  localId: z.string().trim().min(1).max(120),
  idempotencyKey: z.string().trim().min(1).max(120),
  organizationId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  deviceId: z.string().trim().max(120).optional(),
  localReference: z.string().trim().max(120).optional(),
  soldAt: z.string().trim().max(40).optional(),
  customerId: z.string().trim().min(1).nullable(),
  paymentMethod: z.enum(["CASH", "CHECK", "BANK_TRANSFER", "MIXED"]),
  reference: z.string().trim().max(200).nullable().optional(),
  bankAccountingAccountId: z.string().trim().nullable().optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(["CASH", "CHECK", "BANK_TRANSFER"]),
        amount: money,
        reference: z.string().trim().nullable().optional(),
      }),
    )
    .min(1)
    .max(4),
  totals: z.object({ totalTTC: money, paidAmount: money, creditAmount: money }),
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.coerce.number().int().positive().max(1_000_000),
        discountUnitAmount: money,
        /** Present only for a manual price (honoured for an admin only). */
        unitPriceHT: z.coerce.number().positive().max(MONEY_RANGE_MAX_NUMBER).optional(),
      }),
    )
    .min(1)
    .max(500),
  reservedSaleNumber: z.coerce.number().int().positive().nullable().optional(),
  reservedSaleYear: z.coerce.number().int().positive().nullable().optional(),
});

export type CounterSaleSyncPayload = z.infer<typeof counterSaleSyncSchema>;

/** The exact body POST /api/sales would have received for this sale. */
export function buildCounterSaleInput(payload: CounterSaleSyncPayload): CounterSaleInput {
  const base = {
    customerId: payload.customerId,
    paymentMethod: payload.paymentMethod,
    reference: payload.reference ?? null,
    idempotencyKey: payload.idempotencyKey,
    lines: payload.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      discountUnitAmount: line.discountUnitAmount,
      ...(line.unitPriceHT !== undefined ? { unitPriceHT: line.unitPriceHT } : {}),
    })),
    ...(payload.reservedSaleNumber && payload.reservedSaleYear
      ? {
          reservedSaleNumber: payload.reservedSaleNumber,
          reservedSaleYear: payload.reservedSaleYear,
        }
      : {}),
  };

  if (payload.paymentMethod === "BANK_TRANSFER") {
    return { ...base, bankAccountingAccountId: payload.bankAccountingAccountId ?? null } as CounterSaleInput;
  }
  if (payload.paymentMethod === "MIXED") {
    const sum = (method: "CASH" | "CHECK") =>
      Math.round(
        payload.payments.filter((p) => p.method === method).reduce((total, p) => total + p.amount, 0) * 100,
      ) / 100;
    return { ...base, cashAmount: sum("CASH"), chequeAmount: sum("CHECK") } as CounterSaleInput;
  }
  return base as CounterSaleInput;
}

