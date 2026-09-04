import "server-only";

import { z } from "zod";

import { MONEY_RANGE_MAX_NUMBER, roundMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { Prisma } from "@/lib/generated/prisma/client";
import type {
  CustomerDebtDto,
  CustomerSettlementDto,
  CustomerSettlementInput,
} from "@/types/customer-settlement";

/**
 * BI Phase 2A - a customer paying down (part of) their credit balance.
 *
 * SOURCE OF TRUTH: never Customer.currentBalance (audit finding: 3 call
 * sites in counter-sales.ts/driver-sales.ts/pending-sales.ts only ever
 * `{ increment: creditAmount }` it, zero site decrements it - it drifted far
 * above real outstanding debt on DEV). getCustomerDebt/computeCustomerDebt
 * below always recompute from Sale + CreditNote + CustomerSettlement
 * directly. currentBalance is kept only as an OPERATIONAL CACHE (the
 * credit-limit check on new credit sales reads it) and is
 * decremented/incremented here to stay roughly in step - a future customer
 * credit note will NOT auto-adjust it (out of scope: the avoir workflow
 * itself was not touched), a drift the BI formula does not have since it
 * always re-derives from the transactional tables.
 *
 * CREDIT NOTE AUDIT FINDING (do not re-litigate without re-checking): a
 * customer CreditNote in this system is always a CASH/BANK refund
 * (CreditNoteRefundMethod has only CASH/BANK, never a "credit to account"
 * option) and Sale.status is NEVER set to CREDIT_NOTED by any code path -
 * so a credit note today does not reduce Sale.creditAmount by itself. Left
 * unadjusted, a fully credit-noted credit sale would keep reporting the
 * customer as still owing the original amount even though they were
 * refunded - computeCustomerDebt corrects for this by subtracting VALIDATED
 * customer credit notes (see its own doc comment for the precision limits
 * of this correction).
 */

const settlementInclude = {
  customer: { select: { name: true } },
  createdBy: { select: { fullName: true } },
  cancelledBy: { select: { fullName: true } },
} as const;

type SettlementRecord = Prisma.CustomerSettlementGetPayload<{ include: typeof settlementInclude }>;

const optionalString = () =>
  z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();

const settlementInputSchema = z.object({
  amount: z.coerce
    .number()
    .min(0.01, "Le montant du reglement doit etre strictement positif.")
    .max(MONEY_RANGE_MAX_NUMBER, "Le montant depasse la limite autorisee."),
  date: z.coerce.date().optional(),
  method: z.enum(["CASH", "CARD", "CHECK", "BANK_TRANSFER", "CREDIT", "MIXED"]),
  reference: optionalString(),
  note: optionalString(),
  idempotencyKey: optionalString(),
});

function mapSettlementToDto(settlement: SettlementRecord): CustomerSettlementDto {
  return {
    id: settlement.id,
    settlementNumber: settlement.settlementNumber,
    customerId: settlement.customerId,
    customerName: settlement.customer.name,
    date: settlement.date.toISOString(),
    amount: settlement.amount.toNumber(),
    method: settlement.method,
    reference: settlement.reference,
    note: settlement.note,
    status: settlement.status,
    createdByUserId: settlement.createdByUserId,
    createdByUserName: settlement.createdBy.fullName,
    cancelledByUserId: settlement.cancelledByUserId,
    cancelledByUserName: settlement.cancelledBy?.fullName ?? null,
    cancelledAt: settlement.cancelledAt?.toISOString() ?? null,
    createdAt: settlement.createdAt.toISOString(),
    updatedAt: settlement.updatedAt.toISOString(),
  };
}


/**
 * The BI/receivables source of truth for one customer:
 *   debt = max(0, creditSalesTotal - creditNotesTotal - settlementsTotal)
 * Takes a `db` (bare prisma or an active tx) so both the read-only
 * getCustomerDebt() and the write path in recordCustomerSettlement() (which
 * must see its own in-flight transaction's prior writes) share one
 * implementation - never two formulas that could drift apart.
 */
async function computeCustomerDebt(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  customerId: string,
): Promise<CustomerDebtDto> {
  const [creditAgg, creditNoteAgg, settlementAgg] = await Promise.all([
    db.sale.aggregate({
      where: {
        organizationId,
        customerId,
        status: { in: ["CREDIT", "PARTIALLY_PAID"] },
      },
      _sum: { creditAmount: true },
    }),
    db.creditNote.aggregate({
      where: {
        organizationId,
        customerId,
        partyType: "CUSTOMER",
        status: "VALIDATED",
      },
      _sum: { totalTTC: true },
    }),
    db.customerSettlement.aggregate({
      where: { organizationId, customerId, status: "VALIDATED" },
      _sum: { amount: true },
    }),
  ]);

  const creditSalesTotal = roundMoney(creditAgg._sum.creditAmount?.toNumber() ?? 0);
  const creditNotesTotal = roundMoney(creditNoteAgg._sum.totalTTC?.toNumber() ?? 0);
  const settlementsTotal = roundMoney(settlementAgg._sum.amount?.toNumber() ?? 0);
  const debt = Math.max(0, roundMoney(creditSalesTotal - creditNotesTotal - settlementsTotal));

  return { customerId, creditSalesTotal, creditNotesTotal, settlementsTotal, debt };
}

export async function getCustomerDebt(customerId: string): Promise<CustomerDebtDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!customer) throw new OperationsServiceError("Client introuvable.", 404);
  return computeCustomerDebt(prisma, user.organizationId, customerId);
}

