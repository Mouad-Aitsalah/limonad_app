import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { computePriceTTC } from "@/lib/product-pricing";
import {
  computeCashSaleStampAmount,
  postSaleAccountingEntry,
} from "@/lib/server/accounting";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { getCustomersForCurrentDriver } from "@/lib/server/driver-customers";
import { markCustomerDeliveredOnTour } from "@/lib/server/driver-tour";
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
  DriverPosContextDto,
  DriverSaleInput,
  DriverTourSalesSummaryDto,
  SaleDto,
} from "@/types/operations-dto";

const driverSaleSchema = z.object({
  customerId: z.string().trim().nullable().optional(),
  paymentMethod: z.enum(["CASH", "CARD", "CHECK", "BANK_TRANSFER", "CREDIT", "MIXED"]),
  paidAmount: z.coerce.number().min(0).optional(),
  reference: z.string().trim().nullable().optional(),
  stampAmount: z.coerce.number().min(0).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.coerce.number().int().positive(),
        discountRate: z.coerce.number().min(0).max(100).optional(),
      }),
    )
    .min(1, "Ajoutez au moins un produit."),
});

export async function getDriverPosContext(): Promise<DriverPosContextDto> {
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

  const [levels, customers] = await Promise.all([
    prisma.stockLevel.findMany({
      where: {
        organizationId: user.organizationId,
        locationId: driver.truck.stockLocation.id,
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
    }),
    getCustomersForCurrentDriver(),
  ]);

  return {
    canSell: levels.length > 0,
    message: levels.length > 0 ? undefined : "Aucun produit n'est disponible dans votre camion.",
    driver: { id: driver.id, name: driver.user.fullName },
    truck: driver.truck,
    tour: activeTour,
    customers: customers.filter((customer) => customer.status === "ACTIVE"),
    products: levels.map((level) => {
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
    }),
  };
}

export async function createDriverSale(input: DriverSaleInput): Promise<SaleDto> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId || !user.truckId) {
    throw new OperationsServiceError("Aucun camion n'est affecte a votre compte.", 403);
  }

  const parsed = driverSaleSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError("Certains champs sont invalides.", 422);
  }
  const lines = normalizeSaleLines(parsed.data.lines);

  const sale = await prisma.$transaction(
    async (tx) => {
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
        const grossHT = unitPriceHT * line.quantity;
        const discountAmount = roundMoney(grossHT * (discountRate / 100));
        const totalHT = roundMoney(grossHT - discountAmount);
        const taxRate = product.taxRate.toNumber();
        const taxAmount = roundMoney(totalHT * (taxRate / 100));
        return {
          ...line,
          unitPriceHT,
          discountRate,
          discountAmount,
          taxRate,
          taxAmount,
          totalHT,
          totalTTC: roundMoney(totalHT + taxAmount),
        };
      });
      const subtotalHT = roundMoney(computedLines.reduce((sum, line) => sum + line.totalHT, 0));
      const discountAmount = roundMoney(
        computedLines.reduce((sum, line) => sum + line.discountAmount, 0),
      );
      const taxAmount = roundMoney(computedLines.reduce((sum, line) => sum + line.taxAmount, 0));
      const totalTTC = roundMoney(subtotalHT + taxAmount);
      const stampAmount = await computeCashSaleStampAmount(tx, {
        organizationId: user.organizationId,
        totalTTC,
        paymentMethod: parsed.data.paymentMethod,
      });

      const payment = resolvePaymentAmounts(parsed.data.paymentMethod, totalTTC, parsed.data.paidAmount);
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
              locationId: driver.truck.stockLocation.id,
            },
          },
        });
        const available = (level?.quantity ?? 0) - (level?.reservedQuantity ?? 0);
        if (!level || available < line.quantity) {
          throw new OperationsServiceError("Stock camion insuffisant.", 422);
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
        user.id,
        user.organizationId,
      );

      const sale = await tx.sale.create({
        data: {
          organizationId: user.organizationId,
          invoiceNumber: await nextInvoiceNumber(
            tx,
            driver.employeeCode,
            user.organizationId,
          ),
          saleYear: sequencing.saleYear,
          saleNumber: sequencing.saleNumber,
          posSessionId: sequencing.posSessionId,
          origin: "TRUCK",
          status:
            payment.creditAmount === totalTTC
              ? "CREDIT"
              : payment.creditAmount > 0
                ? "PARTIALLY_PAID"
                : "PAID",
          customerId: customer?.id ?? null,
          depotId: driver.truck.depotId,
          driverId: driver.id,
          truckId: driver.truck.id,
          tourId: activeTour?.id ?? null,
          stockLocationId: driver.truck.stockLocation.id,
          subtotalHT,
          discountAmount,
          taxAmount,
          totalTTC,
          stampAmount,
          paidAmount: payment.paidAmount,
          creditAmount: payment.creditAmount,
          paymentMethod: parsed.data.paymentMethod,
          createdByUserId: user.id,
          validatedAt: new Date(),
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
      if (customer && payment.creditAmount > 0) {
        await tx.customer.update({
          where: { id: customer.id },
          data: { currentBalance: { increment: payment.creditAmount } },
        });
      }

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

      if (customer && activeTour) {
        await markCustomerDeliveredOnTour(tx, activeTour.id, customer.id);
      }

      return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: saleInclude });
    },
    { isolationLevel: "Serializable" },
  );

  return mapSaleToDto(sale);
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
  return { canSell: false, message, driver, truck: truck ?? null, tour: tour ?? null, customers: [], products: [] };
}
