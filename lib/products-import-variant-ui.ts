import type { ProductImportLine } from "@/lib/import-export/products-format";
import { variantFileGroupKey, type VariantAttribute } from "@/lib/products-import-variants";

/**
 * Browser-side helpers of the grouped preview of the products-with-variants
 * import - pure, tested without a browser. The server is the authority on every
 * result; these only prepare what is sent and what is shown.
 */

/** The VAT proposed for the NEW products of a variants file (the product form's default); the user confirms or changes it. */
export const DEFAULT_VARIANT_TAX_RATE = 20;

/**
 * The group a line of the file belongs to - the same key the server computes.
 * A line whose variants cell could not be read has no attributes but still names
 * its parent, so it still belongs to (and blocks) that group. null = an ordinary product.
 */
export function variantGroupKeyOfLine(line: Pick<ProductImportLine, "variantParentName" | "variantAttributes" | "variantRaw" | "name" | "categoryName">): string | null {
  if (line.variantParentName && line.variantAttributes) return variantFileGroupKey(line.variantParentName, line.categoryName);
  if (line.variantRaw !== undefined && line.name) return variantFileGroupKey(line.name, line.categoryName);
  return null;
}

export type LocalRowForGroups = { values: ProductImportLine; status: "VALID" | "ERROR"; message: string };

/**
 * The lines the browser refuses itself (they are never sent) but that belong to a
 * variants group: the server needs them to block the whole group, otherwise a
 * group with an unreadable line would look complete.
 */
export function externalVariantErrors(rows: readonly LocalRowForGroups[]): Array<{ groupKey: string; excelRow: number; message: string }> {
  const errors: Array<{ groupKey: string; excelRow: number; message: string }> = [];
  for (const row of rows) {
    if (row.status !== "ERROR") continue;
    const groupKey = variantGroupKeyOfLine(row.values);
    if (groupKey === null) continue;
    errors.push({ groupKey, excelRow: row.values.excelRow, message: row.message.slice(0, 500) || "Ligne invalide." });
  }
  return errors;
}

/** "TAILLE: S | COULEUR: NOIR" */
export function describeVariantAttributes(attributes: readonly VariantAttribute[] | undefined): string {
  return (attributes ?? []).map((attribute) => `${attribute.name}: ${attribute.value}`).join(" | ");
}

/** A VAT typed on the page ("20", "5,5", "7.5 %") -> number between 0 and 100, null when unreadable. */
export function parseTaxRateInput(text: string): number | null {
  const cleaned = text.trim().replace(/%$/, "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export type VariantDefaultsForm = { supplierId: string; taxRateText: string; confirmed: boolean };

/**
 * The creation defaults to send, or null while the user has not chosen a supplier,
 * typed a readable VAT AND explicitly confirmed. Nothing is ever assumed: the 20 %
 * on the page is only a proposal.
 */
export function confirmedCreationDefaults(form: VariantDefaultsForm): { supplierId: string; taxRate: number } | null {
  const taxRate = parseTaxRateInput(form.taxRateText);
  if (!form.confirmed || !form.supplierId || taxRate === null) return null;
  return { supplierId: form.supplierId, taxRate };
}

/** What stops the confirmation, for the button's tooltip / hint. */
export function variantDefaultsHint(form: VariantDefaultsForm): string | null {
  if (!form.supplierId) return "Choisissez le fournisseur des nouveaux produits.";
  if (parseTaxRateInput(form.taxRateText) === null) return "TVA invalide : un pourcentage entre 0 et 100.";
  if (!form.confirmed) return "Cochez la confirmation pour appliquer ce fournisseur et cette TVA aux nouveaux produits.";
  return null;
}

/**
 * The lines to WRITE, each with the size of its group in the FILE: every line of the file
 * counts - those the browser refuses itself too. A group whose unreadable line is never sent
 * therefore arrives short, and the server refuses it whole instead of writing the rest.
 * Ordinary lines come back as they are.
 */
export function withVariantGroupSizes<T extends ProductImportLine>(lines: readonly T[], allRows: ReadonlyArray<{ values: ProductImportLine }>): T[] {
  const sizes = new Map<string, number>();
  for (const row of allRows) {
    const key = variantGroupKeyOfLine(row.values);
    if (key !== null) sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  return lines.map((line) => {
    const key = variantGroupKeyOfLine(line);
    return key === null ? line : { ...line, variantGroupSize: sizes.get(key) ?? 1 };
  });
}

/**
 * The lines to send to the WRITE, from the preview's answer. An ordinary line goes if it is new or to update.
 * A variants group is written whole or not at all, so it goes COMPLETE - its unchanged lines too, they come
 * back "inchangé" without a write - as soon as one of its lines is new or to update, and never when any
 * line of it is blocked, in error or in conflict, or has no answer yet.
 */
export function selectLinesToWrite<T extends ProductImportLine>(
  lines: readonly T[],
  preview: ReadonlyMap<number, { status: string; groupBlocked?: boolean }>,
): T[] {
  const writable = (status: string | undefined) => status === "NEW" || status === "EXISTING_UPDATE";
  const groups = new Map<string, { writable: boolean; problem: boolean }>();
  for (const line of lines) {
    const key = variantGroupKeyOfLine(line);
    if (key === null) continue;
    const answer = preview.get(line.excelRow);
    const state = groups.get(key) ?? { writable: false, problem: false };
    if (!answer || answer.groupBlocked || answer.status === "ERROR" || answer.status === "CONFLICT") state.problem = true;
    if (writable(answer?.status)) state.writable = true;
    groups.set(key, state);
  }
  return lines.filter((line) => {
    const key = variantGroupKeyOfLine(line);
    if (key === null) return writable(preview.get(line.excelRow)?.status);
    const state = groups.get(key)!;
    return state.writable && !state.problem;
  });
}

/** The lines the browser refused itself that belong to the groups present in a batch - sent with it so the server counts them in the group's size. */
export function externalErrorsForBatch(
  batch: readonly ProductImportLine[],
  allRows: readonly LocalRowForGroups[],
): Array<{ groupKey: string; excelRow: number; message: string }> {
  const keys = new Set(batch.flatMap((line) => {
    const key = variantGroupKeyOfLine(line);
    return key === null ? [] : [key];
  }));
  return externalVariantErrors(allRows).filter((error) => keys.has(error.groupKey));
}
