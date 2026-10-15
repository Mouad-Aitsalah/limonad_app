/**
 * « Regroupement des ventes »: one soft background per product, so the groups are easy to tell apart.
 * Pure (no React): the classes are full literal strings so Tailwind keeps them.
 *
 * The colour comes from the product's IDENTITY (a hash of its id), never from its row position, so a product
 * keeps its colour when the table is searched, collapsed or reloaded. The only adjustment: walking the FULL
 * product list in order, a product whose colour equals the previous product's takes the next palette colour,
 * so two neighbouring groups are never the same colour. That walk is done on the whole list (not the filtered
 * one), so searching never changes a colour.
 */
export type ProductTint = {
  /** Background of the whole group (main row, « Prix appliqué » rows, « Sous-total »). */
  bg: string;
  /** Bottom separator between this group and the next. */
  border: string;
};

// Very light, low-saturation tints (the -50 / -200 steps): dark text stays at full contrast.
export const PRODUCT_TINTS: readonly ProductTint[] = [
  { bg: "bg-sky-50", border: "border-sky-200" },
  { bg: "bg-emerald-50", border: "border-emerald-200" },
  { bg: "bg-violet-50", border: "border-violet-200" },
  { bg: "bg-amber-50", border: "border-amber-200" },
  { bg: "bg-rose-50", border: "border-rose-200" },
  { bg: "bg-teal-50", border: "border-teal-200" },
  { bg: "bg-indigo-50", border: "border-indigo-200" },
  { bg: "bg-lime-50", border: "border-lime-200" },
];

/** FNV-1a 32 bit: stable across runs, platforms and server / browser. */
export function hashProductKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The palette index a product starts from, before the neighbour adjustment. */
export function baseTintIndex(productKey: string, paletteSize = PRODUCT_TINTS.length): number {
  return hashProductKey(productKey) % paletteSize;
}

/** productId -> palette index, for the products in the given (full, unfiltered) order. */
export function assignProductTintIndexes(
  productKeys: readonly string[],
  paletteSize = PRODUCT_TINTS.length,
): Map<string, number> {
  const indexes = new Map<string, number>();
  let previous = -1;
  for (const key of productKeys) {
    let index = baseTintIndex(key, paletteSize);
    if (index === previous && paletteSize > 1) index = (index + 1) % paletteSize;
    indexes.set(key, index);
    previous = index;
  }
  return indexes;
}
