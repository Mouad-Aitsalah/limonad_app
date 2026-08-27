import { customers } from "@/lib/mock-data/customers";
import { driverTours } from "@/lib/mock-data/driver-tours";
import { paymentMethods } from "@/lib/mock-data/payment-methods";
import { products } from "@/lib/mock-data/products";
import { trucks } from "@/lib/mock-data/trucks";
import { computeInvoiceTotals } from "@/lib/sales-calculations";
import { normalizeCustomerText } from "@/lib/customer-utils";
import type { PaymentMethodValue } from "@/lib/mock-data/payment-methods";
import type { Customer } from "@/types/customer";
import type { SaleInvoice, InvoiceStatus } from "@/types/sale";
import type { DriverTour, DriverTourSalesSummary } from "@/types/tour";

export type DriverSalesFilters = {
  search: string;
  period: "all" | "today" | "week" | "month";
  tourId: string;
  customerId: string;
  paymentMethod: PaymentMethodValue | "all";
  status: InvoiceStatus | "all";
};

export type DriverSalesGlobalTotals = {
  salesCount: number;
  totalTTC: number;
  paidAmount: number;
  creditAmount: number;
  toursCount: number;
};

export type DriverTourSalesGroup = {
  summary: DriverTourSalesSummary;
  invoices: SaleInvoice[];
};

export function getPaymentLabel(value: PaymentMethodValue) {
  return paymentMethods.find((method) => method.value === value)?.label ?? value;
}

export function getDriverSaleCustomerName(
  customerId: string,
  customerList: Customer[] = customers,
) {
  return customerList.find((customer) => customer.id === customerId)?.nom ?? "Client";
}

export function getDriverSaleCustomerCode(
  customerId: string,
  customerList: Customer[] = customers,
) {
  return customerList.find((customer) => customer.id === customerId)?.code ?? "-";
}

export function getTourById(tourId: string | undefined): DriverTour | null {
  if (!tourId) return null;
  return driverTours.find((tour) => tour.id === tourId) ?? null;
}

export function getTruckCode(truckId: string | null | undefined) {
  if (!truckId) return "-";
  return trucks.find((truck) => truck.id === truckId)?.code ?? truckId;
}

export function filterDriverSales(
  invoices: SaleInvoice[],
  filters: DriverSalesFilters,
  customerList: Customer[],
) {
  const query = normalizeCustomerText(filters.search);
  const now = new Date("2026-08-02T12:00:00");

  return invoices.filter((invoice) => {
    const totals = computeInvoiceTotals(invoice);
    const productNames = invoice.lignes
      .map((line) => products.find((product) => product.id === line.productId)?.designation)
      .filter(Boolean)
      .join(" ");
    const tour = getTourById(invoice.tourId);
    const searchText = normalizeCustomerText(
      [
        invoice.numero,
        getDriverSaleCustomerName(invoice.clientId, customerList),
        getDriverSaleCustomerCode(invoice.clientId, customerList),
        productNames,
        tour?.code ?? invoice.tourId,
        invoice.truckCode,
        totals.totalTTC.toString(),
      ].join(" "),
    );

    const matchesSearch = query.length === 0 || searchText.includes(query);
    const matchesTour = filters.tourId === "all" || invoice.tourId === filters.tourId;
    const matchesCustomer =
      filters.customerId === "all" || invoice.clientId === filters.customerId;
    const matchesPayment =
      filters.paymentMethod === "all" || invoice.modeReglement === filters.paymentMethod;
    const matchesStatus =
      filters.status === "all" || invoice.statut === filters.status;
    const matchesPeriod = matchPeriod(invoice.date, now, filters.period);

    return (
      matchesSearch &&
      matchesTour &&
      matchesCustomer &&
      matchesPayment &&
      matchesStatus &&
      matchesPeriod
    );
  });
}

export function computeDriverSalesGlobalTotals(
  invoices: SaleInvoice[],
): DriverSalesGlobalTotals {
  const tourIds = new Set(invoices.map((invoice) => invoice.tourId ?? "missing"));

  return invoices.reduce(
    (acc, invoice) => {
      const totals = computeInvoiceTotals(invoice);
      const isCredit = invoice.modeReglement === "credit";

      return {
        salesCount: acc.salesCount + 1,
        totalTTC: acc.totalTTC + totals.totalTTC,
        paidAmount: acc.paidAmount + (isCredit ? 0 : totals.totalTTC),
        creditAmount: acc.creditAmount + (isCredit ? totals.totalTTC : 0),
        toursCount: tourIds.size,
      };
    },
    { salesCount: 0, totalTTC: 0, paidAmount: 0, creditAmount: 0, toursCount: 0 },
  );
}

export function groupDriverSalesByTour(
  invoices: SaleInvoice[],
): DriverTourSalesGroup[] {
  const grouped = new Map<string, SaleInvoice[]>();

  for (const invoice of invoices) {
    const key = invoice.tourId ?? "tour-missing";
    grouped.set(key, [...(grouped.get(key) ?? []), invoice]);
  }

  return Array.from(grouped.entries())
    .map(([tourId, tourInvoices]) => ({
      summary: buildTourSummary(tourId, tourInvoices),
      invoices: tourInvoices.sort((a, b) => b.date.getTime() - a.date.getTime()),
    }))
    .sort(
      (a, b) =>
        new Date(b.summary.date).getTime() - new Date(a.summary.date).getTime(),
    );
}

function buildTourSummary(
  tourId: string,
  invoices: SaleInvoice[],
): DriverTourSalesSummary {
  const tour = getTourById(tourId);
  const firstInvoice = invoices[0];
  const truckId = tour?.truckId ?? firstInvoice?.truckId ?? firstInvoice?.camionId ?? "-";
  const customersCount = new Set(invoices.map((invoice) => invoice.clientId)).size;

  return invoices.reduce(
    (summary, invoice) => {
      const totals = computeInvoiceTotals(invoice);
      const quantity = invoice.lignes.reduce((sum, line) => sum + line.quantite, 0);
      const isCredit = invoice.modeReglement === "credit";

      return {
        ...summary,
        salesCount: summary.salesCount + 1,
        totalQuantity: summary.totalQuantity + quantity,
        totalHT: summary.totalHT + totals.totalHT,
        totalTax: summary.totalTax + totals.totalTVA,
        totalTTC: summary.totalTTC + totals.totalTTC,
        paidAmount: summary.paidAmount + (isCredit ? 0 : totals.totalTTC),
        creditAmount: summary.creditAmount + (isCredit ? totals.totalTTC : 0),
      };
    },
    {
      tourId,
      tourCode: tour?.code ?? tourId,
      date: (tour?.date ?? firstInvoice?.date ?? new Date()).toISOString(),
      truckId,
      truckCode: getTruckCode(truckId),
      status: tour?.status ?? "ACTIVE",
      departureAt: tour?.departureAt ?? firstInvoice?.date ?? new Date(),
      returnAt: tour?.returnAt ?? null,
      salesCount: 0,
      customersCount,
      totalQuantity: 0,
      totalHT: 0,
      totalTax: 0,
      totalTTC: 0,
      paidAmount: 0,
      creditAmount: 0,
    },
  );
}

function matchPeriod(
  date: Date,
  now: Date,
  period: DriverSalesFilters["period"],
) {
  if (period === "all") return true;

  const start = new Date(now);
  if (period === "today") {
    start.setHours(0, 0, 0, 0);
  }
  if (period === "week") {
    start.setDate(start.getDate() - 7);
  }
  if (period === "month") {
    start.setMonth(start.getMonth() - 1);
  }

  return date >= start;
}
