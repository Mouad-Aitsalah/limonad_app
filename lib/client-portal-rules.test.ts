import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLIENT_ORDER_MAX_QUANTITY,
  CLIENT_LOGIN_THROTTLED_MESSAGE,
  canOpenInPos,
  canStaffTransition,
  clientIpFromHeaders,
  clientLoginSchema,
  clientOrderInputSchema,
  computeClientOrderTotals,
  customerCodeCandidates,
  customerOrderStatusLabel,
  estimateClientCartTotal,
  formatCustomerOrderNumber,
  isInvoicePending,
  isValidProductPhoto,
  mergeOrderLines,
  normalizeContactPhone,
  organizationCodeCandidates,
  totalsDiffer,
} from "./client-portal-rules";

const B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";

test("photo: only a real png/jpeg/webp/gif base64 image or an http(s) URL counts", () => {
  for (const ok of [
    `data:image/png;base64,${B64}`,
    `data:image/jpeg;base64,${B64}`,
    `data:image/webp;base64,${B64}`,
    "https://cdn.example.com/p/coca.jpg",
    "http://example.com/a.png",
  ]) {
    assert.equal(isValidProductPhoto(ok), true, ok);
  }
  for (const bad of [
    null,
    "",
    "   ",
    "data:image/png;base64,",
    "data:image/png;base64,abc",
    `data:image/svg+xml;base64,${B64}`,
    `data:text/html;base64,${B64}`,
    "javascript:alert(1)",
    "/uploads/p.png",
    "ftp://example.com/p.png",
    "https://",
  ]) {
    assert.equal(isValidProductPhoto(bad), false, String(bad));
  }
});

test("codes: customer code accepts the POS forms (15, 3421/15, 342115) and legacy codes; org code exact or upper-cased", () => {
  assert.deepEqual(customerCodeCandidates("15"), ["15", "342115"]);
  assert.deepEqual(customerCodeCandidates(" 3421/15 "), ["3421/15", "342115"]);
  assert.deepEqual(customerCodeCandidates("342115"), ["342115"]);
  assert.deepEqual(customerCodeCandidates("cli-0001"), ["cli-0001", "CLI-0001"]);
  assert.deepEqual(customerCodeCandidates("  "), []);
  assert.deepEqual(organizationCodeCandidates("comdis-principal"), ["comdis-principal", "COMDIS-PRINCIPAL"]);
});

test("login schema: organisation and customer codes mandatory, phone optional", () => {
  assert.equal(clientLoginSchema.safeParse({ organizationCode: "X", customerCode: "1" }).success, true);
  assert.equal(clientLoginSchema.safeParse({ organizationCode: "X", customerCode: "1", phone: "" }).success, true);
  assert.equal(clientLoginSchema.safeParse({ organizationCode: "", customerCode: "1" }).success, false);
  assert.equal(clientLoginSchema.safeParse({ organizationCode: "X" }).success, false);
});

test("phone: optional contact info, cleaned, never required", () => {
  assert.equal(normalizeContactPhone(undefined), null);
  assert.equal(normalizeContactPhone("  "), null);
  assert.equal(normalizeContactPhone("06 12 34 56 78"), "0612345678");
  assert.equal(normalizeContactPhone("+212 6-12-34-56-78"), "+212612345678");
  assert.equal(normalizeContactPhone("abc"), "invalid");
  assert.equal(normalizeContactPhone("123"), "invalid");
});

test("client IP: first X-Forwarded-For address, else X-Real-IP, else unknown", () => {
  assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
  assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "5.6.7.8" })), "5.6.7.8");
  assert.equal(clientIpFromHeaders(new Headers()), "unknown");
});

test("order input: only {productId, quantity} lines - prices, totals, customer or organisation are rejected", () => {
  const base = { idempotencyKey: "key-123456", lines: [{ productId: "p1", quantity: 2 }] };
  assert.equal(clientOrderInputSchema.safeParse(base).success, true);
  for (const forged of [
    { ...base, lines: [{ productId: "p1", quantity: 2, priceTTC: 1 }] },
    { ...base, lines: [{ productId: "p1", quantity: 2, unitPriceHT: 1 }] },
    { ...base, customerId: "c1" },
    { ...base, organizationId: "o1" },
    { ...base, totalTTC: 1 },
    { ...base, lines: [{ productId: "p1", quantity: 0 }] },
    { ...base, lines: [{ productId: "p1", quantity: CLIENT_ORDER_MAX_QUANTITY + 1 }] },
    { ...base, lines: [] },
    { lines: base.lines },
  ]) {
    assert.equal(clientOrderInputSchema.safeParse(forged).success, false, JSON.stringify(forged));
  }
  assert.deepEqual(
    mergeOrderLines([
      { productId: "a", quantity: 2 },
      { productId: "b", quantity: 1 },
      { productId: "a", quantity: 3 },
    ]),
    [
      { productId: "a", quantity: 5 },
      { productId: "b", quantity: 1 },
    ],
  );
});

