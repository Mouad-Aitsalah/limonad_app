import assert from "node:assert/strict";
import { test } from "node:test";

import {
  VARIANT_LIMITS,
  attributeNamesKey,
  canonicalizeVariantGroups,
  deriveSimpleReference,
  deriveVariantReference,
  normalizeKey,
  parseVariantAttributes,
  slugForReference,
  stableHash8,
  variantDisplayName,
  variantFileGroupKey,
  variantGroupKeyOf,
  variantKeyOf,
} from "@/lib/products-import-variants";

const attrs = (text: string) => parseVariantAttributes(text).attributes;

// ---- normalisation -----------------------------------------------------------------

test("normalizeKey: case, accents, spaces, apostrophes and invisible characters do not matter", () => {
  assert.equal(normalizeKey("  Arsenal   Survêtements "), "arsenal survetements");
  assert.equal(normalizeKey("ARSENAL SURVETEMENTS"), normalizeKey("arsenal survêtements"));
  assert.equal(normalizeKey("L’Équipe"), "l'equipe");
  assert.equal(normalizeKey("Noir mat​"), "noir mat");
  assert.equal(normalizeKey(""), "");
});

// ---- attributes --------------------------------------------------------------------

test("a variant cell 'NOM: valeur | NOM: valeur' gives ordered, structured attributes (any attribute name)", () => {
  assert.deepEqual(parseVariantAttributes("TAILLE: S | COULEUR: NOIR"), {
    attributes: [
      { name: "TAILLE", value: "S" },
      { name: "COULEUR", value: "NOIR" },
    ],
    errors: [],
  });
  // not only size and colour
  assert.deepEqual(attrs("POINTURE: 42 | MATIERE: Cuir | SAISON: Été"), [
    { name: "POINTURE", value: "42" },
    { name: "MATIERE", value: "Cuir" },
    { name: "SAISON", value: "Été" },
  ]);
  // spaces around the separators and the colon, a colon inside the value
  assert.deepEqual(attrs("  TAILLE :S  |  NOTE: a: b "), [
    { name: "TAILLE", value: "S" },
    { name: "NOTE", value: "a: b" },
  ]);
  // a single attribute is a variant too
  assert.deepEqual(attrs("TAILLE: XL"), [{ name: "TAILLE", value: "XL" }]);
});

test("the historical '/' separator still works, but only between two NAME: value pairs", () => {
  assert.deepEqual(attrs("Taille: S / Couleur: Noir"), [
    { name: "Taille", value: "S" },
    { name: "Couleur", value: "Noir" },
  ]);
  // a slash inside a value is not a separator
  assert.deepEqual(attrs("TAILLE: 38/39"), [{ name: "TAILLE", value: "38/39" }]);
  assert.deepEqual(attrs("TAILLE: 38/39 | COULEUR: N"), [
    { name: "TAILLE", value: "38/39" },
    { name: "COULEUR", value: "N" },
  ]);
  // "|" wins when both are present
  assert.deepEqual(attrs("TAILLE: S/M | COULEUR: Noir"), [
    { name: "TAILLE", value: "S/M" },
    { name: "COULEUR", value: "Noir" },
  ]);
});

test("an empty cell is a product without variants (no attribute, no error)", () => {
  for (const cell of ["", "   ", undefined, null]) {
    assert.deepEqual(parseVariantAttributes(cell), { attributes: [], errors: [] });
  }
});

