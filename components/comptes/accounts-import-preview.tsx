"use client";

import * as React from "react";

import {
  AccountsImportReport,
  AccountsImportSummary,
  AccountsImportTable,
  type AccountFileRow,
  type AccountImportReportData,
  type AccountPreviewSummary,
  type AccountServerRow,
} from "@/components/comptes/accounts-import-parts";
import { Button } from "@/components/ui/button";
import { ACCOUNT_SHEET_NAME, parseAccountTable } from "@/lib/import-export/accounts-format";
import { readTableFile, TableFileError } from "@/lib/import-export/tabular";

type ServerPreview = { summary: AccountPreviewSummary; rows: AccountServerRow[] };
type Row = AccountFileRow;

const FILE_ACCEPT = ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

async function postJson<T>(url: string, body: unknown, failure: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error(`${failure} : connexion au serveur impossible.`);
  }
  const json = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok) throw new Error(json?.message ?? `${failure} (HTTP ${response.status}).`);
  return json as T;
}

/**
 * /comptes/import - Excel (feuille "Comptes") or CSV, every account type
 * (clients, fournisseurs, charges, trésorerie, employés). Reading uses the
 * shared format (lib/import-export/accounts-format.ts); the server classifies
 * and writes (lib/server/accounts-import-core.ts). An absent column or an empty
 * cell never erases a stored value.
 */
