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
import { markCustomerDeliveredOnTour } from "@/lib/server/driver-tour";
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
  DriverTourSalesSummaryDto,
  SaleDto,
} from "@/types/operations-dto";

const driverSaleSchema = z.object({
  customerId: z.string().trim().nullable().optional(),
  paymentMethod: z.enum(["CASH", "CARD", "CHECK", "BANK_TRANSFER", "CREDIT", "MIXED"]),
  // F8-D: input-level sanity bound only, not the real protection - a value
  // right at this bound can still overflow once combined with other lines/
  // tax (see assertMoneyRange calls below, the actual gate).
  paidAmount: z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
  reference: z.string().trim().nullable().optional(),
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

  const [productRows, customers] = await Promise.all([
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
    products: pageProducts.map((product) => {
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
        // No stock row on this truck -> shown as 0 (still sellable).
        availableQuantity: level ? level.quantity - level.reservedQuantity : 0,
      };
    }),
  };
}

export async function createDriverSale(
  input: DriverSaleInput,
  opts: { collectNow?: boolean } = {},
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
          organizationId: user.organizationId,
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
      if (collectNow && customer && payment.creditAmount > 0) {
        const nextBalance = customer.currentBalance.toNumber() + payment.creditAmount;
        if (nextBalance > customer.creditLimit.toNumber()) {
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
          createdByUserId: user.id,
          validatedAt: collectNow ? new Date() : null,
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
  };
}
