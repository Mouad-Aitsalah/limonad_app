import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { test } from "node:test";

import { closeCounterPosDatabase, getCounterPosDatabase } from "./database";
import {
  claimSaleForSync,
  computeRetryDelayMs,
  countOfflineSalesByStatus,
  createOfflineSale,
  deleteCart,
  findOfflineSaleByIdempotencyKey,
  getOfflineSale,
  getPendingQuantityByProduct,
  listOfflineSales,
  loadCart,
  markSaleSynced,
  markSaleSyncFailure,
  pruneSyncedSales,
  reapStaleSyncingSales,
  requeueFailedSale,
  revertSaleToPending,
  saveCart,
  SYNC_MAX_ATTEMPTS,
  validateOfflineSaleInput,
  type CartInput,
} from "./sales-store";
import { failureOf, makeLine, makeSaleInput, uniqueOrg, unwrap } from "./test-helpers";

const T0 = new Date("2026-09-25T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function scopeFor(org: string, userId = "user-1") {
  return { organizationId: org, userId };
}

// ---------------------------------------------------------------------------
// create / read
// ---------------------------------------------------------------------------

test("a saved sale is PENDING with a unique local id, its lines, payments and idempotencyKey", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const input = makeSaleInput([makeLine("p1", 3), makeLine("p2", 1, { unitPriceHT: 8.33 })], {
    idempotencyKey: "key-abc",
    reservedSaleNumber: 41,
    reservedSaleYear: 2026,
    reference: null,
  });
  const { sale, created } = unwrap(await createOfflineSale(scope, input, { now: T0 }));

  assert.equal(created, true);
  assert.match(sale.localId, /^[0-9a-f-]{36}$/);
  assert.equal(sale.status, "PENDING");
  assert.equal(sale.syncAttempts, 0);
  assert.equal(sale.idempotencyKey, "key-abc");
  assert.equal(sale.organizationId, org);
  assert.equal(sale.userId, "user-1");
  assert.match(sale.deviceId, /^[0-9a-f-]{36}$/);
  assert.equal(sale.reservedSaleNumber, 41);
  assert.equal(sale.reservedSaleYear, 2026);
  assert.equal(sale.createdAtLocal, T0.toISOString());
  assert.equal(sale.soldAt, T0.toISOString());
  assert.equal(sale.customerName, "Client Un");
  assert.equal(sale.lastError, null);
  assert.equal(sale.serverSaleId, null);
  assert.equal(sale.lines.length, 2);
  assert.deepEqual(sale.lines.map((l) => l.position), [0, 1]);
  assert.deepEqual(sale.lines.map((l) => l.productId), ["p1", "p2"]);
  assert.equal(sale.payments.length, 1);
  assert.equal(sale.payments[0].method, "CASH");
  assert.equal(sale.payments[0].amount, sale.totalTTC);

  const reread = unwrap(await getOfflineSale(scope, sale.localId));
  assert.deepEqual(reread, sale);
  assert.deepEqual(unwrap(await countOfflineSalesByStatus(scope)), { PENDING: 1, SYNCING: 0, SYNCED: 0, FAILED: 0 });
});

test("an idempotencyKey is generated when the caller gives none", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const a = unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 1)])));
  const b = unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 1)])));
  assert.notEqual(a.sale.idempotencyKey, b.sale.idempotencyKey);
  assert.notEqual(a.sale.localId, b.sale.localId);
});

test("MIXED payment stores one CASH and one CHECK row that add up", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const lines = [makeLine("p1", 10)]; // 120.00 TTC
  const input = makeSaleInput(lines, {
    paymentMethod: "MIXED",
    payments: [
      { method: "CASH", amount: 70 },
      { method: "CHECK", amount: 30, reference: "CHQ-1" },
    ],
    totals: { subtotalHT: 100, discountAmount: 0, taxAmount: 20, totalTTC: 120, paidAmount: 100, creditAmount: 20 },
  });
  const { sale } = unwrap(await createOfflineSale(scope, input));
  assert.equal(sale.creditAmount, 20);
  assert.deepEqual(sale.payments.map((p) => [p.method, p.amount, p.reference]), [
    ["CASH", 70, null],
    ["CHECK", 30, "CHQ-1"],
  ]);
});

