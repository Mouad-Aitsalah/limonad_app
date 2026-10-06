import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { formatMovementNumber, movementNumbersOfBlock } from "@/lib/stock-movement-number";

const ROOT = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// ---- an in-memory model of the DocumentSequence counter ----------------------------------------------------
//
// The real reservation is ONE SQL upsert (row lock): read + increment + return are a single indivisible step.
// The fake mirrors exactly that arithmetic (counter += size, first = counter - size + 1) and yields to the event
// loop BEFORE the step, so concurrent callers genuinely interleave. It is a model of the SQL, not PostgreSQL.

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

class FakeSequences {
  private readonly counters = new Map<string, number>();
  /** The movements already written, per organisation (the unique constraint (organizationId, movementNumber)). */
  readonly movements = new Map<string, string[]>();

  seed(organizationId: string, counter: number, existingMovements = counter) {
    this.counters.set(organizationId, counter);
    this.movements.set(
      organizationId,
      Array.from({ length: existingMovements }, (_, index) => formatMovementNumber(index + 1)),
    );
  }

  counter(organizationId: string) {
    return this.counters.get(organizationId) ?? 0;
  }

  /** reserveDocumentSequenceBlock: returns the FIRST number of the block. */
  async reserveBlock(organizationId: string, size: number): Promise<number> {
    await tick();
    const current = this.counters.get(organizationId) ?? 0;
    this.counters.set(organizationId, current + size);
    return current + 1;
  }

  /** nextMovementNumbers: the block as MV- numbers (same composition as lib/server/sales-shared.ts). */
  async nextMovementNumbers(organizationId: string, count: number): Promise<string[]> {
    if (count === 0) return [];
    return movementNumbersOfBlock(await this.reserveBlock(organizationId, count), count);
  }

  /** nextMovementNumber: reserveDocumentSequence = a block of 1. */
  async nextMovementNumber(organizationId: string): Promise<string> {
    return formatMovementNumber(await this.reserveBlock(organizationId, 1));
  }

  /** The insert with the unique constraint: throws like P2002 on a duplicate. */
  insert(organizationId: string, movementNumber: string) {
    const list = this.movements.get(organizationId) ?? [];
    if (list.includes(movementNumber)) throw new Error(`P2002 unique (${organizationId}, ${movementNumber})`);
    list.push(movementNumber);
    this.movements.set(organizationId, list);
  }
}

// ---- the bug, reproduced with the REPLICA of the former formula -------------------------------------------

/** The former finalizeInventory numbering: `MV-${count + 1 + index}`, the counter untouched. */
function legacyInventoryNumbers(existingMovementCount: number, lines: number): string[] {
  return Array.from({ length: lines }, (_, index) => formatMovementNumber(existingMovementCount + 1 + index));
}

test("BEFORE (the bug): counter 10, 10 movements, the inventory writes MV-000011 but the counter stays at 10 -> the next sale collides", async () => {
  const world = new FakeSequences();
  world.seed("o1", 10);

  const inventoryNumbers = legacyInventoryNumbers(world.movements.get("o1")!.length, 1);
  assert.deepEqual(inventoryNumbers, ["MV-000011"]);
  for (const number of inventoryNumbers) world.insert("o1", number);
  assert.equal(world.counter("o1"), 10, "BUG: the counter was not advanced by the inventory");

  // the next sale reserves counter + 1 = 11 = the inventory's number
  const saleNumber = await world.nextMovementNumber("o1");
  assert.equal(saleNumber, "MV-000011");
  assert.throws(() => world.insert("o1", saleNumber), /P2002/);
});

test("AFTER: counter 10, 10 movements, an inventory of 2 -> MV-000011 and MV-000012, counter 12, then a sale gets MV-000013", async () => {
  const world = new FakeSequences();
  world.seed("o1", 10);

  const inventoryNumbers = await world.nextMovementNumbers("o1", 2);
  assert.deepEqual(inventoryNumbers, ["MV-000011", "MV-000012"]);
  for (const number of inventoryNumbers) world.insert("o1", number);
  assert.equal(world.counter("o1"), 12, "the counter advanced atomically by N");

  const saleNumber = await world.nextMovementNumber("o1");
  assert.equal(saleNumber, "MV-000013");
  assert.doesNotThrow(() => world.insert("o1", saleNumber));
  assert.equal(world.counter("o1"), 13);
});

