import {
  rowCarriesVariantData,
  type ClassifiedProductRow,
  type ProductImportRow,
  type ProductImportStatus,
  type ProductImportSummary,
} from "@/lib/products-import-rules";
import {
  VARIANT_LIMITS,
  attributeNamesKey,
  canonicalizeVariantGroups,
  deriveSimpleReference,
  deriveVariantReference,
  variantDisplayName,
  variantFileGroupKey,
  variantKeyOf,
  type VariantAttribute,
} from "@/lib/products-import-variants";

/**
 * The grouped preview of the products-with-variants import - pure, no database:
 * the server (the authority) and the tests share it.
 *
 *   1. prepareVariantRows   BEFORE the comparison with the database. The server
 *      recomputes, from the parent and the attributes, the designation and the
 *      reference of every variant line; a line whose values differ from what it
 *      sent is an ERROR (nothing is trusted, nothing is silently replaced). The
 *      recomputed values are what the classification looks up.
 *   2. finalizeVariantGroups  AFTER it. Existing products never overwritten by
 *      identity (a reference already held by a different product is a CONFLICT),
 *      duplicate combinations, mixed attribute structures and over-long groups are
 *      detected, and a group with ANY invalid line is BLOCKED AS A WHOLE: every
 *      line of the group becomes an ERROR/CONFLICT, so none is importable. Only
 *      statuses the existing write already refuses (ERROR, CONFLICT) are used, so
 *      a blocked group can never reach a database write, not even through the
 *      current batch writer.
 *
 * A file without any variants line goes through both steps untouched.
 */

export type ExternalVariantError = { groupKey: string; excelRow: number; message: string };

export type PreparedVariantRows = {
  rows: ProductImportRow[];
  /** Lines whose sent designation / reference / source do not match the recomputed ones (by Excel line). */
  problems: Map<number, string>;
  hasVariants: boolean;
};

const describeIdentity = (row: ClassifiedProductRow) => `variante ${(row.variantIdentity?.attributes ?? []).map((attribute) => `${attribute.name}: ${attribute.value}`).join(" | ")}`;
const attributesText = (attributes: readonly VariantAttribute[]) => attributes.map((attribute) => `${attribute.name}: ${attribute.value}`).join(" | ");

/** The key a file groups a variant line by (parent + category); null for a line that is not a variant. */
export function variantGroupKeyOfRow(row: Pick<ProductImportRow, "variantParentName" | "variantAttributes" | "categoryName">): string | null {
  if (!row.variantAttributes || !row.variantParentName) return null;
  return variantFileGroupKey(row.variantParentName, row.categoryName);
}

export function prepareVariantRows(rows: ProductImportRow[]): PreparedVariantRows {
  if (!rows.some(rowCarriesVariantData)) return { rows, problems: new Map(), hasVariants: false };

  // One spelling per group (the first occurrence), exactly like the browser did.
  const variantPositions: number[] = [];
  rows.forEach((row, position) => {
    if (row.variantAttributes && row.variantParentName) variantPositions.push(position);
  });
  const canonical = canonicalizeVariantGroups(
    variantPositions.map((position) => ({
      groupKey: variantFileGroupKey(rows[position].variantParentName!, rows[position].categoryName),
      parentName: rows[position].variantParentName!,
      attributes: rows[position].variantAttributes!,
    })),
  );
  const canonicalByPosition = new Map(variantPositions.map((position, index) => [position, canonical[index]]));

  const problems = new Map<number, string>();
  const prepared = rows.map((row, position) => {
    if (!rowCarriesVariantData(row)) return row;
    const fail = (message: string) => {
      if (!problems.has(row.excelRow)) problems.set(row.excelRow, message);
    };

    const variant = canonicalByPosition.get(position);
    if (variant) {
      const name = variantDisplayName(variant.parentName, variant.attributes);
      const derived = deriveVariantReference({
        barcode: row.barcode,
        parentName: variant.parentName,
        categoryName: row.categoryName,
        attributes: variant.attributes,
      });
      if (name.length > VARIANT_LIMITS.maxProductNameLength) {
        fail(`Désignation trop longue (${VARIANT_LIMITS.maxProductNameLength} caractères maximum) : « ${name} ».`);
      }
      if (row.reference !== derived.reference || row.referenceSource !== derived.source) {
        fail(`Référence incohérente avec la désignation et les attributs (reçue : ${row.reference}, attendue : ${derived.reference}).`);
      }
      if (row.name !== name) {
        fail(`Désignation incohérente avec les attributs (reçue : « ${row.name ?? ""} », attendue : « ${name} »).`);
      }
      return {
        ...row,
        name,
        reference: derived.reference,
        referenceSource: derived.source,
        variantParentName: variant.parentName,
        variantAttributes: variant.attributes,
      };
    }

    // A variants-format line WITHOUT attributes is an ordinary product: its reference is derived from its name.
    if (row.variantParentName !== undefined || row.variantAttributes !== undefined) {
      fail("Variante incomplète : le produit parent et les attributs vont ensemble.");
      return row;
    }
    if (row.name === undefined) {
      fail("Désignation manquante : la référence ne peut pas être calculée.");
      return row;
    }
    const derived = deriveSimpleReference({ barcode: row.barcode, name: row.name, categoryName: row.categoryName });
    if (row.reference !== derived.reference || row.referenceSource !== derived.source) {
      fail(`Référence incohérente avec la désignation (reçue : ${row.reference}, attendue : ${derived.reference}).`);
    }
    return { ...row, reference: derived.reference, referenceSource: derived.source };
  });

  return { rows: prepared, problems, hasVariants: true };
}

