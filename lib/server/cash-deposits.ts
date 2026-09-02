import "server-only";

import { z } from "zod";

import { Prisma } from "@/lib/generated/prisma/client";
import { roundMoney as roundMoneyDecimal } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { CurrentUser, UserRole } from "@/types/auth";
import type {
  CashDepositContextDto,
  CashDepositCreateInput,
  CashDepositDto,
  CashDepositHistoryFilters,
  CashDepositSnapshotDto,
  CashDepositSummaryCalculationDto,
  CashDepositSummaryDto,
} from "@/types/cash-deposits";

// Same role set as the counter-POS itself (lib/server/counter-sales.ts) -
// a cash deposit is declared by whoever can operate the POS.
const cashierRoles: UserRole[] = ["admin", "depot_manager", "cashier"];

const depositSummaryInclude = {
  depot: { select: { name: true } },
  posSession: { select: { number: true } },
  createdBy: { select: { fullName: true } },
} satisfies Prisma.CashDepositInclude;

const depositInclude = {
  ...depositSummaryInclude,
  denominations: { orderBy: { denomination: "asc" as const } },
} satisfies Prisma.CashDepositInclude;

type DepositSummaryRecord = Prisma.CashDepositGetPayload<{ include: typeof depositSummaryInclude }>;
type DepositRecord = Prisma.CashDepositGetPayload<{ include: typeof depositInclude }>;

const denominationLineSchema = z.object({
  denomination: z.coerce.number().positive("La coupure doit etre positive."),
  // Explicit int/min(0): 0 is a valid count, but negative or non-numeric
  // input must never slip through as a quantity.
  quantity: z.coerce
    .number()
    .int("La quantite doit etre un nombre entier.")
    .min(0, "La quantite ne peut pas etre negative."),
});

