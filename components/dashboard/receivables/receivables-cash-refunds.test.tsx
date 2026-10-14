import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CustomerReceivableDetailBody } from "@/components/dashboard/receivables/receivables-customer-detail";
import { methodLabel, refundMethodLabel } from "@/components/dashboard/receivables/receivables-format";
import { ReceivablesContent } from "@/components/dashboard/receivables/receivables-section";
import type { CustomerReceivableDetailDto, ReceivablesOverviewDto } from "@/types/receivables";

/**
 * Lot 2 - labels and counters of « Créances clients » for the cash refunds that no longer reduce
 * the debt (once the cutover is active), and proof that nothing changes while it is dormant.
 */

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const noop = () => undefined;

function overview(dataNotes: ReceivablesOverviewDto["dataNotes"]): ReceivablesOverviewDto {
  return {
    asOfDay: "2026-11-10",
    settings: { overdueDays: 30, isDefault: true },
    totals: { totalOutstanding: 500, debtorCount: 1, overdue: 0, over30: 0 },
    buckets: [
      { key: "0-30", amount: 500, customerCount: 1 },
      { key: "31-60", amount: 0, customerCount: 0 },
      { key: "61-90", amount: 0, customerCount: 0 },
      { key: "90+", amount: 0, customerCount: 0 },
    ],
    debtors: [
      {
        customerId: "c1", name: "Épicerie Atlas", code: "CLI-0001", accountCode: "34211", status: "ACTIVE", balance: 500, overdue: 0, over30: 0,
        buckets: { "0-30": 500, "31-60": 0, "61-90": 0, "90+": 0 }, oldestOpenAgeDays: 9, lastSettlementDay: null, cashCreditNotesTotal: 0,
      },
    ],
    debtorsTruncated: false,
    creditors: { count: 0, total: 0, rows: [] },
    dataNotes,
  };
}
const renderOverview = (dataNotes: ReceivablesOverviewDto["dataNotes"]) =>
  renderToStaticMarkup(<ReceivablesContent data={overview(dataNotes)} loading={false} onRetry={noop} onOpenCustomer={noop} onSettingsSaved={noop} />);

function detail(overrides: Partial<CustomerReceivableDetailDto> = {}): CustomerReceivableDetailDto {
  return {
    asOfDay: "2026-11-10",
    settings: { overdueDays: 30, isDefault: true },
    customer: { id: "c1", name: "Épicerie Atlas", code: "CLI-0001", accountCode: "34211", status: "ACTIVE" },
    debt: { creditSalesTotal: 500, creditNotesTotal: 0, settlementsTotal: 0, debt: 500 },
    rawBalance: 500,
    movements: [
      { id: "sale:1", kind: "CREDIT_SALE", day: "2026-10-01", reference: "1/2026", label: "Vente à crédit 1/2026", amount: 500, balance: 500, sale: { totalTTC: 500, paidAtSale: 0, status: "CREDIT", openEstimate: 500, ageDays: 40 } },
      {
        id: "note:1", kind: "CREDIT_NOTE", day: "2026-11-03", reference: "AVC-1", label: "Remboursement espèces AVC-1", amount: 0, balance: 500,
        creditNote: { refundMethod: "CASH", originalSaleReference: null, originalSaleStatus: null, notDeductedFromDebt: { faceAmount: 100 } },
      },
    ],
    movementsTruncated: false,
    reconciled: true,
    aging: { overdue: 500, over30: 500, buckets: { "0-30": 0, "31-60": 500, "61-90": 0, "90+": 0 } },
    cashCreditNotes: { count: 0, total: 0 },
    cashRefundsNotDeducted: { count: 1, total: 100 },
    excluded: { draftOrCancelledSales: 0, nonValidatedCreditNotes: 0, cancelledSettlements: 0 },
    ...overrides,
  };
}

