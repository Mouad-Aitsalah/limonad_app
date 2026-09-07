import "server-only";

import { z } from "zod";

import { addMoney, MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import {
  computeCashSaleStampAmount,
  postSaleAccountingEntry,
  reverseAccountingEntryForSource,
} from "@/lib/server/accounting";
import { computeCustomerDebt } from "@/lib/server/customer-settlements";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import {
  createMixedPayments,
  mapSaleToDto,
  nextMovementNumber,
  nextPaymentNumber,
  normalizeSaleLines,
  resolveMixedPaymentSplit,
  resolvePaymentAmounts,
  roundMoney,
  saleInclude,
} from "@/lib/server/sales-shared";
import type { SaleDto } from "@/types/operations-dto";

/**
 * Admin-only business operations on an already-created Sale, driven from
 * /ventes. Phase 1: cancellation (`cancelSale`). Every effect the sale ever
 * had - stock, payments, the customer credit balance and the accounting
 * entries - is undone in ONE Serializable transaction, and the Sale row is
 * KEPT with status CANCELLED (never hard-deleted, even for a DRAFT): its
 * commercial number stays reserved forever and the invoice remains visible
 * in the history for traceability. An AuditLog row records who did it.
 */

const cancelSchema = z.object({
  // Optimistic-lock token: the Sale.updatedAt the client last saw. When it
  // no longer matches, another admin changed the sale meanwhile - refuse
  // rather than act on a stale view.
  expectedUpdatedAt: z.string().trim().min(1).nullable().optional(),
});

// Every non-terminal status a sale can be cancelled from. DRAFT included:
// a prepared counter/driver sale has already moved stock and reserved a
// number, so it is cancelled the same way (just with no accounting entry
// to reverse). CANCELLED / CREDIT_NOTED are terminal here.
const CANCELLABLE_STATUSES = new Set([
  "DRAFT",
  "VALIDATED",
  "PARTIALLY_PAID",
  "PAID",
  "CREDIT",
]);

const REVISABLE_STATUSES = CANCELLABLE_STATUSES;

const PAYMENT_METHODS = ["CASH", "CHECK", "BANK_TRANSFER", "CREDIT", "MIXED"] as const;

const reviseSchema = z.object({
  customerId: z.string().trim().nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paidAmount: z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
  cashAmount: z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
  chequeAmount: z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
  reference: z.string().trim().nullable().optional(),
  expectedUpdatedAt: z.string().trim().min(1).nullable().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.coerce.number().int().positive().max(1_000_000),
        discountRate: z.coerce.number().min(0).max(100).optional(),
      }),
    )
    .min(1, "Ajoutez au moins un produit."),
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 40,
): Promise<T> {
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
  throw new OperationsServiceError("Impossible d'annuler la facture.", 500);
}

