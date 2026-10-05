import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const count = (source: string, pattern: RegExp) => (source.match(pattern) ?? []).length;

const counter = read("./server/counter-sales.ts");
const driver = read("./server/driver-sales.ts");
const admin = read("./server/sale-admin.ts");
const pending = read("./server/pending-sales.ts");
const accounting = read("./server/accounting.ts");
const creditNotes = read("./server/credit-notes.ts");

// ---- migration and schema ------------------------------------------------------------------------------

test("migration: ONE additive file, two NOT NULL DEFAULT 0 columns, nothing else touched", () => {
  const folder = "../prisma/migrations/20261006100000_add_rounding_amount_to_sale_and_credit_note/migration.sql";
  const sql = read(folder);
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--") && line.trim() !== "")
    .join("\n");
  assert.match(statements, /ALTER TABLE "Sale" ADD COLUMN "roundingAmount" DECIMAL\(12,2\) NOT NULL DEFAULT 0;/);
  assert.match(statements, /ALTER TABLE "CreditNote" ADD COLUMN "roundingAmount" DECIMAL\(12,2\) NOT NULL DEFAULT 0;/);
  assert.equal(count(statements, /ALTER TABLE/g), 2);
  assert.equal(/UPDATE |DELETE |DROP |INSERT |CREATE |TRUNCATE/i.test(statements), false);
});

test("schema: Sale and CreditNote get a Decimal(12,2) roundingAmount defaulting to 0, no other column changed", () => {
  const schema = read("../prisma/schema.prisma");
  const sale = schema.slice(schema.indexOf("model Sale {"), schema.indexOf("model Sale {") + 6000);
  assert.match(sale, /roundingAmount\s+Decimal\s+@default\(0\) @db\.Decimal\(12, 2\)/);
  const note = schema.slice(schema.indexOf("model CreditNote {"), schema.indexOf("model CreditNote {") + 6000);
  assert.match(note, /roundingAmount\s+Decimal\s+@default\(0\) @db\.Decimal\(12, 2\)/);
});

// ---- sales: one shared computation, HT / VAT / lines untouched --------------------------------------------

