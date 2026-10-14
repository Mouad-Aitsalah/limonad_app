import { checkPhotoBytes, photoDataUrl, MAX_PHOTO_BYTES, type PhotoMime } from "@/lib/import-export/images";
import { PRODUCT_SHEET_NAME, parseProductGrid, parseProductTable, type ParsedProductTable } from "@/lib/import-export/products-format";
import { fileKind, readTableFile, readTableGrid, TableFileError } from "@/lib/import-export/tabular";
import { findArchiveEntry, MAX_DATA_FILE_BYTES, readArchive } from "@/lib/import-export/zip";

/**
 * Reading a products import file IN THE BROWSER - Excel, CSV, or a ZIP holding
 * the data file (produits.xlsx / produits.csv) and its photos/ - pure (bytes in,
 * lines + photo checks out), so it is tested without a browser.
 *
 * Photos: the `photo` column of a line gives the exact path of its image in the
 * archive; the image is matched by that path (never by the original file name)
 * and checked from its content (PNG / JPEG / WebP / GIF, 2 MB max). A problem
 * with a photo never blocks the line's data: it is reported, and that photo is
 * not sent.
 */

export type LinePhoto = { path: string; mime: PhotoMime; bytes: Uint8Array };

export type ProductImportFile = {
  parsed: ParsedProductTable;
  /** Name of the data file actually read (inside the archive for a ZIP). */
  dataFileName: string;
  /** Valid photos to send after the lines, by Excel line. */
  photos: Map<number, LinePhoto>;
  /** Photo problems, by Excel line. */
  photoIssues: Map<number, string>;
  archive: null | {
    imageCount: number;
    unusedImages: number;
    unsafePaths: string[];
  };
};

const DATA_FILE_RE = /\.(xlsx|xls|csv)$/i;

function findDataFile(files: ReadonlyMap<string, Uint8Array>): { name: string; data: Uint8Array } {
  const rootData = [...files.keys()].filter((path) => !path.includes("/") && DATA_FILE_RE.test(path));
  const preferred = rootData.find((path) => /^produits\.(xlsx|xls|csv)$/i.test(path)) ?? (rootData.length === 1 ? rootData[0] : undefined);
  if (!preferred) {
    throw new TableFileError(
      rootData.length > 1
        ? "Archive ZIP : plusieurs fichiers de données à la racine - nommez-le produits.xlsx ou produits.csv."
        : "Archive ZIP : fichier de données introuvable (produits.xlsx ou produits.csv à la racine de l'archive).",
    );
  }
  return { name: preferred, data: files.get(preferred)! };
}

export type ReadProductImportOptions = {
  /**
   * Also recognise the products-with-variants format (see parseProductGrid).
   * Off (the default) = the file is read exactly as it always was: ref_produit
   * required, a first row that is the header, no other format.
   */
  variantFormat?: boolean;
};

/** The data file's bytes -> parsed lines, by the historical reader or - with variantFormat - by the format-recognising one. */
function parseDataFile(bytes: Uint8Array, fileName: string, options: ReadProductImportOptions): ParsedProductTable {
  if (options.variantFormat) return parseProductGrid(readTableGrid(bytes, fileName, PRODUCT_SHEET_NAME));
  const table = readTableFile(bytes, fileName, PRODUCT_SHEET_NAME);
  return parseProductTable(table.headers, table.rows);
}

export function readProductImportFile(bytes: Uint8Array, fileName: string, options: ReadProductImportOptions = {}): ProductImportFile {
  const photos = new Map<number, LinePhoto>();
  const photoIssues = new Map<number, string>();

  if (fileKind(fileName) !== "zip") {
    const parsed = parseDataFile(bytes, fileName, options);
    for (const { line, photoPath } of parsed.lines) {
      if (photoPath) photoIssues.set(line.excelRow, "Photo ignorée : les images ne sont lues que dans une archive ZIP (fichier de données + dossier photos/).");
    }
    return { parsed, dataFileName: fileName, photos, photoIssues, archive: null };
  }

  const archive = readArchive(bytes, (path) => (DATA_FILE_RE.test(path) && !path.includes("/") ? MAX_DATA_FILE_BYTES : MAX_PHOTO_BYTES));
  const data = findDataFile(archive.files);
  const parsed = parseDataFile(data.data, data.name, options);
  const tooLarge = new Set(archive.tooLarge.map((entry) => entry.path.toLowerCase()));
  const usedPaths = new Map<string, number>();

  for (const { line, photoPath } of parsed.lines) {
    if (!photoPath) continue;
    const key = photoPath.toLowerCase();
    if (tooLarge.has(key)) {
      photoIssues.set(line.excelRow, `Photo ${photoPath} trop volumineuse (maximum 2 Mo) : non importée.`);
      continue;
    }
    const entry = findArchiveEntry(archive.files, photoPath);
    if (!entry) {
      photoIssues.set(line.excelRow, `Photo ${photoPath} introuvable dans l'archive.`);
      continue;
    }
    const check = checkPhotoBytes(entry);
    if (!check.ok) {
      photoIssues.set(line.excelRow, `Photo ${photoPath} : ${check.message}`);
      continue;
    }
    const previous = usedPaths.get(key);
    if (previous !== undefined) {
      // the same image for two lines is allowed (two products may share a photo) but flagged
      photoIssues.set(line.excelRow, `Photo ${photoPath} déjà utilisée par la ligne ${previous} : vérifiez l'association.`);
    } else {
      usedPaths.set(key, line.excelRow);
    }
    photos.set(line.excelRow, { path: photoPath, mime: check.mime, bytes: check.bytes });
  }

  const imagePaths = [...archive.files.keys()].filter((path) => path !== data.name && !DATA_FILE_RE.test(path));
  return {
    parsed,
    dataFileName: data.name,
    photos,
    photoIssues,
    archive: {
      imageCount: imagePaths.length + archive.tooLarge.length,
      unusedImages: imagePaths.filter((path) => !usedPaths.has(path.toLowerCase())).length,
      unsafePaths: archive.unsafe,
    },
  };
}

/** Upload batches of photos: each request under `maxChars` of data and `maxItems` photos (a lone photo always fits). */
export function photoUploadBatches(
  items: ReadonlyArray<{ reference: string; mime: PhotoMime; bytes: Uint8Array }>,
  options: { maxChars?: number; maxItems?: number } = {},
): Array<Array<{ reference: string; dataUrl: string }>> {
  const maxChars = options.maxChars ?? 3_000_000;
  const maxItems = options.maxItems ?? 40;
  const batches: Array<Array<{ reference: string; dataUrl: string }>> = [];
  let current: Array<{ reference: string; dataUrl: string }> = [];
  let size = 0;
  for (const item of items) {
    const dataUrl = photoDataUrl(item.bytes, item.mime);
    if (current.length && (size + dataUrl.length > maxChars || current.length >= maxItems)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push({ reference: item.reference, dataUrl });
    size += dataUrl.length;
  }
  if (current.length) batches.push(current);
  return batches;
}
