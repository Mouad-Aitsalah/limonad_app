import "server-only";

import { z } from "zod";

import { businessDayRangeUtc, getCurrentBusinessDayParam } from "@/lib/business-day";
import { addMoney, MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { computePriceTTC } from "@/lib/product-pricing";
import {
  computeCashSaleStampAmount,
  listActiveBankAccountOptions,
  postSaleAccountingEntry,
  resolveSaleTransferBankAccountId,
} from "@/lib/server/accounting";
import { computeCustomerDebt } from "@/lib/server/customer-settlements";
import { getPosCustomerPreload } from "@/lib/server/customers";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { markCustomerDeliveredOnTour } from "@/lib/server/driver-tour";
import { signOfflinePrice, verifyOfflinePriceToken } from "@/lib/server/offline-price-token";
import {
  mapSaleToDto,
  nextInvoiceNumber,
  nextMovementNumber,
  nextPaymentNumber,
  nextPendingSaleRef,
  normalizeSaleLines,
  resolvePaymentAmounts,
  resolvePosSession,
  resolveSaleSequencing,
  roundMoney,
  saleInclude,
} from "@/lib/server/sales-shared";
import type {
  DriverPosContextDto,
  DriverSaleInput,
  DriverTodaySalesDto,
  DriverTourSalesSummaryDto,
  SaleDto,
} from "@/types/operations-dto";

const driverSaleSchema = z.object({
  customerId: z.string().trim().nullable().optional(),
  // CARD removed: see counter-sales.ts's counterSaleSchema comment.
  paymentMethod: z.enum(["CASH", "CHECK", "BANK_TRANSFER", "CREDIT", "MIXED"]),
  // F8-D: input-level sanity bound only, not the real protection - a value
  // right at this bound can still overflow once combined with other lines/
  // tax (see assertMoneyRange calls below, the actual gate).
  paidAmount: z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
  reference: z.string().trim().nullable().optional(),
  // BANK_TRANSFER only: the chosen active 5141 account. Mandatory for a
  // collected bank-transfer sale (validated below + at posting).
  bankAccountingAccountId: z.string().trim().nullable().optional(),
  stampAmount: z.coerce.number().min(0).optional(),
  // Same idempotency contract as counter-sales.ts's counterSaleSchema - see
  // the comment there.
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

// Phase 3: same cap/rationale as counter-sales.ts's POS_PRODUCT_LIST_LIMIT -
// see that file's doc comment and the Phase 3 report.
const POS_PRODUCT_LIST_LIMIT = 500;

export async function getDriverPosContext(
  initialCustomerId?: string | null,
): Promise<DriverPosContextDto> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId) {
    return blockedContext("Aucun camion n'est affecte a votre compte.", {
      id: "",
      name: user.nom,
    });
  }

  const driver = await prisma.driver.findFirst({
    where: { id: user.driverId, organizationId: user.organizationId },
    select: {
      id: true,
      active: true,
      user: { select: { fullName: true } },
      truck: {
        select: {
          id: true,
          code: true,
          registration: true,
          status: true,
          stockLocation: {
            select: { id: true, type: true, code: true, name: true, active: true },
          },
        },
      },
    },
  });
  if (!driver || !driver.active) {
    return blockedContext("Profil chauffeur introuvable.", { id: user.driverId, name: user.nom });
  }
  if (!driver.truck) {
    return blockedContext("Aucun camion n'est affecte a votre compte.", {
      id: driver.id,
      name: driver.user.fullName,
    });
  }

  const activeTour = await prisma.tour.findFirst({
    where: {
      organizationId: user.organizationId,
      driverId: driver.id,
      truckId: driver.truck.id,
      status: "IN_PROGRESS",
    },
    select: {
      id: true,
      code: true,
      status: true,
    },
    orderBy: { startedAt: "desc" },
  });
  if (
    !driver.truck.stockLocation ||
    driver.truck.stockLocation.type !== "TRUCK" ||
    !driver.truck.stockLocation.active
  ) {
    return blockedContext("Stock camion introuvable.", {
      id: driver.id,
      name: driver.user.fullName,
    }, driver.truck, activeTour);
  }

  const [productRows, customers, bankAccounts] = await Promise.all([
    // Same rule as the counter POS: visibility = every ACTIVE product the
    // driver is allowed to sell, NOT "what has a stock row on this truck".
    // A product not (yet) loaded on the truck (no StockLevel row) is still
    // shown and sellable at 0 / negative. Bounded (LIMIT + 1 -> truncated
    // -> search fallback). minimumStock is never a filter.
    prisma.product.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      select: {
        id: true,
        reference: true,
        barcode: true,
        name: true,
        imageUrl: true,
        salePrice: true,
        taxRate: true,
        defaultSupplierId: true,
        defaultSupplier: { select: { name: true } },
      },
      orderBy: { name: "asc" },
      take: POS_PRODUCT_LIST_LIMIT + 1,
    }),
    // Phase 3: bounded preload (recent customers this driver is allowed to
    // see, plus initialCustomerId - e.g. a tour-visit deep link's
    // ?customerId=... - guaranteed present even if it falls outside that
    // recency window) instead of every customer this driver can see. See
    // getPosCustomerPreload's doc comment and the Phase 3 report. Anything
    // beyond this small set is reached through the customer combobox's
    // GET /api/customers/search fallback, transparently scoped the same
    // way for a driver session.
    getPosCustomerPreload({
      organizationId: user.organizationId,
      extraWhere: {
        OR: [{ creationOrigin: "ADMIN" }, { createdByDriverId: driver.id }],
      },
      guaranteeCustomerId: initialCustomerId,
    }),
    listActiveBankAccountOptions(prisma, user.organizationId),
  ]);

  const productsTruncated = productRows.length > POS_PRODUCT_LIST_LIMIT;
  const pageProducts = productsTruncated
    ? productRows.slice(0, POS_PRODUCT_LIST_LIMIT)
    : productRows;

  const levels = pageProducts.length
    ? await prisma.stockLevel.findMany({
        where: {
          organizationId: user.organizationId,
          locationId: driver.truck.stockLocation.id,
          productId: { in: pageProducts.map((product) => product.id) },
        },
        select: { productId: true, quantity: true, reservedQuantity: true },
      })
    : [];
  const levelByProductId = new Map(levels.map((level) => [level.productId, level]));

  const canSell = Boolean(activeTour) && pageProducts.length > 0;
  const message = !activeTour
    ? "Demarrez votre tournee avant de vendre."
    : pageProducts.length > 0
      ? undefined
      : "Aucun produit actif n'est disponible.";

  return {
    canSell,
    message,
    driver: { id: driver.id, name: driver.user.fullName },
    truck: driver.truck,
    tour: activeTour,
    customers: customers.filter((customer) => customer.status === "ACTIVE"),
    stockLocationId: driver.truck.stockLocation.id,
    productsTruncated,
    bankAccounts,
    products: pageProducts.map((product) => {
      const salePriceHT = product.salePrice.toNumber();
      const taxRate = product.taxRate.toNumber();
      const salePriceTTC = computePriceTTC(salePriceHT, taxRate);
      const level = levelByProductId.get(product.id);

      return {
        id: product.id,
        reference: product.reference,
        barcode: product.barcode,
        name: product.name,
        imageUrl: product.imageUrl,
        salePriceHT,
        salePriceTTC,
        taxRate,
        // No stock row on this truck -> shown as 0 (still sellable).
        availableQuantity: level ? level.quantity - level.reservedQuantity : 0,
        supplierId: product.defaultSupplierId,
        supplierName: product.defaultSupplier?.name ?? null,
        // PHASE 4A.1 - see offline-price-token.ts's own doc comment. Issued
        // fresh on every context fetch (online only) - the offline cache
        // just carries whatever it was last given.
        priceToken: signOfflinePrice({
          organizationId: user.organizationId,
          productId: product.id,
          unitPriceTTC: salePriceTTC,
        }),
      };
    }),
  };
}

