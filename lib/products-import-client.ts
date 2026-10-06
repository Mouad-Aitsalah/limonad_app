import type { BatchResponse } from "@/lib/products-import-batches";

/**
 * The two calls the import page makes. They only add readable errors on top of
 * fetch: a timeout (a 504 page), a network drop or a refused request all become
 * a plain French message instead of "Unexpected token 'A'... is not valid JSON".
 */

export type ImportLineInput = {
  excelRow: number;
  reference: string;
  supplierCode: string;
  name: string;
  categoryName: string;
  purchasePriceTTC: number;
  salePriceTTC: number;
  taxRate: number;
  targetStock: number;
};

export type ServerStatus = "NEW" | "EXISTING_UNCHANGED" | "EXISTING_UPDATE" | "CONFLICT" | "ERROR";
export type ServerChange = { old: string | null; new: string | null };

/** One line of the preview answer: only what the browser does not already have
 * (it is matched to the file's own line by `excelRow`). */
export type ServerPreviewRow = {
  excelRow: number;
  supplierName: string | null;
  categoryCreate: boolean;
  currentStock: number | null;
  status: ServerStatus;
  message: string;
  changes: Record<string, ServerChange>;
};

export type ServerSummary = {
  total: number;
  new: number;
  unchanged: number;
  update: number;
  conflicts: number;
  errors: number;
};

export type ServerPreview = {
  depot: { name: string; code: string };
  summary: ServerSummary;
  rows: ServerPreviewRow[];
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

/** Read-only check of the WHOLE file against the database (one request). */
export function postProductImportPreview(rows: ImportLineInput[]): Promise<ServerPreview> {
  return post<ServerPreview>("/api/produits/import/preview", { rows }, "Vérification impossible");
}

/** The real write of ONE batch of lines. */
export function postProductImportBatch(rows: ImportLineInput[]): Promise<BatchResponse> {
  return post<BatchResponse>("/api/produits/import", { rows }, "Import du lot impossible");
}
