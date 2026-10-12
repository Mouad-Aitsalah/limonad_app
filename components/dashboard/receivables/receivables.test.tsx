import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CustomerReceivableDetailBody } from "@/components/dashboard/receivables/receivables-customer-detail";
import { ReceivablesContent, ReceivablesSection } from "@/components/dashboard/receivables/receivables-section";
import type { CustomerReceivableDetailDto, ReceivablesDebtorRow, ReceivablesOverviewDto } from "@/types/receivables";

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const noop = () => undefined;

const debtor = (overrides: Partial<ReceivablesDebtorRow>): ReceivablesDebtorRow => ({
  customerId: "c1",
  name: "Épicerie Atlas",
  code: "CLI-0001",
  accountCode: "34211",
  status: "ACTIVE",
  balance: 1500,
  overdue: 500,
  over30: 500,
  buckets: { "0-30": 1000, "31-60": 0, "61-90": 0, "90+": 500 },
  oldestOpenAgeDays: 95,
  lastSettlementDay: "2026-06-10",
  cashCreditNotesTotal: 0,
  ...overrides,
});

function overview(overrides: Partial<ReceivablesOverviewDto> = {}): ReceivablesOverviewDto {
  return {
    asOfDay: "2026-06-15",
    settings: { overdueDays: 45, isDefault: false },
    totals: { totalOutstanding: 2000, debtorCount: 2, overdue: 500, over30: 500 },
    buckets: [
      { key: "0-30", amount: 1500, customerCount: 2 },
      { key: "31-60", amount: 0, customerCount: 0 },
      { key: "61-90", amount: 0, customerCount: 0 },
      { key: "90+", amount: 500, customerCount: 1 },
    ],
    debtors: [debtor({}), debtor({ customerId: "c2", name: "Café Zahra", balance: 500, overdue: 0, over30: 0, buckets: { "0-30": 500, "31-60": 0, "61-90": 0, "90+": 0 }, oldestOpenAgeDays: 3, cashCreditNotesTotal: 40 })],
    debtorsTruncated: false,
    creditors: { count: 1, total: 30, rows: [{ customerId: "c3", name: "Boulangerie", code: "CLI-0003", accountCode: "34213", creditBalance: 30, cashCreditNotesTotal: 130, explainedByCashCreditNotes: true }] },
    dataNotes: { cashCreditNotes: { count: 2, total: 170 }, agingMismatchCount: 0 },
    ...overrides,
  };
}

test("loading state: a status, no figures yet (the section only asks the API once mounted)", () => {
  const markup = renderToStaticMarkup(<ReceivablesSection />);
  assert.match(markup, /role="status"/);
  assert.match(text(markup), /Créances clients/);
  assert.equal(/data-kpi=/.test(markup), false);
});

test("error state: the message and a retry button, no figures", () => {
  const markup = renderToStaticMarkup(
    <ReceivablesContent data={undefined} loading={false} error="Accès réservé aux administrateurs." onRetry={noop} onOpenCustomer={noop} onSettingsSaved={noop} />,
  );
  assert.match(markup, /role="alert"/);
  assert.match(text(markup), /Accès réservé aux administrateurs\. Réessayer/);
  assert.equal(/data-kpi=/.test(markup), false);
});

test("empty state: zero KPIs and an explicit message, no table, no chart", () => {
  const markup = renderToStaticMarkup(
    <ReceivablesContent
      data={overview({ totals: { totalOutstanding: 0, debtorCount: 0, overdue: 0, over30: 0 }, debtors: [], creditors: { count: 0, total: 0, rows: [] }, dataNotes: { cashCreditNotes: { count: 0, total: 0 }, agingMismatchCount: 0 } })}
      loading={false}
      onRetry={noop}
      onOpenCustomer={noop}
      onSettingsSaved={noop}
    />,
  );
  assert.match(text(markup), /Aucune créance client/);
  assert.equal(/data-table="receivables-debtors"/.test(markup), false);
  assert.equal(/data-chart="aging"/.test(markup), false);
  assert.match(markup, /data-kpi="receivables-total"/);
});

