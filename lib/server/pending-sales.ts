import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  computeCashSaleStampAmount,
  postSaleAccountingEntry,
} from "@/lib/server/accounting";
import { OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import {
  createMixedPayments,
  mapSaleToDto,
  nextInvoiceNumber,
  nextPaymentNumber,
  posDayStart,
  resolveMixedPaymentSplit,
  resolvePaymentAmounts,
  saleInclude,
} from "@/lib/server/sales-shared";
import type { SaleDto } from "@/types/operations-dto";

/**
 * Phase POS-PRACTICAL - "Factures du jour en attente d'encaissement".
 *
 * A sale is prepared with createCounterSale/createDriverSale({ collectNow:
 * false }): a real, server-persisted Sale row with status DRAFT, its stock
 * already moved and a COUNTER_SALE / TRUCK_SALE StockMovement - but no
 * Payment, no accounting entry. A COUNTER draft is created with its
 * definitive commercial number already reserved (saleNumber/saleYear ->
 * "N/YYYY"); only its internal reference is provisional ("BR-YYYYMMDD-
 * NNNNNN" in invoiceNumber). It shows in "Factures du jour" until collected.
 * A COUNTER draft that is never collected therefore leaves a gap in the
 * per-year Sale sequence, exactly like a cancelled sale would - the number
 * is never recycled.
 *
 * collect*Sale() then does the deferred half, once, atomically:
 *   - swaps the provisional BR- ref for the real VC- invoiceNumber, and
 *     keeps the commercial saleNumber/saleYear already on the sale (only a
 *     legacy draft with saleNumber still null gets one reserved here);
 *   - records the Payment and, for a credit split, the customer balance;
 *   - posts the sale accounting entry;
 *   - flips status DRAFT -> PAID / PARTIALLY_PAID / CREDIT with validatedAt.
 * It never touches stock and never creates a second StockMovement. A second
 * call on an already-collected sale is a no-op that returns the sale as-is
 * (double-click / reload-during-collect safe).
 *
 * SERVER_PENDING (this - a Sale row, status DRAFT, has an id and a "BR-"
 * ref) is a different concept from a future offline queue's
 * LOCAL_PENDING_SYNC (a browser-only record keyed by a localOperationId,
 * never a Sale row until it syncs). They never share an identifier or a
 * status value.
 */

const collectSchema = z.object({
  // CARD removed: see counter-sales.ts's counterSaleSchema comment - no new
  // collection (counter or driver) may settle as CARD anymore.
  paymentMethod: z.enum(["CASH", "CHECK", "BANK_TRANSFER", "CREDIT", "MIXED"]),
  paidAmount: z.coerce.number().min(0).optional(),
  // Counter-POS MIXED only - see resolveMixedPaymentSplit. The driver POS
  // never sends these and keeps using the legacy single-paidAmount MIXED
  // behaviour via resolvePaymentAmounts below.
  cashAmount: z.coerce.number().min(0).optional(),
  chequeAmount: z.coerce.number().min(0).optional(),
  reference: z.string().trim().nullable().optional(),
});

export type CollectPendingSaleInput = z.infer<typeof collectSchema>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 40): Promise<T> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      const prismaError = error as { code?: string; message?: string };
      attempt += 1;
      const isRetryable =
        ["P2002", "P2034"].includes(prismaError.code ?? "") ||
        (prismaError.code === "P2010" && /40001|40P01/.test(prismaError.message ?? ""));
      if (!isRetryable || attempt >= maxAttempts) throw error;
      await sleep(Math.min(800, 10 * 1.5 ** attempt) * (0.5 + Math.random()));
    }
  }
  throw new OperationsServiceError("Impossible d'encaisser la facture.", 500);
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listPendingCounterSales(): Promise<SaleDto[]> {
  const sessionUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const user = await prisma.user.findFirst({
    where: { id: sessionUser.id, organizationId: sessionUser.organizationId },
    select: { depotId: true },
  });
  if (!user?.depotId) return [];

  const sales = await prisma.sale.findMany({
    where: {
      organizationId: sessionUser.organizationId,
      origin: "COUNTER",
      status: "DRAFT",
      depotId: user.depotId,
      createdAt: { gte: posDayStart() },
    },
    include: saleInclude,
    orderBy: { createdAt: "asc" },
  });
  return sales.map(mapSaleToDto);
}