export async function createDriverSale(
  input: DriverSaleInput,
  opts: {
    collectNow?: boolean;
    // PHASE 4A.1 - INTERNAL ONLY. Neither field is reachable from client
    // JSON: driverSaleSchema has no `unitPriceTTC`/`soldAt` field at all, so
    // the public /api/driver/sales route can never populate these - only
    // syncOfflineDriverSale (this same file) does, and only with values it
    // has already cryptographically verified (price token) or explicitly
    // decided to trust (soldAt, bounded to "not more than 5 minutes in the
    // future" - see that function's own doc comment). The online path
    // (collectNow default, no override) is completely unaffected - see
    // this task's own report for why this is the chosen integration point
    // instead of a client-facing "pricingMode" field.
    verifiedUnitPriceTTCByProductId?: Map<string, number>;
    soldAtOverride?: Date;
  } = {},
): Promise<SaleDto> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId || !user.truckId) {
    throw new OperationsServiceError("Aucun camion n'est affecte a votre compte.", 403);
  }
  // See createCounterSale for the collectNow contract. collectNow:false is
  // the driver "Préparer la facture" path: DRAFT sale, "BR-..." ref, stock
  // moved, no payment/accounting/official number until collectDriverSale.
  const collectNow = opts.collectNow !== false;

  const parsed = driverSaleSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError("Certains champs sont invalides.", 422);
  }
  const lines = normalizeSaleLines(parsed.data.lines);

  const sale = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
      // Idempotency check first, before any other read - see the identical
      // comment in counter-sales.ts's createCounterSale. organizationId
      // always comes from the authenticated session, never from the client.
      if (parsed.data.idempotencyKey) {
        const existingSale = await tx.sale.findFirst({
          where: {
            organizationId: user.organizationId,
            idempotencyKey: parsed.data.idempotencyKey,
          },
          include: saleInclude,
        });
        if (existingSale) return existingSale;
      }

      const driver = await tx.driver.findFirst({
        where: {
          id: user.driverId,
          organizationId: user.organizationId,
        },
        select: {
          id: true,
          active: true,
          truckId: true,
          employeeCode: true,
          truck: {
            select: {
              id: true,
              depotId: true,
              stockLocation: {
                select: { id: true, type: true, code: true, name: true, active: true },
              },
            },
          },
        },
      });
      if (!driver?.active || !driver.truck || driver.truckId !== user.truckId) {
        throw new OperationsServiceError("Profil chauffeur ou camion invalide.", 403);
      }

      // F3 (Phase 2 audit): a driver sale is only ever allowed while their
      // truck has a genuinely IN_PROGRESS tour. Scoped by driverId AND
      // truckId AND organizationId (all session-derived, never from the
      // client) so this can only ever match this driver's own tour in their
      // own organization - never another driver's or another org's. Once
      // "Fin de tournee" moves the tour to WAITING_FOR_CLOSURE (or it never
      // started at all), this query returns nothing and the sale is refused
      // below, before any stock is touched.
      const activeTour = await tx.tour.findFirst({
        where: {
          organizationId: user.organizationId,
          driverId: driver.id,
          truckId: driver.truck.id,
          status: "IN_PROGRESS",
        },
        select: {
          id: true,
          code: true,
          status: true,
        },
        orderBy: { startedAt: "desc" },
      });
      if (!activeTour) {
        throw new OperationsServiceError(
          "Aucune tournee active. Demarrez votre tournee avant de vendre.",
          409,
        );
      }
      if (
        !driver.truck.stockLocation ||
        driver.truck.stockLocation.type !== "TRUCK" ||
        !driver.truck.stockLocation.active
      ) {
        throw new OperationsServiceError("Stock camion introuvable.", 404);
      }

      const customer = parsed.data.customerId
        ? await tx.customer.findFirst({
            where: {
              id: parsed.data.customerId,
              organizationId: user.organizationId,
            },
            select: {
              id: true,
              status: true,
              creditLimit: true,
              creditLimitEnabled: true,
            },
          })
        : null;
      if (parsed.data.customerId && !customer) {
        throw new OperationsServiceError("Client introuvable.", 404);
      }
      if (customer && customer.status !== "ACTIVE") {
        throw new OperationsServiceError("Client inactif ou bloque.", 409);
      }

      // BANK_TRANSFER: mandatory 5141 account as soon as the sale is
      // collected; validated whenever an id is supplied (same rule as the
      // counter POS).
      const bankAccountingAccountId =
        parsed.data.paymentMethod === "BANK_TRANSFER" &&
        (collectNow || parsed.data.bankAccountingAccountId)
          ? await resolveSaleTransferBankAccountId(
              tx,
              user.organizationId,
              parsed.data.bankAccountingAccountId ?? null,
            )
          : null;

      const productIds = lines.map((line) => line.productId);
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          organizationId: user.organizationId,
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
        const taxRate = product.taxRate.toNumber();
        // PHASE 4A.1 - "5. PROBLÈME PRIX ACTUEL": a verified offline-sync
        // price (already checked against its signed token, or explicitly
        // trusted for a legacy pre-token line - see syncOfflineDriverSale)
        // anchors this line at the price the driver actually showed the
        // customer, never today's Product.salePrice. Absent (every ONLINE
        // sale - this map is always undefined there), unchanged behaviour:
        // priced from the live product, exactly as before this phase.
        const verifiedUnitPriceTTC = opts.verifiedUnitPriceTTCByProductId?.get(line.productId);
        const unitPriceHT =
          verifiedUnitPriceTTC !== undefined
            ? roundMoney(verifiedUnitPriceTTC / (1 + taxRate / 100))
            : product.salePrice.toNumber();
        // BI Phase 2A: snapshot of the cost of the day, frozen on the line
        // forever - see SaleLine.unitCostHT's doc comment. Never touched
        // again by collectSaleCore (DRAFT -> PAID/CREDIT only updates the
        // Sale row, never SaleLine). Cost is a margin concept, distinct
        // from the sale price above - always today's cost, offline or not.
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
        organizationId: user.organizationId,
        totalTTC,
        paymentMethod: parsed.data.paymentMethod,
      });
      assertMoneyRange(stampAmount.toNumber(), "stampAmount");

      // A pending (not-yet-collected) sale has no payment split / credit
      // exposure yet - method is chosen at collection.
      const payment = collectNow
        ? resolvePaymentAmounts(parsed.data.paymentMethod, totalTTC, parsed.data.paidAmount)
        : { paidAmount: 0, creditAmount: 0 };
      assertMoneyRange(payment.paidAmount, "paidAmount");
      assertMoneyRange(payment.creditAmount, "creditAmount");
      if (collectNow && payment.creditAmount > 0 && !customer) {
        throw new OperationsServiceError("Client obligatoire pour une vente a credit.", 422);
      }
      // Opt-in credit ceiling: enforced only when the customer has it
      // enabled, and against the real computed debt (never the
      // currentBalance cache), on the credit part of the sale only.
      if (
        collectNow &&
        customer &&
        customer.creditLimitEnabled &&
        payment.creditAmount > 0
      ) {
        const { debt } = await computeCustomerDebt(
          tx,
          user.organizationId,
          customer.id,
        );
        if (addMoney(debt, payment.creditAmount) > customer.creditLimit.toNumber()) {
          throw new OperationsServiceError("Plafond de credit depasse.", 409);
        }
      }

      // Negative stock is an explicit business choice for DRIVER sales too
      // (see the identical note in counter-sales.ts): a sale is never
      // blocked because its quantity exceeds the truck StockLevel. The
      // decrement and the TRUCK_SALE StockMovement below are unchanged - the
      // truck StockLevel simply goes negative and the tour stock count /
      // return reconciles it.
      for (const line of computedLines) {
        await tx.stockLevel.upsert({
          where: {
            productId_locationId: {
              productId: line.productId,
              locationId: driver.truck.stockLocation.id,
            },
          },
          update: { quantity: { decrement: line.quantity } },
          create: {
            organizationId: user.organizationId,
            productId: line.productId,
            locationId: driver.truck.stockLocation.id,
            quantity: -line.quantity,
            reservedQuantity: 0,
          },
        });
      }

      const saleDate = new Date();
      // PHASE 4A.1 - "3. NOUVELLES VENTES ONLINE" / "soldAt": NULL unless
      // this is an offline sync - see Sale.soldAt's own schema comment,
      // which defines it as meaningful ONLY when the real moment of sale
      // differs from createdAt. An online sale has no such distinct moment
      // (createdAt already IS the moment of sale), so soldAt stays NULL
      // there rather than redundantly duplicating saleDate/createdAt. Only
      // an offline sync (opts.soldAtOverride - the driver's own device time,
      // already validated by syncOfflineDriverSale: finite date, not more
      // than 5 minutes in the future) ever sets it to something real.
      // Numbering below stays keyed to `saleDate` (server now) regardless -
      // soldAt must never influence official sequencing.
      const soldAt = opts.soldAtOverride ?? null;
      const sequencing = collectNow
        ? await resolveSaleSequencing(tx, saleDate, user.id, user.organizationId)
        : {
            saleYear: null as number | null,
            saleNumber: null as number | null,
            posSessionId: await resolvePosSession(
              tx,
              saleDate,
              user.id,
              user.organizationId,
            ),
          };
      const invoiceNumber = collectNow
        ? await nextInvoiceNumber(tx, driver.employeeCode, user.organizationId)
        : await nextPendingSaleRef(tx, user.organizationId);

      const sale = await tx.sale.create({
        data: {
          organizationId: user.organizationId,
          invoiceNumber,
          saleYear: sequencing.saleYear,
          saleNumber: sequencing.saleNumber,
          posSessionId: sequencing.posSessionId,
          origin: "TRUCK",
          status: collectNow
            ? payment.creditAmount === totalTTC
              ? "CREDIT"
              : payment.creditAmount > 0
                ? "PARTIALLY_PAID"
                : "PAID"
            : "DRAFT",
          customerId: customer?.id ?? null,
          depotId: driver.truck.depotId,
          driverId: driver.id,
          truckId: driver.truck.id,
          // Always the tour found above, imposed server-side - the client
          // never supplies tourId (driverSaleSchema has no such field).
          tourId: activeTour.id,
          stockLocationId: driver.truck.stockLocation.id,
          subtotalHT,
          discountAmount,
          taxAmount,
          totalTTC,
          stampAmount: collectNow ? stampAmount : 0,
          paidAmount: payment.paidAmount,
          creditAmount: payment.creditAmount,
          paymentMethod: parsed.data.paymentMethod,
          bankAccountingAccountId,
          createdByUserId: user.id,
          validatedAt: collectNow ? new Date() : null,
          soldAt,
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
      // happen for a collected sale. A pending DRAFT sale has none until
      // collectDriverSale runs.
      const createdPayment =
        collectNow && payment.paidAmount > 0
          ? await tx.payment.create({
              data: {
                organizationId: user.organizationId,
                paymentNumber: await nextPaymentNumber(tx, user.organizationId),
                saleId: sale.id,
                amount: payment.paidAmount,
                method:
                  parsed.data.paymentMethod === "CREDIT" ? "CASH" : parsed.data.paymentMethod,
                status: "VALIDATED",
                reference: parsed.data.reference ?? null,
                receivedByUserId: user.id,
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
          organizationId: user.organizationId,
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
          bankAccountingAccountId,
          paymentId: createdPayment?.id ?? null,
          paymentReference: createdPayment?.reference ?? null,
          createdByUserId: user.id,
        });
      }

      for (const line of computedLines) {
        await tx.stockMovement.create({
          data: {
            organizationId: user.organizationId,
            movementNumber: await nextMovementNumber(tx, user.organizationId),
            type: "TRUCK_SALE",
            productId: line.productId,
            quantity: line.quantity,
            sourceLocationId: driver.truck.stockLocation.id,
            destinationLocationId: null,
            referenceType: "SALE",
            referenceId: sale.id,
            reason: `Vente ${sale.invoiceNumber}`,
            createdByUserId: user.id,
            status: "VALIDATED",
          },
        });
      }

      if (customer) {
        await markCustomerDeliveredOnTour(tx, activeTour.id, customer.id);
      }

      return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: saleInclude });
      },
      // 15s: this transaction chains several sequential lookups plus the
      // accounting entry posting (assertAccountsExist etc.), which can exceed
      // Prisma's 5s default interactive-transaction timeout (P2028) against
      // Neon's serverless connection latency, even with no real conflict.
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  );

  return mapSaleToDto(sale);
}

