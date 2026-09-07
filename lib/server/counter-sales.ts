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
  createMixedPayments,
  mapSaleToDto,
  nextInvoiceNumber,
  nextMovementNumber,
  nextPaymentNumber,
  nextPendingSaleRef,
  normalizeSaleLines,
  resolveMixedPaymentSplit,
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
  // CARD removed: bank-card payments are no longer accepted for new sales
  // at the counter POS (old CARD sales stay fully readable - see
  // types/pos.ts's own comment on this decision).
  paymentMethod: z.enum(["CASH", "CHECK", "BANK_TRANSFER", "CREDIT", "MIXED"]),
  // F8-D: input-level sanity bound only, not the real protection - a value
  // right at this bound can still overflow once combined with other lines/
  // tax (see assertMoneyRange calls below, the actual gate).
  paidAmount: z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
  // MIXED-only: cash+cheque split covering the full total - see
  // resolveMixedPaymentSplit in sales-shared.ts.
  cashAmount: z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
  chequeAmount: z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
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

  const [productRows, customers] = await Promise.all([
    // Source of truth for POS visibility = every ACTIVE product of the
    // organisation, NOT "what has a stock row at this depot". A product
    // never received/loaded here (no StockLevel row) must still be sellable
    // - the stock is only information, never a visibility filter, and
    // negative sales are allowed. minimumStock is never a filter either.
    // Still bounded (take LIMIT + 1 -> productsTruncated -> the search
    // fallback), same as before.
    prisma.product.findMany({
      where: { organizationId: sessionUser.organizationId, status: "ACTIVE" },
      select: {
        id: true,
        reference: true,
        barcode: true,
        name: true,
        imageUrl: true,
        salePrice: true,
        taxRate: true,
      },
      orderBy: { name: "asc" },
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

  const productsTruncated = productRows.length > POS_PRODUCT_LIST_LIMIT;
  const pageProducts = productsTruncated
    ? productRows.slice(0, POS_PRODUCT_LIST_LIMIT)
    : productRows;

  const levels = pageProducts.length
    ? await prisma.stockLevel.findMany({
        where: {
          organizationId: sessionUser.organizationId,
          locationId: stockLocation.id,
          productId: { in: pageProducts.map((product) => product.id) },
        },
        select: { productId: true, quantity: true, reservedQuantity: true },
      })
    : [];
  const levelByProductId = new Map(levels.map((level) => [level.productId, level]));

  const products: DriverPosProductDto[] = pageProducts.map((product) => {
    const salePriceHT = product.salePrice.toNumber();
    const taxRate = product.taxRate.toNumber();
    const level = levelByProductId.get(product.id);

    return {
      id: product.id,
      reference: product.reference,
      barcode: product.barcode,
      name: product.name,
      imageUrl: product.imageUrl,
      salePriceHT,
      salePriceTTC: computePriceTTC(salePriceHT, taxRate),
      taxRate,
      // No stock row at this depot -> shown as 0 (still sellable).
      availableQuantity: level ? level.quantity - level.reservedQuantity : 0,
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

export async function createCounterSale(
  input: CounterSaleInput,
  opts: { collectNow?: boolean } = {},
): Promise<SaleDto> {
  const sessionUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  // collectNow (default true) keeps today's behaviour exactly: create + pay
  // + validate in one atomic shot. collectNow:false = "Préparer la facture":
  // a persisted DRAFT sale carrying a provisional "BR-..." reference, with
  // stock already moved and a COUNTER_SALE StockMovement, but NO payment, NO
  // accounting entry and NO official invoice/sale number - those are all
  // assigned later by collectCounterSale (lib/server/pending-sales.ts).
  const collectNow = opts.collectNow !== false;

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
      //
      // P2028 audit: a plain findFirst with `include: saleInclude` here
      // fires ~9 extra round trips to resolve every relation (customer,
      // depot, driver+user, truck, tour, createdBy, lines+product,
      // payments) EVEN WHEN NO ROW MATCHES - which is the overwhelming
      // common case (a brand-new idempotencyKey on every normal sale). A
      // cheap existence check first (one tiny query) means that cost is
      // only ever paid on a genuine retry/double-submit, not on every sale.
      if (parsed.data.idempotencyKey) {
        const existingSaleId = await tx.sale.findFirst({
          where: {
            organizationId: sessionUser.organizationId,
            idempotencyKey: parsed.data.idempotencyKey,
          },
          select: { id: true },
        });
        if (existingSaleId) {
          return tx.sale.findUniqueOrThrow({
            where: { id: existingSaleId.id },
            include: saleInclude,
          });
        }
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
          purchasePrice: true,
        },
      });
      if (products.length !== productIds.length) {
        throw new OperationsServiceError("Un produit est introuvable.", 422);
      }

      const computedLines = lines.map((line) => {
        const product = products.find((item) => item.id === line.productId);
        if (!product) throw new OperationsServiceError("Produit introuvable.", 422);
        const unitPriceHT = product.salePrice.toNumber();
        // BI Phase 2A: snapshot of the cost of the day, frozen on the line
        // forever - see SaleLine.unitCostHT's doc comment. Never touched
        // again by collectSaleCore (DRAFT -> PAID/CREDIT only updates the
        // Sale row, never SaleLine).
        const unitCostHT = product.purchasePrice.toNumber();
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

      // A pending (not-yet-collected) sale has no payment split and no credit
      // exposure yet - the payment method is only chosen at collection.
      // mixedSplit is kept as its own fully-typed variable (rather than a
      // union member of `payment`) so cashAmount/chequeAmount stay type-safe
      // wherever they're read below, with no "in" narrowing on a union.
      const mixedSplit =
        collectNow && parsed.data.paymentMethod === "MIXED"
          ? resolveMixedPaymentSplit(totalTTC, parsed.data.cashAmount, parsed.data.chequeAmount)
          : null;
      const payment =
        mixedSplit ??
        (collectNow
          ? resolvePaymentAmounts(parsed.data.paymentMethod, totalTTC, parsed.data.paidAmount)
          : { paidAmount: 0, creditAmount: 0 });
      assertMoneyRange(payment.paidAmount, "paidAmount");
      assertMoneyRange(payment.creditAmount, "creditAmount");
      if (collectNow && payment.creditAmount > 0 && !customer) {
        // A partly-paid MIXED sale leaves a receivable, so a customer is
        // mandatory - same hard rule as a pure CREDIT sale (audit: the
        // seeded "Client Comptoir" is itself a real, followable Customer
        // row, and customer.type is not a reliable "generic walk-in"
        // marker on this data, so no type-based block).
        throw new OperationsServiceError(
          parsed.data.paymentMethod === "MIXED"
            ? "Veuillez selectionner un client pour enregistrer le reste a credit."
            : "Client obligatoire pour une vente a credit.",
          422,
        );
      }
      if (collectNow && customer && payment.creditAmount > 0) {
        const nextBalance = customer.currentBalance.toNumber() + payment.creditAmount;
        if (nextBalance > customer.creditLimit.toNumber()) {
          throw new OperationsServiceError("Plafond de credit depasse.", 409);
        }
      }

      // Negative stock is an explicit business choice for COUNTER sales:
      // a sale is never blocked because its quantity exceeds the depot
      // StockLevel. The decrement still runs exactly as before (and the
      // COUNTER_SALE StockMovement below is unchanged), so StockLevel simply
      // goes negative and a later inventory/adjustment reconciles it.
      // Guards for transfers, loadings, inventories and adjustments are
      // untouched - only the sale path allows this.
      for (const line of computedLines) {
        await tx.stockLevel.upsert({
          where: {
            productId_locationId: {
              productId: line.productId,
              locationId: stockLocation.id,
            },
          },
          update: { quantity: { decrement: line.quantity } },
          create: {
            organizationId: sessionUser.organizationId,
            productId: line.productId,
            locationId: stockLocation.id,
            quantity: -line.quantity,
            reservedQuantity: 0,
          },
        });
      }

      const saleDate = new Date();
      // The commercial number (saleNumber/saleYear -> "N/YYYY") is reserved
      // NOW, at sale creation, whether or not the sale is collected in the
      // same call: a prepared-but-not-yet-collected sale already carries its
      // definitive reference (see SaleDto.displayNumber). Collection reuses
      // it and never re-reserves. `invoiceNumber` stays a throwaway BR- ref
      // for an uncollected draft (internal only), swapped for the real VC-
      // number at collection.
      const sequencing = await resolveSaleSequencing(
        tx,
        saleDate,
        sessionUser.id,
        sessionUser.organizationId,
      );
      const invoiceNumber = collectNow
        ? await nextInvoiceNumber(tx, "CTR", sessionUser.organizationId)
        : await nextPendingSaleRef(tx, sessionUser.organizationId);

      const sale = await tx.sale.create({
        data: {
          organizationId: sessionUser.organizationId,
          invoiceNumber,
          saleYear: sequencing.saleYear,
          saleNumber: sequencing.saleNumber,
          posSessionId: sequencing.posSessionId,
          origin: "COUNTER",
          status: collectNow
            ? payment.creditAmount === totalTTC
              ? "CREDIT"
              : payment.creditAmount > 0
                ? "PARTIALLY_PAID"
                : "PAID"
            : "DRAFT",
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
          stampAmount: collectNow ? stampAmount : 0,
          paidAmount: payment.paidAmount,
          creditAmount: payment.creditAmount,
          paymentMethod: parsed.data.paymentMethod,
          createdByUserId: sessionUser.id,
          validatedAt: collectNow ? new Date() : null,
          idempotencyKey: parsed.data.idempotencyKey,
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
        select: { id: true, invoiceNumber: true },
      });

      // Payment, customer-balance movement and the accounting entry only
      // ever happen for a collected sale. A pending DRAFT sale carries none
      // of them until collectCounterSale runs.
      const createdPayment =
        collectNow && payment.paidAmount > 0
          ? mixedSplit
            ? await createMixedPayments(tx, {
                organizationId: sessionUser.organizationId,
                saleId: sale.id,
                cashAmount: mixedSplit.cashAmount,
                chequeAmount: mixedSplit.chequeAmount,
                reference: parsed.data.reference ?? null,
                receivedByUserId: sessionUser.id,
              })
            : await tx.payment.create({
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
      if (collectNow && customer && payment.creditAmount > 0) {
        await tx.customer.update({
          where: { id: customer.id },
          data: { currentBalance: { increment: payment.creditAmount } },
        });
      }

      if (collectNow) {
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
          paymentSplit: mixedSplit
            ? { cashAmount: mixedSplit.cashAmount, chequeAmount: mixedSplit.chequeAmount }
            : null,
          paymentId: createdPayment?.id ?? null,
          paymentReference: createdPayment?.reference ?? null,
          createdByUserId: sessionUser.id,
        });
      }

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
      // P2028 audit (POS timeout chantier, 2026-09-05): this budget was
      // raised from 15000 to 20000ms only AFTER cutting this transaction's
      // own round-trip count by ~43% (82 -> ~47 queries for a MIXED sale,
      // measured with PRISMA_DEBUG_QUERIES=1 against the real
      // org-comdis-principal org - see that chantier's report for the full
      // query-by-query breakdown). That optimization alone took typical
      // wall time from ~15-24s (frequently exceeding 15000ms) down to
      // ~9-13s. The remaining 5000ms is headroom against this dev
      // machine's own observed Neon round-trip variance (individual
      // queries occasionally spiking to 1-8s instead of their usual
      // ~150-200ms, independent of query count) - a live browser test
      // still hit one 25.3s outlier even after optimization, which a
      // higher budget absorbs without disguising any remaining
      // inefficiency (the query count itself is already lean). Not raised
      // further: an even larger budget would start masking genuine
      // problems rather than tolerating normal network jitter, which is
      // exactly what this chantier's own instructions warned against.
      { isolationLevel: "Serializable", timeout: 20000 },
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