test("a CREDIT sale stores no payment row", async () => {
  const org = uniqueOrg();
  const input = makeSaleInput([makeLine("p1", 1)], {
    paymentMethod: "CREDIT",
    payments: [],
    totals: { subtotalHT: 10, discountAmount: 0, taxAmount: 2, totalTTC: 12, paidAmount: 0, creditAmount: 12 },
  });
  const { sale } = unwrap(await createOfflineSale(scopeFor(org), input));
  assert.equal(sale.payments.length, 0);
  assert.equal(sale.creditAmount, 12);
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

test("validation rejects contradictory or malformed sales", () => {
  const good = makeSaleInput([makeLine("p1", 2)]);
  assert.deepEqual(validateOfflineSaleInput(good), []);

  const bad = (mutate: (i: ReturnType<typeof makeSaleInput>) => void) => {
    const input = structuredClone(good);
    mutate(input);
    return validateOfflineSaleInput(input);
  };

  assert.ok(bad((i) => (i.lines = [])).length > 0, "no lines");
  assert.ok(bad((i) => (i.lines[0].quantity = 1.5)).length > 0, "fractional quantity");
  assert.ok(bad((i) => (i.lines[0].quantity = 0)).length > 0, "zero quantity");
  assert.ok(bad((i) => (i.lines[0].quantity = -3)).length > 0, "negative quantity");
  assert.ok(bad((i) => (i.lines[0].unitPriceHT = -1)).length > 0, "negative price");
  assert.ok(bad((i) => (i.lines[0].unitPriceHT = Number.NaN)).length > 0, "NaN price");
  assert.ok(bad((i) => (i.lines[0].discountUnitAmount = -1)).length > 0, "negative discount");
  assert.ok(bad((i) => (i.lines[0].taxRate = 120)).length > 0, "tax over 100");
  assert.ok(bad((i) => (i.totals.totalTTC += 5)).length > 0, "total does not match HT + tax");
  assert.ok(bad((i) => (i.totals.subtotalHT += 5)).length > 0, "subtotal does not match lines");
  assert.ok(bad((i) => (i.totals.creditAmount = 3)).length > 0, "paid + credit != total");
  assert.ok(bad((i) => (i.payments[0].amount = 1)).length > 0, "payments != paid");
  assert.ok(bad((i) => (i.payments[0].amount = 0)).length > 0, "zero payment row");
  assert.ok(bad((i) => (i.stockLocationId = "")).length > 0, "no stock location");
  assert.ok(bad((i) => ((i as { paymentMethod: string }).paymentMethod = "CARD")).length > 0, "CARD is not offered");
  assert.ok(bad((i) => (i.reservedSaleNumber = 5)).length > 0, "number without year");
  assert.ok(bad((i) => { i.reservedSaleNumber = -1; i.reservedSaleYear = 2026; }).length > 0, "negative number");
  assert.ok(bad((i) => (i.idempotencyKey = "x".repeat(121))).length > 0, "key over the server's 120 bound");
  assert.ok(bad((i) => (i.idempotencyKey = " ")).length > 0, "blank key");
  assert.ok(bad((i) => (i.soldAt = "not a date")).length > 0, "bad soldAt");
  assert.ok(bad((i) => i.lines.push({ ...i.lines[0] })).length > 0, "same product twice");
});

test("a refused sale writes NOTHING and does not consume a local reference", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const invalid = makeSaleInput([makeLine("p1", 2)]);
  invalid.totals.totalTTC += 10;
  assert.equal(failureOf(await createOfflineSale(scope, invalid)).code, "INVALID_INPUT");

  assert.deepEqual(unwrap(await listOfflineSales(scope)), []);
  const first = unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 1)]), { now: T0 }));
  assert.match(first.sale.localReference, /-0001$/, "the refused attempt did not burn 0001");
});

test("atomicity: a failure part-way through rolls back the sale row too", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const db = getCounterPosDatabase(org);
  assert.ok(db);
  // Force a failure AFTER the sale row and the lines were written.
  const table = db.offlineSalePayments as unknown as { bulkAdd: unknown };
  const original = table.bulkAdd;
  table.bulkAdd = async () => {
    throw new Error("simulated crash while writing payments");
  };
  try {
    const result = await createOfflineSale(scope, makeSaleInput([makeLine("p1", 2)]));
    assert.equal(failureOf(result).code, "STORAGE_ERROR");
  } finally {
    table.bulkAdd = original;
  }
  assert.equal(await db.offlineSales.count(), 0, "no orphan sale row");
  assert.equal(await db.offlineSaleLines.count(), 0, "no orphan lines");
  assert.equal(await db.offlineSalePayments.count(), 0);

  // The database is healthy afterwards.
  unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 2)])));
  assert.equal(await db.offlineSales.count(), 1);
});

// ---------------------------------------------------------------------------
// idempotency
// ---------------------------------------------------------------------------

