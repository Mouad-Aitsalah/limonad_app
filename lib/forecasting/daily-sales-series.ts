/**
 * Forecasting data layer, step 1 - pure helpers (no DB, no server-only) to turn
 * the sparse "days with sales" rows into a complete Produit x Jour series.
 * Dates are business days ("YYYY-MM-DD", see lib/business-day.ts).
 */

export type ProductDailySalesRow = {
  /** Business day, "YYYY-MM-DD". */
  date: string;
  productId: string;
  productName: string;
  quantitySold: number;
};

export type ProductLifetime = {
  productId: string;
  productName: string;
  /** Business day the product was created ("YYYY-MM-DD"). */
  createdDay: string;
};

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return date.toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, both included ("YYYY-MM-DD" compares lexicographically). */
export function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/**
 * Complete Produit x Jour series.
 *
 * - `rows` are the real sales (one row per product and day, quantities > 0).
 * - Each product's series starts at the EARLIER of its creation day and its
 *   first sale (a product imported after its historical sales must not lose
 *   them), never before: no zero is invented for days before the product
 *   existed. It ends at `to`.
 * - Days without a sale get quantitySold = 0.
 * - `products` lists the products to include; a product with sales but not
 *   listed is still included, starting at its first sale.
 * - Result is sorted by product name, then id, then date; one row per
 *   Produit x Jour, never a duplicate.
 */
export function densifyProductDailySales(input: {
  rows: ProductDailySalesRow[];
  products: ProductLifetime[];
  to: string;
}): ProductDailySalesRow[] {
  const salesByProduct = new Map<string, Map<string, number>>();
  const names = new Map<string, string>();
  for (const row of input.rows) {
    const days = salesByProduct.get(row.productId) ?? new Map<string, number>();
    days.set(row.date, (days.get(row.date) ?? 0) + row.quantitySold);
    salesByProduct.set(row.productId, days);
    names.set(row.productId, row.productName);
  }

  const created = new Map(input.products.map((product) => [product.productId, product]));
  const productIds = new Set([...created.keys(), ...salesByProduct.keys()]);

  const out: ProductDailySalesRow[] = [];
  const ordered = [...productIds]
    .map((id) => ({ id, name: created.get(id)?.productName ?? names.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id));

  for (const { id, name } of ordered) {
    const sales = salesByProduct.get(id);
    const firstSale = sales ? [...sales.keys()].sort()[0] : undefined;
    const createdDay = created.get(id)?.createdDay;
    const start = [createdDay, firstSale].filter((day): day is string => Boolean(day)).sort()[0];
    if (!start || start > input.to) continue;
    for (const date of enumerateDays(start, input.to)) {
      out.push({ date, productId: id, productName: name, quantitySold: sales?.get(date) ?? 0 });
    }
  }
  return out;
}
