import assert from "node:assert/strict";
import { test } from "node:test";

import { runBatchedImport, type BatchResponse } from "@/lib/products-import-batches";
import { PRODUCT_IMPORT_BATCH_MAX_ROWS, countBatches, nextBatchLength, orderByGroup } from "@/lib/products-import-shared";

type Line = { excelRow: number; group: string | null };
const groupOf = (line: Line) => line.group;
const lines = (...spec: Array<[string | null, number]>): Line[] => {
  let row = 0;
  return spec.flatMap(([group, count]) => Array.from({ length: count }, (): Line => ({ excelRow: (row += 1), group })));
};

// ---- ordering and cutting --------------------------------------------------------------------------

test("orderByGroup gathers the lines of a group where its first line is; ordinary lines keep their place", () => {
  const scattered: Line[] = [
    { excelRow: 1, group: "A" },
    { excelRow: 2, group: null },
    { excelRow: 3, group: "B" },
    { excelRow: 4, group: "A" },
    { excelRow: 5, group: null },
    { excelRow: 6, group: "B" },
    { excelRow: 7, group: "A" },
  ];
  assert.deepEqual(orderByGroup(scattered, groupOf).map((line) => line.excelRow), [1, 4, 7, 2, 3, 6, 5]);
  assert.deepEqual(orderByGroup(scattered, () => null).map((line) => line.excelRow), [1, 2, 3, 4, 5, 6, 7]);
});

test("nextBatchLength: without groups it is the historical cut; with groups a batch ends only between two groups", () => {
  const ordinary = lines([null, 500]);
  assert.equal(nextBatchLength(ordinary, 200), 200);
  assert.equal(nextBatchLength(ordinary, 200, groupOf), 200, "ordinary lines are cut exactly at the size");
  assert.equal(nextBatchLength(lines([null, 30]), 200), 30);

  // 150 ordinary lines then a group of 120: the batch reaches the size inside the group and extends to its end
  const mixed = lines([null, 150], ["G", 120], [null, 50]);
  assert.equal(nextBatchLength(mixed, 200, groupOf), 270);
  // a group that would take the batch past the cap starts the next batch instead
  assert.equal(nextBatchLength(lines([null, 150], ["G", 120]), 200, groupOf, 200), 150);
  // a group alone that is bigger than the cap is still taken whole (the server refuses it, but it is never cut)
  assert.equal(nextBatchLength(lines(["G", 250]), 25, groupOf, 200), 250);
  // the batch size shrunk to the minimum cannot cut a group of 40 either
  assert.equal(nextBatchLength(lines(["G", 40], ["H", 40]), 25, groupOf), 40);
});

test("countBatches matches the batches really cut", () => {
  const queue = lines(["A", 70], ["B", 70], [null, 10], ["C", 200], ["D", 3]);
  let remaining = [...queue];
  let cut = 0;
  while (remaining.length) {
    remaining = remaining.slice(nextBatchLength(remaining, 200, groupOf));
    cut += 1;
  }
  assert.equal(countBatches(queue, 200, groupOf), cut);
  assert.equal(countBatches(lines([null, 450]), 200), 3);
});

// ---- the runner ---------------------------------------------------------------------------------------

/** A server that checks what the real one will: every request holds whole groups, at most 500 lines. */
function checkingServer(all: readonly Line[], options: { groupsPerBatch?: number } = {}) {
  const sizes = new Map<string, number>();
  for (const line of all) if (line.group) sizes.set(line.group, (sizes.get(line.group) ?? 0) + 1);
  const batches: Line[][] = [];
  const seen = new Set<number>();
  const send = async (batch: Line[]): Promise<BatchResponse> => {
    batches.push(batch);
    assert.ok(batch.length <= PRODUCT_IMPORT_BATCH_MAX_ROWS, `a batch of ${batch.length} lines exceeds the server's cap`);
    // every group in the request is COMPLETE (the server refuses an incomplete one)
    const inBatch = new Map<string, number>();
    for (const line of batch) if (line.group) inBatch.set(line.group, (inBatch.get(line.group) ?? 0) + 1);
    for (const [group, count] of inBatch) assert.equal(count, sizes.get(group), `group ${group} was cut: ${count} of ${sizes.get(group)} lines in one request`);
    // a slow server: after `groupsPerBatch` units it hands the rest back - WHOLE groups only
    const answered: Line[] = [];
    const deferred: Line[] = [];
    const unitsDone = new Set<string>();
    for (const line of batch) {
      const unit = line.group ?? `line-${line.excelRow}`;
      if (!unitsDone.has(unit) && options.groupsPerBatch !== undefined && unitsDone.size >= options.groupsPerBatch) deferred.push(line);
      else if (unitsDone.has(unit) || options.groupsPerBatch === undefined || unitsDone.size < options.groupsPerBatch) {
        unitsDone.add(unit);
        answered.push(line);
      }
    }
    // lines of a unit that has been deferred stay deferred
    const deferredUnits = new Set(deferred.map((line) => line.group ?? `line-${line.excelRow}`));
    const finalAnswered = answered.filter((line) => !deferredUnits.has(line.group ?? `line-${line.excelRow}`));
    const finalDeferred = batch.filter((line) => deferredUnits.has(line.group ?? `line-${line.excelRow}`));
    for (const line of finalAnswered) {
      assert.equal(seen.has(line.excelRow), false, `line ${line.excelRow} written twice`);
      seen.add(line.excelRow);
    }
    return {
      rows: finalAnswered.map((line) => ({ excelRow: line.excelRow, reference: `R${line.excelRow}`, name: "x", status: "CREATED" as const, message: "" })),
      deferred: finalDeferred.map((line) => line.excelRow),
    };
  };
  return { send, batches, seen };
}