// ---- sizes and organisations ------------------------------------------------------------------------------

test("a new organisation with zero movement: the first inventory starts at MV-000001", async () => {
  const world = new FakeSequences();
  assert.deepEqual(await world.nextMovementNumbers("fresh", 3), ["MV-000001", "MV-000002", "MV-000003"]);
  assert.equal(world.counter("fresh"), 3);
  assert.equal(await world.nextMovementNumber("fresh"), "MV-000004");
});

test("an organisation with many movements: the block follows the counter", async () => {
  const world = new FakeSequences();
  world.seed("big", 25_000, 0);
  assert.deepEqual(await world.nextMovementNumbers("big", 3), ["MV-025001", "MV-025002", "MV-025003"]);
  world.seed("huge", 999_998, 0);
  assert.deepEqual(await world.nextMovementNumbers("huge", 3), ["MV-999999", "MV-1000000", "MV-1000001"]);
});

test("an inventory of 1 movement and an inventory with no adjusted line", async () => {
  const world = new FakeSequences();
  world.seed("o1", 169);
  assert.deepEqual(await world.nextMovementNumbers("o1", 1), ["MV-000170"]);
  assert.equal(world.counter("o1"), 170);
  assert.deepEqual(await world.nextMovementNumbers("o1", 0), [], "nothing to number: nothing reserved");
  assert.equal(world.counter("o1"), 170);
  assert.equal(await world.nextMovementNumber("o1"), "MV-000171", "the production case: the sale after the inventory");
});

test("the numbers of a block are consecutive, distinct and in the standard format", () => {
  const block = movementNumbersOfBlock(171, 5);
  assert.deepEqual(block, ["MV-000171", "MV-000172", "MV-000173", "MV-000174", "MV-000175"]);
  assert.equal(new Set(block).size, 5);
  assert.deepEqual(movementNumbersOfBlock(1, 0), []);
  assert.throws(() => movementNumbersOfBlock(0, 2));
  assert.throws(() => movementNumbersOfBlock(1, -1));
  assert.throws(() => movementNumbersOfBlock(1.5, 1));
  assert.equal(formatMovementNumber(109), "MV-000109", "same format as before the change");
});

// ---- concurrency (a model of the atomic upsert, not PostgreSQL) ---------------------------------------------

test("concurrent inventories and sales on one organisation never take the same number", async () => {
  const world = new FakeSequences();
  world.seed("o1", 10);
  const written: string[] = [];

  const inventory = async (lines: number) => {
    await tick();
    const numbers = await world.nextMovementNumbers("o1", lines);
    await tick();
    for (const number of numbers) {
      world.insert("o1", number); // throws on a duplicate -> the test fails
      written.push(number);
    }
  };
  const sale = async () => {
    await tick();
    const number = await world.nextMovementNumber("o1");
    await tick();
    world.insert("o1", number);
    written.push(number);
  };

  const jobs: Array<Promise<void>> = [];
  const inventorySizes = [1, 2, 5, 3, 4, 1, 6, 2];
  for (let i = 0; i < 30; i += 1) {
    jobs.push(sale());
    if (i % 4 === 0 && inventorySizes.length > 0) jobs.push(inventory(inventorySizes.shift()!));
  }
  while (inventorySizes.length > 0) jobs.push(inventory(inventorySizes.shift()!));
  await Promise.all(jobs);

  assert.equal(new Set(written).size, written.length, "no duplicate");
  const expectedTotal = 30 + [1, 2, 5, 3, 4, 1, 6, 2].reduce((a, b) => a + b, 0);
  assert.equal(written.length, expectedTotal);
  assert.equal(world.counter("o1"), 10 + expectedTotal, "the counter advanced by exactly what was issued");
  // the numbers form one contiguous run right after the 10 existing ones
  const numeric = written.map((n) => Number(n.slice(3))).sort((a, b) => a - b);
  assert.equal(numeric[0], 11);
  assert.equal(numeric[numeric.length - 1], 10 + expectedTotal);
  numeric.forEach((value, index) => assert.equal(value, 11 + index));
});