const cashDepositCreateSchema = z.object({
  denominations: z.array(denominationLineSchema).min(1, "Ajoutez au moins une coupure."),
  cashDepositAmount: z.coerce
    .number()
    .min(0, "Le montant en especes a verser ne peut pas etre negatif.")
    .optional(),
  checkTotal: z.coerce.number().min(0, "Le montant des cheques ne peut pas etre negatif.").optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export async function getCashDepositContext(): Promise<CashDepositContextDto> {
  const user = await requireOrganizationUser(cashierRoles);
  const { depotId, depotName } = await resolveUserDepot(user.id, user.organizationId);
  return buildContext(user, depotId, depotName, user.organizationId);
}

export async function getCashDepositSummary(): Promise<CashDepositSummaryCalculationDto> {
  const user = await requireOrganizationUser(cashierRoles);
  const { depotId } = await resolveUserDepot(user.id, user.organizationId);
  return mapCashSummaryToDto(
    await buildCashDepositSummary(prisma, user.organizationId, depotId, startOfDay(new Date())),
  );
}

/**
 * "Valider le versement": validates quantities, computes every line amount,
 * the cash total, the grand total (cash + checks), then creates the
 * CashDeposit + its CashDepositDenomination rows in one transaction. The
 * deposit is created already VALIDATED - there is no separate draft state
 * to persist, so a page reload always shows a fully committed record.
 *
 * The POS/register is never asked from the cashier: it is resolved from the
 * session user's own depotId (the exact same resolution the counter POS
 * already uses in lib/server/counter-sales.ts), so it can never be spoofed
 * or mis-selected client-side.
 */
export async function createCashDeposit(
  input: CashDepositCreateInput,
): Promise<{ deposit: CashDepositDto; context: CashDepositContextDto }> {
  const user = await requireOrganizationUser(cashierRoles);
  const parsed = cashDepositCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }

  const seenDenominations = new Set<number>();
  for (const line of parsed.data.denominations) {
    if (seenDenominations.has(line.denomination)) {
      throw new OperationsServiceError("Une coupure ne peut apparaitre qu'une seule fois.", 422);
    }
    seenDenominations.add(line.denomination);
  }

  const { depotId, depotName } = await resolveUserDepot(user.id, user.organizationId);

  // F10: read-then-write (nextDepositNumber counts existing rows, then
  // creates one) - a retry after a Serializable conflict (P2034) or a
  // numbering race (P2002 on the unique [organizationId, number] index)
  // simply recomputes a fresh number and creates one correct row, never a
  // duplicate deposit.
  const record = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
      const openSession = await tx.posSession.findFirst({
        where: {
          organizationId: user.organizationId,
          status: "OPEN",
        },
        orderBy: { openedAt: "desc" },
        select: { id: true },
      });

      // F8-E: each line's own amount, checked before rounding/further use -
      // a large-but-plausible denomination times a large count is exactly
      // the case a bound on quantity alone would miss (see
      // lib/money.ts#isWithinMoneyRange). CashDepositDenomination.amount is
      // Decimal(12,2), same bound as everything else checked below.
      // (denomination itself is the narrower Decimal(10,2) - see the F8-E
      // report's "risques restants" for why that isn't gated here too.)
      const denominationAmounts = parsed.data.denominations.map((line) =>
        roundMoney(line.denomination * line.quantity),
      );
      for (const amount of denominationAmounts) {
        assertMoneyRange(amount, "denomination.amount");
      }

      // cashTotal itself kept as a single roundMoney over the raw sum -
      // exactly as before F8-E - so its own rounding behavior does not
      // change even though each line's amount is now also range-checked
      // above (summing pre-rounded per-line amounts instead could produce
      // a different result in a sum-of-rounded-vs-round-of-sum edge case).
      const countedCash = roundMoney(
        parsed.data.denominations.reduce((sum, line) => sum + line.denomination * line.quantity, 0),
      );
      // Older clients retain the previous behavior when this new input is absent.
      const cashTotal = roundMoney(parsed.data.cashDepositAmount ?? countedCash);
      const checkTotal = roundMoney(parsed.data.checkTotal ?? 0);
      const total = roundMoney(cashTotal + checkTotal);
      // F8-E: aggregate totals, checked before any write in this
      // transaction (cashDeposit.create - with its nested denominations
      // create - is the only write here).
      assertMoneyRange(countedCash, "cashDeposit.countedCash");
      assertMoneyRange(cashTotal, "cashDeposit.cashTotal");
      assertMoneyRange(checkTotal, "cashDeposit.checkTotal");
      assertMoneyRange(total, "cashDeposit.total");
      if (cashTotal > countedCash) {
        throw new OperationsServiceError(
          "Le versement en especes ne peut pas depasser les especes comptees.",
          422,
          { cashDepositAmount: "Le montant doit etre inferieur ou egal aux especes comptees." },
        );
      }

      const now = new Date();
      const depositDate = startOfDay(now);
      const cashSummary = await buildCashDepositSummary(
        tx,
        user.organizationId,
        depotId,
        depositDate,
      );
      const cashDifference = new Prisma.Decimal(countedCash).minus(cashSummary.availableCash);
      const cashRemaining = new Prisma.Decimal(countedCash).minus(cashTotal);
      const number = await nextDepositNumber(tx, user.organizationId, now);

      return tx.cashDeposit.create({
        data: {
          organizationId: user.organizationId,
          number,
          date: depositDate,
          depotId,
          posSessionId: openSession?.id ?? null,
          cashTotal,
          checkTotal,
          total,
          cashSales: cashSummary.cashSales,
          cashExpenses: cashSummary.cashExpenses,
          availableCash: cashSummary.availableCash,
          countedCash,
          cashDifference,
          cashRemaining,
          status: "VALIDATED",
          notes: parsed.data.notes || null,
          createdByUserId: user.id,
          denominations: {
            create: parsed.data.denominations.map((line, index) => ({
              denomination: line.denomination,
              quantity: line.quantity,
              amount: denominationAmounts[index],
            })),
          },
        },
        include: depositInclude,
      });
      },
      // 15s: same class of fix already applied to counter-sales.ts /
      // purchases.ts / credit-notes.ts's equivalent transactions - several
      // sequential round-trips can exceed Prisma's 5s default
      // interactive-transaction timeout (P2028) against Neon's serverless
      // connection latency, even with no real conflict.
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  );

  const context = await buildContext(user, depotId, depotName, user.organizationId);
  return { deposit: mapDepositToDto(record), context };
}