test("a file of groups is sent group by group: no group is ever cut, at the default size and when batches shrink", async () => {
  // groups of very different sizes, their lines scattered through the file, and ordinary lines among them
  const sizes = [1, 2, 3, 40, 199, 200, 17, 64];
  const file: Line[] = [];
  let row = 0;
  const pending = sizes.map((size, index) => ({ group: `G${index}`, left: size }));
  while (pending.some((entry) => entry.left > 0)) {
    for (const entry of pending) {
      if (entry.left > 0) {
        entry.left -= 1;
        file.push({ excelRow: (row += 1), group: entry.group });
      }
    }
    file.push({ excelRow: (row += 1), group: null });
  }

  for (const [batchSize, groupsPerBatch] of [[200, undefined], [25, undefined], [200, 1], [200, 2], [50, 1]] as const) {
    const server = checkingServer(file, { groupsPerBatch });
    const result = await runBatchedImport({ rows: file, sendBatch: server.send, groupOf, batchSize });
    assert.equal(result.stopped, "completed", `size ${batchSize}, ${groupsPerBatch ?? "no"} deferral`);
    assert.equal(result.progress.created, file.length);
    assert.equal(server.seen.size, file.length, "every line was written exactly once");
    assert.deepEqual(result.failures, []);
  }
});

test("lines handed back by a slow server are re-sent as WHOLE groups, first, in smaller batches", async () => {
  const file = lines(["A", 60], ["B", 60], ["C", 60], [null, 20]);
  const server = checkingServer(file, { groupsPerBatch: 1 });
  const result = await runBatchedImport({ rows: file, sendBatch: server.send, groupOf, batchSize: 200 });
  assert.equal(result.progress.created, 200);
  assert.ok(server.batches.length >= 4, "one group (or one ordinary line) per answer");
  for (const batch of server.batches) {
    const groups = new Set(batch.filter((line) => line.group).map((line) => line.group));
    for (const group of groups) assert.equal(batch.filter((line) => line.group === group).length, 60);
  }
});

test("the reported number of batches follows the group-aware cut", async () => {
  const file = lines(["A", 150], ["B", 150], ["C", 150]);
  const server = checkingServer(file);
  const reported: number[] = [];
  const result = await runBatchedImport({ rows: file, sendBatch: server.send, groupOf, batchSize: 200, onProgress: (progress) => reported.push(progress.batchesTotal) });
  assert.equal(reported[0], 2, "300 lines then 150");
  assert.equal(result.progress.batchesDone, 2);
  assert.equal(result.progress.batchesTotal, 2);
});

test("without groupOf the runner is the historical one: exactly `batchSize` lines per request", async () => {
  const file = lines([null, 450]);
  const sizes: number[] = [];
  await runBatchedImport({
    rows: file,
    batchSize: 200,
    sendBatch: async (batch) => {
      sizes.push(batch.length);
      return { rows: batch.map((line) => ({ excelRow: line.excelRow, reference: "r", name: "x", status: "CREATED" as const, message: "" })) };
    },
  });
  assert.deepEqual(sizes, [200, 200, 50]);
});

test("lines of a group the server answered only in part (a bug, not a plan) are never silently counted as done", async () => {
  const file = lines(["A", 3]);
  const result = await runBatchedImport({
    rows: file,
    groupOf,
    sendBatch: async (batch) => ({ rows: batch.slice(0, 2).map((line) => ({ excelRow: line.excelRow, reference: "r", name: "x", status: "CREATED" as const, message: "" })) }),
  });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].message, /aucun résultat pour 1 ligne/);
  assert.equal(result.progress.failedRows, 1);
});