// PHASE 4A - error codes the offline-sync endpoint can return, so the
// client can branch on something more precise than an HTTP status. Kept
// local to this module (not a change to the shared OperationsServiceError
// used across the rest of the app) - see DriverSaleSyncError below.
export type OfflineSaleSyncErrorCode =
  | "UNSUPPORTED_OFFLINE_PAYMENT_METHOD"
  | "INVALID_QUANTITY"
  | "INVALID_PRICE"
  | "INVALID_SOLD_AT"
  | "INVALID_OFFLINE_PRICE_TOKEN"
  | "LEGACY_OFFLINE_PRICE_MISMATCH"
  | "DRIVER_CONTEXT_NOT_FOUND"
  | "CUSTOMER_NOT_FOUND"
  | "PRODUCT_NOT_FOUND"
  | "SALE_SYNC_FAILED";

// PHASE 4A.1 - "4. VALIDATION soldAt": no lower/historical bound (a network
// outage can legitimately last days - see this task's own report), only an
// upper one, so a device with a badly wrong clock can't backdate/postdate a
// sale far into the future. 5 minutes absorbs normal clock drift between
// the phone and the server without being meaningfully exploitable.
const SOLD_AT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export class DriverSaleSyncError extends OperationsServiceError {
  constructor(
    public code: OfflineSaleSyncErrorCode,
    message: string,
    status = 422,
    fieldErrors?: Record<string, string>,
  ) {
    super(message, status, fieldErrors);
  }
}

