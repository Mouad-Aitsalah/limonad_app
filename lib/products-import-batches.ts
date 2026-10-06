import {
  PRODUCT_IMPORT_BATCH_SIZE,
  PRODUCT_IMPORT_MAX_CONSECUTIVE_FAILURES,
  PRODUCT_IMPORT_MIN_BATCH_SIZE,
  chunkRows,
} from "@/lib/products-import-shared";

/**
 * The browser side of the real write: sends the importable lines (NEW /
 * EXISTING_UPDATE only) to POST /api/produits/import BATCH BY BATCH, strictly
 * one request at a time, and turns the answers into a progress and a final
 * report. No React, no fetch here (the caller injects `sendBatch`), so the
 * sequencing, the failures and the report are unit-tested without a browser.
 *
 * Safe to re-run: the server applies the existing import rules to every batch
 * (references, updates, stock as a target), so lines already imported come back
 * as "inchangé" instead of being created twice.
 */

export type BatchRowStatus = "CREATED" | "UPDATED" | "UNCHANGED" | "CONFLICT" | "ERROR";

export type BatchRowResult = {
  excelRow: number;
  reference: string;
  name: string;
  status: BatchRowStatus;
  message: string;
};

/** What POST /api/produits/import answers for one batch. */
export type BatchResponse = {
  rows: BatchRowResult[];
  /** Excel lines the server did not start (its time budget was spent). */
  deferred?: number[];
  categoriesCreated?: number;
  /** Suppliers created by this batch (a new ref_fournisseur, once). */
  suppliersCreated?: number;
  stockMovementsCreated?: number;
};

export type BatchFailure = {
  /** 1-based number of the batch, in sending order. */
  batch: number;
  rowCount: number;
  firstRow: number;
  lastRow: number;
  message: string;
};

export type ImportProgress = {
  /** Lines to import (NEW + UPDATE), the denominator of the bar. */
  total: number;
  /** Lines the server answered for. */
  processed: number;
  /** Lines of batches that failed (no answer). */
  failedRows: number;
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  errors: number;
  /** Batches sent so far / batches expected in all (re-estimated as it goes). */
  batchesDone: number;
  batchesTotal: number;
};

export type BatchedImportResult = {
  progress: ImportProgress;
  categoriesCreated: number;
  /** For the WHOLE file: the sum of the batches, each new supplier being created once. */
  suppliersCreated: number;
  stockMovementsCreated: number;
  failures: BatchFailure[];
  /** CONFLICT / ERROR lines the server reported, for the report. */
  problemRows: BatchRowResult[];
  /** Lines never sent because the import was stopped. */
  notSent: number;
  stopped: "completed" | "cancelled" | "too_many_failures";
};

export type RunBatchedImportOptions<T extends { excelRow: number }> = {
  rows: readonly T[];
  sendBatch: (rows: T[], info: { batch: number }) => Promise<BatchResponse>;
  onProgress?: (progress: ImportProgress) => void;
  /** Polled between batches; a batch already sent is never abandoned. */
  shouldStop?: () => boolean;
  batchSize?: number;
  maxConsecutiveFailures?: number;
};