test("same key + same content returns the saved sale instead of writing a second one", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const input = makeSaleInput([makeLine("p1", 2)], { idempotencyKey: "one-sale" });
  const first = unwrap(await createOfflineSale(scope, input));
  const second = unwrap(await createOfflineSale(scope, input));
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.sale.localId, first.sale.localId);
  assert.equal(unwrap(await listOfflineSales(scope)).length, 1);
  assert.equal((await getCounterPosDatabase(org)!.offlineSaleLines.count()), 1, "lines not duplicated");
});

test("a double click (concurrent creates with one key) still yields ONE sale", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const input = makeSaleInput([makeLine("p1", 2)], { idempotencyKey: "double-click" });
  const results = await Promise.all(Array.from({ length: 8 }, () => createOfflineSale(scope, input)));
  const created = results.map((r) => unwrap(r)).filter((r) => r.created);
  assert.equal(created.length, 1);
  assert.equal(unwrap(await listOfflineSales(scope)).length, 1);
});

test("the same key for a DIFFERENT sale is refused", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 2)], { idempotencyKey: "k" })));
  const differentQty = makeSaleInput([makeLine("p1", 3)], { idempotencyKey: "k" });
  assert.equal(failureOf(await createOfflineSale(scope, differentQty)).code, "DUPLICATE_IDEMPOTENCY_KEY");
  const differentProduct = makeSaleInput([makeLine("p9", 2)], { idempotencyKey: "k" });
  assert.equal(failureOf(await createOfflineSale(scope, differentProduct)).code, "DUPLICATE_IDEMPOTENCY_KEY");
  assert.equal(unwrap(await listOfflineSales(scope)).length, 1);
});

test("a key owned by another user is refused and never leaks that sale", async () => {
  const org = uniqueOrg();
  unwrap(await createOfflineSale(scopeFor(org, "alice"), makeSaleInput([makeLine("p1", 2)], { idempotencyKey: "shared" })));
  const result = await createOfflineSale(scopeFor(org, "bob"), makeSaleInput([makeLine("p1", 2)], { idempotencyKey: "shared" }));
  assert.equal(failureOf(result).code, "DUPLICATE_IDEMPOTENCY_KEY");
  assert.deepEqual(unwrap(await listOfflineSales(scopeFor(org, "bob"))), []);
  assert.equal(unwrap(await findOfflineSaleByIdempotencyKey(scopeFor(org, "bob"), "shared")), null);
  assert.ok(unwrap(await findOfflineSaleByIdempotencyKey(scopeFor(org, "alice"), "shared")));
});

test("the unique index enforces one sale per key even against a direct write", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const { sale } = unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 1)], { idempotencyKey: "u" })));
  const db = getCounterPosDatabase(org)!;
  await assert.rejects(
    db.offlineSales.add({ ...sale, localId: "another-local-id" }),
    (error: Error) => error.name === "ConstraintError",
  );
});

// ---------------------------------------------------------------------------
// local reference
// ---------------------------------------------------------------------------

test("local references never repeat, even after a restart or after sales are pruned", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const day = new Date(2026, 8, 25, 10, 0, 0); // local time, so the YYYYMMDD part is stable
  const refs: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const { sale } = unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 1)]), { now: day }));
    refs.push(sale.localReference);
  }
  closeCounterPosDatabase(org); // "restart the PC"
  const { sale: afterRestart } = unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 1)]), { now: day }));
  refs.push(afterRestart.localReference);

  for (const s of unwrap(await listOfflineSales(scope))) {
    unwrap(await markSaleSynced(scope, s.localId, { serverSaleId: `srv-${s.localId}`, officialDisplayNumber: "1/2026" }, { now: day }));
  }
  assert.equal(unwrap(await pruneSyncedSales(scope, { olderThanMs: 0, now: new Date(day.getTime() + 1000) })), 13);
  const { sale: afterPrune } = unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 1)]), { now: day }));
  refs.push(afterPrune.localReference);

  assert.equal(new Set(refs).size, refs.length, "no repeated reference");
  assert.match(refs[0], /^OFF-[0-9A-F]{6}-20260925-0001$/);
  assert.match(refs.at(-1)!, /-0014$/, "the counter kept going: 13 sales + 1");
});

test("two devices (two databases) produce different local references for their first sale", async () => {
  const day = new Date(2026, 8, 25, 10, 0, 0);
  const a = unwrap(await createOfflineSale(scopeFor(uniqueOrg()), makeSaleInput([makeLine("p1", 1)]), { now: day }));
  const b = unwrap(await createOfflineSale(scopeFor(uniqueOrg()), makeSaleInput([makeLine("p1", 1)]), { now: day }));
  assert.notEqual(a.sale.localReference, b.sale.localReference);
});