export async function cancelSale(saleId: string, input: unknown): Promise<SaleDto> {
  const sessionUser = await requireOrganizationUser(["admin", "super_admin"]);
  const parsed = cancelSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new OperationsServiceError("Requete invalide.", 422);
  }
  const expectedUpdatedAt = parsed.data.expectedUpdatedAt ?? null;

  const cancelled = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: { id: saleId, organizationId: sessionUser.organizationId },
          include: {
            lines: { select: { productId: true, quantity: true } },
            payments: { select: { id: true } },
          },
        });
        if (!sale) throw new OperationsServiceError("Facture introuvable.", 404);

        // §29 - concurrent edit guard.
        if (expectedUpdatedAt && sale.updatedAt.toISOString() !== expectedUpdatedAt) {
          throw new OperationsServiceError(
            "Cette facture a ete modifiee entre-temps. Rechargez-la.",
            409,
          );
        }
        if (sale.status === "CANCELLED") {
          throw new OperationsServiceError("Cette facture est deja annulee.", 409);
        }
        if (!CANCELLABLE_STATUSES.has(sale.status)) {
          throw new OperationsServiceError(
            "Cette facture ne peut pas etre annulee dans son etat actuel.",
            409,
          );
        }

        // A validated customer credit note tied to this sale must be undone
        // first - otherwise its stock/ledger effects would be left dangling.
        const linkedCreditNote = await tx.creditNote.findFirst({
          where: {
            organizationId: sessionUser.organizationId,
            originalSaleId: sale.id,
            status: "VALIDATED",
          },
          select: { creditNoteNumber: true },
        });
        if (linkedCreditNote) {
          throw new OperationsServiceError(
            `Un avoir valide (${linkedCreditNote.creditNoteNumber}) est rattache a cette facture. Contre-passez d'abord l'avoir.`,
            409,
          );
        }

        // The part of this sale that currently feeds the customer's real
        // (computed) debt - only CREDIT / PARTIALLY_PAID sales contribute.
        const saleCreditContribution =
          sale.status === "CREDIT" || sale.status === "PARTIALLY_PAID"
            ? sale.creditAmount.toNumber()
            : 0;

        // §22 - a later customer settlement (or credit note) may already
        // cover part of this credit. Cancelling must never push the client
        // into a credit balance; when it would, refuse and let the admin
        // regularise it explicitly first.
        if (sale.customerId && saleCreditContribution > 0) {
          const breakdown = await computeCustomerDebt(
            tx,
            sessionUser.organizationId,
            sale.customerId,
          );
          const rawAfter = roundMoney(
            breakdown.creditSalesTotal -
              breakdown.creditNotesTotal -
              breakdown.settlementsTotal -
              saleCreditContribution,
          );
          if (rawAfter < -0.005) {
            throw new OperationsServiceError(
              `Cette facture a recu des reglements clients ulterieurs. Son annulation rendrait le solde du client crediteur de ${roundMoney(-rawAfter).toFixed(2)} DH. Enregistrez d'abord un avoir ou un remboursement.`,
              409,
            );
          }
        }

        // 1. Stock - restore exactly what each original sale movement took,
        //    append a REVERSAL movement (same pattern as a credit-note
        //    reversal), and flip the original to REVERSED.
        const originalMovements = await tx.stockMovement.findMany({
          where: {
            organizationId: sessionUser.organizationId,
            referenceType: "SALE",
            referenceId: sale.id,
            status: "VALIDATED",
          },
        });
        for (const movement of originalMovements) {
          const locationId = movement.sourceLocationId ?? sale.stockLocationId;
          await tx.stockLevel.upsert({
            where: {
              productId_locationId: { productId: movement.productId, locationId },
            },
            update: { quantity: { increment: movement.quantity } },
            create: {
              organizationId: sessionUser.organizationId,
              productId: movement.productId,
              locationId,
              quantity: movement.quantity,
              reservedQuantity: 0,
            },
          });
          await tx.stockMovement.create({
            data: {
              organizationId: sessionUser.organizationId,
              movementNumber: await nextMovementNumber(tx, sessionUser.organizationId),
              type: "REVERSAL",
              productId: movement.productId,
              quantity: movement.quantity,
              sourceLocationId: null,
              destinationLocationId: locationId,
              referenceType: "SALE_CANCELLATION",
              referenceId: sale.id,
              reason: `Annulation facture ${sale.invoiceNumber}`,
              createdByUserId: sessionUser.id,
              status: "VALIDATED",
              reversedMovementId: movement.id,
            },
          });
          await tx.stockMovement.update({
            where: { id: movement.id },
            data: { status: "REVERSED" },
          });
        }

        // 2. Payments - kept for history, flagged REVERSED.
        if (sale.payments.length > 0) {
          await tx.payment.updateMany({
            where: { saleId: sale.id },
            data: { status: "REVERSED" },
          });
        }

        // 3. Accounting - contra entries for the invoice entry and each
        //    settlement entry. Idempotent and a safe no-op when the sale had
        //    no entry yet (an uncollected DRAFT).
        await reverseAccountingEntryForSource(tx, {
          organizationId: sessionUser.organizationId,
          sourceType: "SALE",
          sourceId: sale.id,
          date: new Date(),
          reference: sale.invoiceNumber,
          description: `Annulation facture ${sale.invoiceNumber}`,
          createdByUserId: sessionUser.id,
        });
        for (const payment of sale.payments) {
          await reverseAccountingEntryForSource(tx, {
            organizationId: sessionUser.organizationId,
            sourceType: "CUSTOMER_PAYMENT",
            sourceId: payment.id,
            date: new Date(),
            reference: sale.invoiceNumber,
            description: `Annulation encaissement facture ${sale.invoiceNumber}`,
            createdByUserId: sessionUser.id,
          });
        }

        // 4. Customer credit-balance cache (the real debt is recomputed from
        //    Sale.creditAmount + status, which the CANCELLED flip below
        //    already removes - this only keeps the operational cache honest).
        if (sale.customerId && saleCreditContribution > 0) {
          await tx.customer.update({
            where: { id: sale.customerId },
            data: { currentBalance: { decrement: saleCreditContribution } },
          });
        }

        // 5. The sale itself - number, lines and links all preserved.
        await tx.sale.update({
          where: { id: sale.id },
          data: { status: "CANCELLED" },
        });

        // 6. Audit trail.
        await tx.auditLog.create({
          data: {
            organizationId: sessionUser.organizationId,
            userId: sessionUser.id,
            action: "SALE_CANCELLED",
            entityType: "Sale",
            entityId: sale.id,
            oldValue: {
              status: sale.status,
              totalTTC: sale.totalTTC.toNumber(),
              paidAmount: sale.paidAmount.toNumber(),
              creditAmount: sale.creditAmount.toNumber(),
              paymentMethod: sale.paymentMethod,
            },
            newValue: { status: "CANCELLED" },
          },
        });

        return tx.sale.findUniqueOrThrow({
          where: { id: sale.id },
          include: saleInclude,
        });
      },
      { isolationLevel: "Serializable", timeout: 20000 },
    ),
  );

  return mapSaleToDto(cancelled);
}

