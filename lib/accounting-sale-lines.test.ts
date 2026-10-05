import assert from "node:assert/strict";
import { test } from "node:test";

import { salesRoundingAccounts } from "@/lib/accounting";
import {
  assertBalancedLines,
  buildCustomerCreditNoteEntryLines,
  buildSaleInvoiceEntryLines,
  type EntryLine,
  type RoundingAccountIds,
} from "@/lib/accounting-sale-lines";
import { roundMoney } from "@/lib/money";
import { applyCommercialRounding } from "@/lib/sale-rounding";

// The account ids are opaque here; the PROVISIONAL codes (to be confirmed by the
// accountant) are read from the one central constant, never written in this file.
const LOSS_ID = `acc-${salesRoundingAccounts.loss.code}`;
const GAIN_ID = `acc-${salesRoundingAccounts.gain.code}`;
const ROUNDING: RoundingAccountIds = { gain: GAIN_ID, loss: LOSS_ID };

const labels = {
  customer: "Achat facture num: F-1",
  revenue: "Ventes de marchandises",
  vat: "Etat TVA facturee",
  stampExpense: "Frais de timbre",
  stampPayable: "Timbre a payer",
  rounding: "Arrondi facture num: F-1",
};

const sum = (lines: EntryLine[], key: "debit" | "credit") =>
  roundMoney(lines.reduce((total, line) => total + line[key], 0));

function invoice(totalBeforeRounding: number, stampAmount = 0, vatRate = 20) {
  // HT / VAT real, total rounded: the real split of an amount "before rounding"
  const subtotalHT = roundMoney(totalBeforeRounding / (1 + vatRate / 100));
  const taxAmount = roundMoney(totalBeforeRounding - subtotalHT);
  const { totalTTC, roundingAmount } = applyCommercialRounding(totalBeforeRounding);
  const lines = buildSaleInvoiceEntryLines({
    totalTTC,
    subtotalHT,
    taxAmount,
    stampAmount,
    roundingAmount,
    accounts: {
      customer: "customer",
      sales: "sales",
      vat: "vat",
      stampExpense: stampAmount > 0 ? "stamp-expense" : null,
      stampPayable: stampAmount > 0 ? "stamp-payable" : null,
      rounding: ROUNDING,
    },
    labels,
  });
  return { lines, subtotalHT, taxAmount, totalTTC, roundingAmount };
}

const REQUIRED_TOTALS = [339.49, 339.5, 339.51, 339.74, 339.75, 339.98, 340.24, 340.25];

// ---- the invoice entry -------------------------------------------------------------------------------

test("the invoice entry is balanced for each required case, with and without stamp", () => {
  for (const total of REQUIRED_TOTALS) {
    for (const stamp of [0, 3.4]) {
      const { lines } = invoice(total, stamp);
      assert.equal(sum(lines, "debit"), sum(lines, "credit"), `${total} stamp ${stamp}`);
    }
  }
});

test("HT and VAT are posted at their REAL values: the rounding never absorbs into them", () => {
  const { lines, subtotalHT, taxAmount, totalTTC, roundingAmount } = invoice(339.49);
  assert.equal(lines.find((l) => l.accountId === "sales")?.credit, subtotalHT);
  assert.equal(lines.find((l) => l.accountId === "vat")?.credit, taxAmount);
  assert.equal(lines.find((l) => l.accountId === "customer")?.debit, totalTTC);
  assert.equal(totalTTC, 339.5);
  assert.equal(roundingAmount, 0.01);
  assert.equal(roundMoney(subtotalHT + taxAmount), 339.49, "HT + VAT = the total before rounding");
});

test("a rounding GAIN (customer pays more) credits the gain account, nothing else", () => {
  for (const total of [339.49, 339.75, 339.98, 340.25]) {
    const { lines, roundingAmount } = invoice(total);
    assert.ok(roundingAmount > 0);
    const rounding = lines.filter((l) => l.label === labels.rounding);
    assert.equal(rounding.length, 1);
    assert.deepEqual(rounding[0], { accountId: GAIN_ID, label: labels.rounding, debit: 0, credit: roundingAmount });
    assert.equal(lines.some((l) => l.accountId === LOSS_ID), false);
  }
});

