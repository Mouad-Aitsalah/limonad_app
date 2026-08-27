import { products } from "@/lib/mock-data/products";
import type {
  StockLocation,
  StockMovement,
  StockMovementType,
  StockTransfer,
  TruckStock,
  WarehouseStock,
} from "@/types/stock";

export const stockLocations: StockLocation[] = [
  {
    id: "loc-main-warehouse",
    code: "DEP-01",
    name: "Depot principal",
    type: "warehouse",
    truckId: null,
    active: true,
  },
  {
    id: "loc-truck-1",
    code: "CAM-01",
    name: "Camion 1",
    type: "truck",
    truckId: "truck-1",
    active: true,
  },
  {
    id: "loc-truck-2",
    code: "CAM-02",
    name: "Camion 2",
    type: "truck",
    truckId: "truck-2",
    active: true,
  },
  {
    id: "loc-truck-3",
    code: "CAM-03",
    name: "Camion 3",
    type: "truck",
    truckId: "truck-3",
    active: true,
  },
];

const truckLocationIds = ["loc-truck-1", "loc-truck-2", "loc-truck-3"] as const;
const users = [
  "Responsable depot",
  "Chef magasin",
  "Chauffeur Camion 1",
  "Chauffeur Camion 2",
  "Chauffeur Camion 3",
] as const;

export const warehouseStock: WarehouseStock[] = products.map((product, index) => {
  const quantity = product.quantiteStock * 8 + (index % 5) * 12;

  return {
    id: `warehouse-stock-${product.id}`,
    productId: product.id,
    locationId: "loc-main-warehouse",
    quantity,
    minimumQuantity: product.stockAlerte * 3,
    entries: quantity + 80 + index * 6,
    exits: 80 + index * 6,
    lastOutboundAt: new Date(2026, 6, 28 - (index % 8), 10, 15),
    updatedAt: new Date(2026, 6, 30, 17, 20),
  };
});

export const truckStock: TruckStock[] = truckLocationIds.flatMap(
  (locationId, truckIndex) =>
    products.map((product, productIndex) => {
      const loaded = 10 + ((productIndex + 2) * (truckIndex + 3)) % 28;
      const sold = Math.min(loaded, 3 + ((productIndex + truckIndex) * 2) % 18);
      const returned = productIndex % 6 === truckIndex ? 2 : 0;
      const quantity = Math.max(0, loaded - sold - returned);

      return {
        id: `truck-stock-${truckIndex + 1}-${product.id}`,
        productId: product.id,
        locationId,
        truckId: `truck-${truckIndex + 1}` as TruckStock["truckId"],
        quantity,
        minimumQuantity: Math.max(3, Math.round(product.stockAlerte / 2)),
        entries: loaded,
        exits: sold + returned,
        lastOutboundAt:
          sold > 0
            ? new Date(2026, 6, 30 - truckIndex, 9 + (productIndex % 7), 20)
            : null,
        updatedAt: new Date(2026, 6, 30, 18, 5),
      };
    }),
);

const movementTypes: StockMovementType[] = [
  "reception",
  "truck_load",
  "sale",
  "truck_return",
  "adjustment",
];

function buildMovement(index: number): StockMovement {
  const product = products[index % products.length];
  const type = movementTypes[index % movementTypes.length];
  const truckLocationId = truckLocationIds[index % truckLocationIds.length];
  const date = new Date(2026, 6, 1 + (index % 30), 8 + (index % 10), (index * 7) % 60);
  const quantity = 4 + ((index * 3) % 46);

  if (type === "reception") {
    return {
      id: `stock-movement-${index + 1}`,
      date,
      productId: product.id,
      quantity,
      originLocationId: null,
      destinationLocationId: "loc-main-warehouse",
      user: users[index % users.length],
      type,
    };
  }

  if (type === "truck_load") {
    return {
      id: `stock-movement-${index + 1}`,
      date,
      productId: product.id,
      quantity,
      originLocationId: "loc-main-warehouse",
      destinationLocationId: truckLocationId,
      user: users[index % users.length],
      type,
    };
  }

  if (type === "truck_return") {
    return {
      id: `stock-movement-${index + 1}`,
      date,
      productId: product.id,
      quantity: Math.max(1, Math.round(quantity / 2)),
      originLocationId: truckLocationId,
      destinationLocationId: "loc-main-warehouse",
      user: users[index % users.length],
      type,
    };
  }

  if (type === "sale") {
    return {
      id: `stock-movement-${index + 1}`,
      date,
      productId: product.id,
      quantity: Math.max(1, Math.round(quantity / 3)),
      originLocationId: truckLocationId,
      destinationLocationId: null,
      user: users[index % users.length],
      type,
    };
  }

  return {
    id: `stock-movement-${index + 1}`,
    date,
    productId: product.id,
    quantity: index % 2 === 0 ? 2 : -1,
    originLocationId: index % 2 === 0 ? null : truckLocationId,
    destinationLocationId: index % 2 === 0 ? truckLocationId : null,
    user: users[index % users.length],
    type,
  };
}

export const stockMovements: StockMovement[] = Array.from(
  { length: 360 },
  (_, index) => buildMovement(index),
).sort((a, b) => b.date.getTime() - a.date.getTime());

export const stockTransfers: StockTransfer[] = [
  {
    id: "transfer-1",
    date: new Date("2026-07-30T08:30:00"),
    originLocationId: "loc-main-warehouse",
    destinationLocationId: "loc-truck-1",
    user: "Responsable depot",
    status: "validated",
    lines: products.slice(0, 5).map((product, index) => ({
      productId: product.id,
      quantity: 12 + index * 3,
    })),
  },
  {
    id: "transfer-2",
    date: new Date("2026-07-30T09:10:00"),
    originLocationId: "loc-main-warehouse",
    destinationLocationId: "loc-truck-2",
    user: "Chef magasin",
    status: "validated",
    lines: products.slice(5, 10).map((product, index) => ({
      productId: product.id,
      quantity: 10 + index * 4,
    })),
  },
];
