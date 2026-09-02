import "server-only";

import { roundMoney as roundMoneyDecimal } from "@/lib/money";
import type { SaleGetPayload } from "@/lib/generated/prisma/models/Sale";
import { prisma } from "@/lib/prisma";
import { getCurrentSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
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
  tx: Pick<typeof prisma, "sale" | "posSession" | "$queryRaw">,
  now: Date,
  userId: string,
  organizationId?: string,
) {
  const scopedOrganizationId =
    organizationId ?? (await resolveOrganizationIdFromUserId(userId));
  const year = now.getFullYear();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const lastSession = await tx.posSession.findFirst({
    where: { organizationId: scopedOrganizationId },
    orderBy: { number: "desc" },
  });
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
    const number = await reserveDocumentSequence(
      tx,
      scopedOrganizationId,
      DocumentType.PosSession,
    );
    const created = await tx.posSession.create({
      data: {
        organizationId: scopedOrganizationId,
        number,
        year,
        openedAt: now,
        status: "OPEN",
        openedByUserId: userId,
      },
    });
    posSessionId = created.id;
  }

  const saleNumber = await reserveDocumentSequence(
    tx,
    scopedOrganizationId,
    DocumentType.Sale,
    String(year),
  );

  return { saleYear: year, saleNumber, posSessionId };
}

export async function nextInvoiceNumber(
  tx: Pick<typeof prisma, "sale" | "$queryRaw">,
  scopeCode: string,
  organizationId?: string,
) {
  const scopedOrganizationId =
    organizationId ?? (await resolveCurrentOrganizationId());
  const today = new Date();
  const date = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
  const prefix = `VC-${date}-${scopeCode}-`;
  const number = await reserveDocumentSequence(
    tx,
    scopedOrganizationId,
    DocumentType.Invoice,
    `${date}-${scopeCode}`,
  );
  return `${prefix}${String(number).padStart(6, "0")}`;
}

export async function nextPaymentNumber(
  tx: Pick<typeof prisma, "payment" | "$queryRaw">,
  organizationId?: string,
) {
  const scopedOrganizationId =
    organizationId ?? (await resolveCurrentOrganizationId());
  const number = await reserveDocumentSequence(
    tx,
    scopedOrganizationId,
    DocumentType.Payment,
  );
  return `PAY-${String(number).padStart(6, "0")}`;
}

export async function nextMovementNumber(
  tx: Pick<typeof prisma, "stockMovement" | "$queryRaw">,
  organizationId?: string,
) {
  const scopedOrganizationId =
    organizationId ?? (await resolveCurrentOrganizationId());
  const number = await reserveDocumentSequence(
    tx,
    scopedOrganizationId,
    DocumentType.StockMovement,
  );
  return `MV-${String(number).padStart(6, "0")}`;
}

// F8-B: delegates to the shared decimal-based engine (lib/money.ts) instead
// of `Math.round(value * 100) / 100`, which can misround values like
// 1.005 or 10.075 due to IEEE754 float imprecision (see the F8 audit
// report). Re-exported under this same name/signature so every existing
// caller (counter-sales.ts, driver-sales.ts, purchases.ts) needed zero
// changes.
export function roundMoney(value: number) {
  return roundMoneyDecimal(value);
}

async function resolveOrganizationIdFromUserId(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true },
  });

  if (!user?.organizationId) {
    throw new OperationsServiceError("Aucune organisation n'est associee a cet utilisateur.", 403);
  }

  return user.organizationId;
}

async function resolveCurrentOrganizationId() {
  const currentUser = await getCurrentSessionUser();

  if (!currentUser?.organizationId) {
    throw new OperationsServiceError("Aucune organisation n'est associee a cette session.", 403);
  }

  return currentUser.organizationId;
}