export function AccountsImportPreview() {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState("");
  const [fileSize, setFileSize] = React.useState<number | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [error, setError] = React.useState("");
  const [serverRows, setServerRows] = React.useState<Map<number, AccountServerRow>>(new Map());
  const [serverLoading, setServerLoading] = React.useState(false);
  const [serverError, setServerError] = React.useState("");
  const [serverSummary, setServerSummary] = React.useState<ServerPreview["summary"] | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [importError, setImportError] = React.useState("");
  const [importReport, setImportReport] = React.useState<AccountImportReportData | null>(null);

  const readableLines = (list: Row[]) => list.filter((row) => row.values && row.errors.length === 0).map((row) => row.values!);

  async function checkWithDatabase(localRows: Row[]) {
    const lines = readableLines(localRows);
    if (!lines.length) {
      setServerRows(new Map());
      setServerSummary(null);
      return;
    }
    setServerLoading(true);
    setServerError("");
    try {
      const body = await postJson<ServerPreview>("/api/comptes/import/preview", { rows: lines }, "Vérification impossible");
      setServerRows(new Map(body.rows.map((row) => [row.excelRow, row])));
      setServerSummary(body.summary);
    } catch (caught) {
      setServerRows(new Map());
      setServerSummary(null);
      setServerError(caught instanceof Error ? caught.message : "Impossible de vérifier les comptes avec la base de données.");
    } finally {
      setServerLoading(false);
    }
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
    setFileName(file.name);
    setFileSize(file.size);
    setError("");
    setImportReport(null);
    setImportError("");
    try {
      const table = readTableFile(new Uint8Array(await file.arrayBuffer()), file.name, ACCOUNT_SHEET_NAME);
      const parsed = parseAccountTable(table.headers, table.rows);
      if (parsed.fatal) {
        setRows([]);
        setServerRows(new Map());
        setServerSummary(null);
        setError(parsed.fatal);
        return;
      }
      const list: Row[] = parsed.lines.map((line) => ({ line: line.excelRow, rawType: line.rawType, values: line.line, errors: line.errors, warnings: line.warnings }));
      setRows(list);
      setServerRows(new Map());
      setServerSummary(null);
      void checkWithDatabase(list);
    } catch (caught) {
      setRows([]);
      setError(caught instanceof TableFileError ? caught.message : "Impossible de lire le fichier.");
    }
  }

  const localErrors = rows.filter((row) => row.errors.length > 0).length;
  const importableRows = rows.filter((row) => {
    const status = serverRows.get(row.line)?.status;
    return row.values && row.errors.length === 0 && (status === "NEW" || status === "EXISTING_UPDATE");
  });
  const canImport = !serverLoading && !serverError && serverSummary != null && importableRows.length > 0 && !importing;

  async function runImport() {
    if (!canImport) return;
    setImporting(true);
    setImportError("");
    setImportReport(null);
    // Lines the import does not send - unchanged, refused by the preview or unreadable - still belong in the report.
    const notSent = {
      unchanged: rows.filter((row) => row.errors.length === 0 && serverRows.get(row.line)?.status === "EXISTING_UNCHANGED").length,
      rejected: rows.flatMap((row) => {
        if (row.errors.length) return [{ excelRow: row.line, code: row.values?.code ?? "—", status: "ERROR", message: row.errors.join(" ; ") }];
        const result = serverRows.get(row.line);
        return result && (result.status === "CONFLICT" || result.status === "ERROR")
          ? [{ excelRow: row.line, code: result.code, status: result.status, message: result.message }]
          : [];
      }),
    };
    try {
      // The server re-classifies these lines itself and writes only NEW / EXISTING_UPDATE.
      const body = await postJson<AccountImportReportData>("/api/comptes/import", { rows: importableRows.map((row) => row.values!) }, "Import impossible");
      setImportReport({ ...body, notSent });
      // Rejoue la prévisualisation lecture seule : les lignes importées remontent maintenant comme "Inchangé".
      await checkWithDatabase(rows);
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : "Impossible d'importer les comptes.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Import des comptes</h1>
        <p className="text-sm text-muted-foreground">
          Excel (feuille <code>Comptes</code>) ou CSV (séparateur <code>;</code>) — colonnes obligatoires <code>N_compte</code> et <code>Type_Compte</code>
          ; <code>Nom_Compte</code> pour créer un compte. Colonnes facultatives : Tel, Email, Adresse, Ville, Latitude, Longitude, ICE, IF, Contact,
          Categorie_Client, Plafond_Credit, Plafond_Credit_Actif, Notes, Description, Categorie_Charge, Nature_Tresorerie, Date_Embauche, Salaire,
          Compte_Avance, Compte_Salaire, Statut.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Types importables : <span className="font-medium text-foreground">Client, Fournisseur, Charge, Trésorerie</span> (Nature_Tresorerie Caisse ou
          Banque pour en créer une) et <span className="font-medium text-foreground">Employé</span> (Compte_Avance et Compte_Salaire pour en créer un ;
          administrateur uniquement). Un compte existant (même code, même type) est mis à jour ; une colonne absente ou une cellule vide ne modifie
          rien. GPS : Latitude et Longitude ensemble.
        </p>
      </div>

      <div>
        <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          Choisir un fichier (Excel ou CSV)
        </Button>
        <input ref={fileInputRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={handleFileChange} data-import="file" />
      </div>
      {fileName && (
        <p className="text-sm text-muted-foreground">
          Fichier : {fileName}
          {fileSize != null ? ` · ${formatFileSize(fileSize)}` : ""}
        </p>
      )}

      {serverLoading && <p role="status" className="text-sm text-muted-foreground">Vérification avec la base de données...</p>}
      {serverError && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-destructive">{serverError}</p>
          <Button type="button" variant="outline" size="sm" disabled={serverLoading} onClick={() => void checkWithDatabase(rows)}>
            Réessayer la vérification
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {rows.length > 0 && (
        <>
          <AccountsImportSummary total={rows.length} summary={serverSummary} localErrors={localErrors} />
          <AccountsImportTable rows={rows} serverRows={serverRows} serverError={Boolean(serverError)} />

          <div className="flex items-center gap-3">
            <Button type="button" onClick={runImport} disabled={!canImport} data-import="run">
              {importing ? "Importation en cours..." : "Importer les comptes"}
            </Button>
            {!importing && serverSummary != null && !serverError && (
              <span className="text-sm text-muted-foreground">
                {importableRows.length > 0 ? `${importableRows.length} ligne(s) à importer` : "Rien à importer"}
              </span>
            )}
          </div>
          {importError && <p role="alert" className="text-sm text-destructive">{importError}</p>}

          {importReport && <AccountsImportReport report={importReport} />}
        </>
      )}
    </div>
  );
}