/**
 * Admin-only edit of an existing counter sale (Phase 2), driven from
 * /pos?editSaleId=. Keeps the SAME commercial number / invoiceNumber and,
 * in ONE Serializable transaction:
 *   - reverses every original SALE stock movement and re-applies the new
 *     lines (net StockLevel change = the delta only);
 *   - contre-passes the previous accounting entries (invoice + each
 *     settlement) and posts a fresh corrected POSTED entry that KEEPS
 *     sourceType = SALE / sourceId = <saleId> (partial unique index);
 *   - flags the old Payment rows REVERSED and creates the new ones;
 *   - recomputes the customer credit balance from the delta;
 *   - refuses (409) if the change would push the customer into credit, or
 *     breach an enabled credit ceiling, or if the sale is not in a revisable
 *     state / not a counter sale / has a validated credit note;
 *   - refuses (409) on a stale `expectedUpdatedAt` (concurrent edit);
 *   - writes an AuditLog SALE_REVISED row (before/after snapshot).
 * Historical per-unit economics (unitPriceHT / unitCostHT / taxRate) of a
 * product already on the sale are preserved; a product added during the
 * edit is priced from the current catalog.
 */
export async function reviseSale(saleId: string, input: unknown): Promise<SaleDto> {
  const sessionUser = await requireOrganizationUser(["admin", "super_admin"]);
  const parsed = reviseSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new OperationsServiceError("Certains champs sont invalides.", 422);
  }
  const data = parsed.data;
  const expectedUpdatedAt = data.expectedUpdatedAt ?? null;
  const newLines = normalizeSaleLines(
    data.lines.map((line) => ({ ...line, discountRate: line.discountRate ?? 0 })),
  );

  const revised = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: { id: saleId, organizationId: sessionUser.organizationId },
          include: {
            lines: true,
            payments: { select: { id: true } },
          },
        });
        if (!sale) throw new OperationsServiceError("Facture introuvable.", 404);

        if (expectedUpdatedAt && sale.updatedAt.toISOString() !== expectedUpdatedAt) {
          throw new OperationsServiceError(
            "Cette facture a ete modifiee entre-temps. Rechargez-la.",
            409,
          );
        }
        if (!REVISABLE_STATUSES.has(sale.status)) {
          throw new OperationsServiceError(
            "Cette facture ne peut pas etre modifiee dans son etat actuel.",
            409,
          );
        }
        if (sale.origin !== "COUNTER") {
          throw new OperationsServiceError(
            "Seules les ventes comptoir peuvent etre modifiees ici.",
            409,
          );
        }

        const linkedCreditNote = await tx.creditNote.findFirst({
          where: {
            organizationId: sessionUser.organizationId,
            originalSaleId: sale.id,
            status: "VALIDATED",
          },
          select: { creditNoteNumber: true },
        });
        if (linkedCreditNote) {
          throw new OperationsServiceError(
            `Un avoir valide (${linkedCreditNote.creditNoteNumber}) est rattache a cette facture. Contre-passez d'abord l'avoir.`,
            409,
          );
        }

        const customer = data.customerId
          ? await tx.customer.findFirst({
              where: { id: data.customerId, organizationId: sessionUser.organizationId },
              select: { id: true, status: true, creditLimit: true, creditLimitEnabled: true },
            })
          : null;
        if (data.customerId && !customer) {
          throw new OperationsServiceError("Client introuvable.", 404);
        }
        if (customer && customer.status !== "ACTIVE") {
          throw new OperationsServiceError("Client inactif ou bloque.", 409);
        }

        const productIds = newLines.map((line) => line.productId);
        const products = await tx.product.findMany({
          where: {
            id: { in: productIds },
            organizationId: sessionUser.organizationId,
            status: "ACTIVE",
          },
          select: { id: true, salePrice: true, taxRate: true, purchasePrice: true },
        });
        if (products.length !== productIds.length) {
          throw new OperationsServiceError("Un produit est introuvable.", 422);
        }

        // Historical economics for a product already on the sale; catalog
        // price for one added during the edit.
        const originalLineByProduct = new Map(sale.lines.map((line) => [line.productId, line]));
        const computedLines = newLines.map((line) => {
          const original = originalLineByProduct.get(line.productId);
          const product = products.find((item) => item.id === line.productId)!;
          const unitPriceHT = original
            ? original.unitPriceHT.toNumber()
            : product.salePrice.toNumber();
          const unitCostHT = original
            ? original.unitCostHT.toNumber()
            : product.purchasePrice.toNumber();
          const taxRate = original ? original.taxRate.toNumber() : product.taxRate.toNumber();
          const discountRate = line.discountRate ?? 0;
          const grossHT = unitPriceHT * line.quantity;
          assertMoneyRange(unitPriceHT, "line.unitPriceHT");
          assertMoneyRange(grossHT, "line.grossHT");
          const discountAmount = roundMoney(grossHT * (discountRate / 100));
          const totalHT = roundMoney(grossHT - discountAmount);
          const taxAmount = roundMoney(totalHT * (taxRate / 100));
          const totalTTC = roundMoney(totalHT + taxAmount);
          assertMoneyRange(discountAmount, "line.discountAmount");
          assertMoneyRange(totalHT, "line.totalHT");
          assertMoneyRange(taxAmount, "line.taxAmount");
          assertMoneyRange(totalTTC, "line.totalTTC");
          return {
            productId: line.productId,
            quantity: line.quantity,
            unitPriceHT,
            unitCostHT,
            discountRate,
            discountAmount,
            taxRate,
            taxAmount,
            totalHT,
            totalTTC,
          };
        });

        const subtotalHT = roundMoney(computedLines.reduce((sum, line) => sum + line.totalHT, 0));
        const discountAmount = roundMoney(
          computedLines.reduce((sum, line) => sum + line.discountAmount, 0),
        );
        const taxAmount = roundMoney(computedLines.reduce((sum, line) => sum + line.taxAmount, 0));
        const totalTTC = roundMoney(subtotalHT + taxAmount);
        assertMoneyRange(subtotalHT, "subtotalHT");
        assertMoneyRange(totalTTC, "totalTTC");

        const isDraft = sale.status === "DRAFT";
        const stampDecimal = await computeCashSaleStampAmount(tx, {
          organizationId: sessionUser.organizationId,
          totalTTC,
          paymentMethod: data.paymentMethod,
        });

        const mixedSplit =
          !isDraft &&
          data.paymentMethod === "MIXED" &&
          data.cashAmount !== undefined &&
          data.chequeAmount !== undefined
            ? resolveMixedPaymentSplit(totalTTC, data.cashAmount, data.chequeAmount)
            : null;
        const payment = isDraft
          ? { paidAmount: 0, creditAmount: 0 }
          : (mixedSplit ??
            resolvePaymentAmounts(data.paymentMethod, totalTTC, data.paidAmount));
        assertMoneyRange(payment.paidAmount, "paidAmount");
        assertMoneyRange(payment.creditAmount, "creditAmount");

        if (!isDraft && payment.creditAmount > 0 && !customer) {
          throw new OperationsServiceError(
            data.paymentMethod === "MIXED"
              ? "Veuillez selectionner un client pour enregistrer le reste a credit."
              : "Client obligatoire pour une vente a credit.",
            422,
          );
        }

        const oldCreditContribution =
          sale.status === "CREDIT" || sale.status === "PARTIALLY_PAID"
            ? sale.creditAmount.toNumber()
            : 0;
        const newStatus = isDraft
          ? "DRAFT"
          : payment.creditAmount === totalTTC
            ? "CREDIT"
            : payment.creditAmount > 0
              ? "PARTIALLY_PAID"
              : "PAID";
        const newCreditContribution =
          newStatus === "CREDIT" || newStatus === "PARTIALLY_PAID" ? payment.creditAmount : 0;
        const customerChanged = (sale.customerId ?? null) !== (customer?.id ?? null);

        // Opt-in credit ceiling - only the NEW credit part, against the real
        // computed debt with this sale's own current contribution removed.
        if (
          !isDraft &&
          customer &&
          customer.creditLimitEnabled &&
          newCreditContribution > 0
        ) {
          const b = await computeCustomerDebt(tx, sessionUser.organizationId, customer.id);
          const removeOld = customerChanged ? 0 : oldCreditContribution;
          const debtExclThisSale = Math.max(
            0,
            roundMoney(
              b.creditSalesTotal - removeOld - b.creditNotesTotal - b.settlementsTotal,
            ),
          );
          if (
            addMoney(debtExclThisSale, newCreditContribution) >
            customer.creditLimit.toNumber()
          ) {
            throw new OperationsServiceError("Plafond de credit depasse.", 409);
          }
        }

        // §7/§8 - the revision must never leave a customer in credit.
        const assertNotOverpaid = async (
          custId: string,
          removeContribution: number,
          addContribution: number,
        ) => {
          const b = await computeCustomerDebt(tx, sessionUser.organizationId, custId);
          const raw = roundMoney(
            b.creditSalesTotal -
              removeContribution +
              addContribution -
              b.creditNotesTotal -
              b.settlementsTotal,
          );
          if (raw < -0.005) {
            throw new OperationsServiceError(
              `Cette modification rendrait le solde du client crediteur de ${roundMoney(-raw).toFixed(2)} DH. Enregistrez d'abord un avoir ou un remboursement.`,
              409,
            );
          }
        };
        if (!isDraft) {
          if (customerChanged) {
            if (sale.customerId && oldCreditContribution > 0) {
              await assertNotOverpaid(sale.customerId, oldCreditContribution, 0);
            }
          } else if (sale.customerId) {
            await assertNotOverpaid(sale.customerId, oldCreditContribution, newCreditContribution);
          }
        }

        // === MUTATIONS ===

        // 1. Reverse every original SALE stock movement, then re-apply the
        //    new lines - net StockLevel change is exactly the delta.
        const originalMovements = await tx.stockMovement.findMany({
          where: {
            organizationId: sessionUser.organizationId,
            referenceType: "SALE",
            referenceId: sale.id,
            status: "VALIDATED",
          },
        });
        for (const movement of originalMovements) {
          const locationId = movement.sourceLocationId ?? sale.stockLocationId;
          await tx.stockLevel.upsert({
            where: { productId_locationId: { productId: movement.productId, locationId } },
            update: { quantity: { increment: movement.quantity } },
            create: {
              organizationId: sessionUser.organizationId,
              productId: movement.productId,
              locationId,
              quantity: movement.quantity,
              reservedQuantity: 0,
            },
          });
          await tx.stockMovement.create({
            data: {
              organizationId: sessionUser.organizationId,
              movementNumber: await nextMovementNumber(tx, sessionUser.organizationId),
              type: "REVERSAL",
              productId: movement.productId,
              quantity: movement.quantity,
              sourceLocationId: null,
              destinationLocationId: locationId,
              referenceType: "SALE_REVISION",
              referenceId: sale.id,
              reason: `Modification facture ${sale.invoiceNumber}`,
              createdByUserId: sessionUser.id,
              status: "VALIDATED",
              reversedMovementId: movement.id,
            },
          });
          await tx.stockMovement.update({
            where: { id: movement.id },
            data: { status: "REVERSED" },
          });
        }
        for (const line of computedLines) {
          await tx.stockLevel.upsert({
            where: {
              productId_locationId: {
                productId: line.productId,
                locationId: sale.stockLocationId,
              },
            },
            update: { quantity: { decrement: line.quantity } },
            create: {
              organizationId: sessionUser.organizationId,
              productId: line.productId,
              locationId: sale.stockLocationId,
              quantity: -line.quantity,
              reservedQuantity: 0,
            },
          });
          await tx.stockMovement.create({
            data: {
              organizationId: sessionUser.organizationId,
              movementNumber: await nextMovementNumber(tx, sessionUser.organizationId),
              type: "COUNTER_SALE",
              productId: line.productId,
              quantity: line.quantity,
              sourceLocationId: sale.stockLocationId,
              destinationLocationId: null,
              referenceType: "SALE",
              referenceId: sale.id,
              reason: `Vente ${sale.invoiceNumber} (modifiee)`,
              createdByUserId: sessionUser.id,
              status: "VALIDATED",
            },
          });
        }

        // 2. Payments - old REVERSED, new created (skipped for a DRAFT).
        if (sale.payments.length > 0) {
          await tx.payment.updateMany({
            where: { saleId: sale.id },
            data: { status: "REVERSED" },
          });
        }
        let newDedupPayment: { id: string; reference: string | null } | null = null;
        if (!isDraft && payment.paidAmount > 0) {
          newDedupPayment = mixedSplit
            ? await createMixedPayments(tx, {
                organizationId: sessionUser.organizationId,
                saleId: sale.id,
                cashAmount: mixedSplit.cashAmount,
                chequeAmount: mixedSplit.chequeAmount,
                reference: data.reference ?? null,
                receivedByUserId: sessionUser.id,
              })
            : await tx.payment.create({
                data: {
                  organizationId: sessionUser.organizationId,
                  paymentNumber: await nextPaymentNumber(tx, sessionUser.organizationId),
                  saleId: sale.id,
                  amount: payment.paidAmount,
                  method: data.paymentMethod === "CREDIT" ? "CASH" : data.paymentMethod,
                  status: "VALIDATED",
                  reference: data.reference ?? null,
                  receivedByUserId: sessionUser.id,
                  receivedAt: new Date(),
                },
                select: { id: true, reference: true },
              });
        }

        // 3. Accounting - contra the previous entries, post the corrected one
        //    keeping SALE / <saleId> (partial unique index allows it).
        if (!isDraft) {
          await reverseAccountingEntryForSource(tx, {
            organizationId: sessionUser.organizationId,
            sourceType: "SALE",
            sourceId: sale.id,
            date: new Date(),
            reference: sale.invoiceNumber,
            description: `Modification facture ${sale.invoiceNumber} - annulation version precedente`,
            createdByUserId: sessionUser.id,
          });
          for (const oldPayment of sale.payments) {
            await reverseAccountingEntryForSource(tx, {
              organizationId: sessionUser.organizationId,
              sourceType: "CUSTOMER_PAYMENT",
              sourceId: oldPayment.id,
              date: new Date(),
              reference: sale.invoiceNumber,
              description: `Modification facture ${sale.invoiceNumber} - annulation reglement precedent`,
              createdByUserId: sessionUser.id,
            });
          }
          await postSaleAccountingEntry(tx, {
            organizationId: sessionUser.organizationId,
            saleId: sale.id,
            invoiceNumber: sale.invoiceNumber,
            customerId: customer?.id ?? null,
            date: new Date(),
            subtotalHT,
            taxAmount,
            totalTTC,
            stampAmount: stampDecimal,
            paidAmount: payment.paidAmount,
            creditAmount: payment.creditAmount,
            paymentMethod: data.paymentMethod,
            paymentSplit: mixedSplit
              ? { cashAmount: mixedSplit.cashAmount, chequeAmount: mixedSplit.chequeAmount }
              : null,
            paymentId: newDedupPayment?.id ?? null,
            paymentReference: newDedupPayment?.reference ?? null,
            createdByUserId: sessionUser.id,
          });
        }

        // 4. Customer credit-balance cache.
        if (customerChanged) {
          if (sale.customerId && oldCreditContribution > 0) {
            await tx.customer.update({
              where: { id: sale.customerId },
              data: { currentBalance: { decrement: oldCreditContribution } },
            });
          }
          if (customer && newCreditContribution > 0) {
            await tx.customer.update({
              where: { id: customer.id },
              data: { currentBalance: { increment: newCreditContribution } },
            });
          }
        } else if (sale.customerId) {
          const delta = roundMoney(newCreditContribution - oldCreditContribution);
          if (delta !== 0) {
            await tx.customer.update({
              where: { id: sale.customerId },
              data: { currentBalance: { increment: delta } },
            });
          }
        }

        // 5. Replace the lines and update the sale - SAME number, SAME
        //    invoiceNumber, SAME saleYear/saleNumber.
        await tx.saleLine.deleteMany({ where: { saleId: sale.id } });
        await tx.sale.update({
          where: { id: sale.id },
          data: {
            customerId: customer?.id ?? null,
            subtotalHT,
            discountAmount,
            taxAmount,
            totalTTC,
            stampAmount: isDraft ? 0 : stampDecimal.toNumber(),
            paidAmount: payment.paidAmount,
            creditAmount: payment.creditAmount,
            paymentMethod: data.paymentMethod,
            status: newStatus,
            lines: {
              create: computedLines.map((line) => ({
                productId: line.productId,
                quantity: line.quantity,
                unitPriceHT: line.unitPriceHT,
                unitCostHT: line.unitCostHT,
                discountRate: line.discountRate,
                discountAmount: line.discountAmount,
                taxRate: line.taxRate,
                taxAmount: line.taxAmount,
                totalHT: line.totalHT,
                totalTTC: line.totalTTC,
              })),
            },
          },
        });

        // 6. Audit trail.
        await tx.auditLog.create({
          data: {
            organizationId: sessionUser.organizationId,
            userId: sessionUser.id,
            action: "SALE_REVISED",
            entityType: "Sale",
            entityId: sale.id,
            oldValue: {
              status: sale.status,
              customerId: sale.customerId,
              totalTTC: sale.totalTTC.toNumber(),
              paidAmount: sale.paidAmount.toNumber(),
              creditAmount: sale.creditAmount.toNumber(),
              paymentMethod: sale.paymentMethod,
              lines: sale.lines.map((line) => ({
                productId: line.productId,
                quantity: line.quantity,
                unitPriceHT: line.unitPriceHT.toNumber(),
                discountRate: line.discountRate.toNumber(),
              })),
            },
            newValue: {
              status: newStatus,
              customerId: customer?.id ?? null,
              totalTTC,
              paidAmount: payment.paidAmount,
              creditAmount: payment.creditAmount,
              paymentMethod: data.paymentMethod,
              lines: computedLines.map((line) => ({
                productId: line.productId,
                quantity: line.quantity,
                unitPriceHT: line.unitPriceHT,
                discountRate: line.discountRate,
              })),
            },
          },
        });

        return tx.sale.findUniqueOrThrow({
          where: { id: sale.id },
          include: saleInclude,
        });
      },
      { isolationLevel: "Serializable", timeout: 20000 },
    ),
  );

  return mapSaleToDto(revised);
}
