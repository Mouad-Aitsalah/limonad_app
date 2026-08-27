import { products } from "@/lib/mock-data/products";
import { roundCurrency } from "@/lib/utils";
import type {
  MonthlySales,
  SaleInvoice,
  SaleInvoiceLine,
  SalesSession,
} from "@/types/sale";

export type LineTotals = {
  baseHT: number;
  remiseAmount: number;
  netHT: number;
  tvaAmount: number;
  total: number;
};

export function computeLineTotals(line: SaleInvoiceLine): LineTotals {
  const baseHT = line.prixUnitaire * line.quantite;
  const remiseAmount = baseHT * (line.remisePercent / 100);
  const netHT = baseHT - remiseAmount;
  const tvaAmount = netHT * (line.tauxTVA / 100);
  const total = netHT + tvaAmount;

  return { baseHT, remiseAmount, netHT, tvaAmount, total };
}

export type InvoiceTotals = {
  nombreArticles: number;
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
};

export function computeInvoiceTotals(invoice: SaleInvoice): InvoiceTotals {
  return invoice.lignes.reduce(
    (acc, line) => {
      const { netHT, tvaAmount, total } = computeLineTotals(line);
      return {
        nombreArticles: acc.nombreArticles + line.quantite,
        totalHT: roundCurrency(acc.totalHT + netHT),
        totalTVA: roundCurrency(acc.totalTVA + tvaAmount),
        totalTTC: roundCurrency(acc.totalTTC + total),
      };
    },
    { nombreArticles: 0, totalHT: 0, totalTVA: 0, totalTTC: 0 },
  );
}

export function computeInvoiceCost(invoice: SaleInvoice): number {
  return roundCurrency(
    invoice.lignes.reduce((sum, line) => {
      const product = products.find((item) => item.id === line.productId);
      const coutUnitaire = product?.prixAchatHT ?? 0;
      return sum + coutUnitaire * line.quantite;
    }, 0),
  );
}

export type SessionTotals = {
  nombreCommandes: number;
  totalVentes: number;
  totalRemboursements: number;
  totalNet: number;
};

export function computeSessionTotals(
  session: SalesSession,
  invoices: SaleInvoice[],
): SessionTotals {
  const sessionInvoices = invoices.filter(
    (invoice) => invoice.sessionId === session.id,
  );

  let totalVentes = 0;
  let totalRemboursements = 0;

  for (const invoice of sessionInvoices) {
    const { totalTTC } = computeInvoiceTotals(invoice);
    totalVentes += totalTTC;
    if (invoice.statut === "annulee") {
      totalRemboursements += totalTTC;
    }
  }

  return {
    nombreCommandes: sessionInvoices.length,
    totalVentes: roundCurrency(totalVentes),
    totalRemboursements: roundCurrency(totalRemboursements),
    totalNet: roundCurrency(totalVentes - totalRemboursements),
  };
}

const monthLabels = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(date: Date): string {
  return `${monthLabels[date.getMonth()]} ${date.getFullYear()}`;
}

export function computeMonthlySales(invoices: SaleInvoice[]): MonthlySales[] {
  const byMonth = new Map<string, MonthlySales>();

  for (const invoice of invoices) {
    const key = monthKey(invoice.date);
    const existing = byMonth.get(key) ?? {
      key,
      label: monthLabel(invoice.date),
      nombreCommandes: 0,
      caHT: 0,
      tva: 0,
      caTTC: 0,
      totalRemboursements: 0,
      benefice: 0,
    };

    const { totalHT, totalTVA, totalTTC } = computeInvoiceTotals(invoice);
    const cout = computeInvoiceCost(invoice);

    existing.nombreCommandes += 1;

    if (invoice.statut === "annulee") {
      existing.totalRemboursements = roundCurrency(
        existing.totalRemboursements + totalTTC,
      );
    } else {
      existing.caHT = roundCurrency(existing.caHT + totalHT);
      existing.tva = roundCurrency(existing.tva + totalTVA);
      existing.caTTC = roundCurrency(existing.caTTC + totalTTC);
      existing.benefice = roundCurrency(existing.benefice + (totalHT - cout));
    }

    byMonth.set(key, existing);
  }

  return Array.from(byMonth.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
}

export type GlobalSalesTotals = {
  nombreCommandes: number;
  caTotal: number;
  remboursements: number;
  benefice: number;
};

export function computeGlobalTotals(invoices: SaleInvoice[]): GlobalSalesTotals {
  const months = computeMonthlySales(invoices);

  return months.reduce(
    (acc, month) => ({
      nombreCommandes: acc.nombreCommandes + month.nombreCommandes,
      caTotal: roundCurrency(acc.caTotal + month.caTTC),
      remboursements: roundCurrency(acc.remboursements + month.totalRemboursements),
      benefice: roundCurrency(acc.benefice + month.benefice),
    }),
    { nombreCommandes: 0, caTotal: 0, remboursements: 0, benefice: 0 },
  );
}
