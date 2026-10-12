import { Prisma } from "@/lib/generated/prisma/client";
import { roundMoney } from "@/lib/money";
import {
  AGING_BUCKETS,
  ageInDays,
  allocateFifo,
  balanceFromTotals,
  businessDayOf,
  saleInstant,
  summarizeAging,
  sumMoney,
} from "@/lib/receivables/aging";
import { buildMovements, type MovementInput } from "@/lib/receivables/movements";
import { parseReceivablesSettings, withReceivablesSettings } from "@/lib/receivables/settings";
import { formatSaleDisplayNumber } from "@/lib/sale-display-number";
import { computeCustomerDebt } from "@/lib/server/customer-debt";
import type {
  CustomerReceivableDetailDto,
  ReceivablesCreditorRow,
  ReceivablesDebtorRow,
  ReceivablesOverviewDto,
  ReceivablesSettings,
} from "@/types/receivables";

/**
 * Dashboard « Créances clients » - the database side, for ONE organisation that
 * the caller has already authorised (lib/server/receivables.ts: admin only,
 * organisation from the session). The client is injected so the tests run it
 * inside a rolled-back transaction. READ ONLY, except writeReceivablesSettings
 * (the admin's overdue delay).
 *
 * The balance of every customer is computeCustomerDebt's formula, computed for
 * all customers at once with grouped queries (loadCustomerBalances); the tests
 * prove it equals computeCustomerDebt customer by customer. The rules (FIFO
 * aging, dates, buckets) are in lib/receivables/aging.ts.
 */

export type ReceivablesDb = Prisma.TransactionClient;

/** The sale statuses computeCustomerDebt counts. */
export const OPEN_CREDIT_STATUSES = ["CREDIT", "PARTIALLY_PAID"] as const;

/** Debtor rows sent to the browser (the KPIs always cover every debtor). */
export const DEBTOR_ROWS_CAP = 2000;
/** Movements listed in a customer's detail (older ones are folded into an opening balance). */
export const DETAIL_MOVEMENTS_CAP = 500;

export class ReceivablesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ReceivablesError";
  }
}

export type CustomerBalance = {
  customerId: string;
  creditSalesTotal: number;
  creditNotesTotal: number;
  settlementsTotal: number;
  /** creditSales - creditNotes - settlements (negative = credit balance). */
  raw: number;
  /** max(0, raw) - computeCustomerDebt(...).debt */
  debt: number;
  cashCreditNotesTotal: number;
  cashCreditNotesCount: number;
};

const money = (value: Prisma.Decimal | null | undefined) => roundMoney(value?.toNumber() ?? 0);

/**
 * computeCustomerDebt for EVERY customer of the organisation that has a credit
 * sale, a validated customer credit note or a validated settlement - 4 grouped
 * queries instead of 3 queries per customer. Same filters, same rounding.
 */