async function nextSettlementNumber(
  tx: Pick<typeof prisma, "$queryRaw">,
  organizationId: string,
) {
  const number = await reserveDocumentSequence(
    tx,
    organizationId,
    DocumentType.CustomerSettlementNumber,
  );
  return `REGL-${String(number).padStart(6, "0")}`;
}

/**
 * Records a customer paying down (part of) their debt.
 *   - Blocks amount > current debt (422) - no override without an explicit
 *     business rule, per spec.
 *   - Idempotent: a repeated call with the same idempotencyKey (double-click,
 *     retried request) returns the already-recorded settlement, applies no
 *     second debit against currentBalance, and creates no second row.
 *   - Decrements Customer.currentBalance (operational cache only - see this
 *     file's top doc comment).
 *   - Serializable + retry: two concurrent settlements against the same
 *     customer must never both read the same pre-settlement debt and both
 *     pass the ">  debt" guard.
 */
export async function recordCustomerSettlement(
  customerId: string,
  input: CustomerSettlementInput,
): Promise<CustomerSettlementDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const parsed = settlementInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Reglement invalide.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }
  const data = parsed.data;
  assertMoneyRange(data.amount, "settlement.amount");

  const record = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const customer = await tx.customer.findFirst({
          where: { id: customerId, organizationId: user.organizationId },
          select: { id: true },
        });
        if (!customer) throw new OperationsServiceError("Client introuvable.", 404);

        if (data.idempotencyKey) {
          const existing = await tx.customerSettlement.findFirst({
            where: { organizationId: user.organizationId, idempotencyKey: data.idempotencyKey },
            include: settlementInclude,
          });
          if (existing) return existing;
        }

        const debt = await computeCustomerDebt(tx, user.organizationId, customerId);
        if (data.amount > debt.debt) {
          throw new OperationsServiceError(
            "Le reglement depasse le montant du.",
            422,
            { amount: "Le reglement depasse le montant du." },
          );
        }

        const created = await tx.customerSettlement.create({
          data: {
            organizationId: user.organizationId,
            settlementNumber: await nextSettlementNumber(tx, user.organizationId),
            customerId,
            date: data.date ?? new Date(),
            amount: data.amount,
            method: data.method,
            reference: data.reference ?? null,
            note: data.note ?? null,
            status: "VALIDATED",
            idempotencyKey: data.idempotencyKey ?? null,
            createdByUserId: user.id,
          },
          include: settlementInclude,
        });

        await tx.customer.update({
          where: { id: customerId },
          data: { currentBalance: { decrement: data.amount } },
        });

        return created;
      },
      { isolationLevel: "Serializable" },
    ),
  );

  return mapSettlementToDto(record);
}

/**
 * Idempotent: cancelling an already-CANCELLED settlement just returns it.
 * Restores the debt (and Customer.currentBalance) as if the settlement had
 * never happened. No ledger reversal needed - CustomerSettlement never
 * posts to AccountingEntry yet (Phase 2A-bis).
 */
export async function cancelCustomerSettlement(id: string): Promise<CustomerSettlementDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

  const record = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const existing = await tx.customerSettlement.findFirst({
          where: { id, organizationId: user.organizationId },
          include: settlementInclude,
        });
        if (!existing) throw new OperationsServiceError("Reglement introuvable.", 404);
        if (existing.status === "CANCELLED") return existing;

        const updated = await tx.customerSettlement.update({
          where: { id: existing.id },
          data: { status: "CANCELLED", cancelledByUserId: user.id, cancelledAt: new Date() },
          include: settlementInclude,
        });

        await tx.customer.update({
          where: { id: existing.customerId },
          data: { currentBalance: { increment: existing.amount } },
        });

        return updated;
      },
      { isolationLevel: "Serializable" },
    ),
  );

  return mapSettlementToDto(record);
}

export async function getCustomerSettlements(customerId: string): Promise<CustomerSettlementDto[]> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!customer) throw new OperationsServiceError("Client introuvable.", 404);

  const rows = await prisma.customerSettlement.findMany({
    where: { organizationId: user.organizationId, customerId },
    include: settlementInclude,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(mapSettlementToDto);
}

/**
 * BI Phase 2A helper - the "Creances clients" KPI (org-wide, not scoped to
 * one customer): sums computeCustomerDebt() over every customer that has
 * ever had a credit-bearing sale. Not a period range - receivables are a
 * balance AT a point in time, not a flow over a window.
 */
export async function totalCustomerReceivables(organizationId: string): Promise<number> {
  const customerIds = await prisma.sale.findMany({
    where: {
      organizationId,
      customerId: { not: null },
      status: { in: ["CREDIT", "PARTIALLY_PAID"] },
    },
    distinct: ["customerId"],
    select: { customerId: true },
  });

  const debts = await Promise.all(
    customerIds
      .map((row) => row.customerId)
      .filter((id): id is string => Boolean(id))
      .map((customerId) => computeCustomerDebt(prisma, organizationId, customerId)),
  );

  return roundMoney(debts.reduce((sum, item) => sum + item.debt, 0));
}

// Same shape as every other file's local withSerializableRetry in this
// codebase (counter-sales.ts, credit-notes.ts, tours.ts, business-accounts.ts,
// etc.). Retries only P2034 (Postgres serialization failure under
// Serializable isolation) / P2010 wrapping it - every other error
// (validation, not-found, over-payment) is rethrown on the first attempt.
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
        prismaError.code === "P2034" ||
        (prismaError.code === "P2010" && /40001|40P01/.test(prismaError.message ?? ""));
      if (!isRetryable || attempt >= maxAttempts) throw error;
      await sleep(Math.min(800, 10 * 1.5 ** attempt) * (0.5 + Math.random()));
    }
  }
  throw new OperationsServiceError("Impossible de finaliser le reglement.", 500);
}
