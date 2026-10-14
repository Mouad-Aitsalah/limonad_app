"use client";

import * as React from "react";

import { ProductsImportPager } from "@/components/produits/products-import-pager";
import { ProductsImportProgress } from "@/components/produits/products-import-progress";
import { ProductsImportReport } from "@/components/produits/products-import-report";
import { ProductsImportVariantsPanel, type VariantSupplierOption } from "@/components/produits/products-import-variants-panel";
import { Button } from "@/components/ui/button";
import { readProductImportFile, photoUploadBatches, type LinePhoto } from "@/lib/import-export/product-import-file";
import { PRODUCT_STATUS_LABELS, type ProductImportLine } from "@/lib/import-export/products-format";
import { TableFileError } from "@/lib/import-export/tabular";
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
  postProductPhotos,
  type ImportLineInput,
  type PhotoUploadResult,
  type ServerPreviewRow,
  type ServerSummary,
  type ServerVariantGroup,
} from "@/lib/products-import-client";
import {
  PRODUCT_IMPORT_MAX_ROWS,
  formatImportCount,
  importRowLimitMessage,
  isImportableStatus,
  paginateRows,
} from "@/lib/products-import-shared";
import {
  DEFAULT_VARIANT_TAX_RATE,
  confirmedCreationDefaults,
  describeVariantAttributes,
  externalErrorsForBatch,
  externalVariantErrors,
  selectLinesToWrite,
  variantGroupKeyOfLine,
  withVariantGroupSizes,
  type VariantDefaultsForm,
} from "@/lib/products-import-variant-ui";

type LocalStatus = "VALID" | "ERROR";
type FilterKey = "ALL" | "NEW" | "UPDATE" | "UNCHANGED" | "ERROR" | "CONFLICT" | "BLOCKED";

type Row = {
  line: number;
  values: ProductImportLine;
  /** Photo of the line read from the ZIP (sent after the lines). */
  photo?: LinePhoto;
  photoIssue?: string;
  status: LocalStatus;
  message: string;
  /** Suspicious but not blocking (variants format: a barcode that may have lost a leading zero). */
  warnings: string[];
};

const FILE_ACCEPT =
  ".xlsx,.xls,.csv,.zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/zip";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

const CHANGE_LABELS: Record<string, string> = {
  name: "Désignation",
  supplier: "Fournisseur",
  category: "Catégorie",
  brand: "Marque",
  purchasePriceHT: "Prix achat HT",
  salePriceHT: "Prix vente HT",
  taxRate: "TVA",
  stock: "Stock",
  retailPriceHT: "Prix détail HT",
  semiWholesalePriceHT: "Prix semi-gros HT",
  semiWholesaleMinQty: "Qped",
  wholesaleMinQty: "Qgros",
  unit: "Unité",
  barcode: "Code-barres",
  description: "Description",
  minimumStock: "Stock minimum",
  status: "Statut",
  photo: "Photo",
};
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "Tous" },
  { key: "NEW", label: "Nouveaux" },
  { key: "UPDATE", label: "À mettre à jour" },
  { key: "UNCHANGED", label: "Inchangés" },
  { key: "ERROR", label: "Erreurs" },
  { key: "CONFLICT", label: "Conflits" },
  // variants format only: valid lines blocked because another variant of their group is invalid
  { key: "BLOCKED", label: "Bloqués (groupe)" },
];

function effectiveFilter(row: Row, server?: ServerPreviewRow): Exclude<FilterKey, "ALL"> | "PENDING" {
  if (row.status === "ERROR") return "ERROR";
  if (!server) return "PENDING";
  if (server.wouldBe) return "BLOCKED";
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
  return row.values;
}

const show = (value: string | number | undefined) => (value === undefined ? "—" : value);

type PhotoReport = { sent: number; updated: number; unchanged: number; rejected: PhotoUploadResult[]; error?: string };

