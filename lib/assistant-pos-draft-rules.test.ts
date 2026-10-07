import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AI_POS_DRAFT_MAX_CANDIDATES,
  AI_POS_DRAFT_TTL_MINUTES,
  aiPosDraftExpiry,
  aiPosDraftHref,
  aiPosDraftLinesSchema,
  applyAiPosDraftOperations,
  candidateProbe,
  checkAiPosDraftAccess,
  compactMatchText,
  looksLikeCustomerNumber,
  mergeAiPosDraftLines,
  normalizeMatchText,
  parseAiPosDraftHref,
  parseAiPosDraftLines,
  resolveCustomerCandidates,
  resolveProductCandidates,
  stockWarning,
} from "./assistant-pos-draft-rules";

const product = (id: string, name: string, reference = `REF-${id}`, barcode: string | null = null) => ({
  id,
  name,
  reference,
  barcode,
});
const customer = (id: string, name: string, code: string) => ({ id, name, code, displayCode: code });

const CATALOGUE = [
  product("coca33", "Coca-Cola 33cl", "COCA-33", "6111000000011"),
  product("coca1l", "Coca-Cola 1L", "COCA-1L"),
  product("coca15", "Coca-Cola 1.5L", "COCA-15"),
  product("hawai", "Hawaï Tropical 33cl", "HAW-33"),
  product("poms", "Pom's 33cl", "POMS-33"),
  product("sidi", "Sidi Ali 1.5L", "SID-15"),
];

// --- normalisation ----------------------------------------------------------

test("normalisation: case, accents, apostrophes, punctuation and spaces never matter", () => {
  for (const value of ["hawai", "Hawaï", "HAWAI", "  hAwAï  "]) assert.equal(normalizeMatchText(value), "hawai");
  assert.equal(normalizeMatchText("Pom's"), "poms");
  assert.equal(normalizeMatchText("Pom’s"), "poms");
  assert.equal(normalizeMatchText("Coca-Cola  1.5L"), "coca cola 1 5l");
  assert.equal(compactMatchText("Coca-Cola"), compactMatchText("coca cola"));
  assert.equal(candidateProbe("Hawaï"), "haw");
  assert.equal(candidateProbe("ab"), null);
});

// --- products ----------------------------------------------------------------

test("product: a single clear match is chosen (hawai -> Hawaï, poms -> Pom's, sidi -> Sidi Ali)", () => {
  for (const [query, id] of [
    ["hawai", "hawai"],
    ["HAWAI", "hawai"],
    ["Hawaï", "hawai"],
    ["poms", "poms"],
    ["Pom's", "poms"],
    ["sidi ali", "sidi"],
    ["coca 1.5l", "coca15"],
    ["coca 33", "coca33"],
  ] as const) {
    const result = resolveProductCandidates(query, CATALOGUE);
    assert.equal(result.kind, "unique", query);
    assert.equal(result.kind === "unique" && result.item.id, id, query);
  }
});

test("product: priority barcode > reference > exact name > contains", () => {
  const byBarcode = resolveProductCandidates("6111000000011", CATALOGUE);
  assert.equal(byBarcode.kind === "unique" && byBarcode.item.id, "coca33");
  const byReference = resolveProductCandidates("coca-1l", CATALOGUE);
  assert.equal(byReference.kind === "unique" && byReference.item.id, "coca1l");
  // exact name wins over the longer names containing it
  const withExact = [...CATALOGUE, product("coca", "Coca")];
  const exact = resolveProductCandidates("COCA", withExact);
  assert.equal(exact.kind === "unique" && exact.item.id, "coca");
});

test("product: an ambiguous query is never resolved arbitrarily (max 5 candidates)", () => {
  const result = resolveProductCandidates("coca", CATALOGUE);
  assert.equal(result.kind, "ambiguous");
  assert.deepEqual(result.kind === "ambiguous" && result.candidates.map((item) => item.id).sort(), ["coca15", "coca1l", "coca33"]);

  const many = Array.from({ length: 9 }, (_, index) => product(`c${index}`, `Coca variante ${index}`));
  const capped = resolveProductCandidates("coca", many);
  assert.equal(capped.kind === "ambiguous" && capped.candidates.length, AI_POS_DRAFT_MAX_CANDIDATES);
});

