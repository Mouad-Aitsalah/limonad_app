/**
 * Pure building blocks of the products import WITH VARIANTS - no database, no
 * "server-only": the browser (file reading, preview) and the server (the
 * classification, which recomputes everything and is the authority) import the
 * same code, so both always derive the same keys, names and references.
 *
 * A variant is a real Product (own reference, barcode, prices, stock). The
 * parent is only a grouping notion - it never has a stock of its own:
 *   - variantParentName  the parent as written ("Arsenal Survêtements")
 *   - variantGroupKey    the parent, normalised (comparison form of the name)
 *   - variantAttributes  the variant's attributes, structured and ORDERED
 *                        ([{ name: "TAILLE", value: "S" }, ...]); the display
 *                        name is formatted from them, never stored as the truth
 *   - variantKey         the normalised, order-insensitive signature of the
 *                        combination (detects duplicates)
 *
 * This module only does the file-level work (parsing, keys, display name,
 * deterministic references). Comparing against the database is done later.
 */

export type VariantAttribute = { name: string; value: string };

export const VARIANT_LIMITS = {
  maxAttributes: 8,
  maxNameLength: 60,
  maxValueLength: 120,
  /** Product.name limit of the import (see productImportRowSchema). */
  maxProductNameLength: 200,
  /** A reference is never longer than a barcode of the import. */
  maxReferenceLength: 80,
  /** Variants of one parent written together (one transaction); raised only after measuring. */
  maxVariantsPerParent: 200,
} as const;

/** ASCII "unit separator": never typed in a spreadsheet cell, so parts of a key never blur together. */
const KEY_SEPARATOR = "\u001f";

/**
 * The comparison form of a name or a value: no accents, no zero-width
 * characters, one kind of apostrophe, single spaces, lower case.
 * "  Arsenal   Survêtements " and "ARSENAL SURVETEMENTS" are the same key.
 */