// ---------------------------------------------------------------------------
// carts
// ---------------------------------------------------------------------------

const cart = (overrides: Partial<CartInput> = {}): CartInput => ({
  lines: [
    { productId: "p1", quantity: 2, discountUnitAmount: 1.5 },
    { productId: "p2", quantity: 1, discountUnitAmount: 0, priceOverrideHT: 7.5 },
  ],
  customerId: "cust-1",
  paymentMethod: "CHECK",
  chequeNumber: "CHQ-9",
  banque: "BP",
  bankAccountId: "",
  mixedCash: 0,
  mixedCheque: 0,
  idempotencyKey: "cart-key-1",
  reservedSaleNumber: 12,
  reservedSaleYear: 2026,
  ...overrides,
});

test("the cart survives a restart, with its idempotencyKey and reserved number", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  assert.equal(unwrap(await loadCart(scope)), null);

  const saved = unwrap(await saveCart(scope, cart(), { now: T0 }));
  assert.equal(saved.slot, "default");
  closeCounterPosDatabase(org);

  const loaded = unwrap(await loadCart(scope));
  assert.ok(loaded);
  assert.equal(loaded.idempotencyKey, "cart-key-1");
  assert.equal(loaded.reservedSaleNumber, 12);
  assert.deepEqual(loaded.lines, [
    { productId: "p1", quantity: 2, discountUnitAmount: 1.5, priceOverrideHT: null },
    { productId: "p2", quantity: 1, discountUnitAmount: 0, priceOverrideHT: 7.5 },
  ]);
  assert.equal(loaded.chequeNumber, "CHQ-9");
});

test("saving again updates the cart but keeps createdAt; slots are independent", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await saveCart(scope, cart(), { now: T0 }));
  const updated = unwrap(await saveCart(scope, cart({ customerId: "cust-2" }), { now: at(5000) }));
  assert.equal(updated.createdAt, T0.toISOString());
  assert.equal(updated.updatedAt, at(5000).toISOString());
  assert.equal(unwrap(await loadCart(scope))?.customerId, "cust-2");

  unwrap(await saveCart(scope, cart({ slot: "tab-2", idempotencyKey: "cart-key-2" })));
  assert.equal(unwrap(await loadCart(scope, "tab-2"))?.idempotencyKey, "cart-key-2");
  unwrap(await deleteCart(scope, "tab-2"));
  assert.equal(unwrap(await loadCart(scope, "tab-2")), null);
  assert.ok(unwrap(await loadCart(scope)), "other slot untouched");
});

test("a user's cart is invisible to another user", async () => {
  const org = uniqueOrg();
  unwrap(await saveCart(scopeFor(org, "alice"), cart()));
  assert.equal(unwrap(await loadCart(scopeFor(org, "bob"))), null);
});

test("invalid carts are refused", async () => {
  const scope = scopeFor(uniqueOrg());
  assert.equal(failureOf(await saveCart(scope, cart({ idempotencyKey: "" }))).code, "INVALID_INPUT");
  assert.equal(
    failureOf(await saveCart(scope, cart({ lines: [{ productId: "p1", quantity: 0, discountUnitAmount: 0 }] }))).code,
    "INVALID_INPUT",
  );
  assert.equal(failureOf(await saveCart(scope, cart({ mixedCash: -1 }))).code, "INVALID_INPUT");
});

test("saving the sale deletes its cart in the SAME transaction", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await saveCart(scope, cart()));
  unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 2)], { clearCartSlot: "default" })));
  assert.equal(unwrap(await loadCart(scope)), null);

  // ...and a refused sale leaves the cart alone.
  unwrap(await saveCart(scope, cart()));
  const invalid = makeSaleInput([makeLine("p1", 2)], { clearCartSlot: "default" });
  invalid.totals.totalTTC += 1;
  failureOf(await createOfflineSale(scope, invalid));
  assert.ok(unwrap(await loadCart(scope)), "cart kept when the sale was not saved");
});

// ---------------------------------------------------------------------------
// state machine
// ---------------------------------------------------------------------------

async function pendingSale(org: string, key = "sm-key", userId = "user-1") {
  const scope = scopeFor(org, userId);
  const { sale } = unwrap(
    await createOfflineSale(scope, makeSaleInput([makeLine("p1", 2)], { idempotencyKey: key }), { now: T0 }),
  );
  return { scope, sale };
}

