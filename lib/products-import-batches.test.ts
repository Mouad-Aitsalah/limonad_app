import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildImportReport,
  progressPercent,
  runBatchedImport,
  type BatchResponse,
  type BatchRowResult,
  type ImportProgress,
} from "@/lib/products-import-batches";

type Line = { excelRow: number; reference: string; name: string };
const lines = (count: number): Line[] =>
  Array.from({ length: count }, (_, index) => ({ excelRow: index + 2, reference: `PRD-${index + 1}`, name: `Produit ${index + 1}` }));

const result = (line: Line, status: BatchRowResult["status"] = "CREATED", message = "ok"): BatchRowResult => ({
  excelRow: line.excelRow,
  reference: line.reference,
  name: line.name,
  status,
  message,
});
const answerAll = (batch: Line[], status: BatchRowResult["status"] = "CREATED"): BatchResponse => ({ rows: batch.map((line) => result(line, status)) });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---- batches, sequencing, progress -----------------------------------------------------

test("1 000 lines -> 5 batches of 200, sent one at a time: the next only starts once the previous answered", async () => {
  const events: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const outcome = await runBatchedImport({
    rows: lines(1000),
    sendBatch: async (batch, { batch: number }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      events.push(`start ${number} (${batch.length})`);
      await tick();
      events.push(`end ${number}`);
      inFlight -= 1;
      return answerAll(batch);
    },
  });
  assert.equal(maxInFlight, 1);
  assert.deepEqual(events, [
    "start 1 (200)", "end 1", "start 2 (200)", "end 2", "start 3 (200)", "end 3", "start 4 (200)", "end 4", "start 5 (200)", "end 5",
  ]);
  assert.equal(outcome.progress.created, 1000);
  assert.equal(outcome.progress.batchesDone, 5);
  assert.equal(outcome.stopped, "completed");
});

test("the batches are consecutive slices of the file: 1-200, 201-400, ... and a short last one", async () => {
  const seen: Array<[number, number, number]> = [];
  await runBatchedImport({
    rows: lines(450),
    sendBatch: async (batch) => {
      seen.push([batch[0].excelRow, batch.at(-1)!.excelRow, batch.length]);
      return answerAll(batch);
    },
  });
  assert.deepEqual(seen, [[2, 201, 200], [202, 401, 200], [402, 451, 50]]);
});

test("progress is counted on the lines to import: 0 / 8 000, 200 / 8 000, 400 / 8 000 ... 8 000 / 8 000", async () => {
  const snapshots: ImportProgress[] = [];
  await runBatchedImport({
    rows: lines(8000),
    onProgress: (progress) => snapshots.push(progress),
    sendBatch: async (batch) => answerAll(batch),
  });
  assert.equal(snapshots.length, 41); // the start + one per batch
  assert.deepEqual(snapshots.slice(0, 3).map((p) => [p.processed, p.total]), [[0, 8000], [200, 8000], [400, 8000]]);
  assert.deepEqual([snapshots.at(-1)!.processed, snapshots.at(-1)!.total, snapshots.at(-1)!.batchesDone, snapshots.at(-1)!.batchesTotal], [8000, 8000, 40, 40]);
  assert.equal(progressPercent(snapshots[0]), 0);
  assert.equal(progressPercent(snapshots.at(-1)!), 100);
  // 7 400 / 10 000 -> 74 %
  assert.equal(progressPercent({ total: 10000, processed: 7400, failedRows: 0 }), 74);
  assert.equal(progressPercent({ total: 0, processed: 0, failedRows: 0 }), 0);
});

test("the counters follow the server's answers: created / updated / unchanged / conflicts / errors", async () => {
  const outcome = await runBatchedImport({
    rows: lines(5),
    sendBatch: async (batch) => ({
      rows: [
        result(batch[0], "CREATED"),
        result(batch[1], "UPDATED"),
        result(batch[2], "UNCHANGED"),
        result(batch[3], "CONFLICT", "Conflit d'unicité sur cette ligne."),
        result(batch[4], "ERROR", "Import impossible pour cette ligne."),
      ],
      categoriesCreated: 2,
      stockMovementsCreated: 3,
    }),
  });
  const p = outcome.progress;
  assert.deepEqual([p.created, p.updated, p.unchanged, p.conflicts, p.errors, p.processed], [1, 1, 1, 1, 1, 5]);
  assert.deepEqual([outcome.categoriesCreated, outcome.stockMovementsCreated], [2, 3]);
  assert.deepEqual(outcome.problemRows.map((row) => row.status), ["CONFLICT", "ERROR"]);
});