// "3. CRÉER L'ENDPOINT" - client payload shape. Deliberately does NOT accept
// organizationId/driverId/truckId/stockLocationId (see "IMPORTANT" in that
// section) - those are exclusively derived server-side by createDriverSale
// itself, from the authenticated session, exactly like the online driver
// POS already does.
//
// PHASE 4A.1 - "7. PRICE TOKEN SIGNÉ": `priceToken` is what makes
// `unitPriceTTC` trustworthy as the REAL historical price rather than an
// unverifiable client claim - see verifyOfflinePriceToken below. Optional
// only for "11. VENTES PENDING EXISTANTES SANS TOKEN" (a sale already
// created on a device before this phase shipped, whose offline_sale_lines
// predate the priceToken column and are therefore NULL there) - every
// offline sale created AFTER the client picks up this change always has one
// (enforced client-side, not here - see the report). A missing token is
// NEVER a free pass for whatever unitPriceTTC the client sends - see the
// CORRECTION BLOQUANTE note on the legacy branch further down.
const offlineSaleSyncSchema = z.object({
  clientMutationId: z.string().trim().uuid("clientMutationId doit etre un UUID valide."),
  // Local-only display reference (e.g. "OFF-20260913-0001") - never used for
  // official numbering (see "7. NUMÉROTATION OFFICIELLE"), kept only for
  // audit traceability (stored as the Payment.reference below).
  localReference: z.string().trim().max(60).nullable().optional(),
  soldAt: z.string().trim().min(1, "soldAt est requis."),
  customerId: z.string().trim().nullable().optional(),
  paymentMethod: z.enum(["CASH", "CHECK", "BANK_TRANSFER", "CREDIT", "MIXED"]),
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1, "productId est requis."),
        quantity: z.coerce.number().int().positive().max(1_000_000),
        unitPriceTTC: z.coerce.number().finite().min(0),
        priceToken: z.string().trim().min(1).nullable().optional(),
      }),
    )
    .min(1, "Le panier hors connexion est vide."),
});

