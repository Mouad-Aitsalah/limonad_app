import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { computePriceTTC } from "@/lib/product-pricing";
import {
  computeCashSaleStampAmount,
  postSaleAccountingEntry,
} from "@/lib/server/accounting";
import { getCustomers } from "@/lib/server/customers";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { getDepotStock } from "@/lib/server/stock-levels";
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
    throw new OperationsServiceError("Aucun depot actif n'est rattache a cet utilisateur.", 409);
  }

  const stock = await getDepotStock(user.depotId);
  const productsById = await prisma.product.findMany({
    where: {
      id: { in: stock.map((level) => level.productId) },
      organizationId: sessionUser.organizationId,
    },
    select: {
      id: true,
      imageUrl: true,
      taxRate: true,
    },
  });
  const productMetaById = new Map(
    productsById.map((product) => [
      product.id,
      { imageUrl: product.imageUrl, taxRate: product.taxRate.toNumber() },
    ]),
  );

  const customers = (await getCustomers()).filter((customer) => customer.status === "ACTIVE");
  const products: DriverPosProductDto[] = stock
    .filter((level) => level.availableQuantity > 0)
    .map((level) => {
      const taxRate = productMetaById.get(level.productId)?.taxRate ?? 0;

      return {
        id: level.productId,
        reference: level.productReference,
        barcode: level.barcode,
        name: level.productName,
        imageUrl: productMetaById.get(level.productId)?.imageUrl ?? null,
        salePriceHT: level.salePrice,
        salePriceTTC: computePriceTTC(level.salePrice, taxRate),
        taxRate,
        availableQuantity: level.availableQuantity,
      };
    });

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

  return {
    canSell: products.length > 0,
    message: products.length > 0 ? undefined : "Aucun produit n'est disponible dans ce depot.",
    user: { id: user.id, name: user.fullName },
    depot: { id: user.depot.id, code: user.depot.code, name: user.depot.name },
    stockLocation: { id: stockLocation.id, code: stockLocation.code, name: stockLocation.name },
    customers,
    products,
  };
}

export async function createCounterSale(input: CounterSaleInput): Promise<SaleDto> {
  const sessionUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

  const parsed = counterSaleSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError("Certains champs sont invalides.", 422);
  }
  const lines = normalizeSaleLines(parsed.data.lines);

  const sale = await prisma.$transaction(
    async (tx) => {
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
          "Aucun depot actif n'est rattache a cet utilisateur.",
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
        organizationId: sessionUser.organizationId,
        totalTTC,
        paymentMethod: parsed.data.paymentMethod,
      });

      const payment = resolvePaymentAmounts(
        parsed.data.paymentMethod,
        totalTTC,
        parsed.data.paidAmount,
      );
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
    { isolationLevel: "Serializable" },
  );

  return mapSaleToDto(sale);
}
