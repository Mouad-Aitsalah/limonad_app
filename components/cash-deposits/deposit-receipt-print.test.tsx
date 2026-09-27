import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { resetCompanyIdentityCache } from "@/hooks/use-company-identity";
import type { CashDepositDto } from "@/types/cash-deposits";

import { DepositReceiptPrint } from "./deposit-receipt-print";

function deposit(overrides: Partial<CashDepositDto> = {}): CashDepositDto {
  return {
    id: "d1",
    number: "VRS-000123",
    date: "2026-09-28",
    depotId: "dep1",
    depotName: "Dépôt Centre",
    posSessionId: null,
    posSessionNumber: null,
    cashTotal: 4600,
    checkTotal: 0,
    total: 4600,
    status: "VALIDATED",
    notes: null,
    createdByUserId: "u1",
    createdByUserName: "Abdel",
    createdAt: "2026-09-28T10:15:00.000Z",
    denominations: [
      { denomination: 0.5, quantity: 0, amount: 0 },
      { denomination: 1, quantity: 0, amount: 0 },
      { denomination: 2, quantity: 0, amount: 0 },
      { denomination: 5, quantity: 0, amount: 0 },
      { denomination: 10, quantity: 0, amount: 0 },
      { denomination: 20, quantity: 0, amount: 0 },
      { denomination: 50, quantity: 0, amount: 0 },
      { denomination: 100, quantity: 0, amount: 0 },
      { denomination: 200, quantity: 23, amount: 4600 },
    ],
    cashSummary: null,
    ...overrides,
  };
}

function html(value: CashDepositDto | null) {
  return renderToStaticMarkup(<DepositReceiptPrint deposit={value} />);
}

test("no deposit: renders nothing", () => {
  resetCompanyIdentityCache(null);
  assert.equal(html(null), "");
});

test("title is exactly REÇU DE VERSEMENT, hidden until print, and the ticket carries the deposit's own data - never hardcoded", () => {
  resetCompanyIdentityCache(null);
  const markup = html(deposit());
  assert.match(markup, /receipt-print-area hidden/);
  assert.match(markup, /REÇU DE VERSEMENT/);
  assert.match(markup, /VRS-000123/);
  assert.match(markup, /Abdel/);
  assert.match(markup, /D&#x2A;p&#x2F;ot Centre|Dépôt Centre/);
});

test("every denomination line comes from deposit.denominations, in order, quantity included even at 0 - the documented example", () => {
  const markup = html(deposit());
  const rows = [...markup.matchAll(/<div class="receipt-print-deposit-grid"><span>([^<]*)<\/span><span class="receipt-print-right">(\d+)<\/span><span class="receipt-print-right receipt-print-number">/g)];
  assert.equal(rows.length, 9);
  const byLabel = new Map(rows.map((r) => [r[1].replace(/\s/g, " "), Number(r[2])]));
  assert.equal(byLabel.get("200,00 DH"), 23);
  assert.equal(byLabel.get("5,00 DH"), 0);
  assert.equal(byLabel.get("10,00 DH"), 0);
  assert.equal(byLabel.get("20,00 DH"), 0);
  assert.equal(byLabel.get("50,00 DH"), 0);
  assert.equal(byLabel.get("100,00 DH"), 0);
});

test("totals: cash, cheques and grand total are the deposit's real amounts, 2 decimals with DH", () => {
  const markup = html(deposit({ checkTotal: 150, total: 4750 }));
  assert.match(markup, /TOTAL ESPÈCES<\/span><span>4.600,00.DH/);
  assert.match(markup, /CHÈQUES<\/span><span>150,00.DH/);
  assert.match(markup, /TOTAL<\/span><span>4.750,00.DH/);
});

test("comment: shown only when the deposit has one, using its own text", () => {
  const without = html(deposit({ notes: null }));
  assert.equal(without.includes("Commentaire"), false);
  const withNote = html(deposit({ notes: "Ecart signale au responsable" }));
  assert.match(withNote, /Commentaire<\/p><p class="receipt-print-notes-text">Ecart signale au responsable/);
});

test("both signatures are always present", () => {
  const markup = html(deposit());
  assert.match(markup, /Signature caissier/);
  assert.match(markup, /Signature responsable/);
  assert.equal((markup.match(/receipt-print-signature-space/g) ?? []).length, 2);
});

test("logo: shown only when the organisation identity has one, using its real url and name", () => {
  resetCompanyIdentityCache(null);
  const noLogo = html(deposit());
  assert.equal(noLogo.includes("receipt-print-logo"), false);
  assert.match(noLogo, /COMDIS/); // fallback brand name when identity has neither tradeName nor name

  resetCompanyIdentityCache({ name: "Ma Societe", tradeName: null, logoUrl: "data:image/png;base64,AAAA" });
  const withLogo = html(deposit());
  assert.match(withLogo, /<img src="data:image\/png;base64,AAAA" alt="Ma Societe" class="receipt-print-logo"/);
  assert.match(withLogo, /Ma Societe/);
  resetCompanyIdentityCache(null);
});

test("paper width: defaults to 80mm, can be set to 58mm for a thermal printer, never breaking the A4/80mm markup", () => {
  assert.match(html(deposit()), /data-paper="80"/);
  const markup58 = renderToStaticMarkup(<DepositReceiptPrint deposit={deposit()} paperWidth="58" />);
  assert.match(markup58, /data-paper="58"/);
});
