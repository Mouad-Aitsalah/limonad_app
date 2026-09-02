import "server-only";

import { z } from "zod";

import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { computePriceTTC } from "@/lib/product-pricing";
import {
  computeCashSaleStampAmount,
  postSaleAccountingEntry,
} from "@/lib/server/accounting";
import { getPosCustomerPreload } from "@/lib/server/customers";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import {
  mapSaleToDto,
  nextInvoiceNumber,
  nextMovementNumber,
  nextPaymentNumber,
  normalizeSaleLines,
  resolvePaymentAmounts,
  resolveSaleSequencing,
  roundMoney,
  saleInclude,
} from "@/lib/server/sales-shared";
import type {
  CounterPosContextDto,
  CounterSaleInput,
  DriverPosProductDto,
  SaleDto,
} from "@/types/operations-dto";

const counterSaleSchema = z.object({
  customerId: z.string().trim().nullable().optional(),
  paymentMethod: z.enum(["CASH", "CARD", "CHECK", "BANK_TRANSFER", "CREDIT", "MIXED"]),
  // F8-D: input-level sanity bound only, not the real protection - a value
  // right at this bound can still overflow once combined with other lines/
  // tax (see assertMoneyRange calls below, the actual gate).
  paidAmount: z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
  reference: z.string().trim().nullable().optional(),
  stampAmount: z.coerce.number().min(0).optional(),
  // Client-generated, stable for one logical sale attempt (see
  // components/pos - the POS form keeps the same key across a network retry
  // and only mints a new one when a fresh sale starts). Optional so a caller
  // that never sends one keeps today's behavior exactly (no idempotency
  // protection, same as before this change).
  idempotencyKey: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .optional()
    .transform((value) => value || null),
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        // F8-D: sanity bound - a quantity this large is already absurd for
        // one sale line, well before it could combine with a plausible unit
        // price to overflow Decimal(12,2) (that overflow is caught on the
        // computed amount by assertMoneyRange below regardless).
        quantity: z.coerce.number().int().positive().max(1_000_000),
        discountRate: z.coerce.number().min(0).max(100).optional(),
      }),
    )
    .min(1, "Ajoutez au moins un produit."),
});

// Phase 3: the POS product grid preloads this many sellable products for
// instant, zero-round-trip local search - the realistic case (a depot
// stocking a few hundred SKUs at most) never notices the cap. Beyond it,
// productsTruncated tells the frontend to fall back to
// GET /api/products/search?locationId=... (searchPosProducts) instead of
// silently hiding products the cap couldn't fit. See the Phase 3 report:
// unbounded, this query took 76s/82MB at 100000 stocked products.
const POS_PRODUCT_LIST_LIMIT = 500;

