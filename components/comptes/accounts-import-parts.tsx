import { ACCOUNT_TYPE_LABELS, type AccountImportLine } from "@/lib/import-export/accounts-format";

/**
 * The display parts of /comptes/import (summary counters, preview table, import
 * report), stateless so they render the same in the page and in the tests.
 */

export type AccountServerStatus = "NEW" | "EXISTING_UNCHANGED" | "EXISTING_UPDATE" | "CONFLICT" | "ERROR";
export type AccountChange = { old: string | null; new: string | null };
export type AccountServerRow = {
  excelRow: number;
  code: string;
  name: string | null;
  type: AccountImportLine["type"];
  accountingCode: string | null;
  status: AccountServerStatus;
  message: string;
  changes: Record<string, AccountChange>;
};
export type AccountPreviewSummary = { total: number; new: number; unchanged: number; update: number; conflicts: number; errors: number };
type ReportLine = { excelRow: number; code: string; status: string; message: string };
export type AccountImportReportData = {
  summary: { created: number; updated: number; unchanged: number; conflicts: number; errors: number };
  byType: Record<string, number>;
  rows: ReportLine[];
  /** Lines the page did not send: unchanged at the preview, or refused (preview conflict / error, unreadable line). */
  notSent?: { unchanged: number; rejected: ReportLine[] };
};

export type AccountFileRow = {
  line: number;
  rawType: string;
  /** null = the line could not be read (no code / unknown type). */
  values: AccountImportLine | null;
  errors: string[];
  warnings: string[];
};

const CHANGE_LABELS: Record<string, string> = {
  name: "Nom",
  phone: "Téléphone",
  email: "Email",
  address: "Adresse",
  city: "Ville",
  gps: "GPS",
  ice: "ICE",
  taxId: "IF",
  contactName: "Contact",
  customerType: "Catégorie client",
  creditLimit: "Plafond",
  creditLimitEnabled: "Plafond actif",
  notes: "Notes",
  description: "Description",
  category: "Catégorie",
  hireDate: "Date d'embauche",
  salary: "Salaire",
  advanceAccountCode: "Compte avance",
  salaryAccountCode: "Compte salaire",
  status: "Statut",
};

const STATUS_LABELS: Record<AccountServerStatus, string> = {
  NEW: "Nouveau",
  EXISTING_UNCHANGED: "Inchangé",
  EXISTING_UPDATE: "À mettre à jour",
  CONFLICT: "Conflit",
  ERROR: "Erreur",
};

export function AccountsImportSummary({
  total,
  summary,
  localErrors,
}: {
  total: number;
  summary: AccountPreviewSummary | null;
  localErrors: number;
}) {
  return (
    <div className="grid gap-2 text-sm sm:grid-cols-5" data-import="summary">
      <p>Total : {total}</p>
      <p>À créer : {summary?.new ?? "—"}</p>
      <p>À mettre à jour : {summary?.update ?? "—"}</p>
      <p>Inchangés : {summary?.unchanged ?? "—"}</p>
      <p>Rejetés : {summary ? summary.conflicts + summary.errors + localErrors : localErrors || "—"}</p>
    </div>
  );
}

export function AccountsImportTable({
  rows,
  serverRows,
  serverError,
}: {
  rows: AccountFileRow[];
  serverRows: ReadonlyMap<number, AccountServerRow>;
  serverError: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm" data-import="preview">
        <thead>
          <tr>
            <th className="p-2 text-left">Ligne</th>
            <th className="p-2 text-left">N° compte</th>
            <th className="p-2 text-left">Nom</th>
            <th className="p-2 text-left">Type</th>
            <th className="p-2 text-left">GPS</th>
            <th className="p-2 text-left">Compte comptable</th>
            <th className="p-2 text-left">État</th>
            <th className="p-2 text-left">Valeurs existantes → nouvelles / message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const result = serverRows.get(row.line);
            const values = row.values;
            const changes = result
              ? Object.entries(result.changes).map(([field, value]) => `${CHANGE_LABELS[field] ?? field} : ${value.old ?? "—"} → ${value.new ?? "—"}`)
              : [];
            const state = row.errors.length ? "Erreur" : result ? STATUS_LABELS[result.status] : serverError ? "Non vérifié" : "…";
            return (
              <tr key={row.line} className="border-t align-top" data-line={row.line}>
                <td className="p-2">{row.line}</td>
                <td className="p-2">{values?.code ?? "—"}</td>
                <td className="p-2">{values?.name ?? "—"}</td>
                <td className="p-2">{values ? ACCOUNT_TYPE_LABELS[values.type] : row.rawType || "—"}</td>
                <td className="p-2 tabular-nums">{values?.latitude !== undefined ? `${values.latitude}, ${values.longitude}` : "—"}</td>
                <td className="p-2">{result?.accountingCode ?? "—"}</td>
                <td className="p-2">{state}</td>
                <td className="p-2 text-muted-foreground">
                  {row.errors.length ? <span className="text-destructive">{row.errors.join(" ; ")}</span> : result ? result.message : ""}
                  {changes.map((change) => (
                    <span key={change} className="block text-xs">
                      {change}
                    </span>
                  ))}
                  {row.warnings.map((warning) => (
                    <span key={warning} className="block text-xs text-amber-700">
                      {warning}
                    </span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AccountsImportReport({ report }: { report: AccountImportReportData }) {
  const notSent = report.notSent ?? { unchanged: 0, rejected: [] };
  const problemRows = [...notSent.rejected, ...report.rows.filter((row) => row.status === "CONFLICT" || row.status === "ERROR")].sort(
    (a, b) => a.excelRow - b.excelRow,
  );
  return (
    <div className="space-y-2 rounded-xl border bg-muted/20 p-4 text-sm" data-import="report">
      <p className="font-medium">Bilan de l&apos;import</p>
      <p>
        Créés : {report.summary.created} · Mis à jour : {report.summary.updated} · Ignorés (inchangés) : {report.summary.unchanged + notSent.unchanged} ·
        Rejetés : {report.summary.conflicts + report.summary.errors + notSent.rejected.length}
      </p>
      <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
        <p>Clients — créés : {report.byType.customersCreated} · mis à jour : {report.byType.customersUpdated}</p>
        <p>Fournisseurs — créés : {report.byType.suppliersCreated} · mis à jour : {report.byType.suppliersUpdated}</p>
        <p>Charges — créées : {report.byType.expensesCreated} · mises à jour : {report.byType.expensesUpdated}</p>
        <p>Trésorerie — créées : {report.byType.treasuriesCreated} · mises à jour : {report.byType.treasuriesUpdated}</p>
        <p>Employés — créés : {report.byType.employeesCreated} · mis à jour : {report.byType.employeesUpdated}</p>
      </div>
      {problemRows.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {problemRows.map((row) => (
            <li key={row.excelRow}>
              Ligne {row.excelRow} — {row.code} — {row.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
