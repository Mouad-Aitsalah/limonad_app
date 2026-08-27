export type StockLocationType = "warehouse" | "truck";

export type StockLocation = {
  id: string;
  code: string;
  name: string;
  type: StockLocationType;
  truckId: string | null;
  active: boolean;
};

export type StockMovementType =
  | "reception"
  | "truck_load"
  | "truck_return"
  | "return_merchandise"
  | "sale"
  | "adjustment";

export type StockItem = {
  id: string;
  productId: string;
  locationId: string;
  quantity: number;
  minimumQuantity: number;
  entries: number;
  exits: number;
  lastOutboundAt: Date | null;
  updatedAt: Date;
};

export type WarehouseStock = StockItem & {
  locationId: "loc-main-warehouse";
};

export type TruckStock = StockItem & {
  locationId: "loc-truck-1" | "loc-truck-2" | "loc-truck-3";
  truckId: "truck-1" | "truck-2" | "truck-3";
};

export type StockMovement = {
  id: string;
  date: Date;
  productId: string;
  quantity: number;
  originLocationId: string | null;
  destinationLocationId: string | null;
  user: string;
  type: StockMovementType;
};

export type StockTransferLine = {
  productId: string;
  quantity: number;
};

export type StockTransferStatus = "draft" | "validated" | "cancelled";

export type StockTransfer = {
  id: string;
  date: Date;
  originLocationId: string;
  destinationLocationId: string;
  user: string;
  status: StockTransferStatus;
  lines: StockTransferLine[];
};
