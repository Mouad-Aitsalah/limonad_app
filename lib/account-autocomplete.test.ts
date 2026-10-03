import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ACCOUNT_SUGGESTION_LIMIT,
  autocompleteAfterInput,
  CLOSED_AUTOCOMPLETE,
  filterAccountsByPrefix,
  findExactAccountIndex,
  handleAutocompleteKey,
  type AutocompleteState,
} from "@/lib/account-autocomplete";
import { resolveAccountByCode } from "@/lib/accounting-account-resolve";
import type { AccountingAccountOptionDto } from "@/types/accounting";

const account = (
  code: string,
  name: string,
  isActive = true,
  type: AccountingAccountOptionDto["type"] = "TREASURY",
): AccountingAccountOptionDto => ({ id: `id-${code}`, code, name, type, isActive });

const chart: AccountingAccountOptionDto[] = [
  account("1051", "Primes d'emission"),
  account("3421", "Clients"),
  account("4411", "Fournisseurs"),
  account("4511", "Associes - comptes courants"), // contains "51", does not START with it
  account("5111", "Caisse"),
  account("5121", "Banque"),
  account("51111", "Caisse principale"),
  account("51112", "Caisse camion"),
  account("5311", "Caisse secondaire"),
  account("5141", "Compte bancaire inactif", false),
  account("6111", "Achats de marchandises"),
];

const codes = (result: { items: AccountingAccountOptionDto[] }) => result.items.map((a) => a.code);

// ---------------------------------------------------------------------------
// Filtering (startsWith)
// ---------------------------------------------------------------------------
test("typing 5 returns only accounts whose number starts with 5", () => {
  const result = filterAccountsByPrefix(chart, "5");
  assert.deepEqual(codes(result), ["5111", "51111", "51112", "5121", "5311"]);
  assert.ok(result.items.every((a) => a.code.startsWith("5")));
});

test("typing 51 returns only accounts starting with 51", () => {
  assert.deepEqual(codes(filterAccountsByPrefix(chart, "51")), ["5111", "51111", "51112", "5121"]);
});

test("typing 511 returns only accounts starting with 511", () => {
  assert.deepEqual(codes(filterAccountsByPrefix(chart, "511")), ["5111", "51111", "51112"]);
});

test("an account whose number merely CONTAINS the digits is never returned (4511, 1051 for '51')", () => {
  const found = codes(filterAccountsByPrefix(chart, "51"));
  assert.equal(found.includes("4511"), false);
  assert.equal(found.includes("1051"), false);
});

test("a full number returns that account (and longer ones it prefixes), exact match first-class", () => {
  const result = filterAccountsByPrefix(chart, "5111");
  assert.deepEqual(codes(result), ["5111", "51111", "51112"]);
  assert.equal(findExactAccountIndex(result.items, "5111"), 0);
  assert.equal(findExactAccountIndex(result.items, "511"), -1);
});

test("empty / blank input suggests nothing; spaces and case are ignored", () => {
  assert.deepEqual(filterAccountsByPrefix(chart, ""), { items: [], total: 0 });
  assert.deepEqual(filterAccountsByPrefix(chart, "   "), { items: [], total: 0 });
  assert.deepEqual(codes(filterAccountsByPrefix(chart, " 51 ")), ["5111", "51111", "51112", "5121"]);
  assert.deepEqual(codes(filterAccountsByPrefix([account("A100", "Alpha")], "a1")), ["A100"]);
});

test("no match -> empty list (the UI shows a clear message)", () => {
  assert.deepEqual(filterAccountsByPrefix(chart, "9"), { items: [], total: 0 });
});

test("inactive accounts are not suggested; no duplicates; results sorted by number", () => {
  assert.equal(codes(filterAccountsByPrefix(chart, "514")).length, 0);
  const duplicated = [...chart, chart[4], chart[4]];
  const result = filterAccountsByPrefix(duplicated, "5111");
  assert.equal(new Set(result.items.map((a) => a.id)).size, result.items.length);
  const shuffled = [...chart].reverse();
  assert.deepEqual(codes(filterAccountsByPrefix(shuffled, "5")), ["5111", "51111", "51112", "5121", "5311"]);
});

