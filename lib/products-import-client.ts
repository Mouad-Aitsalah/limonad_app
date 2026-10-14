import type { ProductImportLine } from "@/lib/import-export/products-format";
import type { BatchResponse } from "@/lib/products-import-batches";

/**
 * The two calls the import page makes. They only add readable errors on top of
 * fetch: a timeout (a 504 page), a network drop or a refused request all become
 * a plain French message instead of "Unexpected token 'A'... is not valid JSON".
 */

/** One line sent to the server - the shared file format's line (a missing key = keep the stored value). */
export type ImportLineInput = ProductImportLine;

export type ServerStatus = "NEW" | "EXISTING_UNCHANGED" | "EXISTING_UPDATE" | "CONFLICT" | "ERROR";
export type ServerChange = { old: string | null; new: string | null };

/** One line of the preview answer: only what the browser does not already have
 * (it is matched to the file's own line by `excelRow`). */
export type ServerPreviewRow = {
  excelRow: number;
  supplierName: string | null;
  /** ref_fournisseur matches no supplier yet: the import will create it. */
  supplierCreate: boolean;
  categoryCreate: boolean;
  /** A brand named by the file that does not exist yet: the import creates it. */
  brandCreate?: boolean;
  currentStock: number | null;
  /** A different QuantiteStock while "apply stock" is off: shown, never written. */
  pendingStock?: ServerChange | null;
  status: ServerStatus;
  message: string;
  changes: Record<string, ServerChange>;
  /** Variants format only: index in ServerPreview.groups. */
  variantGroupIndex?: number;
  /** The line belongs to a group blocked by an invalid variant: not importable. */
  groupBlocked?: boolean;
  /** A line blocked ONLY because of its group: what it would have been. */
  wouldBe?: ServerStatus;
  /** The VAT of the page's creation defaults, when it was used for this NEW line. */
  appliedTaxRate?: number;
};

export type ServerSummary = {
  total: number;
  new: number;
  unchanged: number;
  update: number;
  conflicts: number;
  errors: number;
  /** Variants format only: lines blocked ONLY because another variant of their group is invalid. */
  blocked?: number;
};

/** One parent product of the variants format, as the server grouped it. */
export type ServerVariantGroup = {
  parentName: string;
  categoryName: string | null;
  variants: number;
  new: number;
  update: number;
  unchanged: number;
  problems: number;
  blockedRows: number;
  blocked: boolean;
  /** « ligne 12 : … » for a blocked group. */
  reason: string | null;
};

export type ServerPreview = {
  depot: { name: string; code: string };
  summary: ServerSummary;
  rows: ServerPreviewRow[];
  /** Variants format only. */
  groups?: ServerVariantGroup[];
};

/** Variants format: values for the NEW products (no supplier / VAT column in that file) and the lines that blocked a group before reaching the server. */
export type PreviewVariantOptions = {
  creationDefaults?: { supplierId?: string; taxRate?: number };
  externalErrors?: Array<{ groupKey: string; excelRow: number; message: string }>;
};

async function readJson<T>(response: Response, whatFailed: string): Promise<T> {
  let body: (T & { message?: string }) | null = null;
  try {
    body = (await response.json()) as T & { message?: string };
  } catch {
    // The host answered with a page, not JSON (timeout, gateway error, ...).
    throw new Error(
      response.ok
        ? "Réponse illisible du serveur."
        : `${whatFailed} : le serveur n'a pas répondu correctement (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) {
    throw new Error(body?.message || `${whatFailed} (HTTP ${response.status}).`);
  }
  return body as T;
}

async function post<T>(url: string, payload: unknown, whatFailed: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(`${whatFailed} : connexion au serveur impossible.`);
  }
  return readJson<T>(response, whatFailed);
}

/**
 * Read-only check of the WHOLE file against the database (one request).
 * `applyStock`: the user's explicit choice to apply QuantiteStock (off by default).
 */
export function postProductImportPreview(
  rows: ImportLineInput[],
  options: { applyStock: boolean } & PreviewVariantOptions = { applyStock: false },
): Promise<ServerPreview> {
  return post<ServerPreview>(
    "/api/produits/import/preview",
    {
      rows,
      applyStock: options.applyStock,
      // sent only by the variants format: a historical request is byte-for-byte what it was
      ...(options.creationDefaults ? { creationDefaults: options.creationDefaults } : {}),
      ...(options.externalErrors?.length ? { externalErrors: options.externalErrors } : {}),
    },
    "Vérification impossible",
  );
}

/** The real write of ONE batch of lines. */
export function postProductImportBatch(
  rows: ImportLineInput[],
  options: { applyStock: boolean } & PreviewVariantOptions = { applyStock: false },
): Promise<BatchResponse> {
  return post<BatchResponse>(
    "/api/produits/import",
    {
      rows,
      applyStock: options.applyStock,
      // variants format only: the supplier / VAT of the new products, and the browser-refused lines of the batch's groups
      ...(options.creationDefaults ? { creationDefaults: options.creationDefaults } : {}),
      ...(options.externalErrors?.length ? { externalErrors: options.externalErrors } : {}),
    },
    "Import du lot impossible",
  );
}

export type PhotoUploadResult = { reference: string; status: "UPDATED" | "UNCHANGED" | "NOT_FOUND" | "INVALID"; message: string };

/** A few photos of the ZIP (data: URIs prepared in the browser), attached by reference on the server. */
export async function postProductPhotos(photos: Array<{ reference: string; dataUrl: string }>): Promise<PhotoUploadResult[]> {
  const body = await post<{ results: PhotoUploadResult[] }>("/api/produits/import/photos", { photos }, "Envoi des photos impossible");
  return body.results;
}