export async function loadCustomerBalances(db: ReceivablesDb, organizationId: string): Promise<Map<string, CustomerBalance>> {
  const [sales, notes, cashNotes, settlements] = await Promise.all([
    db.sale.groupBy({
      by: ["customerId"],
      where: { organizationId, customerId: { not: null }, status: { in: [...OPEN_CREDIT_STATUSES] } },
      _sum: { creditAmount: true },
    }),
    db.creditNote.groupBy({
      by: ["customerId"],
      where: { organizationId, customerId: { not: null }, partyType: "CUSTOMER", status: "VALIDATED" },
      _sum: { totalTTC: true },
    }),
    db.creditNote.groupBy({
      by: ["customerId"],
      where: { organizationId, customerId: { not: null }, partyType: "CUSTOMER", status: "VALIDATED", refundMethod: "CASH" },
      _sum: { totalTTC: true },
      _count: { _all: true },
    }),
    db.customerSettlement.groupBy({
      by: ["customerId"],
      where: { organizationId, status: "VALIDATED" },
      _sum: { amount: true },
    }),
  ]);

  const creditSales = new Map(sales.map((row) => [row.customerId as string, money(row._sum.creditAmount)]));
  const creditNotes = new Map(notes.map((row) => [row.customerId as string, money(row._sum.totalTTC)]));
  const cash = new Map(cashNotes.map((row) => [row.customerId as string, { total: money(row._sum.totalTTC), count: row._count._all }]));
  const settled = new Map(settlements.map((row) => [row.customerId, money(row._sum.amount)]));

  const ids = new Set<string>([...creditSales.keys(), ...creditNotes.keys(), ...settled.keys()]);
  const out = new Map<string, CustomerBalance>();
  for (const customerId of ids) {
    const creditSalesTotal = creditSales.get(customerId) ?? 0;
    const creditNotesTotal = creditNotes.get(customerId) ?? 0;
    const settlementsTotal = settled.get(customerId) ?? 0;
    const { raw, debt } = balanceFromTotals(creditSalesTotal, creditNotesTotal, settlementsTotal);
    out.set(customerId, {
      customerId,
      creditSalesTotal,
      creditNotesTotal,
      settlementsTotal,
      raw,
      debt,
      cashCreditNotesTotal: cash.get(customerId)?.total ?? 0,
      cashCreditNotesCount: cash.get(customerId)?.count ?? 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------- settings

export async function readReceivablesSettings(db: Pick<ReceivablesDb, "organization">, organizationId: string): Promise<ReceivablesSettings> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { productColumnSettings: true },
  });
  return parseReceivablesSettings(organization?.productColumnSettings);
}

/** Stores the overdue delay (other keys of the settings JSON untouched) and audits the change. */
export async function writeReceivablesSettings(
  db: ReceivablesDb,
  organizationId: string,
  userId: string,
  overdueDays: number,
): Promise<ReceivablesSettings> {
  const before = await db.organization.findUnique({
    where: { id: organizationId },
    select: { productColumnSettings: true },
  });
  if (!before) throw new ReceivablesError("Organisation introuvable.", 404);
  const previous = parseReceivablesSettings(before.productColumnSettings);
  await db.organization.update({
    where: { id: organizationId },
    data: { productColumnSettings: withReceivablesSettings(before.productColumnSettings, overdueDays) as Prisma.InputJsonObject },
    select: { id: true },
  });
  await db.auditLog.create({
    data: {
      organizationId,
      userId,
      action: "RECEIVABLES_OVERDUE_DAYS_UPDATED",
      entityType: "Organization",
      entityId: organizationId,
      oldValue: { overdueDays: previous.overdueDays, isDefault: previous.isDefault },
      newValue: { overdueDays },
    },
  });
  return { overdueDays, isDefault: false };
}

// ---------------------------------------------------------------- overview

type OpenSaleRow = { customerId: string; amount: number; newer: number; at: Date };

/**
 * The still-open part of the credit sales, FIFO, computed by the database: for
 * each credit sale, the sum of the customer's NEWER credit sales; a sale is
 * (partly) open when that sum is below the customer's debt. Only those rows come
 * back - never the whole credit history. Ordering = the FIFO order
 * (soldAt|validatedAt|createdAt, createdAt, id - byte order), the same as the
 * customer detail.
 */
async function loadOpenSaleParts(db: ReceivablesDb, organizationId: string, debts: Map<string, number>) {
  if (debts.size === 0) return [] as Array<{ customerId: string; open: number; at: Date }>;
  const ids = [...debts.keys()];
  const amounts = ids.map((id) => (debts.get(id) ?? 0).toFixed(2));
  const statuses = [...OPEN_CREDIT_STATUSES];
  const rows = await db.$queryRaw<OpenSaleRow[]>(Prisma.sql`
    SELECT r."customerId", r.amount::float8 AS amount, r.newer::float8 AS newer, r.at
    FROM (
      SELECT s."customerId",
             s."creditAmount" AS amount,
             COALESCE(s."soldAt", s."validatedAt", s."createdAt") AS at,
             COALESCE(SUM(s."creditAmount") OVER (
               PARTITION BY s."customerId"
               ORDER BY COALESCE(s."soldAt", s."validatedAt", s."createdAt") DESC, s."createdAt" DESC, s.id COLLATE "C" DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0) AS newer
      FROM "Sale" s
      WHERE s."organizationId" = ${organizationId}
        AND s."customerId" IS NOT NULL
        AND s.status::text = ANY(${statuses})
        AND s."creditAmount" > 0
    ) r
    JOIN unnest(${ids}::text[], ${amounts}::numeric[]) AS d("customerId", debt) ON d."customerId" = r."customerId"
    WHERE r.newer < d.debt
  `);
  return rows.map((row) => {
    const debt = debts.get(row.customerId) ?? 0;
    const open = Math.min(row.amount, roundMoney(debt - row.newer));
    return { customerId: row.customerId, open: Math.max(0, open), at: new Date(row.at) };
  });
}

export async function loadReceivablesOverview(
  db: ReceivablesDb,
  organizationId: string,
  options: { now: Date; settings: ReceivablesSettings },
): Promise<Omit<ReceivablesOverviewDto, "debtors" | "creditors"> & {
  debtors: Array<Omit<ReceivablesDebtorRow, "accountCode">>;
  creditors: { count: number; total: number; rows: Array<Omit<ReceivablesCreditorRow, "accountCode">> };
}> {
  const asOfDay = businessDayOf(options.now);
  const { overdueDays } = options.settings;
  const balances = await loadCustomerBalances(db, organizationId);

  const debtorBalances = [...balances.values()].filter((balance) => balance.debt > 0);
  const creditorBalances = [...balances.values()].filter((balance) => balance.raw < 0);
  const metaIds = [...debtorBalances, ...creditorBalances].map((balance) => balance.customerId);

  const [parts, customers, lastSettlements] = await Promise.all([
    loadOpenSaleParts(db, organizationId, new Map(debtorBalances.map((balance) => [balance.customerId, balance.debt]))),
    metaIds.length
      ? db.customer.findMany({
          where: { organizationId, id: { in: metaIds } },
          select: { id: true, name: true, code: true, status: true },
        })
      : Promise.resolve([]),
    debtorBalances.length
      ? db.customerSettlement.groupBy({
          by: ["customerId"],
          where: { organizationId, status: "VALIDATED", customerId: { in: debtorBalances.map((balance) => balance.customerId) } },
          _max: { date: true },
        })
      : Promise.resolve([]),
  ]);

  const meta = new Map(customers.map((customer) => [customer.id, customer]));
  const lastSettlementDay = new Map(
    lastSettlements.map((row) => [row.customerId, row._max.date ? row._max.date.toISOString().slice(0, 10) : null]),
  );
  const partsByCustomer = new Map<string, Array<{ open: number; ageDays: number }>>();
  for (const part of parts) {
    const list = partsByCustomer.get(part.customerId) ?? [];
    list.push({ open: part.open, ageDays: ageInDays(businessDayOf(part.at), asOfDay) });
    partsByCustomer.set(part.customerId, list);
  }

  let agingMismatchCount = 0;
  const debtors: Array<Omit<ReceivablesDebtorRow, "accountCode">> = debtorBalances
    // A balance whose customer row is not in this organisation is never shown (defensive - ids come from org-scoped queries).
    .filter((balance) => meta.has(balance.customerId))
    .map((balance) => {
      const customer = meta.get(balance.customerId)!;
      const aging = summarizeAging(partsByCustomer.get(balance.customerId) ?? [], overdueDays);
      if (Math.round(aging.total * 100) !== Math.round(balance.debt * 100)) agingMismatchCount += 1;
      return {
        customerId: balance.customerId,
        name: customer.name,
        code: customer.code,
        status: customer.status,
        balance: balance.debt,
        overdue: aging.overdue,
        over30: aging.over30,
        buckets: aging.buckets,
        oldestOpenAgeDays: aging.oldestOpenAgeDays,
        lastSettlementDay: lastSettlementDay.get(balance.customerId) ?? null,
        cashCreditNotesTotal: balance.cashCreditNotesTotal,
      };
    })
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));

  const creditorRows = creditorBalances
    .filter((balance) => meta.has(balance.customerId))
    .map((balance) => {
      const customer = meta.get(balance.customerId)!;
      const creditBalance = roundMoney(-balance.raw);
      return {
        customerId: balance.customerId,
        name: customer.name,
        code: customer.code,
        creditBalance,
        cashCreditNotesTotal: balance.cashCreditNotesTotal,
        explainedByCashCreditNotes: balance.cashCreditNotesTotal >= creditBalance,
      };
    })
    .sort((a, b) => b.creditBalance - a.creditBalance || a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));

  const buckets = AGING_BUCKETS.map(({ key }) => ({
    key,
    amount: sumMoney(debtors.map((row) => row.buckets[key])),
    customerCount: debtors.filter((row) => row.buckets[key] > 0).length,
  }));

  const cashNotes = [...balances.values()].filter((balance) => balance.cashCreditNotesCount > 0);

  return {
    asOfDay,
    settings: options.settings,
    totals: {
      totalOutstanding: sumMoney(debtors.map((row) => row.balance)),
      debtorCount: debtors.length,
      overdue: sumMoney(debtors.map((row) => row.overdue)),
      over30: sumMoney(debtors.map((row) => row.over30)),
    },
    buckets,
    debtors: debtors.slice(0, DEBTOR_ROWS_CAP),
    debtorsTruncated: debtors.length > DEBTOR_ROWS_CAP,
    creditors: {
      count: creditorRows.length,
      total: sumMoney(creditorRows.map((row) => row.creditBalance)),
      rows: creditorRows.slice(0, DEBTOR_ROWS_CAP),
    },
    dataNotes: {
      cashCreditNotes: {
        count: cashNotes.reduce((sum, balance) => sum + balance.cashCreditNotesCount, 0),
        total: sumMoney(cashNotes.map((balance) => balance.cashCreditNotesTotal)),
      },
      agingMismatchCount,
    },
  };
}