test("a rounding LOSS (customer pays less) debits the loss account, nothing else", () => {
  for (const total of [339.51, 339.74, 340.24]) {
    const { lines, roundingAmount } = invoice(total);
    assert.ok(roundingAmount < 0);
    const rounding = lines.filter((l) => l.label === labels.rounding);
    assert.equal(rounding.length, 1);
    assert.deepEqual(rounding[0], {
      accountId: LOSS_ID,
      label: labels.rounding,
      debit: Math.abs(roundingAmount),
      credit: 0,
    });
    assert.equal(lines.some((l) => l.accountId === GAIN_ID), false);
  }
});

test("no rounding -> no rounding line: the entry is exactly the pre-rounding one (same lines, same order)", () => {
  const { lines } = invoice(340);
  assert.deepEqual(
    lines.map((l) => l.accountId),
    ["customer", "sales", "vat"],
  );
  const withStamp = invoice(340, 3.4).lines;
  assert.deepEqual(
    withStamp.map((l) => l.accountId),
    ["customer", "stamp-expense", "sales", "vat", "stamp-payable"],
  );
});

test("a sale without VAT still balances (no VAT line, only the rounding line)", () => {
  const { lines } = invoice(339.49, 0, 0);
  assert.equal(lines.some((l) => l.accountId === "vat"), false);
  assert.equal(sum(lines, "debit"), sum(lines, "credit"));
});

test("a single rounding account for both directions: the same id is debited or credited", () => {
  const single: RoundingAccountIds = { gain: "same", loss: "same" };
  const gainLines = buildSaleInvoiceEntryLines({
    totalTTC: 339.5,
    subtotalHT: 282.91,
    taxAmount: 56.58,
    stampAmount: 0,
    roundingAmount: 0.01,
    accounts: { customer: "c", sales: "s", vat: "v", stampExpense: null, stampPayable: null, rounding: single },
    labels,
  });
  const lossLines = buildSaleInvoiceEntryLines({
    totalTTC: 339.5,
    subtotalHT: 282.93,
    taxAmount: 56.58,
    stampAmount: 0,
    roundingAmount: -0.01,
    accounts: { customer: "c", sales: "s", vat: "v", stampExpense: null, stampPayable: null, rounding: single },
    labels,
  });
  assert.equal(gainLines.find((l) => l.accountId === "same")?.credit, 0.01);
  assert.equal(lossLines.find((l) => l.accountId === "same")?.debit, 0.01);
});

test("a missing rounding account is an error, never a silent unbalanced entry", () => {
  assert.throws(
    () =>
      buildSaleInvoiceEntryLines({
        totalTTC: 339.5,
        subtotalHT: 282.91,
        taxAmount: 56.58,
        stampAmount: 0,
        roundingAmount: 0.01,
        accounts: { customer: "c", sales: "s", vat: "v", stampExpense: null, stampPayable: null, rounding: { gain: null, loss: null } },
        labels,
      }),
    /Compte d'arrondi/,
  );
  assert.throws(() => assertBalancedLines([{ accountId: "a", label: "x", debit: 1, credit: 0 }]), /desequilibree/);
});

test("an inconsistent amount (total != HT + VAT + rounding) is refused by the balance check", () => {
  assert.throws(() =>
    buildSaleInvoiceEntryLines({
      totalTTC: 340,
      subtotalHT: 282.91,
      taxAmount: 56.58,
      stampAmount: 0,
      roundingAmount: 0.01,
      accounts: { customer: "c", sales: "s", vat: "v", stampExpense: null, stampPayable: null, rounding: ROUNDING },
      labels,
    }),
  );
});

// ---- customer credit notes ----------------------------------------------------------------------------

const noteLabels = {
  cash: "Avoir Client",
  customerReturn: "Retour client AC-1",
  vat: "TVA avoir client AC-1",
  customer: "Client AC-1",
  rounding: "Arrondi avoir num: AC-1",
};

function creditNote(refundMethod: "CASH" | "BANK", subtotalHT: number, taxAmount: number, share: number) {
  const totalTTC = roundMoney(subtotalHT + taxAmount + share);
  return buildCustomerCreditNoteEntryLines({
    refundMethod,
    subtotalHT,
    taxAmount,
    totalTTC,
    roundingAmount: share,
    accounts: {
      sales: "sales",
      transit: "transit",
      cash: "cash",
      customerReturn: "return",
      vat: "vat",
      customer: "customer",
      rounding: ROUNDING,
    },
    labels: noteLabels,
  });
}