test("missing or malformed values are explicit errors - nothing is guessed", () => {
  const errorsOf = (text: string) => parseVariantAttributes(text).errors.join(" || ");
  assert.match(errorsOf("XL"), /mal formée : « XL » \(format attendu « NOM: valeur »\)/);
  assert.match(errorsOf("TAILLE S | COULEUR NOIR"), /« TAILLE S » .*« COULEUR NOIR »/);
  assert.match(errorsOf("TAILLE: | COULEUR: NOIR"), /manquante pour l'attribut « TAILLE »/);
  assert.match(errorsOf(": S"), /nom d'attribut manquant/);
  assert.match(errorsOf("TAILLE: S |"), /segment vide/);
  assert.match(errorsOf("TAILLE: S | taille: M"), /« taille » est indiqué deux fois/);
  assert.match(errorsOf(`TAILLE: ${"x".repeat(VARIANT_LIMITS.maxValueLength + 1)}`), /trop longue/);
  assert.match(errorsOf(`${"N".repeat(VARIANT_LIMITS.maxNameLength + 1)}: x`), /trop long/);
  const tooMany = Array.from({ length: VARIANT_LIMITS.maxAttributes + 1 }, (_, index) => `A${index}: v`).join(" | ");
  assert.match(errorsOf(tooMany), /Trop d'attributs \(8 maximum\)/);
  // the valid ones are still returned next to the errors
  const mixed = parseVariantAttributes("TAILLE: S | COULEUR");
  assert.deepEqual(mixed.attributes, [{ name: "TAILLE", value: "S" }]);
  assert.equal(mixed.errors.length, 1);
});

// ---- keys --------------------------------------------------------------------------

test("variantKeyOf: the signature ignores order, case and accents, and tells combinations apart", () => {
  const a = variantKeyOf(attrs("TAILLE: S | COULEUR: NOIR"));
  assert.equal(a, "couleur=noir;taille=s");
  assert.equal(variantKeyOf(attrs("couleur: noir | Taille: s")), a);
  assert.equal(variantKeyOf(attrs("COULEUR: Noïr | TAILLE: S")), a);
  assert.notEqual(variantKeyOf(attrs("TAILLE: M | COULEUR: NOIR")), a);
  assert.notEqual(variantKeyOf(attrs("TAILLE: S | COULEUR: Bleu")), a);
  assert.notEqual(variantKeyOf(attrs("TAILLE: S")), a);
});

test("variantKeyOf is unambiguous even when a value contains the key separators", () => {
  const tricky = variantKeyOf([{ name: "a", value: "b;c=d" }]);
  const twoPairs = variantKeyOf([
    { name: "a", value: "b" },
    { name: "c", value: "d" },
  ]);
  assert.notEqual(tricky, twoPairs);
  assert.equal(tricky, "a=b\\;c\\=d");
});

test("attributeNamesKey is the STRUCTURE (names only, sorted); the group keys follow the parent and its category", () => {
  assert.equal(attributeNamesKey(attrs("TAILLE: S | COULEUR: NOIR")), "couleur,taille");
  assert.equal(attributeNamesKey(attrs("couleur: x | taille: y")), "couleur,taille");
  assert.notEqual(attributeNamesKey(attrs("POINTURE: 42")), attributeNamesKey(attrs("TAILLE: 42")));
  assert.equal(variantGroupKeyOf(" Arsenal  Survêtements "), "arsenal survetements");
  // the file groups by parent AND category: the same name in another category is another product
  assert.equal(variantFileGroupKey("Arsenal Survêtements", "Vêtements de sport"), variantFileGroupKey("ARSENAL SURVETEMENTS", "vetements  de sport"));
  assert.notEqual(variantFileGroupKey("Arsenal", "Maillots"), variantFileGroupKey("Arsenal", "Shorts"));
  assert.notEqual(variantFileGroupKey("Arsenal", null), variantFileGroupKey("Arsenal", "Shorts"));
});

// ---- display name ------------------------------------------------------------------

test("display name: 'Arsenal Survêtements - S / NOIR', formatted from the structured attributes", () => {
  assert.equal(variantDisplayName("Arsenal Survêtements", attrs("TAILLE: S | COULEUR: NOIR")), "Arsenal Survêtements - S / NOIR");
  assert.equal(variantDisplayName("  Arsenal   Survêtements ", attrs("TAILLE: XXL | COULEUR: Bleu")), "Arsenal Survêtements - XXL / Bleu");
  assert.equal(variantDisplayName("Maillot", attrs("TAILLE: M")), "Maillot - M");
  assert.equal(variantDisplayName("Gourde", []), "Gourde");
});

test("canonicalizeVariantGroups: one spelling per group (first occurrence), distinct values never merged", () => {
  const group = variantFileGroupKey("Arsenal Survêtements", "Sport");
  const other = variantFileGroupKey("Short Nike", "Sport");
  const result = canonicalizeVariantGroups([
    { groupKey: group, parentName: "Arsenal Survêtements", attributes: attrs("TAILLE: S | COULEUR: NOIR") },
    { groupKey: group, parentName: "ARSENAL SURVETEMENTS", attributes: attrs("couleur: Noir | taille: M") },
    { groupKey: group, parentName: "arsenal survetements", attributes: attrs("Taille: s | Couleur: Bleu") },
    { groupKey: other, parentName: "Short Nike", attributes: attrs("couleur: rouge | taille: L") },
  ]);
  assert.deepEqual(result[0], { parentName: "Arsenal Survêtements", attributes: [{ name: "TAILLE", value: "S" }, { name: "COULEUR", value: "NOIR" }] });
  // second line: same parent, "Noir" -> "NOIR", attributes put in the group's order (TAILLE, COULEUR)
  assert.deepEqual(result[1], { parentName: "Arsenal Survêtements", attributes: [{ name: "TAILLE", value: "M" }, { name: "COULEUR", value: "NOIR" }] });
  // "s" is the same value as "S"; "Bleu" is a different value and stays as written
  assert.deepEqual(result[2].attributes, [{ name: "TAILLE", value: "S" }, { name: "COULEUR", value: "Bleu" }]);
  // another group is independent: its own first occurrence wins
  assert.deepEqual(result[3], { parentName: "Short Nike", attributes: [{ name: "couleur", value: "rouge" }, { name: "taille", value: "L" }] });
  // the display names are therefore consistent
  assert.deepEqual(
    result.slice(0, 3).map((variant) => variantDisplayName(variant.parentName, variant.attributes)),
    ["Arsenal Survêtements - S / NOIR", "Arsenal Survêtements - M / NOIR", "Arsenal Survêtements - S / Bleu"],
  );
});

test("canonicalizeVariantGroups keeps a line with another structure as it is (the conflict is reported later)", () => {
  const group = variantFileGroupKey("Sac", "Sacs");
  const [first, second] = canonicalizeVariantGroups([
    { groupKey: group, parentName: "Sac", attributes: attrs("TAILLE: S | COULEUR: Noir") },
    { groupKey: group, parentName: "Sac", attributes: attrs("POINTURE: 42") },
  ]);
  assert.deepEqual(first.attributes.map((attribute) => attribute.name), ["TAILLE", "COULEUR"]);
  assert.deepEqual(second.attributes, [{ name: "POINTURE", value: "42" }]);
});

// ---- references --------------------------------------------------------------------

test("reference = the barcode, exactly as written, whenever the line has one", () => {
  for (const barcode of ["2100000407700", "0012345678905", "00001", "ABC-12_x"]) {
    assert.deepEqual(
      deriveVariantReference({ barcode, parentName: "Arsenal", categoryName: "Sport", attributes: attrs("TAILLE: S") }),
      { reference: barcode, source: "barcode" },
    );
    assert.deepEqual(deriveSimpleReference({ barcode, name: "Ballon", categoryName: "Sport" }), { reference: barcode, source: "barcode" });
  }
});

test("without a barcode the reference is generated: readable, deterministic, collision-safe", () => {
  const input = { parentName: "Arsenal Survêtements", categoryName: "Vêtements de sport", attributes: attrs("TAILLE: S | COULEUR: NOIR") };
  const reference = deriveVariantReference(input);
  assert.equal(reference.source, "generated");
  assert.match(reference.reference, /^ARSENAL-SURVETEMENTS-NOIR-S-[0-9a-f]{8}$/);
  // deterministic: same input, same reference; independent of case, accents, spaces and attribute order
  assert.deepEqual(deriveVariantReference({ ...input }), reference);
  assert.deepEqual(
    deriveVariantReference({ parentName: "  ARSENAL  survetements", categoryName: "vetements de sport", attributes: attrs("couleur: noir | taille: s") }).reference,
    reference.reference,
    "the whole reference does not depend on the way it is written (case, accents, spaces, attribute order)",
  );
  // every part of the identity changes it
  const hashes = new Set([
    reference.reference,
    deriveVariantReference({ ...input, attributes: attrs("TAILLE: M | COULEUR: NOIR") }).reference,
    deriveVariantReference({ ...input, attributes: attrs("TAILLE: S | COULEUR: Bleu") }).reference,
    deriveVariantReference({ ...input, categoryName: "Maillots" }).reference,
    deriveVariantReference({ ...input, parentName: "Arsenal Short" }).reference,
  ]);
  assert.equal(hashes.size, 5, "no two different identities share a reference");
  // never longer than a barcode, whatever the names
  const long = deriveVariantReference({ parentName: "x".repeat(300), categoryName: "c", attributes: attrs(`A: ${"y".repeat(100)} | B: ${"z".repeat(100)}`) });
  assert.ok(long.reference.length <= VARIANT_LIMITS.maxReferenceLength, String(long.reference.length));
  assert.match(long.reference, /-[0-9a-f]{8}$/);
});

test("a product without variants and without barcode gets a generated reference from its name and category", () => {
  const simple = deriveSimpleReference({ name: "Ballon Mikasa", categoryName: "Ballons" });
  assert.match(simple.reference, /^BALLON-MIKASA-[0-9a-f]{8}$/);
  assert.equal(simple.source, "generated");
  assert.deepEqual(deriveSimpleReference({ name: "ballon  MIKASA", categoryName: "BALLONS" }), simple);
  assert.notEqual(deriveSimpleReference({ name: "Ballon Mikasa", categoryName: "Cadeaux" }).reference, simple.reference);
  assert.match(deriveSimpleReference({ name: "***", categoryName: null }).reference, /^P-[0-9a-f]{8}$/);
});

test("slug and hash helpers", () => {
  assert.equal(slugForReference("Vêtements de sport / été"), "VETEMENTS-DE-SPORT-ETE");
  assert.equal(slugForReference("--x--"), "X");
  assert.equal(slugForReference("abcdefghij", 5), "ABCDE");
  assert.equal(slugForReference("ab-cdef", 3), "AB", "no trailing dash after the cut");
  assert.equal(stableHash8("a"), stableHash8("a"));
  assert.notEqual(stableHash8("a"), stableHash8("b"));
  assert.match(stableHash8("Arsenal"), /^[0-9a-f]{8}$/);
  // known FNV-1a value, so a future change of the algorithm cannot go unnoticed (it would change every generated reference)
  assert.equal(stableHash8(""), "811c9dc5");
  assert.equal(stableHash8("a"), "e40c292c");
});

test("canonicalizeVariantGroups: an attribute name holding a comma is not mistaken for two names (no TypeError)", () => {
  const group = variantFileGroupKey("Short", "Sport");
  let result: ReturnType<typeof canonicalizeVariantGroups> = [];
  assert.doesNotThrow(() => {
    result = canonicalizeVariantGroups([
      { groupKey: group, parentName: "Short", attributes: attrs("A,B: x") },
      { groupKey: group, parentName: "Short", attributes: attrs("B: 2 | A: 1") },
      { groupKey: group, parentName: "Short", attributes: attrs("a,b: X") },
    ]);
  });
  // the structures are different: the second line keeps its own order, nothing is merged or lost
  assert.deepEqual(result[1].attributes, [{ name: "B", value: "2" }, { name: "A", value: "1" }]);
  // the same structure as the first line ("a,b" ~ "A,B") is unified on the first occurrence
  assert.deepEqual(result[2].attributes, [{ name: "A,B", value: "x" }]);
  assert.notEqual(attributeNamesKey(attrs("A,B: x")), attributeNamesKey(attrs("A: 1 | B: 2")));
});

test("canonicalizeVariantGroups: lines with other attribute names than the group's first line keep their own order", () => {
  const group = variantFileGroupKey("Short", "Sport");
  const result = canonicalizeVariantGroups([
    { groupKey: group, parentName: "Short", attributes: attrs("TAILLE: S | COULEUR: NOIR") },
    { groupKey: group, parentName: "Short", attributes: attrs("POINTURE: 42 | COULEUR: Noir") },
    { groupKey: group, parentName: "Short", attributes: attrs("TAILLE: M") },
  ]);
  assert.deepEqual(result[1].attributes, [{ name: "POINTURE", value: "42" }, { name: "COULEUR", value: "NOIR" }]);
  assert.deepEqual(result[2].attributes, [{ name: "TAILLE", value: "M" }]);
});