test("data: the four KPIs (overdue labelled with the configured delay), the estimate warning, the table, creditors and cash notes apart", () => {
  const markup = renderToStaticMarkup(<ReceivablesContent data={overview()} loading={false} onRetry={noop} onOpenCustomer={noop} onSettingsSaved={noop} />);
  const content = text(markup);
  for (const id of ["receivables-total", "receivables-debtors", "receivables-overdue", "receivables-over30"]) assert.match(markup, new RegExp(`data-kpi="${id}"`), id);
  assert.match(content, /Créances en retard \(> 45 j\)/);
  assert.match(content, /Créances de plus de 30 jours/);
  assert.match(content, /Délai de retard : 45 jours/);
  assert.equal(/par défaut/.test(content), false);
  // the aging is clearly presented as an estimate, not the accounting allocation
  assert.match(content, /Estimation FIFO/);
  assert.match(content, /Répartition estimative/);
  assert.match(content, /pas l'affectation comptable réelle/);
  for (const label of ["0 à 30 jours", "31 à 60 jours", "61 à 90 jours", "Plus de 90 jours"]) assert.match(content, new RegExp(label), label);
  // table rows
  assert.match(markup, /data-table="receivables-debtors"/);
  assert.match(content, /Épicerie Atlas/);
  assert.match(content, /Café Zahra/);
  assert.match(content, /Avoirs « espèces »/);
  // credit balances shown apart, cash-note warning
  assert.match(markup, /data-note="creditors"/);
  assert.match(content, /Soldes créditeurs : 1 client/);
  assert.match(content, /jamais déduits du total des créances/);
  assert.match(markup, /data-note="cash-credit-notes"/);
  // KPI tooltips present
  assert.match(markup, /title="Somme des soldes dus des clients/);
});

test("the default delay is labelled as such", () => {
  const markup = renderToStaticMarkup(
    <ReceivablesContent data={overview({ settings: { overdueDays: 30, isDefault: true } })} loading={false} onRetry={noop} onOpenCustomer={noop} onSettingsSaved={noop} />,
  );
  assert.match(text(markup), /Délai de retard : 30 jours \(par défaut\)/);
});

test("loading over previous data dims it instead of emptying the section", () => {
  const markup = renderToStaticMarkup(<ReceivablesContent data={overview()} loading onRetry={noop} onOpenCustomer={noop} onSettingsSaved={noop} />);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /data-kpi="receivables-total"/);
});

function detail(overrides: Partial<CustomerReceivableDetailDto> = {}): CustomerReceivableDetailDto {
  return {
    asOfDay: "2026-06-15",
    settings: { overdueDays: 30, isDefault: true },
    customer: { id: "c1", name: "Épicerie Atlas", code: "CLI-0001", accountCode: "34211", status: "ACTIVE" },
    debt: { creditSalesTotal: 1400, creditNotesTotal: 100, settlementsTotal: 250, debt: 1050 },
    rawBalance: 1050,
    movements: [
      { id: "sale:1", kind: "CREDIT_SALE", day: "2026-05-06", reference: "12/2026", label: "Vente à crédit 12/2026", amount: 1000, balance: 1000, sale: { totalTTC: 1200, paidAtSale: 200, status: "PARTIALLY_PAID", openEstimate: 650, ageDays: 40 } },
      { id: "note:1", kind: "CREDIT_NOTE", day: "2026-05-26", reference: "AV-1", label: "Avoir AV-1", amount: -100, balance: 900, creditNote: { refundMethod: "CASH", originalSaleReference: "12/2026", originalSaleStatus: "PARTIALLY_PAID" } },
      { id: "settlement:1", kind: "SETTLEMENT", day: "2026-06-12", reference: "REGL-000001", label: "Règlement REGL-000001", amount: -250, balance: 650, settlement: { method: "CASH", createdByName: "Admin" } },
      { id: "sale:2", kind: "CREDIT_SALE", day: "2026-06-10", reference: "15/2026", label: "Vente à crédit 15/2026", amount: 400, balance: 1050, sale: { totalTTC: 400, paidAtSale: 0, status: "CREDIT", openEstimate: 400, ageDays: 5 } },
    ],
    movementsTruncated: false,
    reconciled: true,
    aging: { overdue: 650, over30: 650, buckets: { "0-30": 400, "31-60": 650, "61-90": 0, "90+": 0 } },
    cashCreditNotes: { count: 1, total: 100 },
    excluded: { draftOrCancelledSales: 1, nonValidatedCreditNotes: 2, cancelledSettlements: 1 },
    ...overrides,
  };
}

test("customer detail: movements with running balance ending on the balance, CASH note flagged, exclusions, link to Règlements clients, read only", () => {
  const markup = renderToStaticMarkup(<CustomerReceivableDetailBody detail={detail()} />);
  const content = text(markup);
  assert.match(content, /Solde dû/);
  assert.match(markup, /data-table="receivable-movements"/);
  assert.equal((markup.match(/data-kind=/g) ?? []).length, 4);
  assert.match(markup, /data-cash-note/);
  assert.match(content, /Remboursement enregistré : Espèces · sur la vente 12\/2026/);
  assert.match(content, /payé à la vente 200,00/);
  assert.match(content, /reste estimé/);
  assert.match(markup, /data-excluded/);
  assert.match(content, /1 vente\(s\) en brouillon ou annulée\(s\), 2 avoir\(s\) non validé\(s\) ou annulé\(s\), 1 règlement\(s\) annulé\(s\)/);
  assert.match(markup, /href="\/comptabilite\/reglements-clients\?customerId=c1"/);
  assert.equal(/<button[^>]*>[^<]*(Encaisser|Annuler|Enregistrer)/.test(markup), false, "no write action in the detail");
  assert.equal(/role="alert"/.test(markup), false, "reconciled: no warning");
});

test("customer detail: an unreconciled history is announced, a credit balance is explained, an empty history says so", () => {
  const broken = renderToStaticMarkup(<CustomerReceivableDetailBody detail={detail({ reconciled: false })} />);
  assert.match(broken, /role="alert"/);
  assert.match(text(broken), /ne correspond pas au solde du client/);

  const credit = renderToStaticMarkup(
    <CustomerReceivableDetailBody detail={detail({ debt: { creditSalesTotal: 100, creditNotesTotal: 130, settlementsTotal: 0, debt: 0 }, rawBalance: -30 })} />,
  );
  assert.match(text(credit), /Solde créditeur/);
  assert.match(text(credit), /solde créditeur de 30,00/);

  const empty = renderToStaticMarkup(
    <CustomerReceivableDetailBody
      detail={detail({ debt: { creditSalesTotal: 0, creditNotesTotal: 0, settlementsTotal: 0, debt: 0 }, rawBalance: 0, movements: [], cashCreditNotes: { count: 0, total: 0 }, excluded: { draftOrCancelledSales: 0, nonValidatedCreditNotes: 0, cancelledSettlements: 0 } })}
    />,
  );
  assert.match(text(empty), /Aucun mouvement pris en compte pour ce client/);
});