test("customer credit note (non cash): balanced for a positive, negative or zero share", () => {
  for (const share of [0.25, 0.01, -0.24, -0.01, 0]) {
    const lines = creditNote("BANK", 282.91, 56.58, share);
    assert.equal(sum(lines, "debit"), sum(lines, "credit"), `share ${share}`);
    assert.equal(lines.find((l) => l.accountId === "customer")?.credit, roundMoney(282.91 + 56.58 + share));
  }
});

test("credit note (non cash): a positive share DEBITS the gain account, a negative share CREDITS the loss account", () => {
  const up = creditNote("BANK", 282.91, 56.58, 0.25);
  assert.deepEqual(up.find((l) => l.label === noteLabels.rounding), {
    accountId: GAIN_ID,
    label: noteLabels.rounding,
    debit: 0.25,
    credit: 0,
  });
  const down = creditNote("BANK", 282.91, 56.58, -0.24);
  assert.deepEqual(down.find((l) => l.label === noteLabels.rounding), {
    accountId: LOSS_ID,
    label: noteLabels.rounding,
    debit: 0,
    credit: 0.24,
  });
});

test("credit note (non cash): HT and VAT are the real returned values, untouched by the share", () => {
  const lines = creditNote("BANK", 282.91, 56.58, 0.25);
  assert.equal(lines.find((l) => l.accountId === "return")?.debit, 282.91);
  assert.equal(lines.find((l) => l.accountId === "vat")?.debit, 56.58);
});

test("credit note refunded in CASH keeps its 4-line structure and stays balanced with a share (both signs)", () => {
  for (const share of [0.25, -0.24, 0.01, 0]) {
    const lines = creditNote("CASH", 282.91, 56.58, share);
    assert.equal(sum(lines, "debit"), sum(lines, "credit"), `share ${share}`);
    const total = roundMoney(282.91 + 56.58 + share);
    // transit / cash lines unchanged: the gross amount of the note
    assert.deepEqual(
      lines.filter((l) => l.accountId === "transit" || l.accountId === "cash").map((l) => l.debit || l.credit),
      [total, total, total],
    );
    // only the first line is split: 7111 for the amount net of the share + one rounding line
    assert.equal(lines.find((l) => l.accountId === "sales")?.debit, roundMoney(total - share));
    assert.equal(lines.filter((l) => l.label === noteLabels.rounding).length, share === 0 ? 0 : 1);
  }
  const noShare = creditNote("CASH", 282.91, 56.58, 0);
  assert.equal(noShare.length, 4, "identical to the structure before the rounding");
});

test("a full cycle: sale (+0.25) then total return gives back exactly what was posted", () => {
  const sale = invoice(339.75);
  const note = creditNote("BANK", sale.subtotalHT, sale.taxAmount, sale.roundingAmount);
  // customer: debited by the sale (340.00), credited by the note (340.00) -> nothing left
  const saleCustomer = sale.lines.find((l) => l.accountId === "customer")!.debit;
  const noteCustomer = note.find((l) => l.accountId === "customer")!.credit;
  assert.equal(saleCustomer, noteCustomer);
  // rounding account: credited by the sale, debited by the note -> zero net
  const saleRounding = sale.lines.find((l) => l.accountId === GAIN_ID)!.credit;
  const noteRounding = note.find((l) => l.accountId === GAIN_ID)!.debit;
  assert.equal(saleRounding, noteRounding);
});

// ---- the provisional accounts ----------------------------------------------------------------------------

test("the provisional rounding accounts are one central constant, not in the bootstrap defaults", async () => {
  const { defaultAccountingAccounts, accountingSystemAccountCodes } = await import("@/lib/accounting");
  assert.ok(salesRoundingAccounts.loss.code && salesRoundingAccounts.gain.code);
  assert.equal(salesRoundingAccounts.loss.type, "EXPENSE");
  assert.equal(salesRoundingAccounts.gain.type, "REVENUE");
  const bootstrapCodes = defaultAccountingAccounts.map((account) => account.code);
  assert.equal(bootstrapCodes.includes(salesRoundingAccounts.loss.code), false, "not created at bootstrap");
  assert.equal(bootstrapCodes.includes(salesRoundingAccounts.gain.code), false, "not created at bootstrap");
  assert.equal((Object.values(accountingSystemAccountCodes) as string[]).includes("6588"), false);
  assert.notEqual(salesRoundingAccounts.loss.code, "6588", "6588 already is 'Frais de timbre' in the live chart");
  assert.notEqual(salesRoundingAccounts.gain.code, "6588");
});