test("suppliers created: one global count for the whole file - the sum of the batches, never repeated per line", async () => {
  // 3 batches of 200: the server created ACYL and BETA in the first one, GAMMA in the third
  const createdPerBatch = [2, 0, 1];
  const outcome = await runBatchedImport({
    rows: lines(600),
    sendBatch: async (batch, { batch: number }) => ({ ...answerAll(batch), suppliersCreated: createdPerBatch[number - 1] }),
  });
  assert.equal(outcome.suppliersCreated, 3);
  const report = buildImportReport(outcome, { unchanged: 0, conflicts: 0, errors: 0 });
  assert.equal(report.suppliersCreated, 3);
  // an older server answer without the field counts as 0, never as NaN
  const legacy = await runBatchedImport({ rows: lines(5), sendBatch: async (batch) => answerAll(batch) });
  assert.equal(legacy.suppliersCreated, 0);
});

test("nothing to import: no request at all", async () => {
  let calls = 0;
  const outcome = await runBatchedImport({ rows: [] as Line[], sendBatch: async () => { calls += 1; return { rows: [] }; } });
  assert.equal(calls, 0);
  assert.deepEqual([outcome.progress.total, outcome.stopped], [0, "completed"]);
});

// ---- a failing batch -------------------------------------------------------------------

test("a failed batch is recorded (batch number, Excel lines) and the next batches still run", async () => {
  const outcome = await runBatchedImport({
    rows: lines(800),
    sendBatch: async (batch, { batch: number }) => {
      if (number === 2) throw new Error("Import du lot impossible : le serveur n'a pas répondu correctement (HTTP 504).");
      return answerAll(batch);
    },
  });
  assert.equal(outcome.stopped, "completed");
  assert.equal(outcome.progress.batchesDone, 4);
  assert.deepEqual([outcome.progress.processed, outcome.progress.failedRows, outcome.progress.created], [600, 200, 600]);
  assert.deepEqual(outcome.failures, [
    { batch: 2, rowCount: 200, firstRow: 202, lastRow: 401, message: "Import du lot impossible : le serveur n'a pas répondu correctement (HTTP 504)." },
  ]);
  // the bar still reaches 100 %: the failed lines were attempted
  assert.equal(progressPercent(outcome.progress), 100);

  const report = buildImportReport(outcome, { unchanged: 0, conflicts: 0, errors: 0 });
  assert.equal(report.title, "Import terminé avec erreurs");
  assert.equal(report.notProcessedRows, 200);
  assert.equal(report.failures.length, 1);
});

test("three failed batches in a row stop the import: the rest is not sent, and the report says so", async () => {
  const sentNumbers: number[] = [];
  const outcome = await runBatchedImport({
    rows: lines(2000),
    sendBatch: async (batch, { batch: number }) => {
      sentNumbers.push(number);
      if (number >= 2 && number <= 4) throw new Error("Connexion au serveur impossible.");
      return answerAll(batch);
    },
  });
  assert.deepEqual(sentNumbers, [1, 2, 3, 4]);
  assert.equal(outcome.stopped, "too_many_failures");
  assert.equal(outcome.failures.length, 3);
  assert.equal(outcome.notSent, 1200);
  const report = buildImportReport(outcome, { unchanged: 0, conflicts: 0, errors: 0 });
  assert.equal(report.title, "Import interrompu");
  assert.equal(report.notProcessedRows, 600 + 1200);
});

test("a success between two failures resets the streak (isolated failures never stop the import)", async () => {
  const outcome = await runBatchedImport({
    rows: lines(1800),
    sendBatch: async (batch, { batch: number }) => {
      if (number % 2 === 0) throw new Error("boom");
      return answerAll(batch);
    },
  });
  assert.equal(outcome.stopped, "completed");
  assert.equal(outcome.failures.length, 4); // batches 2, 4, 6, 8
  assert.equal(outcome.progress.created, 1000); // batches 1, 3, 5, 7, 9
});