test("retry delays double up to a one-hour cap", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(computeRetryDelayMs), [5000, 5000, 10000, 20000, 40000, 80000]);
  assert.equal(computeRetryDelayMs(30), 3_600_000);
  assert.equal(computeRetryDelayMs(1000), 3_600_000);
});

test("PENDING -> SYNCING counts the attempt and refuses a second claim", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  const claimed = unwrap(await claimSaleForSync(scope, sale.localId, { now: at(1000) }));
  assert.equal(claimed.status, "SYNCING");
  assert.equal(claimed.syncAttempts, 1);
  assert.equal(claimed.lockedAt, at(1000).toISOString());
  assert.equal(claimed.lastAttemptAt, at(1000).toISOString());
  assert.equal(failureOf(await claimSaleForSync(scope, sale.localId)).code, "INVALID_TRANSITION");
});

test("two engines racing: exactly one claims the sale", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  const results = await Promise.all(Array.from({ length: 6 }, () => claimSaleForSync(scope, sale.localId)));
  assert.equal(results.filter((r) => r.ok).length, 1);
});

test("a retryable failure goes back to PENDING with a backoff, and is not claimable before it", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  unwrap(await claimSaleForSync(scope, sale.localId, { now: at(0) }));
  const { sale: failed, retryAt } = unwrap(
    await markSaleSyncFailure(scope, sale.localId, { code: "NETWORK", message: "reseau", retryable: true }, { now: at(0) }),
  );
  assert.equal(failed.status, "PENDING");
  assert.equal(retryAt, at(5000).toISOString(), "attempt 1 -> 5 s");
  assert.equal(failed.nextAttemptAt, retryAt);
  assert.equal(failed.lockedAt, null);
  assert.deepEqual(failed.lastError, {
    code: "NETWORK",
    message: "reseau",
    retryable: true,
    httpStatus: null,
    at: at(0).toISOString(),
  });

  assert.equal(failureOf(await claimSaleForSync(scope, sale.localId, { now: at(4999) })).code, "INVALID_TRANSITION");
  assert.equal(unwrap(await claimSaleForSync(scope, sale.localId, { now: at(5000) })).syncAttempts, 2);
});

test("ignoreBackoff lets a manual 'retry now' skip the wait", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  unwrap(await claimSaleForSync(scope, sale.localId, { now: at(0) }));
  unwrap(await markSaleSyncFailure(scope, sale.localId, { code: "TIMEOUT", message: "t", retryable: true }, { now: at(0) }));
  assert.equal(unwrap(await claimSaleForSync(scope, sale.localId, { now: at(1), ignoreBackoff: true })).status, "SYNCING");
});

test("delays grow with the attempts and the budget ends in FAILED (no endless loop)", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  const delays: number[] = [];
  let clock = 0;
  let last = null as Awaited<ReturnType<typeof markSaleSyncFailure>> | null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    unwrap(await claimSaleForSync(scope, sale.localId, { now: at(clock), ignoreBackoff: true }));
    last = await markSaleSyncFailure(
      scope,
      sale.localId,
      { code: "HTTP_503", message: "indispo", retryable: true, httpStatus: 503 },
      { now: at(clock), maxAttempts: 3 },
    );
    const outcome = unwrap(last);
    if (outcome.retryAt) delays.push(new Date(outcome.retryAt).getTime() - at(clock).getTime());
    clock += 1000;
  }
  assert.deepEqual(delays, [5000, 10000], "attempts 1 and 2 are retried, doubling");
  const finalOutcome = unwrap(last!);
  assert.equal(finalOutcome.sale.status, "FAILED", "third attempt exhausted the budget");
  assert.equal(finalOutcome.retryAt, null);
  assert.equal(finalOutcome.sale.lastError?.httpStatus, 503);
  assert.equal(failureOf(await claimSaleForSync(scope, sale.localId)).code, "INVALID_TRANSITION", "FAILED is never auto-claimed");
});

test("the default budget is SYNC_MAX_ATTEMPTS", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  let outcome;
  for (let attempt = 1; attempt <= SYNC_MAX_ATTEMPTS; attempt += 1) {
    unwrap(await claimSaleForSync(scope, sale.localId, { ignoreBackoff: true }));
    outcome = unwrap(await markSaleSyncFailure(scope, sale.localId, { code: "NETWORK", message: "x", retryable: true }));
    if (attempt < SYNC_MAX_ATTEMPTS) assert.equal(outcome.sale.status, "PENDING");
  }
  assert.equal(outcome!.sale.status, "FAILED");
  assert.equal(outcome!.sale.syncAttempts, SYNC_MAX_ATTEMPTS);
});

