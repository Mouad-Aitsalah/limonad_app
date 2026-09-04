"use client";

import * as React from "react";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";

type Status = "VALID" | "WARNING" | "ERROR";
// Import volontairement limité à ces 3 types. Trésorerie / Produit /
// Employé / etc. ne sont PAS importables depuis ce fichier -> ERROR.
type AccountType = "CUSTOMER" | "SUPPLIER" | "EXPENSE" | null;
type ImportableType = Exclude<AccountType, null>;
type Row = { line: number; code: string; name: string; excelType: string; type: AccountType; phone: string | null; accountingCode: string; status: Status; message: string };
type ServerStatus = "NEW" | "EXISTING_UNCHANGED" | "EXISTING_UPDATE" | "CONFLICT" | "ERROR";
type ServerRow = { excelRow: number; status: ServerStatus; message: string; changes: Record<string, { old: string | null; new: string | null }> };
type ServerPreview = { summary: { total: number; new: number; unchanged: number; update: number; conflicts: number }; rows: ServerRow[] };

type ImportRowStatus = "CREATED" | "UPDATED" | "UNCHANGED" | "CONFLICT" | "ERROR";
type ImportReport = {
  summary: { created: number; updated: number; unchanged: number; conflicts: number; errors: number };
  byType: {
    customersCreated: number; customersUpdated: number;
    suppliersCreated: number; suppliersUpdated: number;
    expensesCreated: number; expensesUpdated: number;
  };
  rows: { excelRow: number; code: string; name: string; type: ImportableType; accountingCode: string; status: ImportRowStatus; message: string }[];
};

function text(value: unknown) { return value == null ? "" : String(value).trim(); }
function phone(value: unknown) { const valueText = text(value); return valueText || null; }

/**
 * Normalise un libellé Type_Compte pour la comparaison : minuscules, trim,
 * espaces internes réduits. " CHARGES", "Charge" -> "charges", "charge".
 */