test("the list is capped (20 by default) while the total is reported, so the user can refine", () => {
  const many = Array.from({ length: 57 }, (_, i) => account(`6${String(i).padStart(3, "0")}`, `Compte ${i}`));
  const result = filterAccountsByPrefix(many, "6");
  assert.equal(result.items.length, ACCOUNT_SUGGESTION_LIMIT);
  assert.equal(result.total, 57);
  assert.equal(filterAccountsByPrefix(many, "6004").total, 1, "typing more narrows the list");
  assert.equal(filterAccountsByPrefix(many, "6", 5).items.length, 5);
});

// ---------------------------------------------------------------------------
// Selection fills the associated fields
// ---------------------------------------------------------------------------
test("choosing a suggestion fills the number; the account name is then resolved from the chart; the free designation is untouched", () => {
  const picked = filterAccountsByPrefix(chart, "51").items[0]; // 5111 Caisse
  // what the entry form does on selection: numCompt = account.code
  const line = { numCompt: picked.code, label: "libelle saisi par l'utilisateur", debit: "0", credit: "0" };
  const resolved = resolveAccountByCode(chart, line.numCompt);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.status === "resolved" && resolved.account.id, picked.id);
  assert.equal(resolved.status === "resolved" && resolved.account.name, "Caisse");
  assert.equal(line.label, "libelle saisi par l'utilisateur", "designation keeps its 'no auto-fill' rule");
});

test("account resolution rules are unchanged (empty / not found / inactive / resolved)", () => {
  assert.equal(resolveAccountByCode(chart, "  ").status, "empty");
  assert.equal(resolveAccountByCode(chart, "9999").status, "not-found");
  assert.equal(resolveAccountByCode(chart, "5141").status, "inactive");
  assert.equal(resolveAccountByCode(chart, "5111").status, "resolved");
  assert.equal(resolveAccountByCode(chart, " 5111 ").status, "resolved");
});

// ---------------------------------------------------------------------------
// Keyboard / pointer behaviour (pure state machine used by the component)
// ---------------------------------------------------------------------------
const open = (activeIndex = -1): AutocompleteState => ({ open: true, activeIndex });

test("typing opens the list; nothing is highlighted unless it is exactly the typed number", () => {
  assert.deepEqual(autocompleteAfterInput(true, -1), { open: true, activeIndex: -1 });
  assert.deepEqual(autocompleteAfterInput(true, 0), { open: true, activeIndex: 0 });
  assert.deepEqual(autocompleteAfterInput(false, -1), CLOSED_AUTOCOMPLETE);
});

test("arrow keys move the highlight, wrap around, and reopen a closed list", () => {
  let result = handleAutocompleteKey(open(-1), "ArrowDown", 3);
  assert.deepEqual([result.state.activeIndex, result.consumed], [0, true]);
  result = handleAutocompleteKey(result.state, "ArrowDown", 3);
  assert.equal(result.state.activeIndex, 1);
  result = handleAutocompleteKey(result.state, "ArrowDown", 3);
  result = handleAutocompleteKey(result.state, "ArrowDown", 3);
  assert.equal(result.state.activeIndex, 0, "wraps from last to first");
  result = handleAutocompleteKey(result.state, "ArrowUp", 3);
  assert.equal(result.state.activeIndex, 2, "wraps from first to last");
  result = handleAutocompleteKey(open(-1), "ArrowUp", 3);
  assert.equal(result.state.activeIndex, 2);
  const reopened = handleAutocompleteKey(CLOSED_AUTOCOMPLETE, "ArrowDown", 3);
  assert.deepEqual(reopened.state, { open: true, activeIndex: 0 });
  assert.equal(reopened.consumed, true);
  assert.equal(handleAutocompleteKey(CLOSED_AUTOCOMPLETE, "ArrowDown", 0).consumed, false, "nothing to navigate");
});

test("Enter selects the ACTIVE suggestion first (and is consumed); the list closes", () => {
  const result = handleAutocompleteKey(open(1), "Enter", 3);
  assert.deepEqual(result, { state: CLOSED_AUTOCOMPLETE, consumed: true, select: true });
});

test("Enter with no active suggestion, or no list, is NOT consumed: the existing 'next field' navigation runs", () => {
  const noActive = handleAutocompleteKey(open(-1), "Enter", 3);
  assert.deepEqual([noActive.consumed, noActive.select, noActive.state.open], [false, false, false]);
  const closed = handleAutocompleteKey(CLOSED_AUTOCOMPLETE, "Enter", 3);
  assert.deepEqual([closed.consumed, closed.select], [false, false]);
  const noResults = handleAutocompleteKey(open(0), "Enter", 0);
  assert.deepEqual([noResults.consumed, noResults.select], [false, false]);
});