test("a permanent (non-retryable) rejection is FAILED immediately and can be re-queued", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  unwrap(await claimSaleForSync(scope, sale.localId, { now: at(0) }));
  const { sale: failed, retryAt } = unwrap(
    await markSaleSyncFailure(
      scope,
      sale.localId,
      { code: "CREDIT_LIMIT_EXCEEDED", message: "Plafond de credit depasse.", retryable: false, httpStatus: 409 },
      { now: at(0) },
    ),
  );
  assert.equal(failed.status, "FAILED");
  assert.equal(retryAt, null);
  assert.equal(failed.lastError?.code, "CREDIT_LIMIT_EXCEEDED");

  const requeued = unwrap(await requeueFailedSale(scope, sale.localId, { now: at(10) }));
  assert.equal(requeued.status, "PENDING");
  assert.equal(requeued.syncAttempts, 0, "fresh retry budget");
  assert.equal(requeued.nextAttemptAt, null);
  assert.equal(requeued.idempotencyKey, sale.idempotencyKey, "same key: the retry stays safe");
  assert.equal(requeued.lastError?.code, "CREDIT_LIMIT_EXCEEDED", "previous error kept until the next attempt");
});

test("SYNCING -> SYNCED records the server identity and clears the error", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  unwrap(await claimSaleForSync(scope, sale.localId));
  unwrap(await markSaleSyncFailure(scope, sale.localId, { code: "NETWORK", message: "x", retryable: true }));
  unwrap(await claimSaleForSync(scope, sale.localId, { ignoreBackoff: true }));
  const synced = unwrap(
    await markSaleSynced(
      scope,
      sale.localId,
      { serverSaleId: "srv-1", officialDisplayNumber: "33/2026", serverTotalTTC: 24, totalMismatch: false },
      { now: at(9000) },
    ),
  );
  assert.equal(synced.status, "SYNCED");
  assert.equal(synced.serverSaleId, "srv-1");
  assert.equal(synced.officialDisplayNumber, "33/2026");
  assert.equal(synced.syncedAt, at(9000).toISOString());
  assert.equal(synced.lastError, null);
  assert.equal(synced.nextAttemptAt, null);
  assert.equal(synced.lockedAt, null);
  assert.equal(synced.syncAttempts, 2);
});

test("confirming twice keeps the FIRST confirmation", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  unwrap(await claimSaleForSync(scope, sale.localId));
  unwrap(await markSaleSynced(scope, sale.localId, { serverSaleId: "srv-1", officialDisplayNumber: "1/2026" }));
  const again = unwrap(await markSaleSynced(scope, sale.localId, { serverSaleId: "srv-OTHER", officialDisplayNumber: "9/2026" }));
  assert.equal(again.serverSaleId, "srv-1");
  assert.equal(again.officialDisplayNumber, "1/2026");
});

test("a server confirmation is accepted even if a restart already put the sale back to PENDING", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  unwrap(await claimSaleForSync(scope, sale.localId, { now: at(0) }));
  unwrap(await reapStaleSyncingSales(scope, { now: at(10 * 60 * 1000) }));
  assert.equal(unwrap(await getOfflineSale(scope, sale.localId)).status, "PENDING");
  const synced = unwrap(await markSaleSynced(scope, sale.localId, { serverSaleId: "srv-1", officialDisplayNumber: "1/2026" }));
  assert.equal(synced.status, "SYNCED");
});

test("markSaleSynced needs the server identity", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  assert.equal(
    failureOf(await markSaleSynced(scope, sale.localId, { serverSaleId: "", officialDisplayNumber: "1/2026" })).code,
    "INVALID_INPUT",
  );
  assert.equal(
    failureOf(await markSaleSynced(scope, sale.localId, { serverSaleId: "srv", officialDisplayNumber: "" })).code,
    "INVALID_INPUT",
  );
});

test("revertSaleToPending (auth pause) does not count as an attempt", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  unwrap(await claimSaleForSync(scope, sale.localId));
  const reverted = unwrap(await revertSaleToPending(scope, sale.localId));
  assert.equal(reverted.status, "PENDING");
  assert.equal(reverted.syncAttempts, 0);
  assert.equal(reverted.lockedAt, null);
  assert.equal(failureOf(await revertSaleToPending(scope, sale.localId)).code, "INVALID_TRANSITION");
});