test("two concurrent inventories get disjoint blocks", async () => {
  const world = new FakeSequences();
  world.seed("o1", 100);
  const [a, b] = await Promise.all([world.nextMovementNumbers("o1", 4), world.nextMovementNumbers("o1", 3)]);
  assert.equal(new Set([...a, ...b]).size, 7);
  assert.equal(world.counter("o1"), 107);
  for (const block of [a, b]) {
    const values = block.map((n) => Number(n.slice(3)));
    values.forEach((value, index) => index > 0 && assert.equal(value, values[index - 1] + 1, "a block is consecutive"));
  }
});

test("several organisations at the same time keep independent counters", async () => {
  const world = new FakeSequences();
  world.seed("a", 169);
  world.seed("b", 10);
  const [a1, b1, a2, b2] = await Promise.all([
    world.nextMovementNumbers("a", 2),
    world.nextMovementNumbers("b", 2),
    world.nextMovementNumber("a"),
    world.nextMovementNumber("b"),
  ]);
  assert.equal(world.counter("a"), 172);
  assert.equal(world.counter("b"), 13);
  assert.equal(new Set([...a1, a2]).size, 3);
  assert.equal(new Set([...b1, b2]).size, 3);
  assert.ok([...a1, a2].every((n) => Number(n.slice(3)) > 169 && Number(n.slice(3)) <= 172));
  assert.ok([...b1, b2].every((n) => Number(n.slice(3)) > 10 && Number(n.slice(3)) <= 13));
});

// ---- the real code is pinned to this behaviour -------------------------------------------------------------

