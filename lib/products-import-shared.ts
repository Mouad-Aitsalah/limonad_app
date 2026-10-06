/**
 * Isomorphic building blocks of the products Excel import (feuille "produits"):
 * the limits shared by the browser and the server, the batching of the real
 * write, the preview pagination and the user-facing messages. No "server-only",
 * no Prisma: the browser imports it too, and so do the tests.
 *
 * The business rules of the import (supplier, category, reference, prices,
 * VAT, stock target, update / conflict detection) are NOT here - they stay in
 * lib/server/products-import.ts and are unchanged.
 */

/** A file with more data lines than this is refused (message below). */
export const PRODUCT_IMPORT_MAX_ROWS = 15000;

/** Lines the browser sends per request of the real write. */
export const PRODUCT_IMPORT_BATCH_SIZE = 200;

/** Hard cap of one write request: a client can never push a whole file through
 * one request (maxDuration is 60 s). The browser sends PRODUCT_IMPORT_BATCH_SIZE. */
export const PRODUCT_IMPORT_BATCH_MAX_ROWS = 500;

/** Smallest batch the browser shrinks to when the server could not finish one
 * within its time budget. */
export const PRODUCT_IMPORT_MIN_BATCH_SIZE = 25;

/** The server stops starting new lines after this long and hands the rest back
 * (maxDuration is 60 s; this leaves room for the response and a slow last line). */
export const PRODUCT_IMPORT_BATCH_TIME_BUDGET_MS = 40_000;

/** After this many failed batches in a row the browser stops sending more. */
export const PRODUCT_IMPORT_MAX_CONSECUTIVE_FAILURES = 3;

/** Lines per page of the preview table (display only). */
export const PRODUCT_IMPORT_PAGE_SIZE = 200;

const NUMBER_FORMAT = new Intl.NumberFormat("fr-FR");

/** 7400 -> "7 400" (a normal space, so it never breaks a test or a copy-paste). */
export function formatImportCount(value: number): string {
  return NUMBER_FORMAT.format(value).replace(/[  ]/g, " ");
}

export function importRowLimitMessage(rowCount: number): string {
  return `Le fichier contient ${formatImportCount(rowCount)} lignes. Le maximum autorisé est de ${formatImportCount(PRODUCT_IMPORT_MAX_ROWS)} lignes.`;
}

export function importBatchLimitMessage(rowCount: number): string {
  return `Un lot d'import ne peut pas dépasser ${formatImportCount(PRODUCT_IMPORT_BATCH_MAX_ROWS)} lignes (reçu : ${formatImportCount(rowCount)}).`;
}

/**
 * Only NEW and EXISTING_UPDATE lines are ever sent to the real write: unchanged
 * lines, conflicts and errors have nothing to write (the server re-checks anyway).
 */
export function isImportableStatus(status: string | undefined): boolean {
  return status === "NEW" || status === "EXISTING_UPDATE";
}

/** Splits `items` into consecutive batches of at most `size` (last one shorter). */
export function chunkRows<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("chunk size must be a positive integer");
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/**
 * Runs `handler` on the items ONE AFTER THE OTHER (never in parallel). Once the
 * time budget is spent it stops starting new items and hands the rest back as
 * `deferred`, so a request can end cleanly before the platform kills it. The
 * first item is always processed, so every call makes progress and a caller that
 * re-submits the deferred items cannot loop forever.
 */
export async function processUntilBudget<T, R>(
  items: readonly T[],
  handler: (item: T) => Promise<R>,
  options: { budgetMs: number; now?: () => number },
): Promise<{ results: R[]; deferred: T[] }> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const results: R[] = [];
  const deferred: T[] = [];
  for (const item of items) {
    if (results.length > 0 && now() - startedAt >= options.budgetMs) {
      deferred.push(item);
      continue;
    }
    results.push(await handler(item));
  }
  return { results, deferred };
}

// --- preview pagination ----------------------------------------------------------

export function pageCount(totalRows: number, pageSize: number = PRODUCT_IMPORT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

/** Keeps a page number inside [1, pageCount] (a filter can shrink the list). */
export function clampPage(page: number, totalRows: number, pageSize: number = PRODUCT_IMPORT_PAGE_SIZE): number {
  return Math.min(Math.max(1, Math.trunc(page) || 1), pageCount(totalRows, pageSize));
}

export function paginateRows<T>(
  items: readonly T[],
  page: number,
  pageSize: number = PRODUCT_IMPORT_PAGE_SIZE,
): { rows: T[]; page: number; pageCount: number; from: number; to: number } {
  const current = clampPage(page, items.length, pageSize);
  const start = (current - 1) * pageSize;
  const rows = items.slice(start, start + pageSize);
  return {
    rows,
    page: current,
    pageCount: pageCount(items.length, pageSize),
    from: items.length === 0 ? 0 : start + 1,
    to: start + rows.length,
  };
}

export type PageButton = number | "gap";

/**
 * The numbered buttons of the pager: always the first and the last page, the
 * current one and its neighbours, and "gap" where pages are skipped:
 * 1 2 3 4 5 ... 50   |   1 ... 24 25 26 ... 50   |   1 ... 46 47 48 49 50
 */
export function buildPageWindow(current: number, total: number, siblings = 1): PageButton[] {
  if (total <= 1) return [1];
  const pages = new Set<number>([1, total]);
  for (let page = current - siblings; page <= current + siblings; page += 1) {
    if (page >= 1 && page <= total) pages.add(page);
  }
  // Near an edge the pager keeps a stable width: 1 2 3 4 5 ... 50 / 1 ... 46 47 48 49 50.
  const edge = siblings * 2 + 3;
  if (current <= edge - 2) for (let page = 1; page <= Math.min(edge, total); page += 1) pages.add(page);
  if (current >= total - (edge - 3)) for (let page = Math.max(1, total - edge + 1); page <= total; page += 1) pages.add(page);

  const sorted = [...pages].sort((a, b) => a - b);
  const buttons: PageButton[] = [];
  sorted.forEach((page, index) => {
    if (index > 0) {
      const gap = page - sorted[index - 1];
      if (gap === 2) buttons.push(page - 1); // one skipped page: show it rather than a gap
      else if (gap > 2) buttons.push("gap");
    }
    buttons.push(page);
  });
  return buttons;
}