export type OfflineSaleSyncInput = z.input<typeof offlineSaleSyncSchema>;

export type OfflineSaleSyncResult = {
  success: true;
  syncStatus: "SYNCED";
  result: "CREATED" | "ALREADY_SYNCED";
  clientMutationId: string;
  serverSaleId: string;
  officialDisplayNumber: string;
  saleYear: number | null;
  saleNumber: number | null;
};

/**
 * PHASE 4A / 4A.1 - receives ONE already-confirmed offline (driver POS)
 * sale and creates the real server Sale for it, exactly once, with the real
 * official number, the driver's real sale price (not today's), and the
 * real moment of sale. Deliberately a thin wrapper: every core business
 * rule (organization/driver/truck/tour derivation from the session,
 * customer/product existence, stock movement, payment, accounting,
 * official numbering, idempotency-by-key) is createDriverSale's own,
 * unmodified - see that function's doc comments. This function only adds
 * what's specific to the offline-sync path:
 *  - refusing anything but CASH ("5. CASH UNIQUEMENT POUR V1");
 *  - verifying each line's signed price token ("7./12. PRICE TOKEN SIGNÉ")
 *    and passing the VERIFIED historical price into createDriverSale's
 *    internal-only override, instead of letting it price from today's
 *    Product.salePrice;
 *  - validating/forwarding the real `soldAt` into the same internal-only
 *    override, instead of leaving it as "now" like an online sale.
 *
 * PRICING (see this task's report, "5.-14. PRIX"): a line whose token
 * verifies is trusted at its signed price - a changed Product.salePrice
 * since the offline sale never affects it. A line with NO token (a sale
 * created before this phase shipped - see "11. VENTES PENDING EXISTANTES
 * SANS TOKEN") is NEVER trusted on the client's say-so: its unitPriceTTC
 * must match TODAY's real server tariff exactly (same computePriceTTC/
 * roundMoney createDriverSale itself uses) or the WHOLE sync is refused
 * with LEGACY_OFFLINE_PRICE_MISMATCH, before any DB write - see "CORRECTION
 * BLOQUANTE - SÉCURISER LE FALLBACK LEGACY PRICE". Even when it matches,
 * the value that actually anchors the sale is the SERVER's own computed
 * price, never the client's number. Either way, createDriverSale still
 * recalculates subtotal/tax/total from that anchor price × quantity - the
 * client's totalTTC is never trusted directly ("14. RECALCUL SERVEUR").
 */