// ---------------------------------------------------------------- detail

export async function loadCustomerReceivableDetail(
  db: ReceivablesDb,
  organizationId: string,
  customerId: string,
  options: { now: Date; settings: ReceivablesSettings },
): Promise<Omit<CustomerReceivableDetailDto, "customer"> & { customer: Omit<CustomerReceivableDetailDto["customer"], "accountCode"> }> {
  const customer = await db.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { id: true, name: true, code: true, status: true },
  });
  if (!customer) throw new ReceivablesError("Client introuvable.", 404);

  const asOfDay = businessDayOf(options.now);
  const statuses = [...OPEN_CREDIT_STATUSES];
  const [debt, sales, notes, settlements, excludedSales, nonValidatedNotes, cancelledSettlements] = await Promise.all([
    // THE reference figure, shown in the table.
    computeCustomerDebt(db, organizationId, customerId),
    db.sale.findMany({
      where: { organizationId, customerId, status: { in: statuses }, creditAmount: { gt: 0 } },
      select: {
        id: true,
        saleNumber: true,
        saleYear: true,
        invoiceNumber: true,
        status: true,
        totalTTC: true,
        paidAmount: true,
        creditAmount: true,
        soldAt: true,
        validatedAt: true,
        createdAt: true,
      },
    }),
    db.creditNote.findMany({
      where: { organizationId, customerId, partyType: "CUSTOMER", status: "VALIDATED" },
      select: {
        id: true,
        creditNoteNumber: true,
        totalTTC: true,
        refundMethod: true,
        validatedAt: true,
        createdAt: true,
        originalSale: { select: { saleNumber: true, saleYear: true, invoiceNumber: true, status: true } },
      },
    }),
    db.customerSettlement.findMany({
      where: { organizationId, customerId, status: "VALIDATED" },
      select: {
        id: true,
        settlementNumber: true,
        amount: true,
        method: true,
        date: true,
        createdAt: true,
        createdBy: { select: { fullName: true } },
      },
    }),
    db.sale.count({
      where: {
        organizationId,
        customerId,
        OR: [{ status: "DRAFT" }, { status: "CANCELLED", creditAmount: { gt: 0 } }],
      },
    }),
    db.creditNote.count({
      where: { organizationId, customerId, partyType: "CUSTOMER", status: { in: ["DRAFT", "REVERSED"] } },
    }),
    db.customerSettlement.count({ where: { organizationId, customerId, status: "CANCELLED" } }),
  ]);

  // FIFO order: the same as the overview's SQL (instant, createdAt, id in byte order).
  const orderedSales = sales
    .map((sale) => ({ sale, at: saleInstant(sale), amount: sale.creditAmount.toNumber() }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.sale.createdAt.getTime() - b.sale.createdAt.getTime() || (a.sale.id < b.sale.id ? -1 : a.sale.id > b.sale.id ? 1 : 0));
  const allocated = allocateFifo(orderedSales, debt.debt);

  const inputs: MovementInput[] = [];
  const openParts: Array<{ open: number; ageDays: number }> = [];
  for (const { sale, at, amount, open } of allocated) {
    const day = businessDayOf(at);
    const ageDays = ageInDays(day, asOfDay);
    openParts.push({ open, ageDays });
    const reference = formatSaleDisplayNumber(sale.saleNumber, sale.saleYear, sale.invoiceNumber);
    inputs.push({
      id: `sale:${sale.id}`,
      kind: "CREDIT_SALE",
      day,
      sortAt: at.getTime(),
      reference,
      label: `Vente à crédit ${reference}`,
      amount,
      sale: {
        totalTTC: sale.totalTTC.toNumber(),
        paidAtSale: sale.paidAmount.toNumber(),
        status: sale.status,
        openEstimate: open,
        ageDays,
      },
    });
  }
  let cashCount = 0;
  let cashCents = 0;
  for (const note of notes) {
    const at = note.validatedAt ?? note.createdAt;
    const amount = note.totalTTC.toNumber();
    if (note.refundMethod === "CASH") {
      cashCount += 1;
      cashCents += Math.round(amount * 100);
    }
    inputs.push({
      id: `note:${note.id}`,
      kind: "CREDIT_NOTE",
      day: businessDayOf(at),
      sortAt: at.getTime(),
      reference: note.creditNoteNumber,
      label: `Avoir ${note.creditNoteNumber}`,
      amount: -amount,
      creditNote: {
        refundMethod: note.refundMethod,
        originalSaleReference: note.originalSale
          ? formatSaleDisplayNumber(note.originalSale.saleNumber, note.originalSale.saleYear, note.originalSale.invoiceNumber)
          : null,
        originalSaleStatus: note.originalSale?.status ?? null,
      },
    });
  }
  for (const settlement of settlements) {
    inputs.push({
      id: `settlement:${settlement.id}`,
      kind: "SETTLEMENT",
      // CustomerSettlement.date is a calendar date (no time): it is the business day as entered.
      day: settlement.date.toISOString().slice(0, 10),
      sortAt: settlement.createdAt.getTime(),
      reference: settlement.settlementNumber,
      label: `Règlement ${settlement.settlementNumber}`,
      amount: -settlement.amount.toNumber(),
      settlement: { method: settlement.method, createdByName: settlement.createdBy?.fullName ?? null },
    });
  }

  const { movements, truncated, finalBalance } = buildMovements(inputs, DETAIL_MOVEMENTS_CAP);
  const rawBalance = roundMoney(debt.creditSalesTotal - debt.creditNotesTotal - debt.settlementsTotal);
  const aging = summarizeAging(openParts, options.settings.overdueDays);

  return {
    asOfDay,
    settings: options.settings,
    customer: { id: customer.id, name: customer.name, code: customer.code, status: customer.status },
    debt: {
      creditSalesTotal: debt.creditSalesTotal,
      creditNotesTotal: debt.creditNotesTotal,
      settlementsTotal: debt.settlementsTotal,
      debt: debt.debt,
    },
    rawBalance,
    movements,
    movementsTruncated: truncated,
    reconciled: Math.round(finalBalance * 100) === Math.round(rawBalance * 100),
    aging: { overdue: aging.overdue, over30: aging.over30, buckets: aging.buckets },
    cashCreditNotes: { count: cashCount, total: cashCents / 100 },
    excluded: {
      draftOrCancelledSales: excludedSales,
      nonValidatedCreditNotes: nonValidatedNotes,
      cancelledSettlements,
    },
  };
}