test("product: unknown product -> none (never a guess); plural retried", () => {
  assert.deepEqual(resolveProductCandidates("fanta", CATALOGUE), { kind: "none" });
  assert.deepEqual(resolveProductCandidates("", CATALOGUE), { kind: "none" });
  const plural = resolveProductCandidates("sidis", CATALOGUE);
  assert.equal(plural.kind === "unique" && plural.item.id, "sidi");
});

// --- customers ---------------------------------------------------------------

test("customer: « autre » resolves the customer named Autre (exact name wins)", () => {
  const customers = [customer("autre", "Autre", "34211"), customer("autres", "Autres Divers", "34219")];
  const result = resolveCustomerCandidates("autre", customers);
  assert.equal(result.kind === "unique" && result.item.id, "autre");
});

test("customer: two Karim -> ambiguous; unknown -> none; a code or displayed number matches exactly", () => {
  const customers = [
    customer("k1", "Karim Alaoui", "342112"),
    customer("k2", "Karim Bennani", "342113"),
    customer("x", "Épicerie Atlas", "342114"),
  ];
  assert.equal(resolveCustomerCandidates("karim", customers).kind, "ambiguous");
  assert.deepEqual(resolveCustomerCandidates("Youssef", customers), { kind: "none" });
  const byCode = resolveCustomerCandidates("342113", customers);
  assert.equal(byCode.kind === "unique" && byCode.item.id, "k2");
  const accent = resolveCustomerCandidates("epicerie atlas", customers);
  assert.equal(accent.kind === "unique" && accent.item.id, "x");
  assert.equal(looksLikeCustomerNumber("44115"), true);
  assert.equal(looksLikeCustomerNumber("3421/15"), true);
  assert.equal(looksLikeCustomerNumber("Karim"), false);
});

// --- draft lines -------------------------------------------------------------

test("draft lines carry ONLY productId + quantity: any price / total / discount field is rejected", () => {
  assert.equal(aiPosDraftLinesSchema.safeParse([{ productId: "p", quantity: 2 }]).success, true);
  for (const extra of [{ price: 10 }, { unitPriceHT: 10 }, { totalTTC: 20 }, { discountUnitAmount: 1 }, { taxRate: 20 }]) {
    assert.equal(aiPosDraftLinesSchema.safeParse([{ productId: "p", quantity: 2, ...extra }]).success, false);
  }
  assert.deepEqual(parseAiPosDraftLines([{ productId: "p", quantity: 2, price: 9 }]), []);
  assert.deepEqual(parseAiPosDraftLines("garbage"), []);
  assert.deepEqual(
    mergeAiPosDraftLines([
      { productId: "a", quantity: 1 },
      { productId: "b", quantity: 2 },
      { productId: "a", quantity: 3 },
    ]),
    [
      { productId: "a", quantity: 4 },
      { productId: "b", quantity: 2 },
    ],
  );
});