test("totals: server computation = POS computation, and the browser estimate from TTC prices matches it", () => {
  // Coca 4.17 HT @20% -> 5.00 TTC ; Pom's 3.75 HT @20% -> 4.50 TTC ; odd one 1.23 HT @10% -> 1.35 TTC
  const lines = [
    { productId: "coca", quantity: 2, unitPriceHT: 4.17, taxRate: 20 },
    { productId: "poms", quantity: 3, unitPriceHT: 3.75, taxRate: 20 },
    { productId: "odd", quantity: 1, unitPriceHT: 1.23, taxRate: 10 },
  ];
  const server = computeClientOrderTotals(lines);
  assert.equal(server.lines[0].totalTTC, 10);
  assert.equal(server.lines[1].totalTTC, 13.5);
  assert.equal(server.lines[2].totalTTC, 1.35);
  // 24.85 rounded to the commercial 0.50 step
  assert.equal(server.totalTTC, 25);
  assert.equal(server.roundingAmount, 0.15);

  const browser = estimateClientCartTotal([
    { priceTTC: 5, quantity: 2 },
    { priceTTC: 4.5, quantity: 3 },
    { priceTTC: 1.35, quantity: 1 },
  ]);
  assert.equal(browser.totalTTC, server.totalTTC, "no false PRICE_CHANGED");
  assert.equal(totalsDiffer(browser.totalTTC, server.totalTTC), false);
  assert.equal(totalsDiffer(25, 25.5), true);
});

test("staff workflow: accept/reject transitions, POS only for ACCEPTED, CONVERTED only via the sale", () => {
  assert.equal(canStaffTransition("SUBMITTED", "ACCEPTED"), true);
  assert.equal(canStaffTransition("SUBMITTED", "REJECTED"), true);
  assert.equal(canStaffTransition("ACCEPTED", "REJECTED"), true);
  assert.equal(canStaffTransition("ACCEPTED", "ACCEPTED"), false);
  assert.equal(canStaffTransition("REJECTED", "ACCEPTED"), false);
  assert.equal(canStaffTransition("CONVERTED", "REJECTED"), false);
  assert.equal(canStaffTransition("SUBMITTED", "CONVERTED"), false);
  assert.equal(canOpenInPos("ACCEPTED"), true);
  assert.equal(canOpenInPos("SUBMITTED"), false);
  assert.equal(canOpenInPos("CONVERTED"), false);
  assert.equal(formatCustomerOrderNumber(7), "CMD-000007");
});

test("order label: « Facture en attente » only for CONVERTED while the linked sale is still a pending (DRAFT) invoice", () => {
  assert.equal(isInvoicePending("CONVERTED", "DRAFT"), true);
  for (const saleStatus of ["PAID", "CREDIT", "PARTIALLY_PAID", "VALIDATED", "CANCELLED", null, undefined]) {
    assert.equal(isInvoicePending("CONVERTED", saleStatus), false, String(saleStatus));
  }
  for (const status of ["SUBMITTED", "ACCEPTED", "REJECTED", "CANCELLED"] as const) {
    assert.equal(isInvoicePending(status, "DRAFT"), false, status);
  }
  assert.equal(customerOrderStatusLabel("CONVERTED", true), "Facture en attente");
  assert.equal(customerOrderStatusLabel("CONVERTED", false), "Facturée");
  assert.equal(customerOrderStatusLabel("CONVERTED", undefined), "Facturée");
  assert.equal(customerOrderStatusLabel("ACCEPTED", true), "Acceptée", "never relabels another status");
});

test("throttled login message: tells the customer to retry later or contact the supplier", () => {
  assert.match(CLIENT_LOGIN_THROTTLED_MESSAGE, /temporairement bloqué/);
  assert.match(CLIENT_LOGIN_THROTTLED_MESSAGE, /15 minutes/);
  assert.match(CLIENT_LOGIN_THROTTLED_MESSAGE, /contactez votre fournisseur/);
  assert.equal(/code|organisation|client/i.test(CLIENT_LOGIN_THROTTLED_MESSAGE.replace("fournisseur", "")), false, "reveals nothing about the codes");
});