test("a server that answers nothing for some lines of a batch does not make them 'done'", async () => {
  const outcome = await runBatchedImport({
    rows: lines(10),
    sendBatch: async (batch) => answerAll(batch.slice(0, 7)),
  });
  assert.equal(outcome.progress.processed, 7);
  assert.equal(outcome.progress.failedRows, 3);
  assert.equal(outcome.failures[0].rowCount, 3);
  assert.match(outcome.failures[0].message, /aucun résultat pour 3 ligne/);
});

// ---- the server hands lines back (time budget) -----------------------------------------

test("lines handed back by the server (time budget) are sent again, first, in smaller batches - nothing is lost", async () => {
  const sizes: number[] = [];
  const processed = new Set<number>();
  const outcome = await runBatchedImport({
    rows: lines(600),
    sendBatch: async (batch) => {
      sizes.push(batch.length);
      // the server only has time for 50 lines per request
      const done = batch.slice(0, 50);
      done.forEach((line) => processed.add(line.excelRow));
      return { rows: done.map((line) => result(line)), deferred: batch.slice(50).map((line) => line.excelRow) };
    },
  });
  assert.equal(outcome.progress.processed, 600);
  assert.equal(processed.size, 600);
  assert.equal(outcome.failures.length, 0);
  assert.equal(sizes[0], 200);
  assert.ok(sizes.slice(1).every((size) => size <= 50), `batches shrank: ${sizes.slice(0, 5).join(",")}`);
  assert.equal(outcome.notSent, 0);
});

test("a server that defers everything and answers nothing cannot make the browser loop forever", async () => {
  let calls = 0;
  const outcome = await runBatchedImport({
    rows: lines(800),
    sendBatch: async (batch) => {
      calls += 1;
      return { rows: [], deferred: batch.map((line) => line.excelRow) };
    },
  });
  assert.equal(calls, 3, "stops after three useless answers");
  assert.equal(outcome.stopped, "too_many_failures");
  assert.equal(outcome.notSent, 200);
  assert.match(outcome.failures[0].message, /n'a traité aucune ligne/);
});

// ---- stopping and the final report -----------------------------------------------------

test("stopping lets the batch in flight finish, sends no further one, and reports 'Import interrompu'", async () => {
  let stop = false;
  const outcome = await runBatchedImport({
    rows: lines(1000),
    shouldStop: () => stop,
    sendBatch: async (batch, { batch: number }) => {
      if (number === 2) stop = true; // the user clicks "Arrêter" while batch 2 is in flight
      return answerAll(batch);
    },
  });
  assert.equal(outcome.stopped, "cancelled");
  assert.equal(outcome.progress.processed, 400);
  assert.equal(outcome.notSent, 600);
  assert.equal(buildImportReport(outcome, { unchanged: 0, conflicts: 0, errors: 0 }).title, "Import interrompu");
});

test("'Import terminé' only for a clean run; any error or conflict (even set aside by the preview) is 'avec erreurs'", async () => {
  const clean = await runBatchedImport({ rows: lines(300), sendBatch: async (batch) => answerAll(batch) });
  const cleanReport = buildImportReport(clean, { unchanged: 120, conflicts: 0, errors: 0 });
  assert.deepEqual([cleanReport.title, cleanReport.withProblems, cleanReport.created, cleanReport.unchanged], ["Import terminé", false, 300, 120]);

  assert.equal(buildImportReport(clean, { unchanged: 0, conflicts: 1, errors: 0 }).title, "Import terminé avec erreurs");
  assert.equal(buildImportReport(clean, { unchanged: 0, conflicts: 0, errors: 1 }).title, "Import terminé avec erreurs");

  const rowError = await runBatchedImport({
    rows: lines(3),
    sendBatch: async (batch) => ({ rows: [result(batch[0]), result(batch[1]), result(batch[2], "ERROR", "Import impossible pour cette ligne.")] }),
  });
  const report = buildImportReport(rowError, { unchanged: 0, conflicts: 0, errors: 4 });
  assert.deepEqual([report.title, report.created, report.errors], ["Import terminé avec erreurs", 2, 5]);
});
