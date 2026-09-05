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

/**
 * LEGACY MIXED handling: "some cash now, the rest on credit" - a single
 * paidAmount with no record of which instrument it was paid in. Kept
 * exactly as-is for the driver POS (components/driver-pos), which still
 * offers MIXED with this single-amount semantics and never sends the new
 * cashAmount/chequeAmount fields. The counter POS (components/pos) no
 * longer uses this branch for MIXED - see resolveMixedPaymentSplit below,
 * which callers use instead whenever those fields are present (audit: 0
 * MIXED sales existed in DEV under this legacy behaviour before the
 * cash+cheque split feature was added, so this is dead in practice for the
 * counter POS, only kept for the untouched driver flow).
 */
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
 * Counter-POS MIXED: cash + cheque covering ALL OR PART of the total. The
 * paid part is `cash + cheque`; whatever is left (`total - paid`) becomes a
 * customer receivable (`Sale.creditAmount`), exactly like a partial CREDIT
 * sale - so a mixed payment can now settle a sale only partially.
 *   - Allowed: `0 < cash + cheque <= total`.
 *   - Refused: `cash + cheque > total` (overpayment) or `cash = cheque = 0`.
 *   - Either side alone may be 0 (cheque-only or cash-only), but not both.
 * Both non-zero amounts persist as their own Payment row (one CASH, one
 * CHECK) so the split survives for the journal, reports, the ticket and
 * future exports - see createMixedPayments below.
 */
export function resolveMixedPaymentSplit(
  totalTTC: number,
  cashAmountInput: number | undefined,
  chequeAmountInput: number | undefined,
): { paidAmount: number; creditAmount: number; cashAmount: number; chequeAmount: number } {
  const cashAmount = roundMoney(cashAmountInput ?? 0);
  const chequeAmount = roundMoney(chequeAmountInput ?? 0);
  if (
    !Number.isFinite(cashAmount) ||
    !Number.isFinite(chequeAmount) ||
    cashAmount < 0 ||
    chequeAmount < 0
  ) {
    throw new OperationsServiceError(
      "Les montants Especes et Cheque doivent etre des nombres positifs.",
      422,
    );
  }
  if (cashAmount <= 0 && chequeAmount <= 0) {
    throw new OperationsServiceError(
      "Saisissez un montant en especes ou en cheque.",
      422,
    );
  }

  const paidAmount = roundMoney(cashAmount + chequeAmount);
  const target = roundMoney(totalTTC);
  if (paidAmount > target) {
    throw new OperationsServiceError("Le montant saisi depasse le total a regler.", 422);
  }

  return {
    paidAmount,
    creditAmount: roundMoney(target - paidAmount),
    cashAmount,
    chequeAmount,
  };
}

/**
 * The civil day boundary POS activity is scoped to (server local time,
 * matching resolvePosSession / resolveSaleSequencing). "Factures du jour"
 * uses the same boundary.
 */
export function posDayStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Resolves (reusing or opening) the POS session for `now` - the session
 * part of resolveSaleSequencing, without reserving an official saleNumber.
 * Used by the "prepare a pending invoice" path, which must be attributable
 * to today's session but must NOT consume the year-scoped Sale sequence
 * (that is only spent at collection).
 */
export async function resolvePosSession(
  tx: Pick<typeof prisma, "posSession" | "$queryRaw">,
  now: Date,
  userId: string,
  organizationId: string,
): Promise<string> {
  const year = now.getFullYear();
  const dayStart = posDayStart(now);

  const lastSession = await tx.posSession.findFirst({
    where: { organizationId },
    orderBy: { number: "desc" },
  });
  const reuseExisting =
    lastSession !== null && lastSession.status === "OPEN" && lastSession.openedAt >= dayStart;

  if (reuseExisting && lastSession) {
    return lastSession.id;
  }
  if (lastSession && lastSession.status === "OPEN") {
    await tx.posSession.update({
      where: { id: lastSession.id },
      data: { status: "CLOSED", closedAt: now },
    });
  }
  const number = await reserveDocumentSequence(tx, organizationId, DocumentType.PosSession);
  const created = await tx.posSession.create({
    data: {
      organizationId,
      number,
      year,
      openedAt: now,
      status: "OPEN",
      openedByUserId: userId,
    },
  });
  return created.id;
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

  const posSessionId = await resolvePosSession(tx, now, userId, scopedOrganizationId);

  const saleNumber = await reserveDocumentSequence(
    tx,
    scopedOrganizationId,
    DocumentType.Sale,
    String(year),
  );

  return { saleYear: year, saleNumber, posSessionId };
}

/**
 * Throwaway provisional reference for a sale prepared but not yet collected
 * ("BR-YYYYMMDD-000001", per day). It lives in Sale.invoiceNumber only
 * until collection, when it is replaced by the real nextInvoiceNumber().
 * Gaps in this sequence are meaningless - the official Invoice / Sale
 * sequences are never spent by an abandoned draft.
 */
export async function nextPendingSaleRef(
  tx: Pick<typeof prisma, "$queryRaw">,
  organizationId: string,
) {
  const today = new Date();
  const date = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const number = await reserveDocumentSequence(
    tx,
    organizationId,
    DocumentType.SalePendingRef,
    date,
  );
  return `BR-${date}-${String(number).padStart(6, "0")}`;
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

/**
 * A counter-POS MIXED sale persists ONE Payment row per instrument actually
 * used (a CASH row iff cashAmount > 0, a CHECK row iff chequeAmount > 0) -
 * never a zero-amount row, never a single row with method=MIXED
 * (Payment.saleId was never unique, so this needed no schema change). This
 * is how the split survives for the journal, sales history, the ticket and
 * future exports. At least one of the two amounts is > 0 (guaranteed by
 * resolveMixedPaymentSplit).
 *
 * Returns one stable, non-null `{ id, reference }` for the sale's
 * settlement-entry dedup key (see postSaleAccountingEntry's
 * settlementSourceId) - the CASH row when there is one, otherwise the CHECK
 * row.
 */
export async function createMixedPayments(
  tx: Pick<typeof prisma, "payment" | "$queryRaw">,
  input: {
    organizationId: string;
    saleId: string;
    cashAmount: number;
    chequeAmount: number;
    reference: string | null;
    receivedByUserId: string;
  },
): Promise<{ id: string; reference: string | null }> {
  const receivedAt = new Date();
  let dedupPayment: { id: string; reference: string | null } | null = null;

  if (input.cashAmount > 0) {
    dedupPayment = await tx.payment.create({
      data: {
        organizationId: input.organizationId,
        paymentNumber: await nextPaymentNumber(tx, input.organizationId),
        saleId: input.saleId,
        amount: input.cashAmount,
        method: "CASH",
        status: "VALIDATED",
        reference: null,
        receivedByUserId: input.receivedByUserId,
        receivedAt,
      },
      select: { id: true, reference: true },
    });
  }

  if (input.chequeAmount > 0) {
    const chequePayment = await tx.payment.create({
      data: {
        organizationId: input.organizationId,
        paymentNumber: await nextPaymentNumber(tx, input.organizationId),
        saleId: input.saleId,
        amount: input.chequeAmount,
        method: "CHECK",
        status: "VALIDATED",
        reference: input.reference,
        receivedByUserId: input.receivedByUserId,
        receivedAt,
      },
      select: { id: true, reference: true },
    });
    dedupPayment ??= chequePayment;
  }

  if (!dedupPayment) {
    // Unreachable: resolveMixedPaymentSplit rejects cash = cheque = 0.
    throw new OperationsServiceError("Paiement mixte sans montant.", 422);
  }
  return dedupPayment;
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