test("counter, driver and revision compute the totals with the ONE shared function", () => {
  for (const [name, source] of [["counter", counter], ["driver", driver], ["revision", admin]] as const) {
    assert.match(source, /computeSaleTotals\(computedLines/, name);
    // the old inline total (HT + VAT, no rounding) is gone
    assert.equal(/const totalTTC = roundMoney\(subtotalHT \+ taxAmount\);/.test(source), false, name);
    assert.match(source, /roundingAmount,\s*\n\s*stampAmount/, `${name}: stored / sent to accounting`);
  }
  assert.equal(count(counter, /roundingAmount,/g) >= 3, true);
});

test("the final (rounded) total drives the stamp, the payments and the credit - on every payment method", () => {
  for (const [name, source] of [["counter", counter], ["driver", driver]] as const) {
    assert.match(source, /computeCashSaleStampAmount\(tx, \{[\s\S]*?totalTTC,/, `${name} stamp`);
    assert.match(source, /resolvePaymentAmounts\(parsed\.data\.paymentMethod, totalTTC, parsed\.data\.paidAmount\)/, name);
    assert.match(source, /payment\.creditAmount === totalTTC/, `${name}: CREDIT status from the final total`);
  }
  assert.match(counter, /resolveMixedPaymentSplit\(totalTTC, parsed\.data\.cashAmount, parsed\.data\.chequeAmount\)/);
  assert.match(admin, /resolveMixedPaymentSplit\(totalTTC, data\.cashAmount, data\.chequeAmount\)/);
});

test("HT and VAT are written as the line sums (never adjusted to absorb the rounding)", () => {
  for (const source of [counter, driver, admin]) {
    // subtotalHT / taxAmount come out of computeSaleTotals and go straight to the sale row
    assert.match(source, /subtotalHT,\s*\n\s*discountAmount,\s*\n\s*taxAmount,\s*\n\s*totalTTC,\s*\n\s*roundingAmount,/);
  }
});

test("a pending sale is collected at the amounts stored when it was prepared (old ones stay at cents)", () => {
  assert.match(pending, /roundingAmount: true,/);
  assert.match(pending, /roundingAmount: sale\.roundingAmount\.toNumber\(\)/);
  assert.match(pending, /const totalTTC = sale\.totalTTC\.toNumber\(\);/);
  assert.equal(/computeSaleTotals/.test(pending), false, "no recomputation at collection");
});

test("revision: new rule on a real revision only, contre-passation of the old entry, balanced new entry, audit trail", () => {
  assert.match(admin, /computeSaleTotals\(computedLines, "COMMERCIAL"\)/);
  const revise = admin.slice(admin.indexOf("export async function reviseSale"));
  assert.match(revise, /reverseAccountingEntryForSource\(tx, \{[\s\S]*?sourceType: "SALE"/);
  assert.match(revise, /postSaleAccountingEntry\(tx, \{[\s\S]*?roundingAmount,/);
  // the audit trail records the before / after of the amounts
  assert.match(revise, /roundingAmount: sale\.roundingAmount\.toNumber\(\)/);
  assert.match(revise, /totalBeforeRounding,\s*\n\s*roundingAmount,\s*\n\s*totalTTC,/);
  // reading / opening an old sale never goes through this path: only reviseSale recomputes
  assert.equal(count(admin, /computeSaleTotals\(/g), 1);
  assert.match(admin, /refuse|credit note|avoir/i, "the refusal when a validated credit note exists is unchanged");
});

// ---- accounting ------------------------------------------------------------------------------------------

test("accounting: the invoice entry is built by the pure builder, rounding accounts resolved only for a non-zero rounding", () => {
  assert.match(accounting, /lines: buildSaleInvoiceEntryLines\(\{/);
  assert.match(accounting, /roundingAmount: roundingAmount\.toNumber\(\)/);
  const resolver = accounting.slice(
    accounting.indexOf("async function resolveRoundingAccountIds"),
    accounting.indexOf("async function requireSystemAccountIdByCode"),
  );
  assert.match(resolver, /roundingAmount\.gt\(0\)/);
  assert.match(resolver, /roundingAmount\.lt\(0\)/);
  assert.match(resolver, /return \{ gain: null, loss: null \};/, "zero rounding: nothing resolved, nothing created");
});

test("accounting: rounding accounts are created on first use but never reused with another type", () => {
  const fn = accounting.slice(
    accounting.indexOf("async function requireSalesRoundingAccountId"),
    accounting.indexOf("async function resolveRoundingAccountIds"),
  );
  assert.match(fn, /ensureAccountingAccountByCode\(db, organizationId, \{/);
  assert.match(fn, /account\.type !== spec\.type/);
  assert.match(fn, /409/);
  assert.match(fn, /est inactif/);
  // codes live in ONE place
  assert.match(accounting, /salesRoundingAccounts\[role\]/);
  assert.equal(/"6188"|"7188"/.test(accounting), false, "no code written in the accounting service");
});

test("accounting: the customer credit note posts the inverse rounding, supplier notes are untouched", () => {
  assert.equal(count(accounting, /buildCustomerCreditNoteEntryLines\(\{/g), 2, "cash and non-cash branches");
  const supplier = accounting.slice(accounting.indexOf('if (payload.partyType === "SUPPLIER")'), accounting.indexOf("const roundingAmount = toMoneyDecimal(payload.roundingAmount"));
  assert.equal(/rounding/i.test(supplier), false);
});

// ---- credit notes ----------------------------------------------------------------------------------------

test("credit notes: the share is computed on create, draft, driver return AND at validation", () => {
  assert.equal(count(creditNotes, /roundingAmount,\s*\n\s*\} = await resolveReturnLines\(tx, \{/g), 2, "manual (draft / create) + driver");
  assert.equal(count(creditNotes, /withRoundingShare\(computeTotals\(persistedLines\), roundingAmount\)/g), 2);
  const validate = creditNotes.slice(creditNotes.indexOf("export async function validateCreditNote"), creditNotes.indexOf("export async function reverseCreditNote"));
  assert.match(validate, /computeCustomerCreditNoteRounding\(/);
  assert.match(validate, /addMoney\(linesTotalTTC, roundingAmount\)/);
  assert.match(validate, /roundingAmount: updated\.roundingAmount/);
  assert.match(validate, /isolationLevel: "Serializable"/);
});

test("credit notes: validated notes only count, the 409 ceiling is enforced, legacy sales behave as before", () => {
  const helper = creditNotes.slice(
    creditNotes.indexOf("async function computeCustomerCreditNoteRounding"),
    creditNotes.indexOf("/** The note's totals with the rounding share"),
  );
  assert.match(helper, /roundingAmount: \{ not: 0 \}/, "a sale without rounding is not even looked at");
  assert.match(helper, /creditNote: \{ status: "VALIDATED" \}/, "same filter as the returnable-quantity guard");
  assert.match(helper, /creditNoteExceedsSaleTotal\(/);
  assert.match(helper, /Le remboursement depasse le montant de la vente d'origine\./);
  assert.match(helper, /409/);
  assert.match(helper, /if \(sales\.length === 0\) return 0;/);
});

test("credit notes: only customer notes linked to a sale carry a share; supplier / free returns do not", () => {
  assert.match(creditNotes, /params\.partyType === "CUSTOMER" && anyLinked/);
  assert.match(creditNotes, /existing\.partyType === "CUSTOMER"\s*\n\s*\? await computeCustomerCreditNoteRounding/);
});

test("credit notes: the DTO and the cart preview expose the stored amounts", () => {
  assert.match(creditNotes, /totalTTC: note\.totalTTC\.toNumber\(\),\s*\n\s*roundingAmount: note\.roundingAmount\.toNumber\(\),/);
  assert.match(creditNotes, /\.\.\.\(saleRounding \? \{ saleRounding \} : \{\}\)/);
  assert.match(creditNotes, /sale\.roundingAmount\.toNumber\(\) !== 0/, "origins only carry the data for a rounded sale");
  assert.match(read("../components/credit-notes/credit-note-pos-view.tsx"), /creditNoteRoundingShareForSales\(/);
});

test("the three accounting posts of a credit note forward the share", () => {
  assert.equal(count(creditNotes, /roundingAmount: (note|updated)\.roundingAmount,/g), 3);
});

// ---- offline (driver) -----------------------------------------------------------------------------------

test("driver offline: SQLite column added by an additive migration, NULL = legacy sale", () => {
  const schema = read("./offline/driver-pos/schema.ts");
  assert.match(schema, /version: 7,\s*\n\s*statements: \[\s*\n\s*`ALTER TABLE offline_sales ADD COLUMN roundingAmount REAL`/);
  const store = read("./offline/driver-pos/sales-store.ts");
  assert.match(store, /input\.roundingAmount \?\? null/);
  assert.match(store, /row\.roundingAmount === null \|\| row\.roundingAmount === undefined/);
  assert.match(store, /"roundingAmount", "syncAttempts", "lastSyncError"/);
});

test("driver offline sync: the body carries roundingAmount only for a sale made with the rounding", async () => {
  const { buildSyncPayload } = await import("@/lib/offline/driver-pos/sync-payload");
  const base = {
    localId: "l1",
    clientMutationId: "m1",
    localReference: "OFF-1",
    soldAt: "2026-10-06T10:00:00.000Z",
    customerId: null,
    paymentMethod: "CASH",
    totalTTC: 340,
    lines: [
      {
        productId: "p1",
        productNameSnapshot: "P",
        quantity: 20,
        unitPriceSnapshot: 18,
        taxRateSnapshot: 20,
        discountSnapshot: 5.56,
        totalHT: 283.33,
        taxAmount: 56.67,
        totalTTC: 340,
        priceToken: null,
      },
    ],
  };
  const legacy = buildSyncPayload(base as never);
  assert.equal(legacy.ok && "roundingAmount" in legacy.body, false);
  const current = buildSyncPayload({ ...base, roundingAmount: 0 } as never);
  assert.equal(current.ok && current.body.roundingAmount, 0);
  const rounded = buildSyncPayload({ ...base, roundingAmount: 0.25 } as never);
  assert.equal(rounded.ok && rounded.body.roundingAmount, 0.25);
});

// ---- carts and documents -----------------------------------------------------------------------------

test("carts: both POS feed the amount due with the rounded total and show the rounding", () => {
  const pos = read("../components/pos/pos-layout.tsx");
  assert.match(pos, /computeSaleTotals\(\s*\n\s*cartLines\.map/);
  assert.match(pos, /netAPayer: totalTTC,/);
  assert.match(pos, /openPendingSale\s*\n\s*\? \{/, "a pending sale keeps its stored amounts");
  const driverCart = read("../components/driver-pos/driver-pos-view.tsx");
  assert.match(driverCart, /applyCommercialRounding\(\s*\n\s*cartRows\.reduce/);
  assert.match(driverCart, /roundingAmount: totals\.roundingAmount,/);
  const summary = read("../components/pos/cart-summary.tsx");
  assert.match(summary, /Total avant arrondi/);
  assert.match(summary, /roundingAmount !== 0/);
});

test("documents show an 'Arrondi' line only when the sale has one", () => {
  const checks: Array<[string, RegExp]> = [
    ["../components/pos/receipt-print.tsx", /\(sale\.roundingAmount \?\? 0\) !== 0/],
    ["./escpos-receipt.ts", /if \(rounding !== 0\)/],
    ["./invoice-pdf.ts", /if \(roundingAmount !== 0\)/],
    ["./whatsapp-invoice.ts", /\(sale\.roundingAmount \?\? 0\) !== 0/],
    ["../components/ventes/invoice-detail-dialog.tsx", /\(sale\.roundingAmount \?\? 0\) !== 0/],
    ["../components/ventes/invoice-detail-inline.tsx", /\(sale\.roundingAmount \?\? 0\) !== 0/],
    ["../components/credit-notes/credit-note-summary.tsx", /roundingAmount !== 0/],
    ["../components/credit-notes/credit-note-detail-view.tsx", /roundingAmount !== 0/],
  ];
  for (const [file, pattern] of checks) assert.match(read(file), pattern, file);
});

test("unit prices and lines are not rounded to 0.50 anywhere: only the sale total is", () => {
  const rounding = read("./sale-rounding.ts");
  assert.equal(/roundToHalfDirham/.test(read("./pos-discount.ts")), false);
  assert.equal(/roundToHalfDirham/.test(read("./driver-line-totals.ts")), false);
  assert.equal(/roundToHalfDirham/.test(read("./receipt-line-price.ts")), false);
  assert.match(rounding, /Unit prices|only the total to pay is rounded/i);
});