test("illegal transitions are refused", async () => {
  const { scope, sale } = await pendingSale(uniqueOrg());
  // failure of a sale that is not being sent
  assert.equal(
    failureOf(await markSaleSyncFailure(scope, sale.localId, { code: "X", message: "x", retryable: true })).code,
    "INVALID_TRANSITION",
  );
  // re-queue of a sale that did not fail
  assert.equal(failureOf(await requeueFailedSale(scope, sale.localId)).code, "INVALID_TRANSITION");
  // a SYNCED sale cannot be sent again
  unwrap(await claimSaleForSync(scope, sale.localId));
  unwrap(await markSaleSynced(scope, sale.localId, { serverSaleId: "s", officialDisplayNumber: "1/2026" }));
  assert.equal(failureOf(await claimSaleForSync(scope, sale.localId)).code, "INVALID_TRANSITION");
  assert.equal(failureOf(await requeueFailedSale(scope, sale.localId)).code, "INVALID_TRANSITION");
  assert.equal(failureOf(await getOfflineSale(scope, "no-such-sale")).code, "NOT_FOUND");
});

// ---------------------------------------------------------------------------
// crash recovery / housekeeping
// ---------------------------------------------------------------------------

test("restart recovery: an interrupted SYNCING sale returns to PENDING; a live one is left alone", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const a = unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 1)], { idempotencyKey: "a" }), { now: T0 })).sale;
  const b = unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p2", 1)], { idempotencyKey: "b" }), { now: T0 })).sale;
  unwrap(await claimSaleForSync(scope, a.localId, { now: at(0) })); // old lock
  unwrap(await claimSaleForSync(scope, b.localId, { now: at(9 * 60 * 1000) })); // fresh lock

  closeCounterPosDatabase(org); // the PC was restarted
  const reaped = unwrap(await reapStaleSyncingSales(scope, { now: at(10 * 60 * 1000), olderThanMs: 2 * 60 * 1000 }));
  assert.equal(reaped, 1);
  const reread = unwrap(await getOfflineSale(scope, a.localId));
  assert.equal(reread.status, "PENDING");
  assert.equal(reread.idempotencyKey, "a", "retried with the SAME key");
  assert.equal(reread.syncAttempts, 1, "the interrupted attempt stays counted");
  assert.equal(unwrap(await getOfflineSale(scope, b.localId)).status, "SYNCING");
});

test("pruneSyncedSales removes only old SYNCED sales, with their lines and payments", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const make = async (key: string) =>
    unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 1)], { idempotencyKey: key }), { now: T0 })).sale;
  const oldSynced = await make("old");
  const recentSynced = await make("recent");
  const pending = await make("pending");
  const failed = await make("failed");

  for (const [sale, when] of [[oldSynced, at(0)], [recentSynced, at(9 * 24 * 3600 * 1000)]] as const) {
    unwrap(await claimSaleForSync(scope, sale.localId, { now: when }));
    unwrap(await markSaleSynced(scope, sale.localId, { serverSaleId: `s-${sale.localId}`, officialDisplayNumber: "1/2026" }, { now: when }));
  }
  unwrap(await claimSaleForSync(scope, failed.localId));
  unwrap(await markSaleSyncFailure(scope, failed.localId, { code: "X", message: "x", retryable: false }));

  const removed = unwrap(await pruneSyncedSales(scope, { olderThanMs: 7 * 24 * 3600 * 1000, now: at(10 * 24 * 3600 * 1000) }));
  assert.equal(removed, 1);
  const remaining = unwrap(await listOfflineSales(scope)).map((s) => s.localId).sort();
  assert.deepEqual(remaining, [recentSynced.localId, pending.localId, failed.localId].sort());

  const db = getCounterPosDatabase(org)!;
  assert.equal(await db.offlineSaleLines.where("localId").equals(oldSynced.localId).count(), 0);
  assert.equal(await db.offlineSalePayments.where("localId").equals(oldSynced.localId).count(), 0);
});

// ---------------------------------------------------------------------------
// listing / counting
// ---------------------------------------------------------------------------

test("sales list oldest first (soldAt, then creation) and can be filtered by status", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const make = async (key: string, soldAt: Date, now: Date) =>
    unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 1)], { idempotencyKey: key, soldAt: soldAt.toISOString() }), { now })).sale;
  const third = await make("3", at(3000), at(0));
  const first = await make("1", at(1000), at(1));
  const second = await make("2", at(2000), at(2));
  assert.deepEqual(unwrap(await listOfflineSales(scope)).map((s) => s.idempotencyKey), ["1", "2", "3"]);

  unwrap(await claimSaleForSync(scope, first.localId));
  assert.deepEqual(unwrap(await listOfflineSales(scope, { statuses: ["PENDING"] })).map((s) => s.localId), [second.localId, third.localId]);
  assert.deepEqual(unwrap(await countOfflineSalesByStatus(scope)), { PENDING: 2, SYNCING: 1, SYNCED: 0, FAILED: 0 });
});