// ---------------------------------------------------------------- groups

export type VariantGroupSummary = {
  parentName: string;
  categoryName: string | null;
  /** Lines of the group. */
  variants: number;
  /** What the lines are (a blocked line counts for what it would have been). */
  new: number;
  update: number;
  unchanged: number;
  /** Lines that are themselves in error / conflict. */
  problems: number;
  /** Lines blocked only because of another line of their group. */
  blockedRows: number;
  blocked: boolean;
  /** « ligne 12 : … » - the first problem of a blocked group. */
  reason: string | null;
};

export type GroupedClassification = {
  rows: ClassifiedProductRow[];
  summary: ProductImportSummary;
  groups: VariantGroupSummary[];
};

const isProblem = (status: ProductImportStatus) => status === "ERROR" || status === "CONFLICT";

function countByStatus(rows: readonly ClassifiedProductRow[]): ProductImportSummary {
  const count = (predicate: (row: ClassifiedProductRow) => boolean) => rows.filter(predicate).length;
  const blocked = count((row) => row.wouldBe !== undefined);
  return {
    total: rows.length,
    new: count((row) => row.status === "NEW"),
    unchanged: count((row) => row.status === "EXISTING_UNCHANGED"),
    update: count((row) => row.status === "EXISTING_UPDATE"),
    conflicts: count((row) => row.status === "CONFLICT" && row.wouldBe === undefined),
    errors: count((row) => row.status === "ERROR" && row.wouldBe === undefined),
    ...(blocked > 0 ? { blocked } : {}),
  };
}

/**
 * What the database says about a variants line - never an overwrite of another product:
 *   - the variant identity (category + parent + combination) already exists under ANOTHER
 *     reference                                                    -> CONFLICT
 *   - the reference is held by a product that carries ANOTHER variant identity, or by a variant
 *     while this line is an ordinary product                       -> CONFLICT
 *   - the reference is held by an ORDINARY product (all four variant fields NULL): it receives
 *     the identity ONLY if reference, designation and category match exactly (and its barcode,
 *     if it has one, is the line's); otherwise                      -> CONFLICT
 *   - the reference is held by the same variant (same identity): a normal update. A different
 *     spelling of the designation is a visible change; a different category or barcode is a CONFLICT
 *   - the existing product's variant fields were not loaded (pure checks): the historical rule -
 *     a reference held by a product with another designation / category / barcode is a CONFLICT.
 */
