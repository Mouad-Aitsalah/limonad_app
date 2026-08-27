import type { SaleGetPayload } from "@/lib/generated/prisma/models/Sale";
import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import type { SaleDto } from "@/types/operations-dto";

export const saleInclude = {
  customer: { select: { id: true, code: true, name: true } },
  depot: { select: { id: true, name: true } },
  driver: { select: { id: true, user: { select: { fullName: true } } } },
  truck: { select: { id: true, code: true, registration: true } },
  tour: { select: { id: true, code: true, status: true, date: true } },
  createdBy: { select: { fullName: true } },
  lines: {
    include: {
      product: { select: { reference: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  payments: { orderBy: { createdAt: "asc" } },
} as const;

type SaleWithRelations = SaleGetPayload<{ include: typeof saleInclude }>;

export type RawSaleLineInput = {
  productId: string;
  quantity: number;
  discountRate?: number;
};

export function mapSaleToDto(sale: SaleWithRelations): SaleDto {
  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    saleYear: sale.saleYear,
    saleNumber: sale.saleNumber,
    displayNumber:
      sale.saleYear !== null && sale.saleNumber !== null
        ? `${sale.saleNumber}/${sale.saleYear}`
        : sale.invoiceNumber,
    posSessionId: sale.posSessionId,
    origin: sale.origin,
    status: sale.status,
    customer: sale.customer,
    depot: sale.depot,
    driver: sale.driver
      ? { id: sale.driver.id, name: sale.driver.user.fullName }
      : null,
    truck: sale.truck,
    tour: sale.tour ? { ...sale.tour, date: sale.tour.date.toISOString() } : null,
    subtotalHT: sale.subtotalHT.toNumber(),
    discountAmount: sale.discountAmount.toNumber(),
    taxAmount: sale.taxAmount.toNumber(),
    totalTTC: sale.totalTTC.toNumber(),
    stampAmount: sale.stampAmount.toNumber(),
    paidAmount: sale.paidAmount.toNumber(),
    creditAmount: sale.creditAmount.toNumber(),
    paymentMethod: sale.paymentMethod,
    createdByUserName: sale.createdBy.fullName,
    validatedAt: sale.validatedAt?.toISOString() ?? null,
    createdAt: sale.createdAt.toISOString(),
    lines: sale.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productReference: line.product.reference,
      productName: line.product.name,
      quantity: line.quantity,
      unitPriceHT: line.unitPriceHT.toNumber(),
      discountRate: line.discountRate.toNumber(),
      discountAmount: line.discountAmount.toNumber(),
      taxRate: line.taxRate.toNumber(),
      taxAmount: line.taxAmount.toNumber(),
      totalHT: line.totalHT.toNumber(),
      totalTTC: line.totalTTC.toNumber(),
    })),
    payments: sale.payments.map((payment) => ({
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      amount: payment.amount.toNumber(),
      method: payment.method,
      status: payment.status,
      reference: payment.reference,
      receivedAt: payment.receivedAt.toISOString(),
    })),
  };
}

export function normalizeSaleLines<T extends RawSaleLineInput>(lines: T[]) {
  const seen = new Set<string>();
  return lines.map((line) => {
    if (seen.has(line.productId)) {
      throw new OperationsServiceError("Un produit ne peut apparaitre qu'une fois.", 422);
    }
    seen.add(line.productId);
    return { ...line, discountRate: line.discountRate ?? 0 };
  });
}

export function resolvePaymentAmounts(
  method: string,
  totalTTC: number,
  paidAmountInput?: number,
) {
  if (method === "CREDIT") return { paidAmount: 0, creditAmount: totalTTC };
  if (method === "MIXED") {
    const paidAmount = roundMoney(paidAmountInput ?? 0);
    if (paidAmount <= 0 || paidAmount >= totalTTC) {
      throw new OperationsServiceError("Paiement mixte invalide.", 422);
    }
    return { paidAmount, creditAmount: roundMoney(totalTTC - paidAmount) };
  }
  return { paidAmount: totalTTC, creditAmount: 0 };
}

/**
 * Assigns the year-scoped display number ("N/YYYY") and the POS session for a
 * new sale, atomically within the caller's own Serializable transaction so two
 * concurrent sales can never collide. A session is a calendar day of POS
 * activity: the currently OPEN session is reused if it was opened today,
 * otherwise it is closed and a new one is opened.
 */
export async function resolveSaleSequencing(
  tx: Pick<typeof prisma, "sale" | "posSession">,
  now: Date,
  userId: string,
) {
  const year = now.getFullYear();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const lastSession = await tx.posSession.findFirst({ orderBy: { number: "desc" } });
  const reuseExisting =
    lastSession !== null && lastSession.status === "OPEN" && lastSession.openedAt >= dayStart;

  let posSessionId: string;
  if (reuseExisting && lastSession) {
    posSessionId = lastSession.id;
  } else {
    if (lastSession && lastSession.status === "OPEN") {
      await tx.posSession.update({
        where: { id: lastSession.id },
        data: { status: "CLOSED", closedAt: now },
      });
    }
    const created = await tx.posSession.create({
      data: {
        number: (lastSession?.number ?? 0) + 1,
        year,
        openedAt: now,
        status: "OPEN",
        openedByUserId: userId,
      },
    });
    posSessionId = created.id;
  }

  const saleCount = await tx.sale.count({ where: { saleYear: year } });

  return { saleYear: year, saleNumber: saleCount + 1, posSessionId };
}

export async function nextInvoiceNumber(
  tx: Pick<typeof prisma, "sale">,
  scopeCode: string,
) {
  const today = new Date();
  const date = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
  const prefix = `VC-${date}-${scopeCode}-`;
  const count = await tx.sale.count({ where: { invoiceNumber: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(6, "0")}`;
}

export async function nextPaymentNumber(tx: Pick<typeof prisma, "payment">) {
  const count = await tx.payment.count();
  return `PAY-${String(count + 1).padStart(6, "0")}`;
}

export async function nextMovementNumber(tx: Pick<typeof prisma, "stockMovement">) {
  const count = await tx.stockMovement.count();
  return `MV-${String(count + 1).padStart(6, "0")}`;
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