export async function runBatchedImport<T extends { excelRow: number }>(
  options: RunBatchedImportOptions<T>,
): Promise<BatchedImportResult> {
  const maxFailures = options.maxConsecutiveFailures ?? PRODUCT_IMPORT_MAX_CONSECUTIVE_FAILURES;
  let batchSize = Math.max(1, options.batchSize ?? PRODUCT_IMPORT_BATCH_SIZE);
  const total = options.rows.length;

  // The rows still to send, in file order. Deferred rows go back to the front.
  const queue: T[] = [...options.rows];
  const progress: ImportProgress = {
    total,
    processed: 0,
    failedRows: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    conflicts: 0,
    errors: 0,
    batchesDone: 0,
    batchesTotal: chunkRows(queue, batchSize).length,
  };
  const failures: BatchFailure[] = [];
  const problemRows: BatchRowResult[] = [];
  let categoriesCreated = 0;
  let suppliersCreated = 0;
  let stockMovementsCreated = 0;
  let consecutiveFailures = 0;
  let stopped: BatchedImportResult["stopped"] = "completed";

  const report = () => options.onProgress?.({ ...progress });
  report();

  while (queue.length > 0) {
    if (options.shouldStop?.()) {
      stopped = "cancelled";
      break;
    }
    if (consecutiveFailures >= maxFailures) {
      stopped = "too_many_failures";
      break;
    }

    const batch = queue.splice(0, batchSize);
    const batchNumber = progress.batchesDone + 1;
    progress.batchesDone = batchNumber;

    const fail = (message: string, failedRows: T[]) => {
      failures.push({
        batch: batchNumber,
        rowCount: failedRows.length,
        firstRow: Math.min(...failedRows.map((row) => row.excelRow)),
        lastRow: Math.max(...failedRows.map((row) => row.excelRow)),
        message,
      });
      progress.failedRows += failedRows.length;
    };

    let response: BatchResponse;
    try {
      // One request at a time: the next batch only starts once this one answered.
      response = await options.sendBatch(batch, { batch: batchNumber });
    } catch (error) {
      fail(error instanceof Error && error.message ? error.message : "Le lot n'a pas pu être envoyé.", batch);
      consecutiveFailures += 1;
      progress.batchesTotal = progress.batchesDone + chunkRows(queue, batchSize).length;
      report();
      continue;
    }

    const deferred = new Set(response.deferred ?? []);
    const answered = new Set<number>();
    for (const row of response.rows) {
      answered.add(row.excelRow);
      progress.processed += 1;
      if (row.status === "CREATED") progress.created += 1;
      else if (row.status === "UPDATED") progress.updated += 1;
      else if (row.status === "UNCHANGED") progress.unchanged += 1;
      else if (row.status === "CONFLICT") progress.conflicts += 1;
      else progress.errors += 1;
      if (row.status === "CONFLICT" || row.status === "ERROR") problemRows.push(row);
    }
    categoriesCreated += response.categoriesCreated ?? 0;
    suppliersCreated += response.suppliersCreated ?? 0;
    stockMovementsCreated += response.stockMovementsCreated ?? 0;

    // Lines the server handed back (time budget): send them again, first, and
    // shrink the next batches so they fit the budget.
    const handedBack = batch.filter((row) => deferred.has(row.excelRow) && !answered.has(row.excelRow));
    // Lines with neither an answer nor a deferral: never count them as done.
    const missing = batch.filter((row) => !answered.has(row.excelRow) && !deferred.has(row.excelRow));

    if (answered.size === 0 && handedBack.length > 0) {
      // A server that answers nothing and defers everything would loop forever.
      fail("Le serveur n'a traité aucune ligne de ce lot.", batch);
      consecutiveFailures += 1;
    } else if (missing.length > 0) {
      fail(`Le serveur n'a renvoyé aucun résultat pour ${missing.length} ligne(s) de ce lot.`, missing);
      consecutiveFailures += 1;
    } else {
      consecutiveFailures = 0;
    }

    if (handedBack.length > 0 && answered.size > 0) {
      queue.unshift(...handedBack);
      batchSize = Math.max(PRODUCT_IMPORT_MIN_BATCH_SIZE, Math.min(batchSize, answered.size));
    }

    progress.batchesTotal = progress.batchesDone + chunkRows(queue, batchSize).length;
    report();
  }

  return {
    progress: { ...progress },
    categoriesCreated,
    suppliersCreated,
    stockMovementsCreated,
    failures,
    problemRows,
    notSent: queue.length,
    stopped,
  };
}

// --- final report ----------------------------------------------------------------

/** The counters of the preview that were NOT sent to the write (not importable). */
export type PreviewLeftovers = { unchanged: number; conflicts: number; errors: number };

export type ImportReportView = {
  title: "Import terminé" | "Import terminé avec erreurs" | "Import interrompu";
  /** true when anything went wrong or was left out: never shown as a clean run. */
  withProblems: boolean;
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  errors: number;
  failures: BatchFailure[];
  notProcessedRows: number;
  categoriesCreated: number;
  suppliersCreated: number;
  stockMovementsCreated: number;
};

/**
 * "Import terminé" only for a clean run. Lines that were never imported (preview
 * errors / conflicts, row errors, failed batches, an interrupted run) make it
 * "Import terminé avec erreurs" - or "Import interrompu" when it was stopped.
 */
export function buildImportReport(result: BatchedImportResult, leftovers: PreviewLeftovers): ImportReportView {
  const { progress } = result;
  const created = progress.created;
  const updated = progress.updated;
  const unchanged = leftovers.unchanged + progress.unchanged;
  const conflicts = leftovers.conflicts + progress.conflicts;
  const errors = leftovers.errors + progress.errors;
  const notProcessedRows = progress.failedRows + result.notSent;
  const withProblems = result.failures.length > 0 || notProcessedRows > 0 || errors > 0 || conflicts > 0;

  return {
    title: result.stopped !== "completed" ? "Import interrompu" : withProblems ? "Import terminé avec erreurs" : "Import terminé",
    withProblems,
    created,
    updated,
    unchanged,
    conflicts,
    errors,
    failures: result.failures,
    notProcessedRows,
    categoriesCreated: result.categoriesCreated,
    suppliersCreated: result.suppliersCreated,
    stockMovementsCreated: result.stockMovementsCreated,
  };
}

/** Progress as shown in the bar: lines answered or failed, over the lines to import. */
export function progressPercent(progress: Pick<ImportProgress, "total" | "processed" | "failedRows">): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.round(((progress.processed + progress.failedRows) / progress.total) * 100));
}