export async function syncOfflineDriverSale(
  input: OfflineSaleSyncInput,
): Promise<OfflineSaleSyncResult> {
  // Auth first, before any business rule below can leak pass/fail
  // information to an unauthenticated caller. requireOrganizationUser is
  // called again, redundantly, inside createDriverSale itself further down -
  // harmless (every authenticated request re-reads the session fresh, see
  // that function's own doc comment) and keeps this function self-contained.
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId || !user.truckId) {
    throw new DriverSaleSyncError(
      "DRIVER_CONTEXT_NOT_FOUND",
      "Aucun camion n'est affecte a votre compte.",
      403,
    );
  }

  const parsed = offlineSaleSyncSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // A line-level issue's path is ["lines", <index>, <field>] - distinguish
    // a bad quantity from a bad price so the client gets the precise code,
    // not just "something in lines is wrong".
    const code: OfflineSaleSyncErrorCode =
      issue?.path[0] === "lines"
        ? issue.path[2] === "unitPriceTTC"
          ? "INVALID_PRICE"
          : "INVALID_QUANTITY"
        : "SALE_SYNC_FAILED";
    throw new DriverSaleSyncError(code, issue?.message ?? "Payload de synchronisation invalide.", 422);
  }
  const data = parsed.data;

  const soldAtDate = new Date(data.soldAt);
  if (Number.isNaN(soldAtDate.getTime())) {
    throw new DriverSaleSyncError("INVALID_SOLD_AT", "soldAt n'est pas une date valide.", 422);
  }
  if (soldAtDate.getTime() > Date.now() + SOLD_AT_FUTURE_TOLERANCE_MS) {
    throw new DriverSaleSyncError(
      "INVALID_SOLD_AT",
      "soldAt ne peut pas etre dans le futur.",
      422,
    );
  }

  // "5. CASH UNIQUEMENT POUR V1" - refused before any DB read. Other modes
  // are a future phase's job, not this one's.
  if (data.paymentMethod !== "CASH") {
    throw new DriverSaleSyncError(
      "UNSUPPORTED_OFFLINE_PAYMENT_METHOD",
      "Ce mode de reglement n'est pas encore pris en charge pour une synchronisation hors connexion.",
      422,
    );
  }

  // "7./12. PRICE TOKEN SIGNÉ" - verified (or explicitly trusted legacy)
  // price per productId, passed to createDriverSale's internal-only
  // override below. A tokenized line's price MUST match what was actually
  // signed - any mismatch (tampering or corruption) refuses the whole sale
  // before any DB read, exactly like an unsupported payment method.
  const verifiedUnitPriceTTCByProductId = new Map<string, number>();
  for (const line of data.lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new DriverSaleSyncError(
        "INVALID_QUANTITY",
        `Quantite invalide pour le produit ${line.productId}.`,
        422,
      );
    }
    if (!Number.isFinite(line.unitPriceTTC) || line.unitPriceTTC < 0) {
      throw new DriverSaleSyncError(
        "INVALID_PRICE",
        `Prix invalide pour le produit ${line.productId}.`,
        422,
      );
    }

    if (line.priceToken) {
      const verification = verifyOfflinePriceToken(line.priceToken);
      if (!verification.valid) {
        throw new DriverSaleSyncError(
          "INVALID_OFFLINE_PRICE_TOKEN",
          `Jeton de prix invalide pour le produit ${line.productId}.`,
          422,
        );
      }
      const { payload: tokenPayload } = verification;
      const tokenMatches =
        tokenPayload.organizationId === user.organizationId &&
        tokenPayload.productId === line.productId &&
        roundMoney(tokenPayload.unitPriceTTC) === roundMoney(line.unitPriceTTC);
      if (!tokenMatches) {
        throw new DriverSaleSyncError(
          "INVALID_OFFLINE_PRICE_TOKEN",
          `Le prix envoye ne correspond pas au jeton signe pour le produit ${line.productId}.`,
          422,
        );
      }
      verifiedUnitPriceTTCByProductId.set(line.productId, tokenPayload.unitPriceTTC);
    } else {
      // CORRECTION BLOQUANTE - "1. NOUVELLE POLITIQUE LEGACY": a line with
      // no priceToken (a sale created before this phase shipped - see "11.
      // VENTES PENDING EXISTANTES SANS TOKEN" in the prior task) is NEVER
      // trusted on the client's say-so alone - that was exactly the hole
      // this fix closes (delete the token, send unitPriceTTC = 1, get a 1 DH
      // sale). The client's unitPriceTTC is only ever used to prove it still
      // matches TODAY's real server tariff - if it matches, the value that
      // actually anchors the sale is the SERVER's own computed price, never
      // the client's number, even though the two are numerically identical
      // at that point. A mismatch refuses the ENTIRE sync, before any DB
      // write - no partial fallback, no silent repricing.
      const legacyProduct = await prisma.product.findFirst({
        where: { id: line.productId, organizationId: user.organizationId },
        select: { salePrice: true, taxRate: true },
      });
      if (!legacyProduct) {
        throw new DriverSaleSyncError(
          "PRODUCT_NOT_FOUND",
          `Produit introuvable pour la ligne ${line.productId}.`,
          422,
        );
      }
      const currentUnitPriceTTC = computePriceTTC(
        legacyProduct.salePrice.toNumber(),
        legacyProduct.taxRate.toNumber(),
      );
      if (roundMoney(currentUnitPriceTTC) !== roundMoney(line.unitPriceTTC)) {
        console.warn(
          "[OFFLINE SYNC] legacy line price does not match current server tariff - refusing whole sync",
          { organizationId: user.organizationId, productId: line.productId },
        );
        throw new DriverSaleSyncError(
          "LEGACY_OFFLINE_PRICE_MISMATCH",
          `Le prix hors connexion ne correspond plus au tarif serveur actuel pour le produit ${line.productId}.`,
          422,
        );
      }
      console.warn(
        "[OFFLINE SYNC] legacy line without a price token - matches current server tariff, accepted",
        { organizationId: user.organizationId, productId: line.productId },
      );
      // The SERVER's own computed price, not the client's - see this
      // block's own doc comment on why that distinction matters even when
      // the two numbers are equal.
      verifiedUnitPriceTTCByProductId.set(line.productId, currentUnitPriceTTC);
    }
  }

  // Best-effort CREATED/ALREADY_SYNCED labeling only (see this task's
  // report on the rare true-concurrency case) - the actual guarantee that
  // only one Sale ever exists for this key comes from createDriverSale's
  // own idempotency check + the DB's @@unique([organizationId,
  // idempotencyKey]) constraint + its retry-on-conflict loop, none of which
  // this read participates in. NEVER use this field to decide whether a
  // sale is synced - only `success`/`serverSaleId`/`officialDisplayNumber`
  // are guaranteed accurate under true concurrency (see "18. CONCURRENCE").
  const existingBeforeSync = await prisma.sale.findFirst({
    where: { organizationId: user.organizationId, idempotencyKey: data.clientMutationId },
    select: { id: true },
  });

  const driverSaleInput: DriverSaleInput & { idempotencyKey: string } = {
    customerId: data.customerId ?? null,
    paymentMethod: "CASH",
    reference: data.localReference ?? null,
    idempotencyKey: data.clientMutationId,
    lines: data.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
  };

  let sale: SaleDto;
  try {
    sale = await createDriverSale(driverSaleInput, {
      collectNow: true,
      verifiedUnitPriceTTCByProductId,
      soldAtOverride: soldAtDate,
    });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      throw new DriverSaleSyncError(
        mapCreateDriverSaleErrorCode(error.message),
        error.message,
        error.status,
        error.fieldErrors,
      );
    }
    throw new DriverSaleSyncError("SALE_SYNC_FAILED", "Impossible de synchroniser la vente.", 500);
  }

  return {
    success: true,
    syncStatus: "SYNCED",
    result: existingBeforeSync ? "ALREADY_SYNCED" : "CREATED",
    clientMutationId: data.clientMutationId,
    serverSaleId: sale.id,
    officialDisplayNumber: sale.displayNumber,
    saleYear: sale.saleYear,
    saleNumber: sale.saleNumber,
  };
}