test("detail (active): the cash refund that does not reduce the debt has its own badge, says « sans effet sur la dette », moves nothing, and the figure is labelled « Avoirs déduits »", () => {
  const markup = renderToStaticMarkup(<CustomerReceivableDetailBody detail={detail()} />);
  const content = text(markup);
  assert.match(markup, /data-cash-refund-not-deducted/);
  assert.equal(/data-cash-note/.test(markup), false, "it is not the amber « Avoir espèces » of a deducted note");
  assert.match(content, /Remboursement espèces/);
  assert.match(content, /Remboursement en espèces de 100,00 DH · sans effet sur la dette · sans vente d'origine/);
  assert.match(content, /Avoirs déduits/);
  assert.equal(/Avoirs validés/.test(content), false);
  // the note: counted, amount, and the plain meaning
  assert.match(markup, /data-note="cash-refunds-not-deducted"/);
  assert.match(content, /1 remboursement en espèces \(100,00 DH\) n'est pas déduit du solde : l'argent est sorti de la caisse, la dette du client est inchangée\./);
  // the movement is listed with no debit and no credit, and the running balance is unchanged (500 → 500)
  const row = markup.slice(markup.indexOf('data-kind="CREDIT_NOTE"'));
  assert.equal(/<td[^>]*>\s*100,00 DH/.test(row.slice(0, row.indexOf("</tr>"))), false, "no 100,00 in the debit / credit columns");
  assert.match(text(row.slice(0, row.indexOf("</tr>"))), /500,00 DH$/);
});

test("detail (active): several refunds are counted in the plural; a deducted historical cash note keeps the amber « Avoir espèces » and its own note", () => {
  const plural = renderToStaticMarkup(<CustomerReceivableDetailBody detail={detail({ cashRefundsNotDeducted: { count: 3, total: 250 } })} />);
  assert.match(text(plural), /3 remboursements en espèces \(250,00 DH\) ne sont pas déduits du solde/);

  const mixed = renderToStaticMarkup(
    <CustomerReceivableDetailBody
      detail={detail({
        debt: { creditSalesTotal: 500, creditNotesTotal: 50, settlementsTotal: 0, debt: 450 },
        rawBalance: 450,
        cashCreditNotes: { count: 1, total: 50 },
        movements: [
          { id: "sale:1", kind: "CREDIT_SALE", day: "2026-10-01", reference: "1/2026", label: "Vente à crédit 1/2026", amount: 500, balance: 500, sale: { totalTTC: 500, paidAtSale: 0, status: "CREDIT", openEstimate: 450, ageDays: 40 } },
          { id: "note:old", kind: "CREDIT_NOTE", day: "2026-10-04", reference: "AVC-0", label: "Avoir AVC-0", amount: -50, balance: 450, creditNote: { refundMethod: "CASH", originalSaleReference: null, originalSaleStatus: null } },
        ],
      })}
    />,
  );
  assert.match(mixed, /data-cash-note/, "the historical cash note is still flagged as before");
  assert.equal(/data-cash-refund-not-deducted/.test(mixed), false);
  assert.match(text(mixed), /1 avoir enregistré « remboursé en espèces » \(50,00 DH\) est déduit du solde par le calcul actuel/);
  assert.match(text(mixed), /Avoirs déduits/);
});

test("detail (dormant): no new field - the historical wording is unchanged, no new badge, no new note", () => {
  const dormant = renderToStaticMarkup(
    <CustomerReceivableDetailBody
      detail={detail({
        cashRefundsNotDeducted: undefined,
        debt: { creditSalesTotal: 500, creditNotesTotal: 100, settlementsTotal: 0, debt: 400 },
        rawBalance: 400,
        cashCreditNotes: { count: 1, total: 100 },
        movements: [
          { id: "sale:1", kind: "CREDIT_SALE", day: "2026-10-01", reference: "1/2026", label: "Vente à crédit 1/2026", amount: 500, balance: 500, sale: { totalTTC: 500, paidAtSale: 0, status: "CREDIT", openEstimate: 400, ageDays: 40 } },
          { id: "note:1", kind: "CREDIT_NOTE", day: "2026-11-03", reference: "AVC-1", label: "Avoir AVC-1", amount: -100, balance: 400, creditNote: { refundMethod: "CASH", originalSaleReference: null, originalSaleStatus: null } },
        ],
      })}
    />,
  );
  const content = text(dormant);
  assert.match(content, /Avoirs validés/);
  assert.equal(/Avoirs déduits/.test(content), false);
  assert.equal(/data-cash-refund-not-deducted|data-note="cash-refunds-not-deducted"/.test(dormant), false);
  assert.match(dormant, /data-cash-note/);
  assert.match(content, /Remboursement enregistré : Espèces · sans vente d'origine/);
});

test("overview (active): the counter of refunds the formula leaves out, singular and plural, in its own note; the historical counter is untouched", () => {
  const one = renderOverview({ cashCreditNotes: { count: 0, total: 0 }, cashRefundsNotDeducted: { count: 1, total: 100 }, agingMismatchCount: 0 });
  assert.match(one, /data-note="cash-refunds-not-deducted"/);
  assert.match(text(one), /1 remboursement en espèces \(100,00 DH\) n'est pas déduit des soldes : ils sortent de la caisse sans réduire la dette des clients\./);
  assert.equal(/data-note="cash-credit-notes"/.test(one), false, "no historical cash note to announce");

  const both = renderOverview({ cashCreditNotes: { count: 2, total: 170 }, cashRefundsNotDeducted: { count: 3, total: 250 }, agingMismatchCount: 0 });
  assert.match(text(both), /3 remboursements en espèces \(250,00 DH\) ne sont pas déduits des soldes/);
  assert.match(text(both), /2 avoirs clients validés, enregistrés « remboursé en espèces » \(170,00 DH\), sont déduits des soldes par le calcul actuel/);
  assert.match(both, /data-note="cash-credit-notes"/);
});

test("overview: a zero counter shows nothing; dormant (field absent) shows exactly the historical notes", () => {
  const zero = renderOverview({ cashCreditNotes: { count: 0, total: 0 }, cashRefundsNotDeducted: { count: 0, total: 0 }, agingMismatchCount: 0 });
  assert.equal(/data-note="cash-refunds-not-deducted"/.test(zero), false);
  assert.equal(/data-note="cash-credit-notes"/.test(zero), false);

  const dormant = renderOverview({ cashCreditNotes: { count: 1, total: 100 }, agingMismatchCount: 0 });
  assert.equal(/data-note="cash-refunds-not-deducted"/.test(dormant), false);
  assert.match(dormant, /data-note="cash-credit-notes"/);
  assert.match(text(dormant), /1 avoir client validé, enregistré « remboursé en espèces » \(100,00 DH\), est déduit des soldes par le calcul actuel/);
});

// ---- the label of an account credit (BANK): « Avoir sur compte client », never « Banque » ------------------------------------

function bankNoteDetail(overrides: Partial<CustomerReceivableDetailDto> = {}): CustomerReceivableDetailDto {
  return detail({
    debt: { creditSalesTotal: 500, creditNotesTotal: 40, settlementsTotal: 0, debt: 460 },
    rawBalance: 460,
    movements: [
      { id: "sale:1", kind: "CREDIT_SALE", day: "2026-10-01", reference: "1/2026", label: "Vente à crédit 1/2026", amount: 500, balance: 500, sale: { totalTTC: 500, paidAtSale: 0, status: "CREDIT", openEstimate: 460, ageDays: 40 } },
      { id: "note:bank", kind: "CREDIT_NOTE", day: "2026-11-04", reference: "AVC-2", label: "Avoir AVC-2", amount: -40, balance: 460, creditNote: { refundMethod: "BANK", originalSaleReference: "1/2026", originalSaleStatus: "CREDIT" } },
    ],
    cashRefundsNotDeducted: undefined,
    ...overrides,
  });
}

test("detail: an account credit (BANK) is presented as « Avoir sur compte client » - and the word « Banque » appears nowhere in the screen", () => {
  const markup = renderToStaticMarkup(<CustomerReceivableDetailBody detail={bankNoteDetail()} />);
  const content = text(markup);
  assert.match(content, /Avoir sur compte client · crédité sur le compte du client · sur la vente 1\/2026 \(À crédit\)/);
  assert.equal(/Banque/.test(content), false, "no « Banque » for an account credit");
  assert.equal(/Remboursement enregistré : Avoir sur compte/.test(content), false, "an account credit is not described as a refund");
  assert.equal(/data-cash-note|data-cash-refund-not-deducted/.test(markup), false, "it is neither a cash note nor a left-out refund");
  assert.match(content, /Avoir AVC-2/, "the movement keeps its label");
});

test("detail: the same label whether the rule is active or dormant, and a cash refund keeps its historical wording", () => {
  const active = renderToStaticMarkup(<CustomerReceivableDetailBody detail={bankNoteDetail({ cashRefundsNotDeducted: { count: 0, total: 0 } })} />);
  assert.match(text(active), /Avoir sur compte client · crédité sur le compte du client/);
  assert.equal(/Banque/.test(text(active)), false);
  const cash = renderToStaticMarkup(
    <CustomerReceivableDetailBody
      detail={detail({
        cashRefundsNotDeducted: undefined,
        cashCreditNotes: { count: 1, total: 50 },
        debt: { creditSalesTotal: 500, creditNotesTotal: 50, settlementsTotal: 0, debt: 450 },
        rawBalance: 450,
        movements: [
          { id: "sale:1", kind: "CREDIT_SALE", day: "2026-10-01", reference: "12/2026", label: "Vente à crédit 12/2026", amount: 500, balance: 500, sale: { totalTTC: 500, paidAtSale: 0, status: "CREDIT", openEstimate: 450, ageDays: 40 } },
          { id: "note:cash", kind: "CREDIT_NOTE", day: "2026-10-04", reference: "AVC-0", label: "Avoir AVC-0", amount: -50, balance: 450, creditNote: { refundMethod: "CASH", originalSaleReference: "12/2026", originalSaleStatus: "CREDIT" } },
        ],
      })}
    />,
  );
  assert.match(text(cash), /Remboursement enregistré : Espèces · sur la vente 12\/2026/);
});

test("labels: refundMethodLabel is the credit-note wording; methodLabel keeps the settlement methods and no longer maps BANK to « Banque »", () => {
  assert.equal(refundMethodLabel("BANK"), "Avoir sur compte client");
  assert.equal(refundMethodLabel("CASH"), "Espèces");
  assert.equal(methodLabel("CASH"), "Espèces");
  assert.equal(methodLabel("CHECK"), "Chèque");
  assert.equal(methodLabel("BANK_TRANSFER"), "Virement");
  assert.equal(methodLabel(null), "—");
  assert.notEqual(methodLabel("BANK"), "Banque");
});