test("Escape closes the list (consumed); with the list already closed it is left alone", () => {
  const closing = handleAutocompleteKey(open(2), "Escape", 3);
  assert.deepEqual(closing, { state: CLOSED_AUTOCOMPLETE, consumed: true, select: false });
  assert.equal(handleAutocompleteKey(CLOSED_AUTOCOMPLETE, "Escape", 3).consumed, false);
  assert.equal(handleAutocompleteKey(open(-1), "Escape", 0).state.open, false, "also closes the 'no account' message");
});

test("Tab closes the list without being consumed; other keys do not change the state", () => {
  const tab = handleAutocompleteKey(open(1), "Tab", 3);
  assert.deepEqual([tab.state.open, tab.consumed], [false, false]);
  const letter = handleAutocompleteKey(open(1), "5", 3);
  assert.deepEqual(letter, { state: open(1), consumed: false, select: false });
});

test("several lines use the autocomplete independently (one state per line)", () => {
  // each entry line renders its own <AccountCodeInput> (own state); model two of them
  let lineA: AutocompleteState = autocompleteAfterInput(true, -1);
  let lineB: AutocompleteState = CLOSED_AUTOCOMPLETE;
  lineA = handleAutocompleteKey(lineA, "ArrowDown", 4).state; // A highlights #0
  lineB = autocompleteAfterInput(true, 2); // B opens with its own exact match
  lineA = handleAutocompleteKey(lineA, "ArrowDown", 4).state; // A -> #1
  assert.deepEqual(lineA, { open: true, activeIndex: 1 });
  assert.deepEqual(lineB, { open: true, activeIndex: 2 });
  lineB = handleAutocompleteKey(lineB, "Escape", 4).state;
  assert.deepEqual(lineB, CLOSED_AUTOCOMPLETE);
  assert.deepEqual(lineA, { open: true, activeIndex: 1 }, "closing B leaves A open");
  // and each row filters its own typed text
  assert.deepEqual(codes(filterAccountsByPrefix(chart, "51")), ["5111", "51111", "51112", "5121"]);
  assert.deepEqual(codes(filterAccountsByPrefix(chart, "53")), ["5311"]);
});

// ---------------------------------------------------------------------------
// Wiring guards
// ---------------------------------------------------------------------------
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the entry table gives EVERY line its own autocomplete, keeping the Enter navigation and the other fields intact", () => {
  const view = read("../components/accounting/accounting-entries-view.tsx");
  assert.equal((view.match(/<AccountCodeInput/g) ?? []).length, 1, "rendered once per line, inside form.lines.map");
  assert.match(view, /form\.lines\.map\(\(line, index\)/);
  assert.match(view, /onKeyDown=\{\(event\) => handleLineKeyDown\(index, "numCompt", event\)\}/);
  assert.match(view, /accounts=\{accounts\}/);
  // existing behaviour untouched
  assert.match(view, /focusRowField\(line\.id, "label"\)/);
  assert.match(view, /const ecart = currentDebit - currentCredit/);
  assert.match(view, /resolveAccountByCode\(accounts, line\.numCompt\)/);
  assert.equal(/function resolveAccountByCode/.test(view), false, "single shared implementation");
});

test("suggestions come from the accounts the page already loaded: no request while typing", () => {
  const component = read("../components/accounting/account-code-input.tsx");
  assert.equal(/fetch\(/.test(component), false);
  assert.match(component, /filterAccountsByPrefix\(accounts,/);
  assert.match(component, /createPortal\(/, "portal: not clipped by the table's horizontal scroll");
  assert.match(component, /role="combobox"/);
  assert.match(component, /pointerdown/);
});

test("the server side and the other POS screens are untouched by this feature", () => {
  const page = read("../app/(dashboard)/comptabilite/ecritures/page.tsx");
  assert.match(page, /listAccountingAccountOptions\(\)/);
  for (const file of ["../components/pos/pos-layout.tsx", "../components/driver-pos/driver-pos-view.tsx"]) {
    assert.equal(/account-autocomplete|AccountCodeInput/.test(read(file)), false, file);
  }
});