/**
 * Best-effort mapping of createDriverSale's own (message-only)
 * OperationsServiceError onto this task's requested error codes, without
 * duplicating the validation those messages already come from - see
 * syncOfflineDriverSale's own doc comment on reuse.
 */
function mapCreateDriverSaleErrorCode(message: string): OfflineSaleSyncErrorCode {
  if (message.includes("camion") || message.includes("tournee")) return "DRIVER_CONTEXT_NOT_FOUND";
  if (message.includes("Client") || message.includes("client")) return "CUSTOMER_NOT_FOUND";
  if (message.includes("produit") || message.includes("Produit")) return "PRODUCT_NOT_FOUND";
  return "SALE_SYNC_FAILED";
}

// Same pattern as counter-sales.ts's withSerializableRetry - see the
// comment there for why P2002 is retried alongside P2034.
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

export async function getSalesForCurrentDriver(): Promise<SaleDto[]> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId) throw new OperationsServiceError("Profil chauffeur introuvable.", 403);
  const sales = await prisma.sale.findMany({
    where: { driverId: user.driverId, organizationId: user.organizationId },
    include: saleInclude,
    orderBy: { createdAt: "desc" },
  });
  return sales.map(mapSaleToDto);
}

/**
 * "/driver/ventes" - today's own sold sales only, scoped server-side to the
 * authenticated driver (never a client-supplied driverId) and organisation.
 * "Today" is the current COMDIS business day (see lib/business-day.ts:
 * 02:00 -> 02:00 next day, Africa/Casablanca) - not the calendar day, so a
 * 00:30 sale still counts as "yesterday" until the 02:00 cutoff, matching
 * every other "journée" page in the app (Factures journalières, etc).
 * DRAFT (not yet collected) and CANCELLED are excluded, same SOLD_STATUS
 * rule as lib/server/daily-invoices.ts.
 */