function identityDecision(row: ClassifiedProductRow): { conflict: string } | { attach: true } | null {
  const identity = row.variantIdentity;
  if (row.variantOwner) {
    return { conflict: `Cette variante existe déjà sous la référence ${row.variantOwner.reference} (« ${row.variantOwner.name} ») : conflit, rien ne sera écrit.` };
  }
  if (row.status !== "EXISTING_UPDATE" && row.status !== "EXISTING_UNCHANGED") return null;

  const stored = row.existingVariant; // undefined = not loaded
  const differences: string[] = [];
  if (row.changes.name) differences.push(`désignation « ${row.changes.name.old ?? "—"} »`);
  if (row.changes.category) differences.push(`catégorie « ${row.changes.category.old ?? "—"} »`);
  if (row.changes.barcode && row.changes.barcode.old !== null) differences.push(`code-barres ${row.changes.barcode.old}`);
  const conflictWith = (what: string, list: string[]) => ({
    conflict: `Référence ${row.reference} déjà utilisée par ${what}${list.length ? ` (${list.join(", ")})` : ""} : conflit, rien ne sera écrit.`,
  });

  if (stored) {
    if (!identity) return conflictWith("une variante existante", differences);
    if (stored.groupKey !== identity.groupKey || stored.key !== identity.key) return conflictWith("une autre variante", differences);
    // the same variant: only its designation may be spelled differently
    const blocking = differences.filter((difference) => !difference.startsWith("désignation"));
    return blocking.length ? conflictWith("la même variante dans une autre catégorie ou avec un autre code-barres", blocking) : null;
  }
  if (stored === null && identity) {
    return differences.length ? conflictWith("un autre produit", differences) : { attach: true };
  }
  return differences.length ? conflictWith("un autre produit", differences) : null;
}