test("finalizeInventory reserves its block on the shared counter, inside its own Serializable transaction", () => {
  const source = read("./server/inventories.ts");
  const finalize = source.slice(source.indexOf("export async function finalizeInventory"));
  assert.equal(/stockMovement\.count/.test(finalize), false, "count() is gone");
  assert.equal(/baseMovementCount/.test(source), false);
  assert.equal(/MV-\$\{/.test(source), false, "no hand-built MV- number");
  assert.match(finalize, /await nextMovementNumbers\(\s*tx,\s*user\.organizationId,\s*deltaLines\.length,?\s*\)/);
  assert.match(finalize, /movementNumber: movementNumbers\[index\]/);
  // it is the transaction client of the Serializable transaction, never the global client
  assert.match(finalize, /prisma\.\$transaction\(\s*async \(tx\) => \{/);
  assert.match(finalize, /\{ isolationLevel: "Serializable", timeout: 120000 \}/);
  assert.match(finalize, /if \(delta === 0\) continue;/, "a count equal to the live stock still produces no movement");
  // untouched: the inventory number
  assert.match(source, /reserveDocumentSequence\(tx, organizationId, DocumentType\.Inventory\)/);
  // untouched: the single createMany of the movements and the quantities
  assert.match(finalize, /tx\.stockMovement\.createMany\(\{ data: movements \}\)/);
  assert.match(finalize, /quantity: Math\.abs\(line\.delta\)/);
});

test("the sales keep nextMovementNumber on the same counter; the block uses the same documentType and scope", () => {
  const shared = read("./server/sales-shared.ts");
  const single = shared.slice(shared.indexOf("export async function nextMovementNumber("), shared.indexOf("export async function nextMovementNumbers("));
  assert.match(single, /reserveDocumentSequence\(\s*tx,\s*scopedOrganizationId,\s*DocumentType\.StockMovement,?\s*\)/);
  assert.match(single, /return formatMovementNumber\(number\);/);
  const block = shared.slice(shared.indexOf("export async function nextMovementNumbers("));
  assert.match(block, /if \(count === 0\) return \[\];/);
  assert.match(block, /reserveDocumentSequenceBlock\(\s*tx,\s*organizationId,\s*DocumentType\.StockMovement,\s*count,?\s*\)/);
  assert.match(block, /return movementNumbersOfBlock\(first, count\);/);
});

test("reserveDocumentSequenceBlock: the same single upsert as reserveDocumentSequence, moved by `size`", () => {
  const source = read("./server/document-sequence.ts");
  const single = source.slice(source.indexOf("export async function reserveDocumentSequence("), source.indexOf("export async function reserveDocumentSequenceBlock"));
  const block = source.slice(source.indexOf("export async function reserveDocumentSequenceBlock"), source.indexOf("export const DocumentType"));
  // same row key, same statement shape
  for (const piece of [
    `INSERT INTO "DocumentSequence" ("id", "organizationId", "documentType", "scopeKey", "currentValue", "updatedAt")`,
    `ON CONFLICT ("organizationId", "documentType", "scopeKey")`,
    `RETURNING "currentValue"`,
  ]) {
    assert.ok(single.includes(piece) && block.includes(piece), piece);
  }
  assert.match(single, /"currentValue" = "DocumentSequence"\."currentValue" \+ 1,/);
  assert.match(block, /"currentValue" = "DocumentSequence"\."currentValue" \+ \$\{size\},/);
  assert.match(block, /\$\{scopeKey\}, \$\{size\}, NOW\(\)\)/, "a brand-new row starts at `size`, like 0 + size");
  assert.match(block, /return Number\(rows\[0\]\.currentValue\) - size \+ 1;/);
  assert.match(block, /size < 1/);
  // one statement, no read-then-write, no extra table
  assert.equal(count(block, /tx\.\$queryRaw/g), 1);
  assert.equal(/findFirst|findUnique|\.count\(|SELECT /.test(block), false);
});

test("no StockMovement number is still built from a row count anywhere in the application or its scripts", () => {
  const files = listSourceFiles();
  assert.ok(files.length > 100, "the scan really covers the project");
  // Legitimate count() of StockMovement: the movements list pagination total, and the
  // seed's own "MV-SEED-nnnnnn" numbers (a prefix that can never equal an "MV-nnnnnn"
  // counter number).
  const legitimateCounts = ["stock-movements.ts", "seed.ts"];
  const offenders: string[] = [];
  for (const file of files) {
    // comments (which may describe the former behaviour) are not code
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    if (/stockMovement\.count\(/.test(source) && !legitimateCounts.some((name) => file.endsWith(name))) {
      offenders.push(`${file}: stockMovement.count(`);
    }
    if (/MV-\$\{String\((count|base\w*)\b/.test(source)) offenders.push(`${file}: MV- from a count`);
    if (/MV-\$\{String\([^)]*\+ 1/.test(source)) offenders.push(`${file}: MV- built with + 1`);
  }
  assert.deepEqual(offenders, []);
  // the seed's numbers are in their own namespace
  assert.match(read("../prisma/seed.ts"), /MV-SEED-\$\{String\(seedMovementSequence\)/);
});

test("every application writer of StockMovement.movementNumber goes through the counter", () => {
  const generators: string[] = [];
  for (const file of listSourceFiles().filter((f) => !f.includes(`${join("prisma", "seed")}`))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/movementNumber:\s*([^\n]+)/g)) {
      const value = match[1].trim();
      // reads / selects / DTO mapping / schema docs are not generators
      if (/^(true|string|movement\.|line\.|row\.|m\.|\{)/.test(value) || value.startsWith("//")) continue;
      generators.push(`${file.replace(/\\/g, "/").split("limonad_app/").pop()}: ${value.replace(/[,]$/, "")}`);
    }
  }
  for (const generator of generators) {
    assert.match(
      generator,
      /await nextMovementNumber\(|movementNumbers\[index\]/,
      `a movementNumber is not taken from the counter: ${generator}`,
    );
  }
  assert.ok(generators.length >= 10, `expected the known writers, found ${generators.length}`);
});

// ---- helpers --------------------------------------------------------------------------------------------------

function count(source: string, pattern: RegExp) {
  return (source.match(pattern) ?? []).length;
}

/** app/, lib/, scripts/, prisma/seed.ts - production sources, not tests, not generated. */
function listSourceFiles(): string[] {
  const out: string[] = [];
  const root = new URL(".", ROOT).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (["node_modules", ".next", "generated", "migrations", ".git", "android", "ios", "mobile"].includes(entry)) continue;
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  for (const folder of ["app", "lib", "scripts"]) walk(join(root, folder));
  out.push(join(root, "prisma", "seed.ts"));
  return out;
}
