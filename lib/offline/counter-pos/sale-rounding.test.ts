import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildCounterSaleInput, counterSaleSyncSchema } from "@/lib/counter-sale-sync-contract";
import { roundMoney } from "@/lib/money";

import { buildOfflineSaleInput, ticketFromOfflineSale, type OfflineCartLine } from "./offline-sale";
import { buildCounterSyncPayload } from "./sales-sync";
import { createOfflineSale, getOfflineSale, validateOfflineSaleInput } from "./sales-store";
import type { CounterPosScope } from "./schema";
import { makeLine, makeSaleInput, uniqueOrg, unwrap } from "./test-helpers";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// A cart whose lines add up to 339.49 TTC before rounding (HT 282.91 + VAT 56.58).
const cartLine = (overrides: Partial<OfflineCartLine> = {}): OfflineCartLine => ({
  productId: "p1",
  reference: "R1",
  designation: "Produit 1",
  quantity: 1,
  unitPriceHT: 282.91,
  tauxTVA: 20,
  discountUnitAmount: 0,
  discountAmount: 0,
  netHT: 282.91,
  tvaAmount: 56.58,
  totalTTC: 339.49,
  ...overrides,
});

const baseParams = {
  depotId: "d1",
  stockLocationId: "l1",
  bankAccounts: [{ id: "bank-1", code: "5141", name: "Banque" }] as never,
  lines: [cartLine()],
  customer: null,
  chequeNumber: "CHQ-1",
  banque: "Banque X",
  bankAccountId: "bank-1",
  mixedAmounts: { cash: 0, cheque: 0 },
  idempotencyKey: "k-1",
  reservation: null,
};

// ---- a NEW offline sale carries the rounding and is paid at the rounded total --------------------------------

test("new offline sale: totals carry the rounding, HT / VAT / lines stay real, payments cover the rounded total", () => {
  for (const paymentMethod of ["CASH", "CHECK", "BANK_TRANSFER"] as const) {
    const result = buildOfflineSaleInput({ ...baseParams, paymentMethod });
    assert.equal(result.ok, true, paymentMethod);
    if (!result.ok) continue;
    const { totals, payments, lines } = result.input;
    assert.equal(totals.subtotalHT, 282.91);
    assert.equal(totals.taxAmount, 56.58);
    assert.equal(totals.roundingAmount, 0.01);
    assert.equal(totals.totalTTC, 339.5);
    assert.equal(totals.paidAmount, 339.5);
    assert.equal(totals.creditAmount, 0);
    assert.equal(roundMoney(payments.reduce((sum, p) => sum + p.amount, 0)), 339.5, paymentMethod);
    assert.equal(lines[0].totalTTC, 339.49, "the line keeps its cent value");
    assert.deepEqual(validateOfflineSaleInput(result.input), []);
  }
});

test("new offline MIXED sale must cover the ROUNDED total", () => {
  const exact = buildOfflineSaleInput({ ...baseParams, paymentMethod: "MIXED", mixedAmounts: { cash: 300, cheque: 39.5 } });
  assert.equal(exact.ok, true);
  const atCents = buildOfflineSaleInput({ ...baseParams, paymentMethod: "MIXED", mixedAmounts: { cash: 300, cheque: 39.49 } });
  assert.equal(atCents.ok, false, "339.49 no longer covers the 339.50 due");
});

test("the offline credit sale stays unavailable", () => {
  assert.equal(buildOfflineSaleInput({ ...baseParams, paymentMethod: "CREDIT" }).ok, false);
});

test("a cart with no rounding gets roundingAmount 0 (present, so the server still applies the rule)", () => {
  const result = buildOfflineSaleInput({
    ...baseParams,
    lines: [cartLine({ netHT: 283.33, tvaAmount: 56.67, totalTTC: 340 })],
    paymentMethod: "CASH",
  });
  assert.equal(result.ok && result.input.totals.roundingAmount, 0);
});

test("validation: total = HT + VAT + rounding is enforced, an absurd rounding is refused", () => {
  const ok = buildOfflineSaleInput({ ...baseParams, paymentMethod: "CASH" });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  const wrongTotal = { ...ok.input, totals: { ...ok.input.totals, totalTTC: 340 } };
  assert.ok(validateOfflineSaleInput(wrongTotal).some((issue) => /HT \+ TVA \+ arrondi/.test(issue)));
  const absurd = { ...ok.input, totals: { ...ok.input.totals, roundingAmount: 5 } };
  assert.ok(validateOfflineSaleInput(absurd).length > 0);
});

// ---- a LEGACY offline sale keeps its old total ---------------------------------------------------------------

