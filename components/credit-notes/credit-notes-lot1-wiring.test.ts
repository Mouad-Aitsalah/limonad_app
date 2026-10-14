import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Lot 1 (avoirs) - how the desk credit-note screens are wired to the server rules.
 * The rules themselves are proven against a real database in
 * lib/server/credit-notes.integration.test.ts; this file checks, without a database,
 * that the screens offer only what the server accepts.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const clientView = read("./credit-note-pos-view.tsx");
const supplierView = read("./supplier-credit-note-pos-view.tsx");
const server = read("../../lib/server/credit-notes.ts");

test("customer and supplier screens only offer DEPOT locations (never a truck)", () => {
  for (const view of [clientView, supplierView]) {
    assert.match(view, /\.filter\(\(location\) => location\.active && location\.type === "DEPOT"\)/);
  }
});

test("both screens send one submission key per avoir, renewed only once it is saved or emptied", () => {
  for (const view of [clientView, supplierView]) {
    assert.match(view, /const idempotencyKeyRef = React\.useRef<string>\(crypto\.randomUUID\(\)\);/);
    assert.match(view, /idempotencyKey: editingCreditNote \? null : idempotencyKeyRef\.current,/);
    assert.match(view, /idempotencyKeyRef\.current = crypto\.randomUUID\(\);/);
  }
});

test("customer screen: cash refund by default, account credit as an option, sent to the server", () => {
  assert.match(clientView, /value: "remboursement_especes",\s*label: "Remboursement en especes"/);
  assert.match(clientView, /value: "avoir_sur_compte",\s*label: "Avoir sur compte client"/);
  assert.match(clientView, /refundMode: "remboursement_especes" as CreditNoteRefundMode,/);
  assert.match(clientView, /returnMode: mode === "linked" \? "LINKED" : "MANUAL",\s*refundMode,/);
  assert.equal(/refundMode/.test(supplierView), false, "a supplier note keeps its single (cash) treatment");
});

test("customer screen: the cashier may make a manual return, its price inputs are read-only, a justification is always asked", () => {
  assert.match(clientView, /return role === "admin" \|\| role === "depot_manager" \|\| role === "cashier";/);
  assert.match(clientView, /readOnlyPricing: Boolean\(line\.saleLineId\) \|\| pricingLocked,/);
  assert.match(clientView, /if \(comment\.trim\(\)\.length < JUSTIFICATION_MIN_LENGTH\)/);
  assert.match(clientView, /Commentaire \/ justification \(obligatoire\)/);
});

test("server: the rules the screens rely on are enforced there too", () => {
  // the MANUAL restriction to admin / depot manager is gone, replaced by the justification + price lock
  assert.equal(/assertUserRole\(user, \["admin", "depot_manager"\]\)/.test(server), false);
  assert.match(server, /const lockManualPricing = partyType === "client" && user\.role === "cashier";/);
  assert.match(server, /assertDepotLocation\(partyType === "client" \? destination : sourceLocation, partyType\);/);
  assert.match(server, /if \(!parsed\.data\.id && !parsed\.data\.idempotencyKey\)/);
  // the driver return keeps its own truck path and never receives the price lock
  const driverReturn = server.slice(server.indexOf("export async function createDriverReturn"), server.indexOf("async function persistManualCreditNote"));
  assert.match(driverReturn, /requireOrganizationUser\(\["driver"\]\)/);
  assert.match(driverReturn, /driver\.truck\.stockLocation\.type !== "TRUCK"/);
  assert.equal(/lockManualPricing|assertDepotLocation/.test(driverReturn), false);
});