export async function getCounterPosContext(): Promise<CounterPosContextDto> {
  const sessionUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const user = await prisma.user.findFirst({
    where: { id: sessionUser.id, organizationId: sessionUser.organizationId },
    select: {
      id: true,
      fullName: true,
      depotId: true,
      depot: { select: { id: true, code: true, name: true, active: true } },
    },
  });
  if (!user?.depotId || !user.depot || !user.depot.active) {
    throw new OperationsServiceError("Aucun depot actif n'est associe a votre compte. Contactez un administrateur.", 409);
  }

  const stockLocation = await prisma.stockLocation.findFirst({
    where: {
      depotId: user.depotId,
      organizationId: sessionUser.organizationId,
    },
    select: { id: true, code: true, name: true, active: true, type: true },
  });
  if (!stockLocation || stockLocation.type !== "DEPOT" || !stockLocation.active) {
    throw new OperationsServiceError("Emplacement depot introuvable.", 404);
  }

  const [levels, customers] = await Promise.all([
    prisma.stockLevel.findMany({
      where: {
        organizationId: sessionUser.organizationId,
        locationId: stockLocation.id,
        quantity: { gt: 0 },
        product: { status: "ACTIVE" },
      },
      include: {
        product: {
          select: {
            id: true,
            reference: true,
            barcode: true,
            name: true,
            imageUrl: true,
            salePrice: true,
            taxRate: true,
          },
        },
      },
      orderBy: { product: { name: "asc" } },
      take: POS_PRODUCT_LIST_LIMIT + 1,
    }),
    // Phase 3: bounded preload (recent customers + the org's "COUNTER"/
    // walk-in customer, always guaranteed present since it's the default
    // pre-selected customer below) instead of every customer in the
    // organization - see getPosCustomerPreload's doc comment and the
    // Phase 3 report. Anything beyond this small set is reached through
    // the customer combobox's GET /api/customers/search fallback.
    getPosCustomerPreload({ organizationId: sessionUser.organizationId, guaranteeType: "COUNTER" }),
  ]);

  const productsTruncated = levels.length > POS_PRODUCT_LIST_LIMIT;
  const pageLevels = productsTruncated ? levels.slice(0, POS_PRODUCT_LIST_LIMIT) : levels;
  const products: DriverPosProductDto[] = pageLevels.map((level) => {
    const salePriceHT = level.product.salePrice.toNumber();
    const taxRate = level.product.taxRate.toNumber();

    return {
      id: level.product.id,
      reference: level.product.reference,
      barcode: level.product.barcode,
      name: level.product.name,
      imageUrl: level.product.imageUrl,
      salePriceHT,
      salePriceTTC: computePriceTTC(salePriceHT, taxRate),
      taxRate,
      availableQuantity: level.quantity - level.reservedQuantity,
    };
  });

  return {
    canSell: products.length > 0,
    message: products.length > 0 ? undefined : "Aucun produit n'est disponible dans ce depot.",
    user: { id: user.id, name: user.fullName },
    depot: { id: user.depot.id, code: user.depot.code, name: user.depot.name },
    stockLocation: { id: stockLocation.id, code: stockLocation.code, name: stockLocation.name },
    customers,
    products,
    productsTruncated,
  };
}