export async function listPendingDriverSales(): Promise<SaleDto[]> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId) return [];

  const sales = await prisma.sale.findMany({
    where: {
      organizationId: user.organizationId,
      origin: "TRUCK",
      status: "DRAFT",
      driverId: user.driverId,
      createdAt: { gte: posDayStart() },
    },
    include: saleInclude,
    orderBy: { createdAt: "asc" },
  });
  return sales.map(mapSaleToDto);
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

type CollectScope =
  | { origin: "COUNTER" }
  | { origin: "TRUCK"; driverId: string };

async function collectSaleCore(
  saleId: string,
  input: unknown,
  organizationId: string,
  collectedByUserId: string,
  scope: CollectScope,
): Promise<SaleDto> {
  const parsed = collectSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError("Certains champs sont invalides.", 422);
  }
  const { paymentMethod } = parsed.data;

  const collected = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        // P2028 audit: a findFirst with `include: saleInclude` here fires
        // ~9 extra round trips to resolve every relation (customer, depot,
        // driver+user, truck, tour, createdBy, lines+product, payments) -
        // but the actual collection logic below only ever reads this sale's
        // own scalar fields (status/totalTTC/subtotalHT/taxAmount/
        // customerId). The full include is only genuinely needed for the
        // rare "already collected" early-return path, which now re-fetches
        // it there instead of paying that cost on every normal collection.
        const sale = await tx.sale.findFirst({
          where: {
            id: saleId,
            organizationId,
            origin: scope.origin,
            ...(scope.origin === "TRUCK" ? { driverId: scope.driverId } : {}),
          },
          select: {
            id: true,
            status: true,
            totalTTC: true,
            subtotalHT: true,
            taxAmount: true,
            customerId: true,
            saleNumber: true,
            saleYear: true,
          },
        });
        if (!sale) throw new OperationsServiceError("Facture introuvable.", 404);

        // Idempotent: already collected (double-click, reload during
        // collect, a retried request) - return it untouched, never a second
        // payment / movement / number.
        if (sale.status !== "DRAFT") {
          return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: saleInclude });
        }

        const totalTTC = sale.totalTTC.toNumber();
        // The counter POS always sends both split fields together for
        // MIXED; the driver POS never sends either and keeps the legacy
        // single-paidAmount behaviour (see collectSchema's own comment).
        // mixedSplit is its own fully-typed variable (not a union member of
        // `payment`) so cashAmount/chequeAmount stay type-safe below.
        const mixedSplit =
          paymentMethod === "MIXED" &&
          parsed.data.cashAmount !== undefined &&
          parsed.data.chequeAmount !== undefined
            ? resolveMixedPaymentSplit(totalTTC, parsed.data.cashAmount, parsed.data.chequeAmount)
            : null;
        const payment =
          mixedSplit ?? resolvePaymentAmounts(paymentMethod, totalTTC, parsed.data.paidAmount);

        let customer: { id: string; currentBalance: number; creditLimit: number } | null = null;
        if (sale.customerId) {
          const row = await tx.customer.findFirst({
            where: { id: sale.customerId, organizationId },
            select: { id: true, status: true, currentBalance: true, creditLimit: true },
          });
          if (!row) throw new OperationsServiceError("Client introuvable.", 404);
          if (row.status !== "ACTIVE") {
            throw new OperationsServiceError("Client inactif ou bloque.", 409);
          }
          customer = {
            id: row.id,
            currentBalance: row.currentBalance.toNumber(),
            creditLimit: row.creditLimit.toNumber(),
          };
        }

        if (payment.creditAmount > 0) {
          // Same hard rule as createCounterSale: a partly-paid MIXED sale
          // leaves a receivable, so a customer is mandatory.
          if (!customer) {
            throw new OperationsServiceError(
              paymentMethod === "MIXED"
                ? "Veuillez selectionner un client pour enregistrer le reste a credit."
                : "Client obligatoire pour une vente a credit.",
              422,
            );
          }
          if (customer.currentBalance + payment.creditAmount > customer.creditLimit) {
            throw new OperationsServiceError("Plafond de credit depasse.", 409);
          }
        }

        const stampAmount = await computeCashSaleStampAmount(tx, {
          organizationId,
          totalTTC,
          paymentMethod,
        });

        const scopeCode =
          scope.origin === "COUNTER"
            ? "CTR"
            : (
                await tx.driver.findFirst({
                  where: { id: scope.driverId, organizationId },
                  select: { employeeCode: true },
                })
              )?.employeeCode ?? "TRK";
        const invoiceNumber = await nextInvoiceNumber(tx, scopeCode, organizationId);
        // The commercial number is assigned at sale creation now - keep the
        // one this sale already has; only reserve one here for a legacy
        // draft that predates that change (saleNumber still null). Collection
        // never changes an already-attributed "N/YYYY".
        const saleYear = sale.saleYear ?? new Date().getFullYear();
        const saleNumber =
          sale.saleNumber ??
          (await reserveDocumentSequence(
            tx,
            organizationId,
            DocumentType.Sale,
            String(saleYear),
          ));

        const createdPayment =
          payment.paidAmount > 0
            ? mixedSplit
              ? await createMixedPayments(tx, {
                  organizationId,
                  saleId: sale.id,
                  cashAmount: mixedSplit.cashAmount,
                  chequeAmount: mixedSplit.chequeAmount,
                  reference: parsed.data.reference ?? null,
                  receivedByUserId: collectedByUserId,
                })
              : await tx.payment.create({
                  data: {
                    organizationId,
                    paymentNumber: await nextPaymentNumber(tx, organizationId),
                    saleId: sale.id,
                    amount: payment.paidAmount,
                    method: paymentMethod === "CREDIT" ? "CASH" : paymentMethod,
                    status: "VALIDATED",
                    reference: parsed.data.reference ?? null,
                    receivedByUserId: collectedByUserId,
                    receivedAt: new Date(),
                  },
                  select: { id: true, reference: true },
                })
            : null;

        if (customer && payment.creditAmount > 0) {
          await tx.customer.update({
            where: { id: customer.id },
            data: { currentBalance: { increment: payment.creditAmount } },
          });
        }

        await postSaleAccountingEntry(tx, {
          organizationId,
          saleId: sale.id,
          invoiceNumber,
          customerId: sale.customerId,
          date: new Date(),
          subtotalHT: sale.subtotalHT.toNumber(),
          taxAmount: sale.taxAmount.toNumber(),
          totalTTC,
          stampAmount,
          paidAmount: payment.paidAmount,
          creditAmount: payment.creditAmount,
          paymentSplit: mixedSplit
            ? { cashAmount: mixedSplit.cashAmount, chequeAmount: mixedSplit.chequeAmount }
            : null,
          paymentMethod,
          paymentId: createdPayment?.id ?? null,
          paymentReference: createdPayment?.reference ?? null,
          createdByUserId: collectedByUserId,
        });

        await tx.sale.update({
          where: { id: sale.id },
          data: {
            status:
              payment.creditAmount === totalTTC
                ? "CREDIT"
                : payment.creditAmount > 0
                  ? "PARTIALLY_PAID"
                  : "PAID",
            paymentMethod,
            paidAmount: payment.paidAmount,
            creditAmount: payment.creditAmount,
            stampAmount,
            invoiceNumber,
            saleYear,
            saleNumber,
            validatedAt: new Date(),
          },
        });

        // Retag the stock movement(s) already written at prepare time with
        // the now-official number (no new movement, no stock change).
        await tx.stockMovement.updateMany({
          where: { organizationId, referenceType: "SALE", referenceId: sale.id },
          data: { reason: `Vente ${invoiceNumber}` },
        });

        return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: saleInclude });
      },
      // Raised from 15000 to 20000ms alongside the same fix in
      // counter-sales.ts's createCounterSale - see that file's own comment
      // for the full justification (P2028 audit, 2026-09-05): a ~43%
      // round-trip reduction was applied first (this collect transaction
      // shares the same idempotency-check and accounting-posting
      // optimizations), this extra headroom only covers genuine leftover
      // Neon latency variance, not remaining inefficiency.
      { isolationLevel: "Serializable", timeout: 20000 },
    ),
  );

  return mapSaleToDto(collected);
}

export async function collectCounterSale(
  saleId: string,
  input: unknown,
): Promise<SaleDto> {
  const sessionUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  return collectSaleCore(saleId, input, sessionUser.organizationId, sessionUser.id, {
    origin: "COUNTER",
  });
}

export async function collectDriverSale(saleId: string, input: unknown): Promise<SaleDto> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId) throw new OperationsServiceError("Profil chauffeur introuvable.", 403);
  return collectSaleCore(saleId, input, user.organizationId, user.id, {
    origin: "TRUCK",
    driverId: user.driverId,
  });
}