export async function getTodaySalesForCurrentDriver(): Promise<DriverTodaySalesDto> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId) throw new OperationsServiceError("Profil chauffeur introuvable.", 403);

  const { start, end, day } = businessDayRangeUtc(getCurrentBusinessDayParam());
  const rows = await prisma.sale.findMany({
    where: {
      driverId: user.driverId,
      organizationId: user.organizationId,
      createdAt: { gte: start, lt: end },
      status: { notIn: ["DRAFT", "CANCELLED"] },
    },
    include: saleInclude,
    orderBy: { createdAt: "desc" },
  });

  const sales = rows.map(mapSaleToDto);
  return {
    day,
    sales,
    stats: {
      count: sales.length,
      totalTTC: roundMoney(sales.reduce((sum, sale) => sum + sale.totalTTC, 0)),
      paidAmount: roundMoney(sales.reduce((sum, sale) => sum + sale.paidAmount, 0)),
      creditAmount: roundMoney(sales.reduce((sum, sale) => sum + sale.creditAmount, 0)),
    },
  };
}

export async function getSalesForDriverByTour(tourId: string): Promise<SaleDto[]> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId) throw new OperationsServiceError("Profil chauffeur introuvable.", 403);
  const sales = await prisma.sale.findMany({
    where: {
      tourId,
      driverId: user.driverId,
      organizationId: user.organizationId,
    },
    include: saleInclude,
    orderBy: { createdAt: "desc" },
  });
  return sales.map(mapSaleToDto);
}

export async function getDriverSaleById(id: string): Promise<SaleDto> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId) throw new OperationsServiceError("Profil chauffeur introuvable.", 403);
  const sale = await prisma.sale.findFirst({
    where: { id, driverId: user.driverId, organizationId: user.organizationId },
    include: saleInclude,
  });
  if (!sale) throw new OperationsServiceError("Vente introuvable.", 404);
  return mapSaleToDto(sale);
}

export async function getAllSales(): Promise<SaleDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const sales = await prisma.sale.findMany({
    where: { organizationId: currentUser.organizationId },
    include: saleInclude,
    orderBy: { createdAt: "desc" },
  });
  return sales.map(mapSaleToDto);
}

export async function getSaleById(id: string): Promise<SaleDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const sale = await prisma.sale.findFirst({
    where: { id, organizationId: currentUser.organizationId },
    include: saleInclude,
  });
  if (!sale) throw new OperationsServiceError("Vente introuvable.", 404);
  return mapSaleToDto(sale);
}

export function groupSalesByTour(sales: SaleDto[]): DriverTourSalesSummaryDto[] {
  const groups = new Map<string, SaleDto[]>();
  for (const sale of sales) {
    const key = sale.tour?.id ?? "missing";
    groups.set(key, [...(groups.get(key) ?? []), sale]);
  }

  return [...groups.entries()].map(([tourId, items]) => {
    const first = items[0];
    return {
      tourId,
      tourCode: first?.tour?.code ?? tourId,
      date: first?.tour?.date ?? first?.createdAt ?? new Date().toISOString(),
      truckCode: first?.truck?.code ?? "-",
      status: first?.tour?.status ?? "-",
      salesCount: items.length,
      customersCount: new Set(items.map((sale) => sale.customer?.id).filter(Boolean)).size,
      totalQuantity: items.reduce(
        (sum, sale) => sum + sale.lines.reduce((lineSum, line) => lineSum + line.quantity, 0),
        0,
      ),
      totalHT: roundMoney(items.reduce((sum, sale) => sum + sale.subtotalHT, 0)),
      totalTax: roundMoney(items.reduce((sum, sale) => sum + sale.taxAmount, 0)),
      totalTTC: roundMoney(items.reduce((sum, sale) => sum + sale.totalTTC, 0)),
      paidAmount: roundMoney(items.reduce((sum, sale) => sum + sale.paidAmount, 0)),
      creditAmount: roundMoney(items.reduce((sum, sale) => sum + sale.creditAmount, 0)),
      sales: items,
    };
  });
}

function blockedContext(
  message: string,
  driver: { id: string; name: string },
  truck?: { id: string; code: string; registration: string } | null,
  tour?: { id: string; code: string; status: string } | null,
): DriverPosContextDto {
  return {
    canSell: false,
    message,
    driver,
    truck: truck ?? null,
    tour: tour ?? null,
    customers: [],
    products: [],
    stockLocationId: null,
    productsTruncated: false,
    bankAccounts: [],
  };
}