export async function createCounterSale(input: CounterSaleInput): Promise<SaleDto> {
  const sessionUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

  const parsed = counterSaleSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError("Certains champs sont invalides.", 422);
  }
  const lines = normalizeSaleLines(parsed.data.lines);

  const sale = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
      // Idempotency check first, before any other read: a retried request
      // (network retry, double-click that got through the client guard
      // anyway) carrying the same key must return the sale already created
      // for it instead of creating a second one. organizationId always comes
      // from the authenticated session, never from the client, so one
      // organization can never look up - let alone reuse - another
      // organization's idempotency key.
      if (parsed.data.idempotencyKey) {
        const existingSale = await tx.sale.findFirst({
          where: {
            organizationId: sessionUser.organizationId,
            idempotencyKey: parsed.data.idempotencyKey,
          },
          include: saleInclude,
        });
        if (existingSale) return existingSale;
      }

      const user = await tx.user.findFirst({
        where: {
          id: sessionUser.id,
          organizationId: sessionUser.organizationId,
        },
        select: {
          id: true,
          depotId: true,
          depot: { select: { id: true, active: true } },
        },
      });
      if (!user?.depotId || !user.depot?.active) {
        throw new OperationsServiceError(
          "Aucun depot actif n'est associe a votre compte. Contactez un administrateur.",
          409,
        );
      }

      const stockLocation = await tx.stockLocation.findFirst({
        where: {
          depotId: user.depotId,
          organizationId: sessionUser.organizationId,
        },
        select: { id: true, type: true, active: true },
      });
      if (!stockLocation || stockLocation.type !== "DEPOT" || !stockLocation.active) {
        throw new OperationsServiceError("Emplacement depot introuvable.", 404);
      }

      const customer = parsed.data.customerId
        ? await tx.customer.findFirst({
            where: {
              id: parsed.data.customerId,
              organizationId: sessionUser.organizationId,
            },
            select: {
              id: true,
              status: true,
              creditLimit: true,
              currentBalance: true,
            },
          })
        : null;
      if (parsed.data.customerId && !customer) {
        throw new OperationsServiceError("Client introuvable.", 404);
      }
      if (customer && customer.status !== "ACTIVE") {
        throw new OperationsServiceError("Client inactif ou bloque.", 409);
      }

      const productIds = lines.map((line) => line.productId);
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          organizationId: sessionUser.organizationId,
          status: "ACTIVE",
        },
        select: {
          id: true,
          salePrice: true,
          taxRate: true,
        },
      });
      if (products.length !== productIds.length) {
        throw new OperationsServiceError("Un produit est introuvable.", 422);
      }

      const computedLines = lines.map((line) => {
        const product = products.find((item) => item.id === line.productId);
        if (!product) throw new OperationsServiceError("Produit introuvable.", 422);
        const unitPriceHT = product.salePrice.toNumber();
        const discountRate = line.discountRate ?? 0;
        // F8-D: grossHT is a raw multiplication (unitPriceHT x quantity),
        // checked before rounding/further use - a large-but-otherwise-valid
        // quantity times a large unit price is exactly the case a bound on
        // quantity alone would miss (see lib/money.ts#isWithinMoneyRange).
        const grossHT = unitPriceHT * line.quantity;
        assertMoneyRange(unitPriceHT, "line.unitPriceHT");
        assertMoneyRange(grossHT, "line.grossHT");
        const discountAmount = roundMoney(grossHT * (discountRate / 100));
        const totalHT = roundMoney(grossHT - discountAmount);
        const taxRate = product.taxRate.toNumber();
        const taxAmount = roundMoney(totalHT * (taxRate / 100));
        const totalTTC = roundMoney(totalHT + taxAmount);
        assertMoneyRange(discountAmount, "line.discountAmount");
        assertMoneyRange(totalHT, "line.totalHT");
        assertMoneyRange(taxAmount, "line.taxAmount");
        assertMoneyRange(totalTTC, "line.totalTTC");
        return {
          ...line,
          unitPriceHT,
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
      // F8-D: aggregate totals, checked before any write in this
      // transaction (stock decrement is the first one, further below).
      assertMoneyRange(subtotalHT, "subtotalHT");
      assertMoneyRange(discountAmount, "discountAmount");
      assertMoneyRange(taxAmount, "taxAmount");
      assertMoneyRange(totalTTC, "totalTTC");
      const stampAmount = await computeCashSaleStampAmount(tx, {
        organizationId: sessionUser.organizationId,
        totalTTC,
        paymentMethod: parsed.data.paymentMethod,
      });
      assertMoneyRange(stampAmount.toNumber(), "stampAmount");

      const payment = resolvePaymentAmounts(
        parsed.data.paymentMethod,
        totalTTC,
        parsed.data.paidAmount,
      );
      assertMoneyRange(payment.paidAmount, "paidAmount");
      assertMoneyRange(payment.creditAmount, "creditAmount");
      if (payment.creditAmount > 0 && !customer) {
        throw new OperationsServiceError("Client obligatoire pour une vente a credit.", 422);
      }
      if (customer && payment.creditAmount > 0) {
        const nextBalance = customer.currentBalance.toNumber() + payment.creditAmount;
        if (nextBalance > customer.creditLimit.toNumber()) {
          throw new OperationsServiceError("Plafond de credit depasse.", 409);
        }
      }

      for (const line of computedLines) {
        const level = await tx.stockLevel.findUnique({
          where: {
            productId_locationId: {
              productId: line.productId,
              locationId: stockLocation.id,
            },
          },
        });
        const available = (level?.quantity ?? 0) - (level?.reservedQuantity ?? 0);
        if (!level || available < line.quantity) {
          throw new OperationsServiceError("Stock depot insuffisant.", 422);
        }
        await tx.stockLevel.update({
          where: { id: level.id },
          data: { quantity: { decrement: line.quantity } },
        });
      }

      const saleDate = new Date();
      const sequencing = await resolveSaleSequencing(
        tx,
        saleDate,
        sessionUser.id,
        sessionUser.organizationId,
      );

      const sale = await tx.sale.create({
        data: {
          organizationId: sessionUser.organizationId,
          invoiceNumber: await nextInvoiceNumber(tx, "CTR", sessionUser.organizationId),
          saleYear: sequencing.saleYear,
          saleNumber: sequencing.saleNumber,
          posSessionId: sequencing.posSessionId,
          origin: "COUNTER",
          status:
            payment.creditAmount === totalTTC
              ? "CREDIT"
              : payment.creditAmount > 0
                ? "PARTIALLY_PAID"
                : "PAID",
          customerId: customer?.id ?? null,
          depotId: user.depotId,
          driverId: null,
          truckId: null,
          tourId: null,
          stockLocationId: stockLocation.id,
          subtotalHT,
          discountAmount,
          taxAmount,
          totalTTC,
          stampAmount,
          paidAmount: payment.paidAmount,
          creditAmount: payment.creditAmount,
          paymentMethod: parsed.data.paymentMethod,
          createdByUserId: sessionUser.id,
          validatedAt: new Date(),
          idempotencyKey: parsed.data.idempotencyKey,
          lines: {
            create: computedLines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitPriceHT: line.unitPriceHT,
              discountRate: line.discountRate,
              discountAmount: line.discountAmount,
              taxRate: line.taxRate,
              taxAmount: line.taxAmount,
              totalHT: line.totalHT,
              totalTTC: line.totalTTC,
            })),
          },
        },
        select: { id: true, invoiceNumber: true },
      });

      const createdPayment =
        payment.paidAmount > 0
          ? await tx.payment.create({
              data: {
                organizationId: sessionUser.organizationId,
                paymentNumber: await nextPaymentNumber(tx, sessionUser.organizationId),
                saleId: sale.id,
                amount: payment.paidAmount,
                method:
                  parsed.data.paymentMethod === "CREDIT" ? "CASH" : parsed.data.paymentMethod,
                status: "VALIDATED",
                reference: parsed.data.reference ?? null,
                receivedByUserId: sessionUser.id,
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
        organizationId: sessionUser.organizationId,
        saleId: sale.id,
        invoiceNumber: sale.invoiceNumber,
        customerId: customer?.id ?? null,
        date: new Date(),
        subtotalHT,
        taxAmount,
        totalTTC,
        stampAmount,
        paidAmount: payment.paidAmount,
        creditAmount: payment.creditAmount,
        paymentMethod: parsed.data.paymentMethod,
        paymentId: createdPayment?.id ?? null,
        paymentReference: createdPayment?.reference ?? null,
        createdByUserId: sessionUser.id,
      });

      for (const line of computedLines) {
        await tx.stockMovement.create({
          data: {
            organizationId: sessionUser.organizationId,
            movementNumber: await nextMovementNumber(tx, sessionUser.organizationId),
            type: "COUNTER_SALE",
            productId: line.productId,
            quantity: line.quantity,
            sourceLocationId: stockLocation.id,
            destinationLocationId: null,
            referenceType: "SALE",
            referenceId: sale.id,
            reason: `Vente ${sale.invoiceNumber}`,
            createdByUserId: sessionUser.id,
            status: "VALIDATED",
          },
        });
      }

      return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: saleInclude });
      },
      // 15s: this transaction chains several sequential lookups plus the
      // accounting entry posting, which can exceed Prisma's 5s default
      // interactive-transaction timeout (P2028) against Neon's serverless
      // connection latency, even with no real conflict (same fix already
      // applied to the equivalent driver-sales.ts transaction).
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  );

  return mapSaleToDto(sale);
}

