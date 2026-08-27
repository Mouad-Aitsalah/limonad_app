import { products } from "@/lib/mock-data/products";
import { stockLocations, truckStock, warehouseStock } from "@/lib/mock-data/stock";
import type { Product } from "@/types/product";
import type { StockItem, StockLocation, StockMovementType } from "@/types/stock";

export type StockRow = StockItem & {
  product: Product;
  location: StockLocation;
  stockValue: number;
};

export type StockFilters = {
  search: string;
  categoryId: string;
  brandId: string;
  supplierId: string;
};

export type StockTotals = {
  totalValue: number;
  productCount: number;
  outOfStockCount: number;
  lowStockCount: number;
  trucksValue: number;
};

export const stockMovementTypeLabels: Record<StockMovementType, string> = {
  reception: "Reception",
  truck_load: "Chargement camion",
  truck_return: "Retour camion",
  sale: "Vente",
  adjustment: "Ajustement",
  return_merchandise: "Retour marchandise",
};

export function normalizeStockText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function getProductById(productId: string) {
  return products.find((product) => product.id === productId);
}

export function getLocationById(locationId: string | null) {
  if (!locationId) return null;
  return stockLocations.find((location) => location.id === locationId) ?? null;
}

export function buildStockRows(items: StockItem[]): StockRow[] {
  return items.flatMap((item) => {
    const product = getProductById(item.productId);
    const location = getLocationById(item.locationId);

    if (!product || !location) return [];

    return {
      ...item,
      product,
      location,
      stockValue: item.quantity * product.prixAchatTTC,
    };
  });
}

export function filterStockRows(rows: StockRow[], filters: StockFilters) {
  const query = normalizeStockText(filters.search);
  const filteredByFacets = rows.filter((row) => {
    const matchesCategory =
      filters.categoryId === "all" || row.product.categorieId === filters.categoryId;
    const matchesBrand =
      filters.brandId === "all" || row.product.marqueId === filters.brandId;
    const matchesSupplier =
      filters.supplierId === "all" ||
      row.product.fournisseurId === filters.supplierId;

    return matchesCategory && matchesBrand && matchesSupplier;
  });

  if (query.length === 0) {
    return filteredByFacets;
  }

  const startsWithRows = filteredByFacets.filter((row) =>
    normalizeStockText(row.product.designation).startsWith(query),
  );

  if (startsWithRows.length > 0) {
    return startsWithRows;
  }

  return filteredByFacets.filter((row) => {
    const searchable = normalizeStockText(
      [
        row.product.designation,
        row.product.reference,
        row.product.codeBarres,
        row.location.name,
      ].join(" "),
    );

    return searchable.includes(query);
  });
}

export function computeStockTotals(truckItems: StockItem[] = truckStock): StockTotals {
  const warehouseRows = buildStockRows(warehouseStock);
  const truckRows = buildStockRows(truckItems);

  return {
    totalValue: warehouseRows.reduce((sum, row) => sum + row.stockValue, 0),
    productCount: warehouseRows.length,
    outOfStockCount: warehouseRows.filter((row) => row.quantity === 0).length,
    lowStockCount: warehouseRows.filter(
      (row) => row.quantity > 0 && row.quantity <= row.minimumQuantity,
    ).length,
    trucksValue: truckRows.reduce((sum, row) => sum + row.stockValue, 0),
  };
}