test("operations: zid 2 coca / na9es wa7ed coca / 7yed poms / set - pure, never mutating", () => {
  const current = [
    { productId: "coca", quantity: 2 },
    { productId: "poms", quantity: 2 },
  ];
  const frozen = JSON.stringify(current);

  const zid = applyAiPosDraftOperations(current, [{ action: "add", productId: "coca", quantity: 2 }]);
  assert.deepEqual(zid.ok && zid.lines, [
    { productId: "coca", quantity: 4 },
    { productId: "poms", quantity: 2 },
  ]);

  const na9es = applyAiPosDraftOperations(current, [{ action: "decrease", productId: "coca" }]);
  assert.deepEqual(na9es.ok && na9es.lines, [
    { productId: "coca", quantity: 1 },
    { productId: "poms", quantity: 2 },
  ]);

  const toZero = applyAiPosDraftOperations(current, [{ action: "decrease", productId: "coca", quantity: 5 }]);
  assert.deepEqual(toZero.ok && toZero.lines, [{ productId: "poms", quantity: 2 }]);

  const seyed = applyAiPosDraftOperations(current, [{ action: "remove", productId: "poms" }]);
  assert.deepEqual(seyed.ok && seyed.lines, [{ productId: "coca", quantity: 2 }]);

  const set = applyAiPosDraftOperations(current, [{ action: "set", productId: "coca", quantity: 7 }]);
  assert.deepEqual(set.ok && set.lines, [
    { productId: "coca", quantity: 7 },
    { productId: "poms", quantity: 2 },
  ]);

  assert.deepEqual(applyAiPosDraftOperations(current, [{ action: "remove", productId: "fanta" }]), {
    ok: false,
    error: "PRODUCT_NOT_IN_DRAFT",
    productId: "fanta",
  });
  assert.equal(applyAiPosDraftOperations(current, [{ action: "add", productId: "x", quantity: 0 }]).ok, false);
  assert.equal(JSON.stringify(current), frozen, "input untouched");
});

test("stock warning: only when the request exceeds the stock, never blocking", () => {
  assert.equal(stockWarning("Coca-Cola", 2, 5), null);
  assert.equal(stockWarning("Coca-Cola", 2, null), null);
  assert.equal(
    stockWarning("Coca-Cola", 2, 1),
    "⚠️ Il reste seulement 1 Coca-Cola, mais tu demandes 2 unités. Le POS autorise actuellement cette vente.",
  );
  assert.match(stockWarning("Coca-Cola", 1, -3) ?? "", /Il n'en reste plus en stock/);
});

// --- access / expiry / idempotence ------------------------------------------

test("access: organisation isolation, author only, APPLIED and EXPIRED refused", () => {
  const now = new Date("2026-10-07T10:00:00Z");
  const row = { organizationId: "orgA", userId: "u1", status: "OPEN" as const, expiresAt: new Date("2026-10-07T10:30:00Z") };
  assert.deepEqual(checkAiPosDraftAccess(row, { organizationId: "orgA", userId: "u1" }, now), { ok: true });

  const otherOrg = checkAiPosDraftAccess(row, { organizationId: "orgB", userId: "u1" }, now);
  assert.equal(otherOrg.ok === false && otherOrg.reason, "NOT_FOUND");
  const otherUser = checkAiPosDraftAccess(row, { organizationId: "orgA", userId: "u2" }, now);
  assert.equal(otherUser.ok === false && otherUser.status, 404);
  assert.equal(checkAiPosDraftAccess(null, { organizationId: "orgA", userId: "u1" }, now).ok, false);

  const applied = checkAiPosDraftAccess({ ...row, status: "APPLIED" }, { organizationId: "orgA", userId: "u1" }, now);
  assert.equal(applied.ok === false && applied.reason, "ALREADY_APPLIED");
  assert.equal(applied.ok === false && applied.status, 409);

  const late = checkAiPosDraftAccess(row, { organizationId: "orgA", userId: "u1" }, new Date("2026-10-07T10:31:00Z"));
  assert.equal(late.ok === false && late.reason, "EXPIRED");
  const expired = checkAiPosDraftAccess({ ...row, status: "EXPIRED" }, { organizationId: "orgA", userId: "u1" }, now);
  assert.equal(expired.ok === false && expired.status, 410);
});

test("expiry is limited in time and the POS link is strictly recognised", () => {
  const now = new Date("2026-10-07T10:00:00Z");
  assert.equal(aiPosDraftExpiry(now).getTime() - now.getTime(), AI_POS_DRAFT_TTL_MINUTES * 60_000);
  assert.equal(aiPosDraftHref("cmabc123"), "/pos?aiDraft=cmabc123");
  assert.equal(parseAiPosDraftHref("/pos?aiDraft=cmabc123"), "cmabc123");
  for (const bad of ["https://evil.example/pos?aiDraft=x", "/pos?aiDraft=x&y=1", "javascript:alert(1)", "/ventes", "", null]) {
    assert.equal(parseAiPosDraftHref(bad), null, String(bad));
  }
});