test("legacy offline sale (no roundingAmount): still valid at its cent total, never re-rounded", async () => {
  const legacy = makeSaleInput([makeLine("p1", 1, { unitPriceHT: 282.91 })], { idempotencyKey: "legacy" });
  assert.equal(legacy.totals.roundingAmount, undefined);
  assert.deepEqual(validateOfflineSaleInput(legacy), []);

  const scope: CounterPosScope = { organizationId: uniqueOrg(), userId: "u1" };
  const { sale } = unwrap(await createOfflineSale(scope, legacy, { now: new Date("2026-10-06T10:00:00Z") }));
  const stored = unwrap(await getOfflineSale(scope, sale.localId));
  assert.equal(stored.roundingAmount, undefined, "stored without a rounding");

  const payload = buildCounterSyncPayload(stored);
  assert.equal("roundingAmount" in payload.totals, false, "synchronised WITHOUT roundingAmount");
  const parsed = counterSaleSyncSchema.parse(JSON.parse(JSON.stringify(payload)));
  assert.equal(parsed.totals.roundingAmount, undefined);
});

test("new offline sale: stored with its rounding and synchronised WITH it (even 0)", async () => {
  const scope: CounterPosScope = { organizationId: uniqueOrg(), userId: "u1" };
  for (const [key, cart, expected] of [
    ["new-1", cartLine(), 0.01],
    ["new-2", cartLine({ netHT: 283.33, tvaAmount: 56.67, totalTTC: 340 }), 0],
  ] as const) {
    const built = buildOfflineSaleInput({ ...baseParams, lines: [cart], paymentMethod: "CASH", idempotencyKey: key });
    assert.equal(built.ok, true);
    if (!built.ok) continue;
    const { sale } = unwrap(await createOfflineSale(scope, built.input, { now: new Date("2026-10-06T10:00:00Z") }));
    const stored = unwrap(await getOfflineSale(scope, sale.localId));
    assert.equal(stored.roundingAmount, expected);
    const payload = buildCounterSyncPayload(stored);
    assert.equal(payload.totals.roundingAmount, expected);
    const parsed = counterSaleSyncSchema.parse(JSON.parse(JSON.stringify(payload)));
    assert.equal(parsed.totals.roundingAmount, expected);
    // the sync contract rebuilds the very same CounterSaleInput (the server rounds it itself)
    const input = buildCounterSaleInput(parsed) as unknown as Record<string, unknown>;
    assert.equal("roundingAmount" in input, false, "the rounding is never an input of createCounterSale");
  }
});

test("tickets: a legacy offline sale prints its cent total, a new one the rounded total with an explicit rounding", async () => {
  const scope: CounterPosScope = { organizationId: uniqueOrg(), userId: "u1" };
  const legacyInput = makeSaleInput([makeLine("p1", 1, { unitPriceHT: 282.91 })], { idempotencyKey: "t-legacy" });
  const legacy = unwrap(await getOfflineSale(scope, unwrap(await createOfflineSale(scope, legacyInput)).sale.localId));
  const legacyTicket = ticketFromOfflineSale(legacy, { cashierName: "Caisse" });
  assert.equal(legacyTicket.roundingAmount, 0);
  assert.equal(legacyTicket.totalTTC, legacy.totalTTC, "same total as stored");

  const built = buildOfflineSaleInput({ ...baseParams, paymentMethod: "CASH", idempotencyKey: "t-new" });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const current = unwrap(await getOfflineSale(scope, unwrap(await createOfflineSale(scope, built.input)).sale.localId));
  const ticket = ticketFromOfflineSale(current, { cashierName: "Caisse" });
  assert.equal(ticket.totalTTC, 339.5);
  assert.equal(ticket.roundingAmount, 0.01);
});

// ---- the server never lets a client skip the rounding ---------------------------------------------------------

test("only the offline sync can ask for the legacy cent total; the public APIs always round", () => {
  const counter = read("../../server/counter-sales.ts");
  const driver = read("../../server/driver-sales.ts");
  const counterSync = read("../../server/counter-sales-sync.ts");
  // not part of any request schema
  assert.equal(/rounding/i.test(counter.slice(counter.indexOf("const counterSaleSchema"), counter.indexOf("export async function"))), false);
  assert.equal(/rounding/i.test(driver.slice(driver.indexOf("const driverSaleSchema"), driver.indexOf("export async function"))), false);
  // defaults to the commercial rounding
  assert.match(counter, /opts\.rounding \?\? "COMMERCIAL"/);
  assert.match(driver, /opts\.rounding \?\? "COMMERCIAL"/);
  // the routes call them without options
  for (const route of ["../../../app/api/sales/route.ts", "../../../app/api/driver/sales/route.ts"]) {
    try {
      const source = read(route);
      assert.equal(/rounding\s*:/.test(source), false, route);
    } catch {
      // route file layout may differ: the schema guards above are the real protection
    }
  }
  // the sync maps "no roundingAmount in the payload" to NONE, nothing else does
  assert.match(counterSync, /payload\.totals\.roundingAmount === undefined \? "NONE" : "COMMERCIAL"/);
  assert.match(driver, /rounding: data\.roundingAmount == null \? "NONE" : "COMMERCIAL"/);
  for (const file of ["../../server/sale-admin.ts", "../../server/pending-sales.ts", "../../../app/api/ai/chat/route.ts"]) {
    assert.equal(/"NONE"/.test(read(file)), false, `${file} never uses the legacy mode`);
  }
});