function normalizeTypeLabel(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// Seuls libellés Excel importables -> type métier interne (singulier +
// pluriel FR, code interne EN). Tout autre libellé (Produit, Trésorerie,
// Employé, Vente, ...) n'est PAS mappé et devient une ERREUR dans la preview.
const TYPE_BY_LABEL: Record<string, ImportableType> = {
  client: "CUSTOMER", clients: "CUSTOMER", customer: "CUSTOMER", customers: "CUSTOMER",
  fournisseur: "SUPPLIER", fournisseurs: "SUPPLIER", supplier: "SUPPLIER", suppliers: "SUPPLIER",
  charge: "EXPENSE", charges: "EXPENSE", expense: "EXPENSE", expenses: "EXPENSE",
};

function mapType(value: string): AccountType {
  return TYPE_BY_LABEL[normalizeTypeLabel(value)] ?? null;
}
function accountingCode(code: string, type: AccountType) { return type === "CUSTOMER" ? (/^3421\d+$/.test(code) ? code : `3421${code}`) : code; }
function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

const FILE_ACCEPT = ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

export function AccountsImportPreview() {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState("");
  const [fileSize, setFileSize] = React.useState<number | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [error, setError] = React.useState("");
  const [serverRows, setServerRows] = React.useState<Map<number, ServerRow>>(new Map());
  const [serverLoading, setServerLoading] = React.useState(false);
  const [serverError, setServerError] = React.useState("");
  const [serverSummary, setServerSummary] = React.useState<ServerPreview["summary"] | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [importError, setImportError] = React.useState("");
  const [importReport, setImportReport] = React.useState<ImportReport | null>(null);

  async function checkWithDatabase(localRows: Row[]) {
    const validRows = localRows
      .filter((row) => row.status !== "ERROR" && row.type)
      .map((row) => ({ excelRow: row.line, code: row.code, name: row.name, type: row.type!, phone: row.phone }));
    if (!validRows.length) return;
    setServerLoading(true);
    setServerError("");
    try {
      const response = await fetch("/api/comptes/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: validRows }) });
      const body = await response.json() as ServerPreview & { message?: string };
      if (!response.ok) throw new Error(body.message);
      setServerRows(new Map(body.rows.map((row) => [row.excelRow, row])));
      setServerSummary(body.summary);
    } catch {
      setServerError("Impossible de vérifier les comptes avec la base de données.");
    } finally { setServerLoading(false); }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    // Réinitialise tout de suite : sans ça, resélectionner le même fichier
    // ne redéclenche pas onChange (la value ne change pas).
    input.value = "";
    if (!file) return;
    void readFile(file);
  }

  async function readFile(file: File) {
    setFileName(file.name); setFileSize(file.size); setError("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
      const sheet = workbook.Sheets.Comptes;
      if (!sheet) { setRows([]); setError("Feuille Comptes introuvable"); return; }
      const source = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const parsed = source.map((item, index) => {
        const code = text(item.N_compte); const name = text(item.Nom_Compte); const excelType = text(item.Type_Compte); const type = mapType(excelType);
        const messages = [!code && "N_compte vide", !name && "Nom_Compte vide", !excelType && "Type_Compte vide", excelType && !type && `Type_Compte non importable : ${excelType}`].filter(Boolean) as string[];
        const phoneValue = phone(item.Tel);
        return { line: index + 2, code, name, excelType, type, phone: phoneValue, accountingCode: accountingCode(code, type), status: messages.length ? "ERROR" : phoneValue ? "VALID" : "WARNING", message: messages.join(" ; ") || (phoneValue ? "Valide" : "Telephone absent") } as Row;
      });
      const groups = new Map<string, Row[]>(); parsed.forEach((row) => { if (row.code) groups.set(row.code, [...(groups.get(row.code) ?? []), row]); });
      groups.forEach((same) => { if (same.length < 2) return; const identical = same.every((row) => row.name === same[0].name && row.type === same[0].type && row.phone === same[0].phone); same.forEach((row, index) => { if (index > 0) { row.status = identical ? "WARNING" : "ERROR"; row.message = identical ? "Doublon identique dans le fichier" : "N_compte utilise avec des informations incompatibles"; } }); });
      setRows(parsed);
      setServerRows(new Map());
      setServerSummary(null);
      setImportReport(null);
      setImportError("");
      void checkWithDatabase(parsed);
    } catch { setRows([]); setError("Impossible de lire le fichier Excel"); }
  }

  const totals = (status?: Status) => rows.filter((row) => !status || row.status === status).length;
  const labels: Record<ServerStatus, string> = { NEW: "Nouveau", EXISTING_UNCHANGED: "Existe déjà", EXISTING_UPDATE: "À mettre à jour", CONFLICT: "Conflit", ERROR: "Erreur" };

  // "Importer les comptes" ne s'active que si la vérification base est
  // terminée, sans erreur réseau, et qu'au moins une ligne est réellement
  // importable (NEW ou EXISTING_UPDATE côté serveur).
  const importableRows = rows.filter((row): row is Row & { type: ImportableType } => {
    if (!row.type) return false;
    const status = serverRows.get(row.line)?.status;
    return status === "NEW" || status === "EXISTING_UPDATE";
  });
  const canImport = !serverLoading && !serverError && serverSummary != null && importableRows.length > 0 && !importing;

  async function runImport() {
    if (!canImport) return;
    setImporting(true);
    setImportError("");
    setImportReport(null);
    try {
      const payload = importableRows.map((row) => ({
        excelRow: row.line,
        code: row.code,
        name: row.name,
        type: row.type,
        phone: row.phone,
      }));
      const response = await fetch("/api/comptes/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: payload }) });
      const body = await response.json() as ImportReport & { message?: string };
      if (!response.ok) throw new Error(body.message);
      setImportReport(body);
      // Rejoue la prévisualisation lecture seule : les lignes importées
      // remontent maintenant comme "Existe déjà".
      await checkWithDatabase(rows);
    } catch {
      setImportError("Impossible d'importer les comptes.");
    } finally {
      setImporting(false);
    }
  }

  const problemRows = importReport?.rows.filter((row) => row.status === "CONFLICT" || row.status === "ERROR") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Import des comptes</h1>
        <p className="text-sm text-muted-foreground">Feuille <code>Comptes</code> — colonnes N_compte, Nom_Compte, Type_Compte, Tel.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Types_Compte importables : <span className="font-medium text-foreground">Client</span>, <span className="font-medium text-foreground">Fournisseur</span>, <span className="font-medium text-foreground">Charge</span>.
          Tout autre libellé (Produit, Trésorerie, Employé, Vente…) est refusé et marqué <span className="font-medium text-foreground">Erreur</span>.
        </p>
      </div>

      <div>
        <Button type="button" onClick={() => fileInputRef.current?.click()}>
          Choisir un fichier Excel
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_ACCEPT}
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
      {fileName && (
        <p className="text-sm text-muted-foreground">
          Fichier : {fileName}
          {fileSize != null ? ` · ${formatFileSize(fileSize)}` : ""}
        </p>
      )}

      {serverLoading && <p className="text-sm text-muted-foreground">Vérification avec la base de données...</p>}
      {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {rows.length > 0 && (
        <>
          <div className="grid gap-2 text-sm sm:grid-cols-4">
            <p>Total : {rows.length}</p>
            <p>Nouveaux : {serverSummary?.new ?? "—"}</p>
            <p>Existants : {serverSummary?.unchanged ?? "—"}</p>
            <p>À mettre à jour : {serverSummary?.update ?? "—"}</p>
            <p>Conflits : {serverSummary?.conflicts ?? "—"}</p>
            <p>Erreurs : {totals("ERROR")}</p>
          </div>

          <div className="overflow-x-auto border rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>Ligne</th><th>N° compte</th><th>Nom</th><th>Type Excel</th><th>Type application</th><th>Téléphone</th><th>Compte comptable</th><th>État base</th><th>Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const result = serverRows.get(row.line);
                  const changes = result ? Object.entries(result.changes).map(([field, value]) => `${field}: ${value.old ?? "—"} → ${value.new ?? "—"}`).join(" ; ") : "";
                  return (
                    <tr key={row.line} className="border-t">
                      <td>{row.line}</td>
                      <td>{row.code}</td>
                      <td>{row.name}</td>
                      <td>{row.excelType}</td>
                      <td>{row.type ?? "—"}</td>
                      <td>{row.phone ?? "—"}</td>
                      <td>{row.accountingCode || "—"}</td>
                      <td>{result ? labels[result.status] : row.status}</td>
                      <td>{result ? `${result.message}${changes ? ` ${changes}` : ""}` : row.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" onClick={runImport} disabled={!canImport}>
              {importing ? "Importation en cours..." : "Importer les comptes"}
            </Button>
            {!importing && serverSummary != null && !serverError && (
              <span className="text-sm text-muted-foreground">
                {importableRows.length > 0 ? `${importableRows.length} ligne(s) à importer` : "Rien à importer"}
              </span>
            )}
          </div>
          {importError && <p className="text-sm text-destructive">{importError}</p>}

          {importReport && (
            <div className="space-y-2 rounded-xl border bg-muted/20 p-4 text-sm">
              <p className="font-medium">Rapport d&apos;import</p>
              <div className="grid gap-1 sm:grid-cols-2">
                <p>Clients — créés : {importReport.byType.customersCreated} · mis à jour : {importReport.byType.customersUpdated}</p>
                <p>Fournisseurs — créés : {importReport.byType.suppliersCreated} · mis à jour : {importReport.byType.suppliersUpdated}</p>
                <p>Charges — créées : {importReport.byType.expensesCreated} · mises à jour : {importReport.byType.expensesUpdated}</p>
              </div>
              <p>Inchangés : {importReport.summary.unchanged} · Conflits : {importReport.summary.conflicts} · Erreurs : {importReport.summary.errors}</p>
              {problemRows.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {problemRows.map((row) => (
                    <li key={row.excelRow}>Ligne {row.excelRow} — {row.code} — {row.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
