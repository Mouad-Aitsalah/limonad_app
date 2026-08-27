import "server-only";

import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/server/auth";
import { mapSaleToDto, saleInclude } from "@/lib/server/sales-shared";
import type {
  PosSessionDto,
  SalesHistoryDto,
  SalesMonthDto,
} from "@/types/operations-dto";

const monthLabels = [
  "Janvier",
  "Fevrier",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Aout",
  "Septembre",
  "Octobre",
  "Novembre",
  "Decembre",
];

/**
 * A sale is "valid" for revenue purposes once it left DRAFT and was not
 * cancelled. CREDIT_NOTED sales still count their original totalTTC toward
 * "Total ventes" - the matching credit note is subtracted separately via
 * "Total remboursements", per the Total net = ventes - remboursements rule.
 */
function isValidSaleStatus(status: string) {
  return status !== "DRAFT" && status !== "CANCELLED";
}

export async function getSalesHistory(): Promise<SalesHistoryDto> {
  await requireSessionUser(["admin", "depot_manager", "cashier"]);

  const [saleRecords, refundRows, sessionRecords] = await Promise.all([
    prisma.sale.findMany({ include: saleInclude, orderBy: { createdAt: "desc" } }),
    prisma.creditNote.findMany({
      where: { partyType: "CUSTOMER", status: "VALIDATED" },
      select: { originalSaleId: true, totalTTC: true, validatedAt: true },
    }),
    prisma.posSession.findMany({ orderBy: { number: "desc" } }),
  ]);

  const orders = saleRecords.map(mapSaleToDto);

  const refundsBySaleId = new Map<string, number>();
  for (const refund of refundRows) {
    if (!refund.originalSaleId) continue;
    const amount = refund.totalTTC.toNumber();
    refundsBySaleId.set(
      refund.originalSaleId,
      (refundsBySaleId.get(refund.originalSaleId) ?? 0) + amount,
    );
  }

  const ordersWithNet = orders.map((order) => ({
    ...order,
    net: order.totalTTC - (refundsBySaleId.get(order.id) ?? 0),
  }));

  const validOrders = ordersWithNet.filter((order) => isValidSaleStatus(order.status));

  const sessions: PosSessionDto[] = sessionRecords.map((session) => {
    const rangeStart = session.openedAt;
    const rangeEnd = session.closedAt ?? null;

    const sessionOrders = validOrders.filter((order) => order.posSessionId === session.id);
    const totalSales = roundMoney(
      sessionOrders.reduce((sum, order) => sum + order.totalTTC, 0),
    );
    const totalRefunds = roundMoney(
      refundRows.reduce((sum, refund) => {
        if (!refund.validatedAt) return sum;
        const inRange =
          refund.validatedAt >= rangeStart && (rangeEnd === null || refund.validatedAt < rangeEnd);
        return inRange ? sum + refund.totalTTC.toNumber() : sum;
      }, 0),
    );

    return {
      id: session.id,
      number: session.number,
      year: session.year,
      displayNumber: `POS/${session.number}`,
      openedAt: session.openedAt.toISOString(),
      closedAt: session.closedAt?.toISOString() ?? null,
      status: session.status,
      ordersCount: sessionOrders.length,
      totalSales,
      totalRefunds,
      totalNet: roundMoney(totalSales - totalRefunds),
    };
  });

  const monthMap = new Map<
    string,
    { year: number; monthNumber: number; ordersCount: number; totalSales: number }
  >();
  for (const order of validOrders) {
    const date = new Date(order.createdAt);
    const year = date.getFullYear();
    const monthNumber = date.getMonth() + 1;
    const key = `${year}-${String(monthNumber).padStart(2, "0")}`;
    const existing = monthMap.get(key) ?? { year, monthNumber, ordersCount: 0, totalSales: 0 };
    existing.ordersCount += 1;
    existing.totalSales += order.totalTTC;
    monthMap.set(key, existing);
  }

  const refundsByMonth = new Map<string, number>();
  for (const refund of refundRows) {
    if (!refund.validatedAt) continue;
    const key = `${refund.validatedAt.getFullYear()}-${String(refund.validatedAt.getMonth() + 1).padStart(2, "0")}`;
    refundsByMonth.set(key, (refundsByMonth.get(key) ?? 0) + refund.totalTTC.toNumber());
  }
  for (const key of refundsByMonth.keys()) {
    if (!monthMap.has(key)) {
      const [yearPart, monthPart] = key.split("-");
      monthMap.set(key, {
        year: Number(yearPart),
        monthNumber: Number(monthPart),
        ordersCount: 0,
        totalSales: 0,
      });
    }
  }

  const months: SalesMonthDto[] = Array.from(monthMap.entries())
    .map(([key, value]) => {
      const totalSales = roundMoney(value.totalSales);
      const totalRefunds = roundMoney(refundsByMonth.get(key) ?? 0);
      return {
        key,
        monthNumber: value.monthNumber,
        year: value.year,
        displayNumber: `${value.monthNumber}/${value.year}`,
        label: `${value.monthNumber}/${value.year} - ${monthLabels[value.monthNumber - 1]} ${value.year}`,
        ordersCount: value.ordersCount,
        totalSales,
        totalRefunds,
        totalNet: roundMoney(totalSales - totalRefunds),
      };
    })
    .sort((a, b) => (a.key < b.key ? 1 : -1));

  return {
    orders: ordersWithNet,
    sessions,
    months,
  };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
