import {
  ACCOUNT_SHEET_NAME,
  accountExportCells,
  orderedAccountColumns,
  type AccountColumnKey,
  type AccountExportRow,
  type AccountTypeCode,
} from "@/lib/import-export/accounts-format";
import { photoArchivePath, storedPhotoBytes } from "@/lib/import-export/images";
import {
  PRODUCT_SHEET_NAME,
  orderedProductColumns,
  productExportCells,
  type ProductColumnKey,
  type ProductExportRow,
} from "@/lib/import-export/products-format";
import { writeCsv, writeXlsx, type CellValue, type TableColumn } from "@/lib/import-export/tabular";
import { buildArchive } from "@/lib/import-export/zip";

/**
 * The exports, built in the browser from the export API (paged JSON, no internal
 * ids) - never a whole file generated on the server (a Vercel response is limited
 * to a few MB, and a catalogue with photos is much bigger). The API access is
 * injected (`fetchJson`), so the whole run is tested without a server.
 */

export type ExportFormat = "xlsx" | "csv" | "zip";

export type FetchJson = <T>(url: string, init?: { method: "POST"; body: unknown }) => Promise<T>;

export type ExportProgress = { phase: "data" | "photos" | "file"; done: number; total: number | null };

export type ExportResult = { bytes: Uint8Array; fileName: string; mime: string; rowCount: number; warnings: string[] };

const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv;charset=utf-8",
  zip: "application/zip",
} as const;

function stamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function tableColumns(columns: ReadonlyArray<{ header: string; kind: TableColumn["kind"] }>): TableColumn[] {
  return columns.map((column) => ({ header: column.header, kind: column.kind }));
}

// ---------------------------------------------------------------- products

type ProductsPage = { rows: ProductExportRow[]; nextCursor: string | null; total: number | null; depotName: string | null };
type PhotosAnswer = { photos: Array<{ reference: string; dataUrl: string }>; remaining: string[]; skipped: Array<{ reference: string; reason: string }> };

/** Most references asked per photo request (the server answers with a size budget anyway). */
const PHOTO_REQUEST_REFERENCES = 200;

export async function runProductsExport(options: {
  columns: Iterable<ProductColumnKey>;
  format: ExportFormat;
  /** Data file inside a ZIP. */
  zipDataFormat?: "xlsx" | "csv";
  filters: { search?: string; categoryId?: string; status?: string };
  fetchJson: FetchJson;
  onProgress?: (progress: ExportProgress) => void;
  now?: Date;
}): Promise<ExportResult> {
  const columns = orderedProductColumns(options.columns);
  const keys = new Set(columns.map((column) => column.key));
  const withPhotos = keys.has("photo");
  const withStock = keys.has("targetStock");
  const warnings: string[] = [];

  // 1. every page of data
  const rows: ProductExportRow[] = [];
  let cursor: string | null = null;
  let total: number | null = null;
  do {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (options.filters.search) params.set("search", options.filters.search);
    if (options.filters.categoryId && options.filters.categoryId !== "all") params.set("categoryId", options.filters.categoryId);
    if (options.filters.status && options.filters.status !== "all") params.set("status", options.filters.status);
    if (withStock) params.set("stock", "1");
    if (withPhotos) params.set("photos", "1");
    const page: ProductsPage = await options.fetchJson<ProductsPage>(`/api/produits/export?${params.toString()}`);
    if (total === null) total = page.total;
    if (withStock && page.depotName && rows.length === 0) warnings.push(`QuantiteStock = stock du dépôt « ${page.depotName} ».`);
    rows.push(...page.rows);
    cursor = page.nextCursor;
    options.onProgress?.({ phase: "data", done: rows.length, total });
  } while (cursor);

  // creating a product needs its supplier (ref_fournisseur): say so before the file goes to another organisation
  const withoutSupplier = keys.has("supplierCode") ? rows.filter((row) => !row.supplierCode).length : 0;
  if (withoutSupplier) {
    warnings.push(`${withoutSupplier} produit(s) sans fournisseur : dans une autre organisation, ils ne pourront être créés qu'une fois ref_fournisseur renseigné.`);
  }

  // 2. photos: inside a ZIP the stored photos travel as files; elsewhere only external URLs fit in a cell
  const photoCells = new Map<string, string>();
  const archiveFiles: Array<{ path: string; data: Uint8Array }> = [];
  if (withPhotos) {
    for (const row of rows) if (row.photo?.kind === "url") photoCells.set(row.reference, row.photo.url);
    const stored = rows.filter((row) => row.photo?.kind === "stored").map((row) => row.reference);
    if (options.format !== "zip") {
      if (stored.length) warnings.push(`${stored.length} photo(s) enregistrée(s) dans l'application ne sont incluses qu'au format ZIP (colonne photo vide).`);
    } else {
      const used = new Set<string>();
      let pending = stored;
      let done = 0;
      options.onProgress?.({ phase: "photos", done, total: stored.length });
      while (pending.length) {
        const ask = pending.slice(0, PHOTO_REQUEST_REFERENCES);
        const answer: PhotosAnswer = await options.fetchJson<PhotosAnswer>("/api/produits/export/photos", { method: "POST", body: { references: ask } });
        for (const photo of answer.photos) {
          const decoded = storedPhotoBytes(photo.dataUrl);
          if (!decoded) {
            warnings.push(`Photo de ${photo.reference} illisible ou dans un format non pris en charge (PNG, JPEG, WebP, GIF) : non exportée.`);
            continue;
          }
          const path = photoArchivePath(photo.reference, decoded.mime, used);
          archiveFiles.push({ path, data: decoded.bytes });
          photoCells.set(photo.reference, path);
        }
        for (const skip of answer.skipped) warnings.push(`${skip.reference} : ${skip.reason}`);
        done += answer.photos.length + answer.skipped.length;
        options.onProgress?.({ phase: "photos", done, total: stored.length });
        // what the server could not fit is asked again first; a call that gave nothing ends the loop
        const progressed = answer.photos.length + answer.skipped.length > 0;
        pending = [...answer.remaining, ...pending.slice(ask.length)];
        if (!progressed && answer.remaining.length) {
          warnings.push(`${answer.remaining.length} photo(s) n'ont pas pu être récupérées.`);
          pending = pending.slice(answer.remaining.length);
        }
      }
    }
  }

  // 3. the file
  options.onProgress?.({ phase: "file", done: rows.length, total: rows.length });
  const cells: CellValue[][] = rows.map((row) => productExportCells(row, columns, photoCells.get(row.reference) ?? null));
  const table = tableColumns(columns);
  const base = `produits_${stamp(options.now ?? new Date())}`;
  if (options.format === "csv") {
    return { bytes: writeCsv(table, cells), fileName: `${base}.csv`, mime: MIME.csv, rowCount: rows.length, warnings };
  }
  if (options.format === "xlsx") {
    return { bytes: writeXlsx(PRODUCT_SHEET_NAME, table, cells), fileName: `${base}.xlsx`, mime: MIME.xlsx, rowCount: rows.length, warnings };
  }
  const dataFormat = options.zipDataFormat ?? "xlsx";
  const data = dataFormat === "csv" ? writeCsv(table, cells) : writeXlsx(PRODUCT_SHEET_NAME, table, cells);
  const bytes = buildArchive([{ path: `produits.${dataFormat}`, data, compress: true }, ...archiveFiles]);
  return { bytes, fileName: `${base}.zip`, mime: MIME.zip, rowCount: rows.length, warnings };
}

