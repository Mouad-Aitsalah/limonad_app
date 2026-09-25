import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeDiscountedLineTotals } from "@/lib/pos-discount";

import { closeCounterPosDatabase } from "./database";
import { findLocalCustomerByNumber, getLocalCustomer, searchLocalCustomers } from "./local-search";
import {
  buildOfflineSaleInput,
  cartInputFromSnapshot,
  snapshotFromCartRecord,
  ticketFromOfflineSale,
  type BuildOfflineSaleParams,
  type OfflineCartLine,
} from "./offline-sale";
import { hydrateCounterPosSnapshot, loadCachedCounterPosContext } from "./pos-data-source";
import { createOfflineSale, deleteCart, listOfflineSales, loadCart, saveCart } from "./sales-store";
import { makeContext, uniqueOrg, unwrap } from "./test-helpers";

function line(productId: string, quantity: number, unitPriceHT = 10, taxRate = 20, discountUnitAmount = 0): OfflineCartLine {
  const t = computeDiscountedLineTotals({ unitPriceHT, taxRate, quantity, discountUnitAmount });
  return {
    productId,
    reference: `REF-${productId}`,
    designation: `Produit ${productId}`,
    quantity,
    unitPriceHT,
    tauxTVA: taxRate,
    discountUnitAmount: t.discountUnitAmount,
    discountAmount: t.discountAmount,
    netHT: t.totalHT,
    tvaAmount: t.taxAmount,
    totalTTC: t.totalTTC,
  };
}

function params(overrides: Partial<BuildOfflineSaleParams> = {}): BuildOfflineSaleParams {
  return {
    depotId: "depot-1",
    stockLocationId: "loc-1",
    bankAccounts: [{ id: "bank-1", code: "51410001", name: "Banque" }],
    lines: [line("p1", 3)],
    customer: { id: "cust-1", code: "34211", name: "Client Un" },
    paymentMethod: "CASH",
    chequeNumber: "",
    banque: "",
    bankAccountId: "",
    mixedAmounts: { cash: 0, cheque: 0 },
    idempotencyKey: "key-1",
    reservation: null,
    ...overrides,
  };
}

test("CASH: one payment for the full total, totals summed from the cart lines", () => {
  const built = buildOfflineSaleInput(params({ lines: [line("p1", 3), line("p2", 1, 8.33, 20, 1)] }));
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const { input } = built;
  assert.equal(input.payments.length, 1);
  assert.equal(input.payments[0].method, "CASH");
  assert.equal(input.payments[0].amount, input.totals.totalTTC);
  assert.equal(input.totals.paidAmount, input.totals.totalTTC);
  assert.equal(input.totals.creditAmount, 0);
  assert.equal(input.lines.length, 2);
  assert.equal(input.lines[1].discountUnitAmount, 1);
  assert.equal(input.idempotencyKey, "key-1");
});

test("CREDIT is refused offline, with the reason", () => {
  const built = buildOfflineSaleInput(params({ paymentMethod: "CREDIT" }));
  assert.equal(built.ok, false);
  if (!built.ok) assert.match(built.message, /crédit/i);
});

test("an empty cart is refused", () => {
  assert.equal(buildOfflineSaleInput(params({ lines: [] })).ok, false);
});

test("BANK_TRANSFER needs a known bank account", () => {
  assert.equal(buildOfflineSaleInput(params({ paymentMethod: "BANK_TRANSFER" })).ok, false);
  assert.equal(
    buildOfflineSaleInput(params({ paymentMethod: "BANK_TRANSFER", bankAccountId: "nope" })).ok,
    false,
  );
  const ok = buildOfflineSaleInput(params({ paymentMethod: "BANK_TRANSFER", bankAccountId: "bank-1" }));
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.input.bankAccountingAccountId, "bank-1");
});

test("CHECK keeps the cheque number as reference", () => {
  const built = buildOfflineSaleInput(params({ paymentMethod: "CHECK", chequeNumber: " 0012345 " }));
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.input.reference, "0012345");
    assert.equal(built.input.payments[0].method, "CHECK");
  }
});

test("MIXED must cover the whole total offline (no credit remainder, no overpayment)", () => {
  const total = 36; // 3 x 10 HT + 20% VAT
  const full = buildOfflineSaleInput(params({ paymentMethod: "MIXED", mixedAmounts: { cash: 20, cheque: 16 } }));
  assert.equal(full.ok, true);
  if (full.ok) {
    assert.deepEqual(full.input.payments.map((p) => p.method), ["CASH", "CHECK"]);
    assert.equal(full.input.totals.paidAmount, total);
  }
  assert.equal(buildOfflineSaleInput(params({ paymentMethod: "MIXED", mixedAmounts: { cash: 10, cheque: 0 } })).ok, false);
  assert.equal(buildOfflineSaleInput(params({ paymentMethod: "MIXED", mixedAmounts: { cash: 50, cheque: 0 } })).ok, false);
  assert.equal(buildOfflineSaleInput(params({ paymentMethod: "MIXED", mixedAmounts: { cash: 0, cheque: 0 } })).ok, false);
});

