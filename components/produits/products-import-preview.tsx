"use client";

import * as React from "react";
import * as XLSX from "xlsx";

import { ProductsImportPager } from "@/components/produits/products-import-pager";
import { ProductsImportProgress } from "@/components/produits/products-import-progress";
import { ProductsImportReport } from "@/components/produits/products-import-report";
import { Button } from "@/components/ui/button";
import {
  buildImportReport,
  runBatchedImport,
  type BatchRowResult,
  type ImportProgress,
  type ImportReportView,
} from "@/lib/products-import-batches";
import {
  postProductImportBatch,
  postProductImportPreview,
  type ImportLineInput,
  type ServerPreviewRow,
  type ServerSummary,
} from "@/lib/products-import-client";
import {
  PRODUCT_IMPORT_MAX_ROWS,
  formatImportCount,
  importRowLimitMessage,
  isImportableStatus,
  paginateRows,
} from "@/lib/products-import-shared";

type LocalStatus = "VALID" | "ERROR";
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

function effectiveFilter(row: Row, server?: ServerPreviewRow): Exclude<FilterKey, "ALL"> | "PENDING" {
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

function toLine(row: Row): ImportLineInput {
  return {
    excelRow: row.line,
    reference: row.reference,
    supplierCode: row.supplierCode,
    name: row.name,
    categoryName: row.categoryName,
    purchasePriceTTC: row.purchasePriceTTC,
    salePriceTTC: row.salePriceTTC,
    taxRate: row.taxRate,
    targetStock: row.targetStock,
  };
}

export function ProductsImportPreview() {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const stopRequestedRef = React.useRef(false);
  const [fileName, setFileName] = React.useState("");
  const [fileSize, setFileSize] = React.useState<number | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [error, setError] = React.useState("");
  const [serverRows, setServerRows] = React.useState<Map<number, ServerPreviewRow>>(new Map());
  const [serverLoading, setServerLoading] = React.useState(false);
  const [serverError, setServerError] = React.useState("");
  const [serverSummary, setServerSummary] = React.useState<ServerSummary | null>(null);
  const [depot, setDepot] = React.useState<{ name: string; code: string } | null>(null);
  const [filter, setFilter] = React.useState<FilterKey>("ALL");
  const [page, setPage] = React.useState(1);
  const [importing, setImporting] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const [importError, setImportError] = React.useState("");
  const [importProgress, setImportProgress] = React.useState<ImportProgress | null>(null);
  const [importResult, setImportResult] = React.useState<{
    report: ImportReportView;
    problemRows: BatchRowResult[];
  } | null>(null);

  // Never leave (or reload) the page by accident in the middle of an import.
  React.useEffect(() => {
    if (!importing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [importing]);

  /** The whole file, in ONE read-only request, so a reference used twice is a conflict file-wide. */
  async function checkWithDatabase(localRows: Row[]) {
    const validRows = localRows.filter((row) => row.status !== "ERROR").map(toLine);
    if (!validRows.length) {
      setServerRows(new Map());
      setServerSummary(null);
      return;
    }
    setServerLoading(true);
    setServerError("");
    try {
      const body = await postProductImportPreview(validRows);
      setServerRows(new Map(body.rows.map((row) => [row.excelRow, row])));
      setServerSummary(body.summary);
      setDepot(body.depot);
    } catch (caught) {
      // No server answer: no counters (they would be zeros that mean nothing).
      setServerRows(new Map());
      setServerSummary(null);
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
    setServerError("");
    setImportResult(null);
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

      // A file over the limit is refused here, with the real numbers, before
      // anything is sent: never a bare "Lignes import invalides.".
      if (parsed.length > PRODUCT_IMPORT_MAX_ROWS) {
        setRows([]);
        setServerRows(new Map());
        setServerSummary(null);
        setError(importRowLimitMessage(parsed.length));
        return;
      }

      // In-file duplicate references are left for the server, which returns
      // them as CONFLICT (never imported) so the "Conflits" filter is real.
      setRows(parsed);
      setServerRows(new Map());
      setServerSummary(null);
      setFilter("ALL");
      setPage(1);
      void checkWithDatabase(parsed);
    } catch {
      setRows([]);
      setError("Impossible de lire le fichier Excel.");
    }
  }

  // One pass over the file lines, only when the file or the server answer changes.
  const counts = React.useMemo(() => {
    const totals: Record<FilterKey, number> = { ALL: rows.length, NEW: 0, UPDATE: 0, UNCHANGED: 0, ERROR: 0, CONFLICT: 0 };
    for (const row of rows) {
      const key = effectiveFilter(row, serverRows.get(row.line));
      if (key !== "PENDING") totals[key] += 1;
    }
    return totals;
  }, [rows, serverRows]);

  // The global counters are only real once the server has classified the file.
  // Before that (or if the check failed) they show "…" / "—", never a false 0.
  const countsReady = serverSummary != null && !serverError && !serverLoading;
  function countLabel(key: FilterKey) {
    if (key === "ALL") return formatImportCount(counts.ALL);
    if (serverLoading) return "…";
    return countsReady ? formatImportCount(counts[key]) : "—";
  }

  const importableRows = React.useMemo(
    () =>
      rows.filter((row) => {
        if (row.status === "ERROR") return false;
        return isImportableStatus(serverRows.get(row.line)?.status);
      }),
    [rows, serverRows],
  );
  const canImport = countsReady && importableRows.length > 0 && !importing;

  // Distinct ref_fournisseur the import will create (each one once, whatever the number of lines).
  const suppliersToCreate = React.useMemo(
    () => new Set(importableRows.filter((row) => serverRows.get(row.line)?.supplierCreate).map((row) => row.supplierCode)).size,
    [importableRows, serverRows],
  );

  async function runImport() {
    if (!canImport) return;
    // What the preview already set aside (not sent): the final report adds it up.
    const leftovers = { unchanged: counts.UNCHANGED, conflicts: counts.CONFLICT, errors: counts.ERROR };
    const lines = importableRows.map(toLine);
    stopRequestedRef.current = false;
    setStopping(false);
    setImporting(true);
    setImportError("");
    setImportResult(null);
    setImportProgress({
      total: lines.length,
      processed: 0,
      failedRows: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
      errors: 0,
      batchesDone: 0,
      batchesTotal: 0,
    });
    try {
      // Batches of 200 lines, sent strictly one after the other.
      const result = await runBatchedImport({
        rows: lines,
        sendBatch: (batch) => postProductImportBatch(batch),
        onProgress: setImportProgress,
        shouldStop: () => stopRequestedRef.current,
      });
      setImportResult({ report: buildImportReport(result, leftovers), problemRows: result.problemRows });
      // The database changed: classify the file again so the counters are current.
      await checkWithDatabase(rows);
    } catch (caught) {
      setImportError(
        caught instanceof Error && caught.message ? caught.message : "Impossible d'importer les produits.",
      );
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  const filteredRows = React.useMemo(
    () => (filter === "ALL" ? rows : rows.filter((row) => effectiveFilter(row, serverRows.get(row.line)) === filter)),
    [rows, serverRows, filter],
  );
  const pageData = paginateRows(filteredRows, page);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Import des produits</h1>
        <p className="text-sm text-muted-foreground">
          Feuille <code>produits</code> — colonnes ref_produit, ref_fournisseur, designation, type, prixAchatTTC, prixGros, taux_tva, QuantiteStock.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Le fournisseur (<code>ref_fournisseur</code>) et la catégorie (<code>type</code>) sont créés s&apos;ils sont absents.
          <code className="ml-1">QuantiteStock</code> est le stock <span className="font-medium text-foreground">cible</span> du dépôt (pas un ajout).
          Jusqu&apos;à {formatImportCount(PRODUCT_IMPORT_MAX_ROWS)} lignes par fichier.
        </p>
        {depot && (
          <p className="mt-1 text-sm">
            Dépôt cible : <span className="font-medium text-foreground">{depot.name}</span> ({depot.code})
          </p>
        )}
      </div>

      <div>
        <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}>
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
      {serverError && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">{serverError}</p>
          <Button type="button" variant="outline" size="sm" disabled={serverLoading} onClick={() => void checkWithDatabase(rows)}>
            Réessayer la vérification
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setFilter(key);
                  setPage(1);
                }}
                className={`rounded-full border px-3 py-1 text-sm ${
                  filter === key ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"
                }`}
              >
                {label} ({countLabel(key)})
              </button>
            ))}
          </div>

          <ProductsImportPager
            page={pageData.page}
            pageCount={pageData.pageCount}
            from={pageData.from}
            to={pageData.to}
            totalRows={filteredRows.length}
            onPageChange={setPage}
          />

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
                {pageData.rows.map((row) => {
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
                        : serverError
                          ? "Non vérifié"
                          : "…";
                  return (
                    <tr key={row.line} className="border-t align-top">
                      <td className="p-2">{row.line}</td>
                      <td className="p-2">{row.reference}</td>
                      <td className="p-2">{row.name}</td>
                      <td className="p-2">
                        {row.supplierCode}
                        {server?.supplierName ? <span className="text-muted-foreground"> · {server.supplierName}</span> : null}
                        {server?.supplierCreate ? <span className="text-muted-foreground"> (nouveau)</span> : null}
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

          <ProductsImportPager
            page={pageData.page}
            pageCount={pageData.pageCount}
            from={pageData.from}
            to={pageData.to}
            totalRows={filteredRows.length}
            onPageChange={setPage}
          />

          <div className="flex items-center gap-3">
            <Button type="button" onClick={runImport} disabled={!canImport}>
              {importing ? "Importation en cours..." : "Importer les produits"}
            </Button>
            {!importing && countsReady && (
              <span className="text-sm text-muted-foreground">
                {importableRows.length > 0
                  ? `${formatImportCount(importableRows.length)} ligne(s) à importer`
                  : "Rien à importer"}
                {suppliersToCreate > 0 ? ` · ${formatImportCount(suppliersToCreate)} fournisseur(s) à créer` : ""}
              </span>
            )}
          </div>
          {importError && <p className="text-sm text-destructive">{importError}</p>}

          {importProgress && (
            <ProductsImportProgress
              progress={importProgress}
              stopping={stopping}
              onStop={() => {
                stopRequestedRef.current = true;
                setStopping(true);
              }}
            />
          )}

          {importResult && <ProductsImportReport report={importResult.report} problemRows={importResult.problemRows} />}
        </>
      )}
    </div>
  );
}