// ---------------------------------------------------------------------------
// isolation
// ---------------------------------------------------------------------------

test("a user cannot see, claim or modify another user's sale (reported as not found)", async () => {
  const org = uniqueOrg();
  const alice = scopeFor(org, "alice");
  const bob = scopeFor(org, "bob");
  const { sale } = unwrap(await createOfflineSale(alice, makeSaleInput([makeLine("p1", 1)])));

  assert.equal(failureOf(await getOfflineSale(bob, sale.localId)).code, "NOT_FOUND");
  assert.equal(failureOf(await claimSaleForSync(bob, sale.localId)).code, "NOT_FOUND");
  assert.equal(
    failureOf(await markSaleSynced(bob, sale.localId, { serverSaleId: "s", officialDisplayNumber: "1/2026" })).code,
    "NOT_FOUND",
  );
  assert.equal(failureOf(await requeueFailedSale(bob, sale.localId)).code, "NOT_FOUND");
  assert.deepEqual(unwrap(await listOfflineSales(bob)), []);
  assert.deepEqual(unwrap(await countOfflineSalesByStatus(bob)), { PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0 });
  assert.equal(unwrap(await reapStaleSyncingSales(bob)), 0);
  assert.equal(unwrap(await pruneSyncedSales(bob, { olderThanMs: 0 })), 0);

  // Alice's sale is untouched by all of that.
  assert.equal(unwrap(await getOfflineSale(alice, sale.localId)).status, "PENDING");
});

test("another organization cannot reach a sale, even by its local id", async () => {
  const orgA = uniqueOrg();
  const orgB = uniqueOrg();
  const { sale } = unwrap(await createOfflineSale(scopeFor(orgA), makeSaleInput([makeLine("p1", 1)])));
  assert.equal(failureOf(await getOfflineSale(scopeFor(orgB), sale.localId)).code, "NOT_FOUND");
  assert.deepEqual(unwrap(await listOfflineSales(scopeFor(orgB))), []);
});

test("scopes with a missing organization or user are refused", async () => {
  const input = makeSaleInput([makeLine("p1", 1)]);
  assert.equal(failureOf(await createOfflineSale({ organizationId: "", userId: "u" }, input)).code, "INVALID_INPUT");
  assert.equal(failureOf(await createOfflineSale({ organizationId: uniqueOrg(), userId: "" }, input)).code, "INVALID_INPUT");
  assert.equal(failureOf(await listOfflineSales(undefined as never)).code, "INVALID_INPUT");
});

// ---------------------------------------------------------------------------
// stock accounting input
// ---------------------------------------------------------------------------

test("pending quantities span every user of the depot but only PENDING/SYNCING sales", async () => {
  const org = uniqueOrg();
  const alice = scopeFor(org, "alice");
  const bob = scopeFor(org, "bob");
  const make = async (scope: ReturnType<typeof scopeFor>, key: string, productId: string, qty: number, location = "loc-1") =>
    unwrap(await createOfflineSale(scope, makeSaleInput([makeLine(productId, qty)], { idempotencyKey: key, stockLocationId: location }), { now: T0 })).sale;

  await make(alice, "a1", "p1", 3);
  await make(bob, "b1", "p1", 4); // another user, same depot
  await make(alice, "a2", "p2", 5);
  await make(alice, "other-depot", "p1", 100, "loc-2");
  const synced = await make(alice, "synced", "p1", 50);
  const failed = await make(alice, "failed", "p1", 60);
  const syncing = await make(bob, "syncing", "p3", 7);

  unwrap(await claimSaleForSync(alice, synced.localId));
  unwrap(await markSaleSynced(alice, synced.localId, { serverSaleId: "s", officialDisplayNumber: "1/2026" }));
  unwrap(await claimSaleForSync(alice, failed.localId));
  unwrap(await markSaleSyncFailure(alice, failed.localId, { code: "X", message: "x", retryable: false }));
  unwrap(await claimSaleForSync(bob, syncing.localId));

  assert.deepEqual(unwrap(await getPendingQuantityByProduct(org, "loc-1")), { p1: 7, p2: 5, p3: 7 });
  assert.deepEqual(unwrap(await getPendingQuantityByProduct(org, "loc-2")), { p1: 100 });
  assert.deepEqual(unwrap(await getPendingQuantityByProduct(org, "loc-none")), {});
  assert.deepEqual(unwrap(await getPendingQuantityByProduct(uniqueOrg(), "loc-1")), {});
});