// ---------------------------------------------------------------- accounts

type AccountsPage = { rows: AccountExportRow[]; nextCursor: string | null };

export async function runAccountsExport(options: {
  types: readonly AccountTypeCode[];
  columns: Iterable<AccountColumnKey>;
  includeGps: boolean;
  format: Exclude<ExportFormat, "zip">;
  fetchJson: FetchJson;
  onProgress?: (progress: ExportProgress) => void;
  now?: Date;
}): Promise<ExportResult> {
  const columns = orderedAccountColumns(options.columns, options.includeGps);
  const rows: AccountExportRow[] = [];
  for (const type of options.types) {
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ type });
      if (cursor) params.set("cursor", cursor);
      if (options.includeGps) params.set("gps", "1");
      const page: AccountsPage = await options.fetchJson<AccountsPage>(`/api/comptes/export?${params.toString()}`);
      rows.push(...page.rows);
      cursor = page.nextCursor;
      options.onProgress?.({ phase: "data", done: rows.length, total: null });
    } while (cursor);
  }
  const cells = rows.map((row) => accountExportCells(row, columns));
  const table = tableColumns(columns);
  const base = `comptes_${stamp(options.now ?? new Date())}`;
  return options.format === "csv"
    ? { bytes: writeCsv(table, cells), fileName: `${base}.csv`, mime: MIME.csv, rowCount: rows.length, warnings: [] }
    : { bytes: writeXlsx(ACCOUNT_SHEET_NAME, table, cells), fileName: `${base}.xlsx`, mime: MIME.xlsx, rowCount: rows.length, warnings: [] };
}

// ---------------------------------------------------------------- browser helpers

/** The fetch the dialogs use: JSON both ways, readable French errors. */
export const browserFetchJson: FetchJson = async <T,>(url: string, init?: { method: "POST"; body: unknown }) => {
  let response: Response;
  try {
    response = await fetch(url, init ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : { cache: "no-store" });
  } catch {
    throw new Error("Connexion au serveur impossible.");
  }
  const body = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok) {
    if (response.status === 401) throw new Error("Session expirée : reconnectez-vous.");
    if (response.status === 403) throw new Error("Exportation réservée à l'administrateur.");
    throw new Error(body?.message ?? `Erreur du serveur (HTTP ${response.status}).`);
  }
  return body as T;
};

/** Saves the file with the browser's own download (nothing is written on the server). */
export function downloadFile(result: ExportResult): void {
  const blob = new Blob([result.bytes as BlobPart], { type: result.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
