import { customerAccountNumber } from "@/lib/customer-code";
import type { ReceivablesDebtorRow } from "@/types/receivables";

/**
 * Search / filter / sort of the debtors table (in the browser, on the rows the
 * API already aggregated per customer - never on sales). Pure.
 */

export type DebtorFilter = "all" | "overdue" | "over30" | "over90" | "cashNotes";
export type DebtorSortKey = "balance" | "overdue" | "over30" | "oldest" | "name";
export type SortDirection = "asc" | "desc";

export const DEBTOR_FILTERS: ReadonlyArray<{ value: DebtorFilter; label: string }> = [
  { value: "all", label: "Tous les débiteurs" },
  { value: "overdue", label: "En retard" },
  { value: "over30", label: "Plus de 30 jours" },
  { value: "over90", label: "Plus de 90 jours" },
  { value: "cashNotes", label: "Avec avoirs « espèces »" },
];

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr").trim();
}

export function matchesDebtorSearch(row: ReceivablesDebtorRow, search: string): boolean {
  const needle = normalize(search);
  if (!needle) return true;
  return normalize([row.name, row.code, row.accountCode, customerAccountNumber(row.code)].join(" ")).includes(needle);
}

export function matchesDebtorFilter(row: ReceivablesDebtorRow, filter: DebtorFilter): boolean {
  switch (filter) {
    case "overdue":
      return row.overdue > 0;
    case "over30":
      return row.over30 > 0;
    case "over90":
      return row.buckets["90+"] > 0;
    case "cashNotes":
      return row.cashCreditNotesTotal > 0;
    default:
      return true;
  }
}

function sortValue(row: ReceivablesDebtorRow, key: DebtorSortKey): number {
  switch (key) {
    case "overdue":
      return row.overdue;
    case "over30":
      return row.over30;
    case "oldest":
      return row.oldestOpenAgeDays ?? -1;
    default:
      return row.balance;
  }
}

export function sortDebtors(rows: readonly ReceivablesDebtorRow[], key: DebtorSortKey, direction: SortDirection): ReceivablesDebtorRow[] {
  const sign = direction === "asc" ? 1 : -1;
  const byName = (a: ReceivablesDebtorRow, b: ReceivablesDebtorRow) =>
    a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) || a.customerId.localeCompare(b.customerId);
  return [...rows].sort((a, b) => {
    if (key === "name") return sign * byName(a, b);
    return sign * (sortValue(a, key) - sortValue(b, key)) || byName(a, b);
  });
}

export function selectDebtors(
  rows: readonly ReceivablesDebtorRow[],
  options: { search: string; filter: DebtorFilter; sort: DebtorSortKey; direction: SortDirection },
): ReceivablesDebtorRow[] {
  return sortDebtors(
    rows.filter((row) => matchesDebtorSearch(row, options.search) && matchesDebtorFilter(row, options.filter)),
    options.sort,
    options.direction,
  );
}
