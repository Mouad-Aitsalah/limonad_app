import "server-only";

import { z } from "zod";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { CurrentUser, UserRole } from "@/types/auth";
import type {
  CashDepositContextDto,
  CashDepositCreateInput,
  CashDepositDto,
  CashDepositHistoryFilters,
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
  checkTotal: z.coerce.number().min(0, "Le montant des cheques ne peut pas etre negatif.").optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export async function getCashDepositContext(): Promise<CashDepositContextDto> {
  const user = await requireOrganizationUser(cashierRoles);
  const { depotId, depotName } = await resolveUserDepot(user.id, user.organizationId);
  return buildContext(user, depotId, depotName, user.organizationId);
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

  const record = await prisma.$transaction(
    async (tx) => {
      const openSession = await tx.posSession.findFirst({
        where: {
          organizationId: user.organizationId,
          status: "OPEN",
        },
        orderBy: { openedAt: "desc" },
        select: { id: true },
      });

      const cashTotal = roundMoney(
        parsed.data.denominations.reduce((sum, line) => sum + line.denomination * line.quantity, 0),
      );
      const checkTotal = roundMoney(parsed.data.checkTotal ?? 0);
      const total = roundMoney(cashTotal + checkTotal);

      const now = new Date();
      const number = await nextDepositNumber(tx, user.organizationId, now);

      return tx.cashDeposit.create({
        data: {
          organizationId: user.organizationId,
          number,
          date: startOfDay(now),
          depotId,
          posSessionId: openSession?.id ?? null,
          cashTotal,
          checkTotal,
          total,
          status: "VALIDATED",
          notes: parsed.data.notes || null,
          createdByUserId: user.id,
          denominations: {
            create: parsed.data.denominations.map((line) => ({
              denomination: line.denomination,
              quantity: line.quantity,
              amount: roundMoney(line.denomination * line.quantity),
            })),
          },
        },
        include: depositInclude,
      });
    },
    { isolationLevel: "Serializable" },
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

  const todayDeposits = await prisma.cashDeposit.findMany({
    where: {
      organizationId,
      status: "VALIDATED",
      date: { gte: todayStart, lt: todayEnd },
      ...(isAdmin ? {} : { depotId }),
    },
    select: { cashTotal: true, checkTotal: true, total: true },
  });

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
  };
}

async function resolveUserDepot(userId: string, organizationId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { depotId: true, depot: { select: { id: true, name: true, active: true } } },
  });
  if (!user?.depotId || !user.depot || !user.depot.active) {
    throw new OperationsServiceError("Aucun depot actif n'est rattache a cet utilisateur.", 409);
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
  };
}

async function nextDepositNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  date: Date,
) {
  const prefix = `VER-${formatSequenceDate(date)}-`;
  const last = await tx.cashDeposit.findFirst({
    where: {
      organizationId,
      number: { startsWith: prefix },
    },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSuffix = last?.number.match(/(\d{6})$/)?.[1];
  const next = (lastSuffix ? Number(lastSuffix) : 0) + 1;
  return `${prefix}${String(next).padStart(6, "0")}`;
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

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function mapCashDepositError(error: unknown) {
  if (error instanceof OperationsServiceError) return error;
  return new OperationsServiceError("Une erreur est survenue.", 500);
}
