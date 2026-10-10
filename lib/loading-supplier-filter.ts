import type { SupplierOption } from "@/components/pos/supplier-filter";

/**
 * Supplier filter of the /chargements (Transfert de Stock) screen: a pure
 * VIEW filter over what the page already shows. It never changes a quantity,
 * a draft line, a stock level or what gets saved - callers filter only what
 * they render / suggest.
 *
 * Rules:
 *  - no supplier selected ("Tous les fournisseurs") -> everything is kept;
 *  - a supplier selected -> only the items whose supplier id is exactly that
 *    supplier. An item WITHOUT a supplier is therefore hidden, and two
 *    suppliers with the same name stay two distinct suppliers (matched by id).
 */
type WithSupplierId = { supplierId?: string | null };
type SelectedSupplier = Pick<SupplierOption, "id"> | null;

export function matchesSupplier(item: WithSupplierId, supplier: SelectedSupplier): boolean {
  if (!supplier) return true;
  return Boolean(item.supplierId) && item.supplierId === supplier.id;
}

export function filterBySupplier<T extends WithSupplierId>(items: T[], supplier: SelectedSupplier): T[] {
  return supplier ? items.filter((item) => matchesSupplier(item, supplier)) : items;
}

/** Same rule for a product coming from the picker/search (its supplier is nested). */
export function productMatchesSupplier(
  product: { supplier?: { id: string } | null },
  supplier: SelectedSupplier,
): boolean {
  return matchesSupplier({ supplierId: product.supplier?.id ?? null }, supplier);
}

/**
 * Options of the selector: every existing (active) supplier, plus any supplier
 * already present on the sheet's lines that is not in that list (e.g. a
 * supplier deactivated since) so those lines stay filterable. Unique by id,
 * sorted by name.
 */
export function buildSupplierOptions(
  suppliers: SupplierOption[],
  lines: Array<{ supplierId?: string | null; supplierName?: string | null }>,
): SupplierOption[] {
  const byId = new Map<string, SupplierOption>();
  for (const supplier of suppliers) byId.set(supplier.id, supplier);
  for (const line of lines) {
    if (line.supplierId && line.supplierName && !byId.has(line.supplierId)) {
      byId.set(line.supplierId, { id: line.supplierId, name: line.supplierName });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