export async function getCashDepositHistory(
  filters: CashDepositHistoryFilters,
): Promise<CashDepositSummaryDto[]> {
  const user = await requireOrganizationUser(cashierRoles);
  const { depotId } = await resolveUserDepot(user.id, user.organizationId);
  const isAdmin = user.role === "admin";

  const where: Prisma.CashDepositWhereInput = {
    organizationId: user.organizationId,
  };
  // depot_manager and cashier only ever see their own depot's history,
  // enforced here (not just hidden in the UI) - only admin may cross depots.
  if (!isAdmin) {
    where.depotId = depotId;
  } else if (filters.depotId) {
    where.depotId = filters.depotId;
  }
  if (filters.search?.trim()) {
    where.number = { contains: filters.search.trim(), mode: "insensitive" };
  }
  if (filters.dateFrom || filters.dateTo) {
    where.date = {
      ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00`) } : {}),
      ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59`) } : {}),
    };
  }
  if (filters.userId) {
    where.createdByUserId = filters.userId;
  }
  if (filters.status) {
    where.status = filters.status;
  }

  const deposits = await prisma.cashDeposit.findMany({
    where,
    include: depositSummaryInclude,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return deposits.map(mapDepositToSummaryDto);
}

export async function getCashDepositById(id: string): Promise<CashDepositDto> {
  const user = await requireOrganizationUser(cashierRoles);
  const deposit = await prisma.cashDeposit.findFirst({
    where: {
      id,
      organizationId: user.organizationId,
    },
    include: depositInclude,
  });
  if (!deposit) {
    throw new OperationsServiceError("Versement introuvable.", 404);
  }

  if (user.role !== "admin") {
    const { depotId } = await resolveUserDepot(user.id, user.organizationId);
    if (deposit.depotId !== depotId) {
      throw new OperationsServiceError("Acces non autorise a ce versement.", 403);
    }
  }

  return mapDepositToDto(deposit);
}

async function buildContext(
  user: CurrentUser,
  depotId: string,
  depotName: string,
  organizationId: string,
): Promise<CashDepositContextDto> {
  const openSession = await prisma.posSession.findFirst({
    where: { organizationId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { id: true, number: true },
  });

  const isAdmin = user.role === "admin";
  const todayStart = startOfDay(new Date());
  const todayEnd = addDays(todayStart, 1);

  const [todayDeposits, cashSummary] = await Promise.all([
    prisma.cashDeposit.findMany({
      where: {
        organizationId,
        status: "VALIDATED",
        date: { gte: todayStart, lt: todayEnd },
        ...(isAdmin ? {} : { depotId }),
      },
      select: { cashTotal: true, checkTotal: true, total: true },
    }),
    buildCashDepositSummary(prisma, organizationId, depotId, todayStart),
  ]);

  return {
    depotId,
    depotName,
    posSessionId: openSession?.id ?? null,
    posSessionNumber: openSession?.number ?? null,
    userName: user.nom,
    canFilterByDepot: isAdmin,
    todayCount: todayDeposits.length,
    todayTotal: roundMoney(todayDeposits.reduce((sum, d) => sum + d.total.toNumber(), 0)),
    todayCashTotal: roundMoney(todayDeposits.reduce((sum, d) => sum + d.cashTotal.toNumber(), 0)),
    todayCheckTotal: roundMoney(todayDeposits.reduce((sum, d) => sum + d.checkTotal.toNumber(), 0)),
    cashSummary: mapCashSummaryToDto(cashSummary),
  };
}

type CashSummaryDecimals = {
  cashSales: Prisma.Decimal;
  cashExpenses: Prisma.Decimal;
  availableCash: Prisma.Decimal;
};

/**
 * The register source of truth is event-based, never the organization-wide
 * ledger balance. Only cash payments received by this depot increase the
 * register; only cash purchases made by this depot decrease it.
 */
async function buildCashDepositSummary(
  db: typeof prisma | Prisma.TransactionClient,
  organizationId: string,
  depotId: string,
  date: Date,
): Promise<CashSummaryDecimals> {
  const dayEnd = addDays(date, 1);
  const [sales, expenses] = await Promise.all([
    db.payment.aggregate({
      where: {
        organizationId,
        method: "CASH",
        status: "VALIDATED",
        receivedAt: { gte: date, lt: dayEnd },
        sale: {
          organizationId,
          depotId,
          origin: "COUNTER",
          status: { in: ["PAID", "PARTIALLY_PAID"] },
        },
      },
      _sum: { amount: true },
    }),
    db.purchase.aggregate({
      where: {
        organizationId,
        depotId,
        status: "RECEIVED",
        paymentMethod: "especes",
        OR: [
          { paymentDate: { gte: date, lt: dayEnd } },
          { paymentDate: null, orderDate: { gte: date, lt: dayEnd } },
        ],
      },
      _sum: { totalTTC: true },
    }),
  ]);

  const cashSales = sales._sum.amount ?? new Prisma.Decimal(0);
  const cashExpenses = expenses._sum.totalTTC ?? new Prisma.Decimal(0);
  const availableCash = cashSales.minus(cashExpenses);

  return { cashSales, cashExpenses, availableCash };
}

function mapCashSummaryToDto(summary: CashSummaryDecimals): CashDepositSummaryCalculationDto {
  return {
    cashSales: summary.cashSales.toNumber(),
    cashExpenses: summary.cashExpenses.toNumber(),
    availableCash: summary.availableCash.toNumber(),
    hasCashShortfall: summary.availableCash.lt(0),
  };
}

async function resolveUserDepot(userId: string, organizationId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { depotId: true, depot: { select: { id: true, name: true, active: true } } },
  });
  if (!user?.depotId || !user.depot || !user.depot.active) {
    throw new OperationsServiceError("Aucun depot actif n'est associe a votre compte. Contactez un administrateur.", 409);
  }
  return { depotId: user.depot.id, depotName: user.depot.name };
}