export function finalizeVariantGroups(
  classified: { rows: ClassifiedProductRow[]; summary: ProductImportSummary },
  options: {
    problems: ReadonlyMap<number, string>;
    externalErrors?: readonly ExternalVariantError[];
    /** The write: every variant line must declare its group's size (the preview may omit it). */
    requireGroupSize?: boolean;
  },
): GroupedClassification {
  const rows = classified.rows.map((row) => ({ ...row }));

  // 1. sent values that do not match the recomputed ones; 2. a reference held by a different product
  for (const row of rows) {
    const problem = options.problems.get(row.excelRow);
    if (problem) {
      row.status = "ERROR";
      row.message = problem;
      continue;
    }
    if (row.referenceSource !== undefined) {
      const decision = identityDecision(row);
      if (decision && "conflict" in decision) {
        row.status = "CONFLICT";
        row.message = decision.conflict;
      } else if (decision) {
        // an ordinary product that matches exactly joins the group: a visible update, even if nothing else changes
        row.status = "EXISTING_UPDATE";
        row.attachVariant = true;
        row.changes = { ...row.changes, variant: { old: null, new: describeIdentity(row) } };
        row.message = "Mise à jour détectée.";
      }
    }
  }

  // 3. the groups
  type Group = { key: string; positions: number[]; external: ExternalVariantError[] };
  const groups = new Map<string, Group>();
  rows.forEach((row, position) => {
    const key = variantGroupKeyOfRow(row);
    if (key === null) return;
    const group = groups.get(key) ?? { key, positions: [], external: [] };
    group.positions.push(position);
    groups.set(key, group);
  });
  for (const error of options.externalErrors ?? []) {
    const group = groups.get(error.groupKey);
    if (group) group.external.push(error);
  }

  const summaries: VariantGroupSummary[] = [];
  for (const group of groups.values()) {
    const members = group.positions.map((position) => rows[position]);

    // The group must arrive COMPLETE: the lines of the file that belong to it were all sent,
    // none hidden (invalid in the browser) and none left for another request. The write is
    // all-or-nothing per group, so a partial group is refused whole.
    // The size EXPECTED is computed here: the lines of the request plus the lines of this group the browser
    // reports it refused itself (each counted once). A line hidden from both makes the group short.
    const reportedLines = new Set(group.external.map((error) => error.excelRow));
    const received = members.length + reportedLines.size;
    const declared = new Set(members.flatMap((member) => (member.variantGroupSize !== undefined ? [member.variantGroupSize] : [])));
    const missingSize = members.some((member) => member.variantGroupSize === undefined);
    let completeness: string | null = null;
    if (declared.size > 1) completeness = "Tailles de groupe incohérentes dans la requête.";
    else if (declared.size === 1) {
      const expected = [...declared][0];
      if (received !== expected || missingSize) {
        completeness = `Groupe incomplet : ${received} ligne(s) reçue(s) sur ${expected} dans le fichier.`;
      }
    } else if (options.requireGroupSize) {
      completeness = "Taille du groupe manquante : le groupe ne peut pas être vérifié complet.";
    }
    if (completeness) {
      for (const member of members) {
        if (isProblem(member.status)) continue;
        member.status = "ERROR";
        member.message = completeness;
      }
    }

    // Duplicate combination (same attributes, any order / case): every line of it.
    const byIdentity = new Map<string, ClassifiedProductRow[]>();
    for (const member of members) {
      const identity = variantKeyOf(member.variantAttributes!);
      byIdentity.set(identity, [...(byIdentity.get(identity) ?? []), member]);
    }
    for (const sameIdentity of byIdentity.values()) {
      if (sameIdentity.length < 2) continue;
      const lines = sameIdentity.map((member) => member.excelRow).join(", ");
      for (const member of sameIdentity) {
        // the generic « Référence en double » of the classification is replaced by the clearer message
        if (member.status === "ERROR" || (member.status === "CONFLICT" && !member.message.startsWith("Référence en double"))) continue;
        member.status = "CONFLICT";
        member.message = `Combinaison en double dans le fichier : ${attributesText(member.variantAttributes!)} (lignes ${lines}).`;
      }
    }

    // One structure per group: the most common set of attribute names (the first seen on a tie).
    const structures = new Map<string, { count: number; names: string }>();
    for (const member of members) {
      const key = attributeNamesKey(member.variantAttributes!);
      const known = structures.get(key);
      if (known) known.count += 1;
      else structures.set(key, { count: 1, names: member.variantAttributes!.map((attribute) => attribute.name).join(", ") });
    }
    if (structures.size > 1) {
      const [expectedKey, expected] = [...structures.entries()].reduce((best, entry) => (entry[1].count > best[1].count ? entry : best));
      for (const member of members) {
        if (attributeNamesKey(member.variantAttributes!) === expectedKey || isProblem(member.status)) continue;
        member.status = "ERROR";
        member.message = `Structure d'attributs différente du reste du groupe (attendu : ${expected.names}).`;
      }
    }

    // Too many variants for one parent.
    members.forEach((member, index) => {
      if (index < VARIANT_LIMITS.maxVariantsPerParent || isProblem(member.status)) return;
      member.status = "ERROR";
      member.message = `Plus de ${VARIANT_LIMITS.maxVariantsPerParent} variantes pour ce parent.`;
    });

    // Is the group blocked? Any line of its own in problem, or a line the browser could not even send.
    const own = members.filter((member) => isProblem(member.status)).map((member) => ({ excelRow: member.excelRow, message: member.message }));
    const issues = [...own, ...group.external.map((error) => ({ excelRow: error.excelRow, message: error.message }))].sort((a, b) => a.excelRow - b.excelRow);
    const blocked = issues.length > 0;
    const parentName = members[0].variantParentName!;
    const reason = blocked ? `ligne ${issues[0].excelRow} : ${issues[0].message}` : null;
    const index = summaries.length;

    let blockedRows = 0;
    const counts = { new: 0, update: 0, unchanged: 0 };
    for (const member of members) {
      member.variantGroupIndex = index;
      if (blocked) {
        member.groupBlocked = true;
        if (!isProblem(member.status)) {
          member.wouldBe = member.status;
          member.status = "ERROR";
          member.message = `Groupe bloqué (${reason}) : aucune variante de « ${parentName} » ne sera importée.`;
          blockedRows += 1;
        }
      }
      const effective = member.wouldBe ?? member.status;
      if (effective === "NEW") counts.new += 1;
      else if (effective === "EXISTING_UPDATE") counts.update += 1;
      else if (effective === "EXISTING_UNCHANGED") counts.unchanged += 1;
    }
    summaries.push({
      parentName,
      categoryName: members[0].categoryName ?? null,
      variants: members.length,
      ...counts,
      problems: members.filter((member) => isProblem(member.status) && member.wouldBe === undefined).length,
      blockedRows,
      blocked,
      reason,
    });
  }

  return { rows, summary: countByStatus(rows), groups: summaries };
}
