"use client";

import * as React from "react";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";

type LocalStatus = "VALID" | "ERROR";
type ServerStatus = "NEW" | "EXISTING_UNCHANGED" | "EXISTING_UPDATE" | "CONFLICT" | "ERROR";
type FilterKey = "ALL" | "NEW" | "UPDATE" | "UNCHANGED" | "ERROR" | "CONFLICT";

type Row = {
  line: number;
  reference: string;
  supplierCode: string;
  name: string;
  categoryName: string;
  purchasePriceTTC: number;
  salePriceTTC: number;
  taxRate: number;
  targetStock: number;
  status: LocalStatus;
  message: string;
};

type Change = { old: string | null; new: string | null };
type ServerRow = {
  excelRow: number;
  reference: string;
  name: string;
  supplierCode: string;
  supplierName: string | null;
  categoryName: string;
  categoryCreate: boolean;
  purchasePriceTTC: number;
  salePriceTTC: number;
  taxRate: number;
  currentStock: number | null;
  targetStock: number;
  status: ServerStatus;
  message: string;
  changes: Record<string, Change>;
};
type ServerSummary = { total: number; new: number; unchanged: number; update: number; conflicts: number; errors: number };
type ServerPreview = { depot: { name: string; code: string }; summary: ServerSummary; rows: ServerRow[] };

type ImportReport = {
  summary: { created: number; updated: number; unchanged: number; conflicts: number; errors: number };
  categoriesCreated: number;
  stockMovementsCreated: number;
  depot: { name: string; code: string };
  rows: { excelRow: number; reference: string; name: string; status: "CREATED" | "UPDATED" | "UNCHANGED" | "CONFLICT" | "ERROR"; message: string }[];
};

const FILE_ACCEPT =
  ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

// Excel headers (case + spacing tolerant, §22). Key = logical column.
const HEADER_ALIASES: Record<string, string> = {
  ref_produit: "reference",
  ref_fournisseur: "supplierCode",
  designation: "name",
  type: "categoryName",
  prixachatttc: "purchasePriceTTC",
  prixgros: "salePriceTTC",
  taux_tva: "taxRate",
  quantitestock: "targetStock",
};
const REQUIRED_HEADERS = Object.keys(HEADER_ALIASES);

function normHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}
function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}
function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
// taux_tva stays a PERCENTAGE (20 = 20 %). Accepts "0", "0%", "0,00%", "20",
// "20%", "20,00%", the number 20, and a percent-formatted cell read as 0.2.
function parseTva(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value > 0 && value < 1 ? value * 100 : value;
  }
  const cleaned = String(value ?? "").trim().replace(/\s/g, "").replace("%", "").replace(",", ".");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
function parseIntStrict(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  return parsed;
}
function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

const CHANGE_LABELS: Record<string, string> = {
  name: "Désignation",
  supplier: "Fournisseur",
  category: "Catégorie",
  purchasePriceHT: "Prix achat HT",
  salePriceHT: "Prix vente HT",
  taxRate: "TVA",
  stock: "Stock",
};
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "Tous" },
  { key: "NEW", label: "Nouveaux" },
  { key: "UPDATE", label: "À mettre à jour" },
  { key: "UNCHANGED", label: "Inchangés" },
  { key: "ERROR", label: "Erreurs" },
  { key: "CONFLICT", label: "Conflits" },
];

function effectiveFilter(row: Row, server?: ServerRow): Exclude<FilterKey, "ALL"> | "PENDING" {
  if (row.status === "ERROR") return "ERROR";
  if (!server) return "PENDING";
  switch (server.status) {
    case "NEW":
      return "NEW";
    case "EXISTING_UPDATE":
      return "UPDATE";
    case "EXISTING_UNCHANGED":
      return "UNCHANGED";
    case "CONFLICT":
      return "CONFLICT";
    default:
      return "ERROR";
  }
}