// Same pattern as lib/server/stock-movements.ts's withSerializableRetry, but
// retrying P2002 as well as P2034: under true simultaneous requests carrying
// the same idempotencyKey, Postgres Serializable isolation is expected to
// resolve the race as a P2034 (see the idempotency check above, re-run on
// retry it will then see the winner's already-committed row) - but the
// unique index on (organizationId, idempotencyKey) is the last line of
// defense, so a P2002 on that index is retried the same way instead of
// surfacing as an error: the retried attempt's find-first-by-key check will
// then return the row the other request just committed.
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
        (prismaError.code === "P2010" &&
          /40001|40P01/.test(prismaError.message ?? ""));
      if (!isRetryable || attempt >= maxAttempts) {
        throw error;
      }
      // Jittered backoff: under N-way true-simultaneous contention on the
      // same counter row, retrying instantly just re-collides with the same
      // herd (empirically verified: without this, 50-100-way concurrent
      // reserveDocumentSequence() calls exhausted immediate retries - see
      // scripts/_tmp-test-real-generators.ts in the Phase 3 numbering
      // chantier report).
      await sleep(Math.min(800, 10 * 1.5 ** attempt) * (0.5 + Math.random()));
    }
  }

  throw new OperationsServiceError("Impossible de finaliser la vente.", 500);
}
