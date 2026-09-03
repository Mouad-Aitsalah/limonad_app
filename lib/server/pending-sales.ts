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
  mapSaleToDto,
  nextInvoiceNumber,
  nextPaymentNumber,
  posDayStart,
  resolvePaymentAmounts,
  saleInclude,
} from "@/lib/server/sales-shared";
import type { SaleDto } from "@/types/operations-dto";

/**
 * Phase POS-PRACTICAL - "Factures du jour en attente d'encaissement".
 *
 * A sale is prepared with createCounterSale/createDriverSale({ collectNow:
 * false }): a real, server-persisted Sale row with status DRAFT, a
 * provisional "BR-YYYYMMDD-NNNNNN" reference, its stock already moved and a
 * COUNTER_SALE / TRUCK_SALE StockMovement - but no Payment, no accounting
 * entry, no official number. It shows in "Factures du jour" until collected.
 *
 * collect*Sale() then does the deferred half, once, atomically:
 *   - assigns the real invoiceNumber + saleYear/saleNumber (the official
 *     sequences are only ever spent here, never by an abandoned draft);
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
  paymentMethod: z.enum(["CASH", "CARD", "CHECK", "BANK_TRANSFER", "CREDIT", "MIXED"]),
  paidAmount: z.coerce.number().min(0).optional(),
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
        const sale = await tx.sale.findFirst({
          where: {
            id: saleId,
            organizationId,
            origin: scope.origin,
            ...(scope.origin === "TRUCK" ? { driverId: scope.driverId } : {}),
          },
          include: saleInclude,
        });
        if (!sale) throw new OperationsServiceError("Facture introuvable.", 404);

        // Idempotent: already collected (double-click, reload during
        // collect, a retried request) - return it untouched, never a second
        // payment / movement / number.
        if (sale.status !== "DRAFT") {
          return sale;
        }

        const totalTTC = sale.totalTTC.toNumber();
        const payment = resolvePaymentAmounts(paymentMethod, totalTTC, parsed.data.paidAmount);

        if (payment.creditAmount > 0 && !sale.customerId) {
          throw new OperationsServiceError("Client obligatoire pour une vente a credit.", 422);
        }
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
          if (payment.creditAmount > 0) {
            if (customer.currentBalance + payment.creditAmount > customer.creditLimit) {
              throw new OperationsServiceError("Plafond de credit depasse.", 409);
            }
          }
        }

        const stampAmount = await computeCashSaleStampAmount(tx, {
          organizationId,
          totalTTC,
          paymentMethod,
        });

        const year = new Date().getFullYear();
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
        const saleNumber = await reserveDocumentSequence(
          tx,
          organizationId,
          DocumentType.Sale,
          String(year),
        );

        const createdPayment =
          payment.paidAmount > 0
            ? await tx.payment.create({
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
            saleYear: year,
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
      { isolationLevel: "Serializable", timeout: 15000 },
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