export function ProductsImportPreview() {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState("");
  const [fileSize, setFileSize] = React.useState<number | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [error, setError] = React.useState("");
  const [serverRows, setServerRows] = React.useState<Map<number, ServerRow>>(new Map());
  const [serverLoading, setServerLoading] = React.useState(false);
  const [serverError, setServerError] = React.useState("");
  const [serverSummary, setServerSummary] = React.useState<ServerSummary | null>(null);
  const [depot, setDepot] = React.useState<{ name: string; code: string } | null>(null);
  const [filter, setFilter] = React.useState<FilterKey>("ALL");
  const [importing, setImporting] = React.useState(false);
  const [importError, setImportError] = React.useState("");
  const [importReport, setImportReport] = React.useState<ImportReport | null>(null);

  async function checkWithDatabase(localRows: Row[]) {
    const validRows = localRows
      .filter((row) => row.status !== "ERROR")
      .map((row) => ({
        excelRow: row.line,
        reference: row.reference,
        supplierCode: row.supplierCode,
        name: row.name,
        categoryName: row.categoryName,
        purchasePriceTTC: row.purchasePriceTTC,
        salePriceTTC: row.salePriceTTC,
        taxRate: row.taxRate,
        targetStock: row.targetStock,
      }));
    if (!validRows.length) {
      setServerRows(new Map());
      setServerSummary(null);
      return;
    }
    setServerLoading(true);
    setServerError("");
    try {
      const response = await fetch("/api/produits/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: validRows }),
      });
      const body = (await response.json()) as ServerPreview & { message?: string };
      if (!response.ok) throw new Error(body.message);
      setServerRows(new Map(body.rows.map((row) => [row.excelRow, row])));
      setServerSummary(body.summary);
      setDepot(body.depot);
    } catch (caught) {
      setServerError(
        caught instanceof Error && caught.message
          ? caught.message
          : "Impossible de vérifier les produits avec la base de données.",
      );
    } finally {
      setServerLoading(false);
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
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
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
      const sheet = workbook.Sheets.produits;
      if (!sheet) {
        setRows([]);
        setError("Feuille « produits » introuvable dans le fichier.");
        return;
      }
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false });
      const headerRow = (grid[0] ?? []).map(normHeader);
      const columnIndex: Record<string, number> = {};
      for (const header of REQUIRED_HEADERS) {
        columnIndex[HEADER_ALIASES[header]] = headerRow.indexOf(header);
      }
      const missing = REQUIRED_HEADERS.filter((header) => columnIndex[HEADER_ALIASES[header]] < 0);
      if (missing.length) {
        setRows([]);
        setError(`Colonne(s) obligatoire(s) absente(s) : ${missing.join(", ")}`);
        return;
      }

      const parsed: Row[] = [];
      for (let index = 1; index < grid.length; index += 1) {
        const cells = grid[index] ?? [];
        const cell = (key: string) => cells[columnIndex[key]];
        const reference = text(cell("reference"));
        const supplierCode = text(cell("supplierCode"));
        const name = text(cell("name"));
        const categoryName = text(cell("categoryName"));
        const rawStock = cell("targetStock");
        // Skip a fully empty row.
        if (!reference && !supplierCode && !name && !categoryName && text(rawStock) === "") continue;

        const purchasePriceTTC = parseNumber(cell("purchasePriceTTC"));
        const salePriceTTC = parseNumber(cell("salePriceTTC"));
        const taxRate = parseTva(cell("taxRate"));
        const targetStock = text(rawStock) === "" ? null : parseIntStrict(rawStock);

        const messages = [
          !reference && "ref_produit manquant",
          !name && "designation manquante",
          !supplierCode && "ref_fournisseur manquant",
          !categoryName && "type (catégorie) manquant",
          (purchasePriceTTC == null || purchasePriceTTC < 0) && "prixAchatTTC invalide",
          (salePriceTTC == null || salePriceTTC < 0) && "prixGros invalide",
          (taxRate == null || taxRate < 0 || taxRate > 100) && "taux_tva invalide",
          targetStock == null && "QuantiteStock invalide (entier attendu)",
        ].filter(Boolean) as string[];

        parsed.push({
          line: index + 1,
          reference,
          supplierCode,
          name,
          categoryName,
          purchasePriceTTC: purchasePriceTTC ?? 0,
          salePriceTTC: salePriceTTC ?? 0,
          taxRate: taxRate ?? 0,
          targetStock: targetStock ?? 0,
          status: messages.length ? "ERROR" : "VALID",
          message: messages.join(" ; ") || "Valide",
        });
      }

      // In-file duplicate references are left for the server, which returns
      // them as CONFLICT (never imported) so the "Conflits" filter is real.
      setRows(parsed);
      setServerRows(new Map());
      setServerSummary(null);
      setFilter("ALL");
      void checkWithDatabase(parsed);
    } catch {
      setRows([]);
      setError("Impossible de lire le fichier Excel.");
    }
  }

  const importableRows = rows.filter((row) => {
    if (row.status === "ERROR") return false;
    const status = serverRows.get(row.line)?.status;
    return status === "NEW" || status === "EXISTING_UPDATE";
  });
  const canImport =
    !serverLoading && !serverError && serverSummary != null && importableRows.length > 0 && !importing;

  async function runImport() {
    if (!canImport) return;
    setImporting(true);
    setImportError("");
    setImportReport(null);
    try {
      const payload = importableRows.map((row) => ({
        excelRow: row.line,
        reference: row.reference,
        supplierCode: row.supplierCode,
        name: row.name,
        categoryName: row.categoryName,
        purchasePriceTTC: row.purchasePriceTTC,
        salePriceTTC: row.salePriceTTC,
        taxRate: row.taxRate,
        targetStock: row.targetStock,
      }));
      const response = await fetch("/api/produits/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload }),
      });
      const body = (await response.json()) as ImportReport & { message?: string };
      if (!response.ok) throw new Error(body.message);
      setImportReport(body);
      await checkWithDatabase(rows);
    } catch (caught) {
      setImportError(
        caught instanceof Error && caught.message ? caught.message : "Impossible d'importer les produits.",
      );
    } finally {
      setImporting(false);
    }
  }

  const counts: Record<FilterKey, number> = { ALL: rows.length, NEW: 0, UPDATE: 0, UNCHANGED: 0, ERROR: 0, CONFLICT: 0 };
  rows.forEach((row) => {
    const key = effectiveFilter(row, serverRows.get(row.line));
    if (key !== "PENDING") counts[key] += 1;
  });

  const visibleRows =
    filter === "ALL" ? rows : rows.filter((row) => effectiveFilter(row, serverRows.get(row.line)) === filter);

  const problemRows = importReport?.rows.filter((row) => row.status === "CONFLICT" || row.status === "ERROR") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Import des produits</h1>
        <p className="text-sm text-muted-foreground">
          Feuille <code>produits</code> — colonnes ref_produit, ref_fournisseur, designation, type, prixAchatTTC, prixGros, taux_tva, QuantiteStock.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Le fournisseur (<code>ref_fournisseur</code>) doit déjà exister. La catégorie (<code>type</code>) est créée si absente.
          <code className="ml-1">QuantiteStock</code> est le stock <span className="font-medium text-foreground">cible</span> du dépôt (pas un ajout).
        </p>
        {depot && (
          <p className="mt-1 text-sm">
            Dépôt cible : <span className="font-medium text-foreground">{depot.name}</span> ({depot.code})
          </p>
        )}
      </div>

      <div>
        <Button type="button" onClick={() => fileInputRef.current?.click()}>
          Choisir un fichier Excel
        </Button>
        <input ref={fileInputRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={handleFileChange} />
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
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  filter === key ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"
                }`}
              >
                {label} ({counts[key]})
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">Ligne</th>
                  <th className="p-2 text-left">Référence</th>
                  <th className="p-2 text-left">Désignation</th>
                  <th className="p-2 text-left">Fournisseur</th>
                  <th className="p-2 text-left">Catégorie</th>
                  <th className="p-2 text-right">Prix achat TTC</th>
                  <th className="p-2 text-right">Prix vente TTC</th>
                  <th className="p-2 text-right">TVA</th>
                  <th className="p-2 text-right">Stock actuel</th>
                  <th className="p-2 text-right">Stock Excel</th>
                  <th className="p-2 text-left">Statut</th>
                  <th className="p-2 text-left">Changements / erreur</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const server = serverRows.get(row.line);
                  const changes = server
                    ? Object.entries(server.changes)
                        .map(([field, value]) => `${CHANGE_LABELS[field] ?? field} : ${value.old ?? "—"} → ${value.new ?? "—"}`)
                        .join(" ; ")
                    : "";
                  const statusLabel =
                    row.status === "ERROR"
                      ? "Erreur"
                      : server
                        ? { NEW: "Nouveau", EXISTING_UNCHANGED: "Inchangé", EXISTING_UPDATE: "À mettre à jour", CONFLICT: "Conflit", ERROR: "Erreur" }[server.status]
                        : "…";
                  return (
                    <tr key={row.line} className="border-t align-top">
                      <td className="p-2">{row.line}</td>
                      <td className="p-2">{row.reference}</td>
                      <td className="p-2">{row.name}</td>
                      <td className="p-2">
                        {row.supplierCode}
                        {server?.supplierName ? <span className="text-muted-foreground"> · {server.supplierName}</span> : null}
                      </td>
                      <td className="p-2">
                        {row.categoryName}
                        {server?.categoryCreate ? <span className="text-muted-foreground"> (nouvelle)</span> : null}
                      </td>
                      <td className="p-2 text-right tabular-nums">{row.purchasePriceTTC}</td>
                      <td className="p-2 text-right tabular-nums">{row.salePriceTTC}</td>
                      <td className="p-2 text-right tabular-nums">{row.taxRate}%</td>
                      <td className="p-2 text-right tabular-nums">{server?.currentStock ?? "—"}</td>
                      <td className="p-2 text-right tabular-nums">{row.targetStock}</td>
                      <td className="p-2">{statusLabel}</td>
                      <td className="p-2 text-muted-foreground">
                        {row.status === "ERROR" ? row.message : server ? `${server.message}${changes ? ` — ${changes}` : ""}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" onClick={runImport} disabled={!canImport}>
              {importing ? "Importation en cours..." : "Importer les produits"}
            </Button>
            {!importing && serverSummary != null && !serverError && (
              <span className="text-sm text-muted-foreground">
                {importableRows.length > 0 ? `${importableRows.length} ligne(s) à importer` : "Rien à importer"}
              </span>
            )}
          </div>
          {importError && <p className="text-sm text-destructive">{importError}</p>}

          {importReport && (
            <div className="space-y-1 rounded-xl border bg-muted/20 p-4 text-sm">
              <p className="font-medium">Rapport d&apos;import</p>
              <p>
                Produits — créés : {importReport.summary.created} · mis à jour : {importReport.summary.updated} · inchangés : {importReport.summary.unchanged} · erreurs : {importReport.summary.errors}
              </p>
              <p>Catégories créées : {importReport.categoriesCreated}</p>
              <p>Stock — mouvements créés : {importReport.stockMovementsCreated}</p>
              {problemRows.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {problemRows.map((row) => (
                    <li key={row.excelRow}>
                      Ligne {row.excelRow} — {row.reference} — {row.message}
                    </li>
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