export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Trim and collapse inner whitespace, keeping case and accents (what is displayed). */
export function cleanDisplayText(value: string): string {
  return value.replace(/[​-‍⁠﻿]/g, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- attributes

export type ParsedVariantCell = {
  /** The attributes read, in file order. Reliable only when `errors` is empty. */
  attributes: VariantAttribute[];
  errors: string[];
};

/**
 * Which separates the attributes: "|" when the cell has one; otherwise the
 * historical "/" - but only when it really separates two "NAME: value" pairs
 * (two colons or more), so a value like "TAILLE: 38/39" stays one attribute.
 */
function splitVariantSegments(raw: string): string[] {
  if (raw.includes("|")) return raw.split("|");
  if (raw.includes("/") && raw.split(":").length > 2) return raw.split("/");
  return [raw];
}

/**
 * "TAILLE: S | COULEUR: NOIR" (or the historical "Taille: S / Couleur: Noir")
 * -> [{ name: "TAILLE", value: "S" }, { name: "COULEUR", value: "NOIR" }].
 *
 * ANY attribute name is accepted (TAILLE, COULEUR, POINTURE, MATIERE...). An
 * empty cell is a product without variants (no attribute, no error). Strict by
 * design, nothing is guessed: a segment without "NAME:" ("XL"), an empty name or
 * value, a repeated name, too many attributes or an over-long text is an error
 * that names the problem.
 */
export function parseVariantAttributes(cell: string | null | undefined): ParsedVariantCell {
  const raw = cleanDisplayText(cell ?? "");
  if (!raw) return { attributes: [], errors: [] };

  const attributes: VariantAttribute[] = [];
  const errors: string[] = [];
  const seenNames = new Set<string>();

  for (const piece of splitVariantSegments(raw)) {
    const segment = cleanDisplayText(piece);
    if (!segment) {
      errors.push(`Valeur de variante mal formée : segment vide dans « ${raw} ».`);
      continue;
    }
    const colon = segment.indexOf(":");
    if (colon < 0) {
      errors.push(`Valeur de variante mal formée : « ${segment} » (format attendu « NOM: valeur »).`);
      continue;
    }
    const name = cleanDisplayText(segment.slice(0, colon));
    const value = cleanDisplayText(segment.slice(colon + 1));
    if (!name) {
      errors.push(`Valeur de variante mal formée : nom d'attribut manquant dans « ${segment} ».`);
      continue;
    }
    if (!value) {
      errors.push(`Valeur de variante manquante pour l'attribut « ${name} ».`);
      continue;
    }
    if (name.length > VARIANT_LIMITS.maxNameLength) {
      errors.push(`Nom d'attribut trop long (${VARIANT_LIMITS.maxNameLength} caractères maximum) : « ${name} ».`);
      continue;
    }
    if (value.length > VARIANT_LIMITS.maxValueLength) {
      errors.push(`Valeur d'attribut trop longue (${VARIANT_LIMITS.maxValueLength} caractères maximum) : « ${name} ».`);
      continue;
    }
    const nameKey = normalizeKey(name);
    if (seenNames.has(nameKey)) {
      errors.push(`L'attribut « ${name} » est indiqué deux fois.`);
      continue;
    }
    seenNames.add(nameKey);
    attributes.push({ name, value });
  }

  if (attributes.length > VARIANT_LIMITS.maxAttributes) {
    errors.push(`Trop d'attributs (${VARIANT_LIMITS.maxAttributes} maximum).`);
  }
  return { attributes, errors };
}

// ---------------------------------------------------------------- keys

/** Escapes the characters that structure a key, so "a=b;c" can never read as two pairs. */
const escapeKeyPart = (value: string) => value.replace(/[\\;=,]/g, (character) => `\\${character}`);

/**
 * The normalised signature of a combination, independent of the order the
 * attributes were written in and of case / accents:
 * "TAILLE: S | COULEUR: NOIR" and "couleur: noir | taille: s" -> "couleur=noir;taille=s".
 */
export function variantKeyOf(attributes: readonly VariantAttribute[]): string {
  return attributes
    .map((attribute) => `${escapeKeyPart(normalizeKey(attribute.name))}=${escapeKeyPart(normalizeKey(attribute.value))}`)
    .sort()
    .join(";");
}

/** The STRUCTURE of the attributes (their names only, sorted): "couleur,taille". */
export function attributeNamesKey(attributes: readonly VariantAttribute[]): string {
  return attributes
    .map((attribute) => escapeKeyPart(normalizeKey(attribute.name)))
    .sort()
    .join(",");
}

/** The stored parent key: the parent's name in comparison form (the category is a separate column of the unique index). */
export function variantGroupKeyOf(parentName: string): string {
  return normalizeKey(parentName);
}

/**
 * The key a FILE groups its lines by: the parent AND its category (the same
 * name in two categories is two different products). Never stored.
 */
export function variantFileGroupKey(parentName: string, categoryName: string | null | undefined): string {
  return [normalizeKey(parentName), normalizeKey(categoryName ?? "")].join(KEY_SEPARATOR);
}

// ---------------------------------------------------------------- names

/** "Arsenal Survêtements - S / NOIR": the display convention. Formatted only for display; the attributes stay structured. */
export function variantDisplayName(parentName: string, attributes: readonly VariantAttribute[]): string {
  const parent = cleanDisplayText(parentName);
  return attributes.length ? `${parent} - ${attributes.map((attribute) => attribute.value).join(" / ")}` : parent;
}

export type CanonicalVariantInput = {
  /** The file group (variantFileGroupKey) the line belongs to. */
  groupKey: string;
  parentName: string;
  attributes: readonly VariantAttribute[];
};

export type CanonicalVariant = { parentName: string; attributes: VariantAttribute[] };

/**
 * Within one file group, the parent name, the attribute names and the values
 * that are the same once normalised are written ONE way - the first occurrence
 * in the file - so "NOIR" / "Noir" and "Arsenal Survêtements" /
 * "ARSENAL SURVETEMENTS" never produce differently spelled names. The order of
 * the attributes is the first line's, for every line with the same attribute
 * names. Distinct values are never merged. Returns one entry per input, in order.
 */
export function canonicalizeVariantGroups(items: readonly CanonicalVariantInput[]): CanonicalVariant[] {
  type GroupMemory = {
    parentName: string;
    names: Map<string, string>;
    values: Map<string, string>;
    order: string[];
    orderSet: string;
  };
  const groups = new Map<string, GroupMemory>();

  const memoryOf = (item: CanonicalVariantInput): GroupMemory => {
    let memory = groups.get(item.groupKey);
    if (!memory) {
      const order = item.attributes.map((attribute) => normalizeKey(attribute.name));
      memory = { parentName: cleanDisplayText(item.parentName), names: new Map(), values: new Map(), order, orderSet: attributeNamesKey(item.attributes) };
      groups.set(item.groupKey, memory);
    }
    return memory;
  };

  return items.map((item) => {
    const memory = memoryOf(item);
    const canonical = item.attributes.map((attribute) => {
      const nameKey = normalizeKey(attribute.name);
      if (!memory.names.has(nameKey)) memory.names.set(nameKey, cleanDisplayText(attribute.name));
      const valueKey = `${nameKey}${KEY_SEPARATOR}${normalizeKey(attribute.value)}`;
      if (!memory.values.has(valueKey)) memory.values.set(valueKey, cleanDisplayText(attribute.value));
      return { name: memory.names.get(nameKey)!, value: memory.values.get(valueKey)!, nameKey };
    });
    // attributeNamesKey escapes the separator: a name containing a comma can never read as two names.
    const sameStructure = attributeNamesKey(item.attributes) === memory.orderSet;
    const ordered = sameStructure
      ? memory.order.map((nameKey) => canonical.find((attribute) => attribute.nameKey === nameKey)!)
      : canonical;
    return {
      parentName: memory.parentName,
      attributes: ordered.map(({ name, value }) => ({ name, value })),
    };
  });
}

// ---------------------------------------------------------------- references

/**
 * FNV-1a (32 bits) as 8 hex digits: a small, dependency-free and synchronous
 * hash, identical in the browser and on the server. It only has to keep two
 * different identities apart inside a reference - a collision is detected and
 * reported as a conflict later, never silently merged.
 */
export function stableHash8(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** UPPER-CASE ASCII slug for a reference: accents removed, anything else becomes "-". */
export function slugForReference(value: string, maxLength = 60): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, maxLength)
    .replace(/-+$/, "");
}

export type ReferenceSource = "file" | "barcode" | "generated";
export type DerivedReference = { reference: string; source: Exclude<ReferenceSource, "file"> };

/**
 * The reference of a variant when the file gives none, DETERMINISTIC so that
 * importing the same file twice finds the same products:
 *   - with a barcode: the barcode itself (exact text);
 *   - otherwise: SLUG(parent)-SLUG(values)-<8 hex of the identity>, where the
 *     identity is the category + parent + combination.
 * Never a counter (it would break the re-import), never a random part. If the
 * reference already belongs to ANOTHER product, the classification reports a
 * conflict - it never overwrites.
 */
export function deriveVariantReference(input: {
  barcode?: string | null;
  parentName: string;
  categoryName?: string | null;
  attributes: readonly VariantAttribute[];
}): DerivedReference {
  if (input.barcode) return { reference: input.barcode, source: "barcode" };
  // The readable part follows the attribute NAMES in alphabetical order, so it does not depend on which row of the file came first.
  const byName = [...input.attributes].sort((a, b) => {
    const left = normalizeKey(a.name);
    const right = normalizeKey(b.name);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const parts = [slugForReference(input.parentName, 30), ...byName.map((attribute) => slugForReference(attribute.value, 12))].filter(Boolean);
  const base = parts.join("-").slice(0, 60).replace(/-+$/, "") || "P";
  const identity = ["v", normalizeKey(input.categoryName ?? ""), variantGroupKeyOf(input.parentName), variantKeyOf(input.attributes)].join(KEY_SEPARATOR);
  return { reference: `${base}-${stableHash8(identity)}`, source: "generated" };
}

/** The same rule for a product WITHOUT variants in a file that carries no reference. */
export function deriveSimpleReference(input: {
  barcode?: string | null;
  name: string;
  categoryName?: string | null;
}): DerivedReference {
  if (input.barcode) return { reference: input.barcode, source: "barcode" };
  const base = slugForReference(input.name, 60) || "P";
  const identity = ["p", normalizeKey(input.categoryName ?? ""), normalizeKey(input.name)].join(KEY_SEPARATOR);
  return { reference: `${base}-${stableHash8(identity)}`, source: "generated" };
}