export function ProductsImportPreview() {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const stopRequestedRef = React.useRef(false);
  const [fileName, setFileName] = React.useState("");
  const [fileSize, setFileSize] = React.useState<number | null>(null);
  const [archiveInfo, setArchiveInfo] = React.useState<{ dataFileName: string; imageCount: number; unusedImages: number; unsafe: number } | null>(null);
  const [hasStockColumn, setHasStockColumn] = React.useState(false);
  // QuantiteStock is applied only after an explicit confirmation (never by default).
  const [applyStock, setApplyStock] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [error, setError] = React.useState("");
  const [serverRows, setServerRows] = React.useState<Map<number, ServerPreviewRow>>(new Map());
  const [serverLoading, setServerLoading] = React.useState(false);
  const [serverError, setServerError] = React.useState("");
  const [serverSummary, setServerSummary] = React.useState<ServerSummary | null>(null);
  const [depot, setDepot] = React.useState<{ name: string; code: string } | null>(null);
  // Products-with-variants format: preview only (the write of variants is not available yet).
  const [variantMode, setVariantMode] = React.useState<{ columnsNotice?: string } | null>(null);
  const [groups, setGroups] = React.useState<ServerVariantGroup[] | null>(null);
  const [suppliers, setSuppliers] = React.useState<VariantSupplierOption[]>([]);
  const [suppliersError, setSuppliersError] = React.useState("");
  const [defaultsForm, setDefaultsForm] = React.useState<VariantDefaultsForm>({ supplierId: "", taxRateText: String(DEFAULT_VARIANT_TAX_RATE), confirmed: false });
  // The supplier / VAT last sent to the server for the NEW products (null = none confirmed yet).
  const [appliedDefaults, setAppliedDefaults] = React.useState<{ supplierId: string; supplierName: string; taxRate: number } | null>(null);
  const [filter, setFilter] = React.useState<FilterKey>("ALL");
  const [page, setPage] = React.useState(1);
  const [importing, setImporting] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const [importError, setImportError] = React.useState("");
  const [importProgress, setImportProgress] = React.useState<ImportProgress | null>(null);
  const [photoProgress, setPhotoProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [photoReport, setPhotoReport] = React.useState<PhotoReport | null>(null);
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
  async function checkWithDatabase(localRows: Row[], withStock: boolean = applyStock, defaults: typeof appliedDefaults = appliedDefaults) {
    const validRows = localRows.filter((row) => row.status !== "ERROR").map(toLine);
    if (!validRows.length) {
      setServerRows(new Map());
      setServerSummary(null);
      setGroups(null);
      return;
    }
    // Variants format: the supplier / VAT of the NEW products, and the lines refused here that still block their group.
    const variantsFile = validRows.some((line) => line.referenceSource !== undefined);
    setServerLoading(true);
    setServerError("");
    try {
      // A historical file: the very same request as ever.
      const body = variantsFile
        ? await postProductImportPreview(validRows, {
            applyStock: withStock,
            ...(defaults ? { creationDefaults: { supplierId: defaults.supplierId, taxRate: defaults.taxRate } } : {}),
            externalErrors: externalVariantErrors(localRows),
          })
        : await postProductImportPreview(validRows, { applyStock: withStock });
      setServerRows(new Map(body.rows.map((row) => [row.excelRow, row])));
      setServerSummary(body.summary);
      setGroups(body.groups ?? null);
      setDepot(body.depot);
    } catch (caught) {
      // No server answer: no counters (they would be zeros that mean nothing).
      setGroups(null);
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
    setPhotoReport(null);
    setArchiveInfo(null);
    setApplyStock(false);
    setVariantMode(null);
    setGroups(null);
    setAppliedDefaults(null);
    setDefaultsForm({ supplierId: "", taxRateText: String(DEFAULT_VARIANT_TAX_RATE), confirmed: false });
    try {
      // variantFormat: also recognise the products-with-variants format; a historical file is read exactly as before.
      const content = readProductImportFile(new Uint8Array(await file.arrayBuffer()), file.name, { variantFormat: true });
      if (content.parsed.fatal) {
        setRows([]);
        setServerRows(new Map());
        setServerSummary(null);
        setError(content.parsed.fatal);
        return;
      }
      setVariantMode(content.parsed.format === "variants" ? { columnsNotice: content.parsed.columnsNotice } : null);
      if (content.archive) {
        setArchiveInfo({
          dataFileName: content.dataFileName,
          imageCount: content.archive.imageCount,
          unusedImages: content.archive.unusedImages,
          unsafe: content.archive.unsafePaths.length,
        });
      }
      setHasStockColumn(content.parsed.present.has("targetStock"));

      const parsed: Row[] = content.parsed.lines.map(({ line, errors, warnings }) => ({
        line: line.excelRow,
        values: line,
        photo: content.photos.get(line.excelRow),
        photoIssue: content.photoIssues.get(line.excelRow),
        status: errors.length ? "ERROR" : "VALID",
        message: errors.join(" ; ") || "Valide",
        warnings: warnings ?? [],
      }));

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
      void checkWithDatabase(parsed, false, null);
    } catch (caught) {
      setRows([]);
      setError(caught instanceof TableFileError || (caught instanceof Error && /ZIP|Archive/.test(caught.message)) ? caught.message : "Impossible de lire le fichier.");
    }
  }

  const counts = React.useMemo(() => {
    const totals: Record<FilterKey, number> = { ALL: rows.length, NEW: 0, UPDATE: 0, UNCHANGED: 0, ERROR: 0, CONFLICT: 0, BLOCKED: 0 };
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

  const importableRows = React.useMemo(() => {
    if (variantMode) {
      // A variants group is written whole or not at all: it goes complete (its unchanged lines too) when one of its
      // lines is new or to update, and never when a line of it is blocked, in error or in conflict.
      const chosen = new Set(selectLinesToWrite(rows.filter((row) => row.status !== "ERROR").map(toLine), serverRows).map((line) => line.excelRow));
      return rows.filter((row) => chosen.has(row.line));
    }
    return rows.filter((row) => {
      if (row.status === "ERROR") return false;
      return isImportableStatus(serverRows.get(row.line)?.status);
    });
  }, [rows, serverRows, variantMode]);
  // Photos of the ZIP for the lines the import keeps (new / updated / unchanged products).
  const photoRows = React.useMemo(
    () =>
      rows.filter((row) => {
        if (!row.photo || row.status === "ERROR") return false;
        const status = serverRows.get(row.line)?.status;
        return status === "NEW" || status === "EXISTING_UPDATE" || status === "EXISTING_UNCHANGED";
      }),
    [rows, serverRows],
  );
  // A products-with-variants file is written only once the supplier and the VAT of its new products are confirmed.
  const canImport = countsReady && (importableRows.length > 0 || photoRows.length > 0) && !importing && (!variantMode || appliedDefaults !== null);

  // Distinct ref_fournisseur the import will create (each one once, whatever the number of lines).
  const suppliersToCreate = React.useMemo(
    () => new Set(importableRows.filter((row) => serverRows.get(row.line)?.supplierCreate).map((row) => row.values.supplierCode)).size,
    [importableRows, serverRows],
  );
  // Lines whose depot stock differs from QuantiteStock while "apply stock" is off.
  const pendingStockCount = React.useMemo(() => rows.filter((row) => serverRows.get(row.line)?.pendingStock).length, [rows, serverRows]);

  // The variants format has no supplier / VAT column: load the organisation's suppliers once, to choose the one of the NEW products.
  React.useEffect(() => {
    if (!variantMode || suppliers.length > 0) return;
    let cancelled = false;
    fetch("/api/suppliers")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("HTTP " + response.status))))
      .then((body: { suppliers?: Array<{ id: string; name: string }> }) => {
        if (!cancelled) setSuppliers((body.suppliers ?? []).map((supplier) => ({ id: supplier.id, name: supplier.name })));
      })
      .catch(() => {
        if (!cancelled) setSuppliersError("Impossible de charger les fournisseurs.");
      });
    return () => {
      cancelled = true;
    };
  }, [variantMode, suppliers.length]);

  function applyVariantDefaults() {
    const confirmed = confirmedCreationDefaults(defaultsForm);
    if (!confirmed) return;
    const next = { ...confirmed, supplierName: suppliers.find((supplier) => supplier.id === confirmed.supplierId)?.name ?? "" };
    setAppliedDefaults(next);
    void checkWithDatabase(rows, applyStock, next);
  }

  async function sendPhotos(): Promise<PhotoReport> {
    const report: PhotoReport = { sent: 0, updated: 0, unchanged: 0, rejected: [] };
    const batches = photoUploadBatches(photoRows.map((row) => ({ reference: row.values.reference, mime: row.photo!.mime, bytes: row.photo!.bytes })));
    setPhotoProgress({ done: 0, total: photoRows.length });
    for (const batch of batches) {
      if (stopRequestedRef.current) break;
      try {
        const results = await postProductPhotos(batch);
        report.sent += batch.length;
        report.updated += results.filter((result) => result.status === "UPDATED").length;
        report.unchanged += results.filter((result) => result.status === "UNCHANGED").length;
        report.rejected.push(...results.filter((result) => result.status === "INVALID" || result.status === "NOT_FOUND"));
      } catch (caught) {
        report.error = caught instanceof Error ? caught.message : "Envoi des photos impossible.";
        break;
      }
      setPhotoProgress({ done: report.sent, total: photoRows.length });
    }
    setPhotoProgress(null);
    return report;
  }

  async function runImport() {
    if (!canImport) return;
    // What the preview already set aside (not sent): the final report adds it up.
    const leftovers = { unchanged: counts.UNCHANGED, conflicts: counts.CONFLICT, errors: counts.ERROR };
    // Variants: each line carries the size of its file group (unreadable lines included) so the server can refuse a short group.
    const lines = variantMode ? withVariantGroupSizes(importableRows.map(toLine), rows) : importableRows.map(toLine);
    stopRequestedRef.current = false;
    setStopping(false);
    setImporting(true);
    setImportError("");
    setImportResult(null);
    setPhotoReport(null);
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
      const result =
        variantMode && appliedDefaults
          ? await runBatchedImport({
              rows: lines,
              // The lines of a group travel together: a batch is cut only between two groups.
              groupOf: variantGroupKeyOfLine,
              sendBatch: (batch) =>
                postProductImportBatch(batch, {
                  applyStock,
                  creationDefaults: { supplierId: appliedDefaults.supplierId, taxRate: appliedDefaults.taxRate },
                  externalErrors: externalErrorsForBatch(batch, rows),
                }),
              onProgress: setImportProgress,
              shouldStop: () => stopRequestedRef.current,
            })
          : await runBatchedImport({
              rows: lines,
              sendBatch: (batch) => postProductImportBatch(batch, { applyStock }),
              onProgress: setImportProgress,
              shouldStop: () => stopRequestedRef.current,
            });
      setImportResult({ report: buildImportReport(result, leftovers), problemRows: result.problemRows });
      // Then the photos of the ZIP, a few at a time (the products exist now).
      if (photoRows.length && !stopRequestedRef.current) setPhotoReport(await sendPhotos());
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
          Excel (feuille <code>produits</code>), CSV (séparateur <code>;</code>) ou ZIP exporté par COMDIS (fichier de données + dossier{" "}
          <code>photos/</code>). Seule la colonne <code>ref_produit</code> est obligatoire.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Colonnes reconnues : ref_produit, ref_fournisseur, nom_fournisseur, designation, type, prixAchatTTC, prixGros (ou prix_gros), prix_detail,
          prix_semi_gros, Qped, Qgros, taux_tva, unite, code_barre, marque, description, stock_min, statut, QuantiteStock, photo. Une colonne absente ou
          une cellule vide ne modifie pas la valeur enregistrée. Pour CRÉER un produit : designation, type, ref_fournisseur, prixAchatTTC, prixGros et
          taux_tva.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Le fournisseur (<code>ref_fournisseur</code>), la catégorie (<code>type</code>) et la marque sont créés s&apos;ils sont absents.
          <code className="ml-1">QuantiteStock</code> est le stock <span className="font-medium text-foreground">cible</span> du dépôt (pas un ajout),
          appliqué seulement si vous le confirmez. Jusqu&apos;à {formatImportCount(PRODUCT_IMPORT_MAX_ROWS)} lignes par fichier.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Un fichier avec variantes (7 colonnes sans en-tête : désignation, code-barres, catégorie, prix d&apos;achat TTC, prix de vente TTC, stock,
          variantes <code>TAILLE: S | COULEUR: NOIR</code>) est reconnu automatiquement et affiché en aperçu groupé.
        </p>
        {depot && (
          <p className="mt-1 text-sm">
            Dépôt cible : <span className="font-medium text-foreground">{depot.name}</span> ({depot.code})
          </p>
        )}
      </div>

      <div>
        <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          Choisir un fichier (Excel, CSV ou ZIP)
        </Button>
        <input ref={fileInputRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={handleFileChange} data-import="file" />
      </div>
      {fileName && (
        <p className="text-sm text-muted-foreground">
          Fichier : {fileName}
          {fileSize != null ? ` · ${formatFileSize(fileSize)}` : ""}
          {archiveInfo
            ? ` · données : ${archiveInfo.dataFileName} · ${archiveInfo.imageCount} image(s) dans l'archive${archiveInfo.unusedImages ? `, dont ${archiveInfo.unusedImages} non référencée(s) (ignorée(s))` : ""}`
            : ""}
        </p>
      )}
      {archiveInfo && archiveInfo.unsafe > 0 ? (
        <p role="alert" className="text-sm text-destructive">
          {archiveInfo.unsafe} entrée(s) de l&apos;archive avec un chemin dangereux (.., chemin absolu) ont été ignorées.
        </p>
      ) : null}

      {serverLoading && <p className="text-sm text-muted-foreground">Vérification avec la base de données...</p>}
      {serverError && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">{serverError}</p>
          <Button type="button" variant="outline" size="sm" disabled={serverLoading} onClick={() => void checkWithDatabase(rows)}>
            Réessayer la vérification
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {rows.length > 0 && variantMode ? (
        <ProductsImportVariantsPanel
          columnsNotice={variantMode.columnsNotice}
          suppliers={suppliers}
          suppliersError={suppliersError}
          form={defaultsForm}
          applied={appliedDefaults ? { supplierName: appliedDefaults.supplierName, taxRate: appliedDefaults.taxRate } : null}
          loading={serverLoading}
          groups={groups}
          onChange={setDefaultsForm}
          onApply={applyVariantDefaults}
        />
      ) : null}

      {rows.length > 0 && hasStockColumn ? (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-import="stock">
          <p>
            Le fichier contient <code>QuantiteStock</code> (stock cible du dépôt {depot ? `« ${depot.name} »` : "de votre utilisateur"}).
            {!applyStock && countsReady
              ? ` ${formatImportCount(pendingStockCount)} produit(s) verraient leur stock modifié si vous l'appliquez.`
              : ""}{" "}
            Par sécurité, il n&apos;est appliqué que si vous le confirmez : un ancien export ne doit pas écraser le stock du jour.
          </p>
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              className="size-4 accent-amber-600"
              checked={applyStock}
              disabled={importing || serverLoading}
              onChange={(event) => {
                const next = event.currentTarget.checked;
                setApplyStock(next);
                void checkWithDatabase(rows, next);
              }}
              data-import="apply-stock"
            />
            Appliquer les quantités de stock du fichier (ajustements d&apos;inventaire)
          </label>
        </div>
      ) : null}

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
            <table className="w-full text-sm" data-import="preview">
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
                  <th className="p-2 text-right">Stock fichier</th>
                  <th className="p-2 text-left">Photo</th>
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
                        ? server.wouldBe
                          ? "Bloqué (groupe)"
                          : { NEW: "Nouveau", EXISTING_UNCHANGED: "Inchangé", EXISTING_UPDATE: "À mettre à jour", CONFLICT: "Conflit", ERROR: "Erreur" }[server.status]
                        : serverError
                          ? "Non vérifié"
                          : "…";
                  const values = row.values;
                  return (
                    <tr key={row.line} className="border-t align-top" data-line={row.line}>
                      <td className="p-2">{row.line}</td>
                      <td className="p-2">{values.reference}</td>
                      <td className="p-2">
                        {show(values.name)}
                        {values.variantAttributes ? (
                          <span className="block text-[0.7rem] text-muted-foreground">
                            {values.variantParentName} · {describeVariantAttributes(values.variantAttributes)}
                          </span>
                        ) : null}
                        {values.productStatus ? <span className="block text-[0.7rem] text-muted-foreground">{PRODUCT_STATUS_LABELS[values.productStatus]}</span> : null}
                      </td>
                      <td className="p-2">
                        {show(values.supplierCode)}
                        {server?.supplierName ? <span className="text-muted-foreground"> · {server.supplierName}</span> : null}
                        {server?.supplierCreate ? <span className="text-muted-foreground"> (nouveau)</span> : null}
                        {server?.supplierCreate && values.supplierName ? (
                          <span className="block text-[0.7rem] text-muted-foreground">Nom : {values.supplierName}</span>
                        ) : null}
                      </td>
                      <td className="p-2">
                        {show(values.categoryName)}
                        {server?.categoryCreate ? <span className="text-muted-foreground"> (nouvelle)</span> : null}
                        {values.brandName ? (
                          <span className="block text-[0.7rem] text-muted-foreground">
                            Marque : {values.brandName}
                            {server?.brandCreate ? " (nouvelle)" : ""}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2 text-right tabular-nums">{show(values.purchasePriceTTC)}</td>
                      <td className="p-2 text-right tabular-nums">{show(values.salePriceTTC)}</td>
                      <td className="p-2 text-right tabular-nums">
                        {values.taxRate !== undefined ? `${values.taxRate}%` : server?.appliedTaxRate !== undefined ? `${server.appliedTaxRate}%` : "—"}
                      </td>
                      <td className="p-2 text-right tabular-nums">{server?.currentStock ?? "—"}</td>
                      <td className="p-2 text-right tabular-nums">
                        {show(values.targetStock)}
                        {server?.pendingStock ? <span className="block text-[0.7rem] text-amber-700">non appliqué</span> : null}
                      </td>
                      <td className="p-2 text-[0.75rem]">
                        {row.photo && !row.photoIssue ? <span className="text-emerald-700">{row.photo.path}</span> : null}
                        {row.photoIssue ? <span className="text-amber-700">{row.photoIssue}</span> : null}
                        {!row.photo && !row.photoIssue ? (values.imageUrl ? "URL" : "—") : null}
                      </td>
                      <td className="p-2">{statusLabel}</td>
                      <td className="p-2 text-muted-foreground">
                        {row.status === "ERROR" ? row.message : server ? `${server.message}${changes ? ` — ${changes}` : ""}` : ""}
                        {row.warnings.map((warning) => (
                          <span key={warning} className="block text-[0.7rem] text-amber-700">
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

          <ProductsImportPager
            page={pageData.page}
            pageCount={pageData.pageCount}
            from={pageData.from}
            to={pageData.to}
            totalRows={filteredRows.length}
            onPageChange={setPage}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={runImport} disabled={!canImport} data-import="run">
              {importing ? "Importation en cours..." : "Importer les produits"}
            </Button>
            {variantMode && !appliedDefaults ? (
              <span className="text-sm text-amber-700">Confirmez le fournisseur et la TVA des nouveaux produits (cadre ci-dessus) pour pouvoir importer.</span>
            ) : null}
            {!importing && countsReady && (
              <span className="text-sm text-muted-foreground">
                {importableRows.length > 0
                  ? `${formatImportCount(importableRows.length)} ligne(s) à importer`
                  : "Aucune ligne à créer ou mettre à jour"}
                {suppliersToCreate > 0 ? ` · ${formatImportCount(suppliersToCreate)} fournisseur(s) à créer` : ""}
                {photoRows.length > 0 ? ` · ${formatImportCount(photoRows.length)} photo(s) à envoyer` : ""}
                {applyStock ? " · stock appliqué" : ""}
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
          {photoProgress ? (
            <p role="status" className="text-sm text-muted-foreground">
              Envoi des photos : {photoProgress.done} / {photoProgress.total}
            </p>
          ) : null}

          {importResult && <ProductsImportReport report={importResult.report} problemRows={importResult.problemRows} />}
          {photoReport ? (
            <div className="space-y-1 rounded-xl border px-4 py-3 text-sm" data-import="photo-report">
              <p className="font-medium">
                Photos : {photoReport.updated} enregistrée(s), {photoReport.unchanged} déjà identique(s), {photoReport.rejected.length} rejetée(s)
              </p>
              {photoReport.rejected.map((item) => (
                <p key={item.reference} className="text-xs text-destructive">
                  {item.reference} : {item.message}
                </p>
              ))}
              {photoReport.error ? <p className="text-xs text-destructive">{photoReport.error}</p> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
