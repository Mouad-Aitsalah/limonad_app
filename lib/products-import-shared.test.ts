import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PRODUCT_IMPORT_BATCH_MAX_ROWS,
  PRODUCT_IMPORT_BATCH_SIZE,
  PRODUCT_IMPORT_MAX_ROWS,
  PRODUCT_IMPORT_PAGE_SIZE,
  buildPageWindow,
  chunkRows,
  clampPage,
  formatImportCount,
  importBatchLimitMessage,
  importRowLimitMessage,
  isImportableStatus,
  pageCount,
  paginateRows,
  processUntilBudget,
} from "@/lib/products-import-shared";

const numbers = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

// ---- limits and messages ---------------------------------------------------------------

test("limits: 15 000 lines per file, batches of 200 (hard cap 500 per request), pages of 200", () => {
  assert.equal(PRODUCT_IMPORT_MAX_ROWS, 15000);
  assert.equal(PRODUCT_IMPORT_BATCH_SIZE, 200);
  assert.equal(PRODUCT_IMPORT_BATCH_MAX_ROWS, 500);
  assert.equal(PRODUCT_IMPORT_PAGE_SIZE, 200);
});

test("the over-the-limit message states the real count and the maximum", () => {
  assert.equal(importRowLimitMessage(15001), "Le fichier contient 15 001 lignes. Le maximum autorisé est de 15 000 lignes.");
  assert.equal(importRowLimitMessage(20000), "Le fichier contient 20 000 lignes. Le maximum autorisé est de 15 000 lignes.");
  assert.equal(/Lignes import invalides/.test(importRowLimitMessage(15001)), false);
  assert.match(importBatchLimitMessage(501), /500 lignes.*501/);
  assert.equal(formatImportCount(7400), "7 400");
  assert.equal(formatImportCount(10000), "10 000");
});

// ---- batches ---------------------------------------------------------------------------

test("10 000 lines -> 50 batches of 200: 1-200, 201-400, ... 9 801-10 000", () => {
  const batches = chunkRows(numbers(10000), PRODUCT_IMPORT_BATCH_SIZE);
  assert.equal(batches.length, 50);
  assert.ok(batches.every((batch) => batch.length === 200));
  assert.deepEqual([batches[0][0], batches[0].at(-1)], [1, 200]);
  assert.deepEqual([batches[1][0], batches[1].at(-1)], [201, 400]);
  assert.deepEqual([batches[49][0], batches[49].at(-1)], [9801, 10000]);
});

test("8 000 importable lines -> 40 batches; a last short batch keeps the remainder; nothing is lost or repeated", () => {
  assert.equal(chunkRows(numbers(8000), 200).length, 40);
  const odd = chunkRows(numbers(8123), 200);
  assert.equal(odd.length, 41);
  assert.equal(odd.at(-1)?.length, 123);
  assert.deepEqual(odd.flat(), numbers(8123));
  assert.deepEqual(chunkRows([], 200), []);
  assert.throws(() => chunkRows([1], 0), RangeError);
});

test("only NEW and EXISTING_UPDATE lines are importable", () => {
  assert.equal(isImportableStatus("NEW"), true);
  assert.equal(isImportableStatus("EXISTING_UPDATE"), true);
  for (const status of ["EXISTING_UNCHANGED", "CONFLICT", "ERROR", undefined]) {
    assert.equal(isImportableStatus(status), false, String(status));
  }
});

// ---- pagination ------------------------------------------------------------------------

test("10 000 lines -> 50 pages of 200; the page is a window on the list, the list is untouched", () => {
  const all = numbers(10000);
  assert.equal(pageCount(all.length), 50);
  const first = paginateRows(all, 1);
  assert.deepEqual([first.page, first.pageCount, first.from, first.to, first.rows.length], [1, 50, 1, 200, 200]);
  const third = paginateRows(all, 3);
  assert.deepEqual([third.rows[0], third.rows.at(-1), third.from, third.to], [401, 600, 401, 600]);
  const last = paginateRows(all, 50);
  assert.deepEqual([last.rows[0], last.rows.at(-1), last.from, last.to], [9801, 10000, 9801, 10000]);
  assert.equal(all.length, 10000);
});

test("a page outside the list is clamped (a filter can shrink it); an empty list is one empty page", () => {
  assert.equal(clampPage(50, 300), 2);
  assert.equal(clampPage(0, 300), 1);
  assert.equal(clampPage(Number.NaN, 300), 1);
  const filtered = paginateRows(numbers(130), 7);
  assert.deepEqual([filtered.page, filtered.pageCount, filtered.from, filtered.to], [1, 1, 1, 130]);
  const empty = paginateRows([], 1);
  assert.deepEqual([empty.page, empty.pageCount, empty.from, empty.to, empty.rows.length], [1, 1, 0, 0, 0]);
});

test("pager buttons: 1 2 3 4 5 … 50 on the first pages, … in the middle, … 46 47 48 49 50 at the end", () => {
  assert.deepEqual(buildPageWindow(1, 50), [1, 2, 3, 4, 5, "gap", 50]);
  assert.deepEqual(buildPageWindow(3, 50), [1, 2, 3, 4, 5, "gap", 50]);
  assert.deepEqual(buildPageWindow(25, 50), [1, "gap", 24, 25, 26, "gap", 50]);
  assert.deepEqual(buildPageWindow(48, 50), [1, "gap", 46, 47, 48, 49, 50]);
  assert.deepEqual(buildPageWindow(50, 50), [1, "gap", 46, 47, 48, 49, 50]);
  assert.deepEqual(buildPageWindow(4, 50), [1, 2, 3, 4, 5, "gap", 50]);
  assert.deepEqual(buildPageWindow(1, 1), [1]);
  assert.deepEqual(buildPageWindow(2, 5), [1, 2, 3, 4, 5]);
  // two or more skipped pages become a gap...
  assert.deepEqual(buildPageWindow(5, 9), [1, "gap", 4, 5, 6, "gap", 9]);
  // ...but a single skipped page is shown, never replaced by a gap
  assert.deepEqual(buildPageWindow(4, 8), [1, 2, 3, 4, 5, "gap", 8]);
});

// ---- time budget -----------------------------------------------------------------------

test("processUntilBudget runs the items one after the other, never in parallel", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const { results, deferred } = await processUntilBudget(
    numbers(20),
    async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return item * 2;
    },
    { budgetMs: 60_000 },
  );
  assert.equal(maxInFlight, 1);
  assert.deepEqual(results, numbers(20).map((item) => item * 2));
  assert.deepEqual(deferred, []);
});

test("processUntilBudget: once the budget is spent it stops STARTING items and hands the rest back, in order", async () => {
  let clock = 0;
  const processed: number[] = [];
  const { results, deferred } = await processUntilBudget(
    numbers(10),
    async (item) => {
      processed.push(item);
      clock += 10; // each item takes 10 ms
      return item;
    },
    { budgetMs: 35, now: () => clock },
  );
  assert.deepEqual(processed, [1, 2, 3, 4]); // 40 ms >= 35 ms after the 4th
  assert.deepEqual(results, [1, 2, 3, 4]);
  assert.deepEqual(deferred, [5, 6, 7, 8, 9, 10]);
});

test("processUntilBudget always processes the first item, even with a spent budget (no endless re-sending)", async () => {
  const { results, deferred } = await processUntilBudget(numbers(3), async (item) => item, { budgetMs: 0 });
  assert.deepEqual(results, [1]);
  assert.deepEqual(deferred, [2, 3]);
});