function mapDepositToSummaryDto(deposit: DepositSummaryRecord): CashDepositSummaryDto {
  return {
    id: deposit.id,
    number: deposit.number,
    date: deposit.date.toISOString(),
    depotId: deposit.depotId,
    depotName: deposit.depot.name,
    posSessionId: deposit.posSessionId,
    posSessionNumber: deposit.posSession?.number ?? null,
    cashTotal: deposit.cashTotal.toNumber(),
    checkTotal: deposit.checkTotal.toNumber(),
    total: deposit.total.toNumber(),
    status: deposit.status,
    notes: deposit.notes,
    createdByUserId: deposit.createdByUserId,
    createdByUserName: deposit.createdBy.fullName,
    createdAt: deposit.createdAt.toISOString(),
  };
}

function mapDepositToDto(deposit: DepositRecord): CashDepositDto {
  return {
    ...mapDepositToSummaryDto(deposit),
    denominations: deposit.denominations.map((line) => ({
      denomination: line.denomination.toNumber(),
      quantity: line.quantity,
      amount: line.amount.toNumber(),
    })),
    cashSummary: mapDepositSnapshot(deposit),
  };
}

function mapDepositSnapshot(deposit: DepositRecord): CashDepositSnapshotDto | null {
  if (
    deposit.cashSales === null ||
    deposit.cashExpenses === null ||
    deposit.availableCash === null ||
    deposit.countedCash === null ||
    deposit.cashDifference === null ||
    deposit.cashRemaining === null
  ) {
    return null;
  }

  return {
    cashSales: deposit.cashSales.toNumber(),
    cashExpenses: deposit.cashExpenses.toNumber(),
    availableCash: deposit.availableCash.toNumber(),
    hasCashShortfall: deposit.availableCash.lt(0),
    countedCash: deposit.countedCash.toNumber(),
    cashDifference: deposit.cashDifference.toNumber(),
    cashRemaining: deposit.cashRemaining.toNumber(),
  };
}

async function nextDepositNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  date: Date,
) {
  const scopeDate = formatSequenceDate(date);
  const number = await reserveDocumentSequence(
    tx,
    organizationId,
    DocumentType.CashDeposit,
    scopeDate,
  );
  return `VER-${scopeDate}-${String(number).padStart(6, "0")}`;
}

// Both the "VER-YYYYMMDD-..." prefix and the @db.Date "date" column must
// reflect the calendar day as the cashier's local clock sees it (this
// server runs UTC+1), not the UTC day - otherwise a deposit made after
// local midnight but before UTC midnight would silently number/file itself
// under yesterday. Local getters read "which day is it here"; Date.UTC()
// re-anchors that Y/M/D as a UTC-midnight instant so a @db.Date column
// (which normalizes to UTC) stores that exact same day, not the day before.
function formatSequenceDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function addDays(date: Date, days: number) {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + days);
  return clone;
}

// F8-C: delegates to the shared decimal-based engine (lib/money.ts) instead
// of `Math.round(value * 100) / 100`. Kept under this same local name so
// every call site in this file needed zero changes.
function roundMoney(value: number) {
  return roundMoneyDecimal(value);
}

export function mapCashDepositError(error: unknown) {
  if (error instanceof OperationsServiceError) return error;
  return new OperationsServiceError("Une erreur est survenue.", 500);
}

// F10: same shape as every other file's local withSerializableRetry in
// this codebase (counter-sales.ts, credit-notes.ts, tours.ts, etc.) -
// retries P2002 (numbering race on the unique [organizationId, number]
// index) and P2034 (Serializable conflict) alike, since createCashDeposit
// is safe to simply re-run on either.
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

  throw new OperationsServiceError("Impossible d'enregistrer le versement.", 500);
}