test("end to end: sale kept PENDING locally, stock reduced, ticket honest, survives a reopen", async () => {
  const org = uniqueOrg();
  const scope = { organizationId: org, userId: "user-1" };
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext()));

  const built = buildOfflineSaleInput(params({ lines: [line("p1", 3)], reservation: { saleNumber: 41, saleYear: 2026 } }));
  assert.ok(built.ok);
  if (!built.ok) return;
  const { sale } = unwrap(await createOfflineSale(scope, built.input));
  assert.equal(sale.status, "PENDING");
  assert.equal(sale.idempotencyKey, "key-1");
  assert.equal(sale.reservedSaleNumber, 41);
  assert.equal(sale.organizationId, org);
  assert.equal(sale.depotId, "depot-1");

  // local stock: 20 - 3
  const cached = await loadCachedCounterPosContext(scope);
  assert.ok(cached.ok);
  if (cached.ok) {
    assert.equal(cached.context.products.find((p) => p.id === "p1")?.availableQuantity, 17);
  }

  const ticket = ticketFromOfflineSale(sale, { cashierName: "Caissier Un" });
  assert.equal(ticket.displayNumber, sale.localReference);
  assert.equal(ticket.paidAmount, 36);
  assert.equal(ticket.creditAmount, 0);

  // "close the app": drop the connection, reopen from IndexedDB
  closeCounterPosDatabase(org);
  const again = unwrap(await listOfflineSales(scope, { statuses: ["PENDING"] }));
  assert.equal(again.length, 1);
  assert.equal(again[0].localId, sale.localId);
});

test("cart persists across a reopen, keeps its idempotency key, and is cleared by the sale", async () => {
  const org = uniqueOrg();
  const scope = { organizationId: org, userId: "user-1" };
  unwrap(
    await saveCart(
      scope,
      cartInputFromSnapshot({
        lines: [{ productId: "p1", quantity: 2, discountUnitAmount: 0.5 }, { productId: "p3", quantity: 1, discountUnitAmount: 0, priceOverrideHT: 4 }],
        customerId: "cust-2",
        paymentMethod: "MIXED",
        chequeNumber: "77",
        banque: "BP",
        bankAccountId: "bank-1",
        mixedAmounts: { cash: 5, cheque: 7 },
        idempotencyKey: "cart-key",
        reservation: { saleNumber: 9, saleYear: 2026 },
      }),
    ),
  );
  closeCounterPosDatabase(org);

  const stored = unwrap(await loadCart(scope));
  assert.ok(stored);
  const snap = snapshotFromCartRecord(stored);
  assert.equal(snap.lines.length, 2);
  assert.equal(snap.lines[0].discountUnitAmount, 0.5);
  assert.equal("priceOverrideHT" in snap.lines[0], false);
  assert.equal(snap.lines[1].priceOverrideHT, 4);
  assert.equal(snap.customerId, "cust-2");
  assert.equal(snap.paymentMethod, "MIXED");
  assert.deepEqual(snap.mixedAmounts, { cash: 5, cheque: 7 });
  assert.equal(snap.idempotencyKey, "cart-key");
  assert.deepEqual(snap.reservation, { saleNumber: 9, saleYear: 2026 });

  // Validating with clearCartSlot removes it in the same transaction.
  const built = buildOfflineSaleInput(params({ clearCartSlot: "default", idempotencyKey: "cart-key" }));
  assert.ok(built.ok);
  if (built.ok) unwrap(await createOfflineSale(scope, built.input));
  assert.equal(unwrap(await loadCart(scope)), null);
  unwrap(await deleteCart(scope));
});

test("local customer search: name, code, N°, phone; never blocked; scoped to the organization", async () => {
  const org = uniqueOrg();
  const scope = { organizationId: org, userId: "user-1" };
  const context = makeContext();
  context.customers.push({ ...context.customers[1], id: "cust-3", code: "34213", displayCode: "3421/3", name: "Client Bloqué", status: "BLOCKED" });
  unwrap(await hydrateCounterPosSnapshot(scope, context));

  assert.deepEqual((await searchLocalCustomers(scope, "deux")).map((c) => c.id), ["cust-2"]);
  assert.deepEqual((await searchLocalCustomers(scope, "CLIENT")).map((c) => c.id).sort(), ["cust-1", "cust-2"]);
  assert.deepEqual((await searchLocalCustomers(scope, "0600000001")).map((c) => c.id), ["cust-1"]);
  assert.deepEqual(await searchLocalCustomers(scope, "bloqu"), []);
  assert.deepEqual(await searchLocalCustomers(scope, "  "), []);

  const byNumber = await findLocalCustomerByNumber(scope, "2");
  assert.equal(byNumber.kind, "found");
  if (byNumber.kind === "found") assert.equal(byNumber.customer.id, "cust-2");
  assert.equal((await findLocalCustomerByNumber(scope, "3421/1")).kind, "found");
  assert.equal((await findLocalCustomerByNumber(scope, "99")).kind, "not_found");
  assert.equal((await findLocalCustomerByNumber(scope, "abc")).kind, "not_found");
  assert.equal((await findLocalCustomerByNumber(scope, "3")).kind, "not_found"); // blocked

  assert.equal((await getLocalCustomer(scope, "cust-1"))?.name, "Client Un");
  const other = { organizationId: uniqueOrg(), userId: "user-1" };
  assert.deepEqual(await searchLocalCustomers(other, "client"), []);
  assert.equal(await getLocalCustomer(other, "cust-1"), null);
});
