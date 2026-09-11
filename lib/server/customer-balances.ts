import "server-only";

import { customerAccountNumber } from "@/lib/customer-code";
import { roundMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { resolveCustomerAuxiliaryCode } from "@/lib/server/accounting";
import { computeCustomerDebt } from "@/lib/server/customer-settlements";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { CustomerBalanceDto, CustomerBalancesPageDto } from "@/types/customer-balance";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
// Guard for the opt-in "clients soldés" listing: a plain read (no per-row
// computation) but still bounded so one page request can't scan an entire
// six-figure customer table.
const SETTLED_SCAN_CAP = 2000;

export type CustomerBalancesPageParams = {
  page?: number;
  pageSize?: number;
  /** Matches name, stored code, resolved auxiliary code, or the short client
   * number ("14"). Empty = no filter. */
  search?: string;
  /** Also list customers whose balance is 0 (default: debtors only). */
  includeSettled?: boolean;
};

type DebtorCandidate = {
  id: string;
  name: string;
  code: string;
  createdByUserName: string;
  balance: number;
};

function clampPageSize(value: number | undefined): number {
  const requested = Math.trunc(value ?? DEFAULT_PAGE_SIZE);
  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
}

function matchesSearch(needle: string, candidate: DebtorCandidate, accountCode: string): boolean {
  const haystack = [candidate.name, candidate.code, accountCode, customerAccountNumber(candidate.code)]
    .join(" ")
    .toLocaleLowerCase("fr");
  return haystack.includes(needle);
}

function settledSearchWhere(needle: string) {
  return needle
    ? {
        OR: [
          { name: { contains: needle, mode: "insensitive" as const } },
          { code: { contains: needle, mode: "insensitive" as const } },
        ],
      }
    : {};
}

/**
 * "Solde clients": every customer of the current organisation that still
 * owes money, with the auxiliary account number the Journal / Règlements
 * clients use and their real balance (computeCustomerDebt - the same source
 * as "Solde à régler"). Debtors are found the same way
 * totalCustomerReceivables does (customers with an open CREDIT /
 * PARTIALLY_PAID sale), so the per-customer debt computation only ever runs
 * for that bounded set, never for the whole customer table. Settled
 * customers are listed only on demand (`includeSettled`) and carry balance 0
 * with no computation.
 */
export async function getCustomerBalancesPage(
  params: CustomerBalancesPageParams = {},
): Promise<CustomerBalancesPageDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const organizationId = user.organizationId;

  const pageSize = clampPageSize(params.pageSize);
  const requestedPage = Math.max(1, Math.trunc(params.page ?? 1));
  const needle = params.search?.trim().toLocaleLowerCase("fr") ?? "";
  const includeSettled = params.includeSettled === true;

  // 1. Candidate debtors = customers with at least one open credit sale.
  const candidateRows = await prisma.sale.findMany({
    where: {
      organizationId,
      customerId: { not: null },
      status: { in: ["CREDIT", "PARTIALLY_PAID"] },
    },
    distinct: ["customerId"],
    select: { customerId: true },
  });
  const candidateIds = candidateRows
    .map((row) => row.customerId)
    .filter((id): id is string => Boolean(id));

  const candidateCustomers = candidateIds.length
    ? await prisma.customer.findMany({
        where: { id: { in: candidateIds }, organizationId },
        select: { id: true, name: true, code: true, createdBy: { select: { fullName: true } } },
      })
    : [];

  const debts = await Promise.all(
    candidateCustomers.map((customer) => computeCustomerDebt(prisma, organizationId, customer.id)),
  );
  const debtByCustomerId = new Map(debts.map((debt) => [debt.customerId, debt.debt]));

  const debtorRows: CustomerBalanceDto[] = candidateCustomers
    .map<DebtorCandidate>((customer) => ({
      id: customer.id,
      name: customer.name,
      code: customer.code,
      createdByUserName: customer.createdBy?.fullName?.trim() || "-",
      balance: roundMoney(debtByCustomerId.get(customer.id) ?? 0),
    }))
    .filter((candidate) => candidate.balance > 0)
    .map((candidate) => ({ candidate, accountCode: resolveCustomerAuxiliaryCode(candidate.code) }))
    .filter(({ candidate, accountCode }) => !needle || matchesSearch(needle, candidate, accountCode))
    .map(({ candidate, accountCode }) => ({
      customerId: candidate.id,
      accountCode,
      accountName: candidate.name,
      balance: candidate.balance,
      createdByUserName: candidate.createdByUserName,
    }))
    .sort((a, b) => b.balance - a.balance || a.accountName.localeCompare(b.accountName, "fr"));

  const debtorCount = debtorRows.length;
  const totalOutstanding = roundMoney(debtorRows.reduce((sum, row) => sum + row.balance, 0));
  const debtorIds = debtorRows.map((row) => row.customerId);

  // 2. Settled customers (opt-in), balance 0, no per-row computation.
  let settledCount = 0;
  if (includeSettled) {
    const rawCount = await prisma.customer.count({
      where: { organizationId, id: { notIn: debtorIds }, ...settledSearchWhere(needle) },
    });
    settledCount = Math.min(SETTLED_SCAN_CAP, rawCount);
  }

  const totalCount = debtorCount + settledCount;
  const pageCount = totalCount ? Math.max(1, Math.ceil(totalCount / pageSize)) : 0;
  const page = pageCount ? Math.min(requestedPage, pageCount) : 1;
  const offset = (page - 1) * pageSize;

  const items: CustomerBalanceDto[] = debtorRows.slice(offset, offset + pageSize);

  if (includeSettled && items.length < pageSize && offset + items.length >= debtorCount) {
    const settledOffset = Math.max(0, offset - debtorCount);
    const settled = await prisma.customer.findMany({
      where: { organizationId, id: { notIn: debtorIds }, ...settledSearchWhere(needle) },
      select: { id: true, name: true, code: true, createdBy: { select: { fullName: true } } },
      orderBy: { name: "asc" },
      skip: settledOffset,
      take: pageSize - items.length,
    });
    for (const customer of settled) {
      items.push({
        customerId: customer.id,
        accountCode: resolveCustomerAuxiliaryCode(customer.code),
        accountName: customer.name,
        balance: 0,
        createdByUserName: customer.createdBy?.fullName?.trim() || "-",
      });
    }
  }

  return { items, page, pageSize, totalCount, pageCount, debtorCount, totalOutstanding };
}
