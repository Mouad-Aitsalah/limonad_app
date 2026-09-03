export interface DepotDto {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  phone?: string | null;
  active: boolean;
  // The DEPOT-type StockLocation bound to this depot (1:1). Every depot
  // created through the app gets one in the same transaction; only legacy
  // rows might miss it.
  stockLocationName: string | null;
  stockLocationActive: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface DepotCreateInput {
  name: string;
}

export interface TruckDto {
  id: string;
  code: string;
  registration: string;
  brand?: string | null;
  model?: string | null;
  capacity?: number | null;
  status: string;
  active: boolean;
  depot: {
    id: string;
    code: string;
    name: string;
  };
  defaultDriver?: {
    id: string;
    name: string;
  } | null;
  assignedDriver?: {
    id: string;
    name: string;
  } | null;
  stockLocation?: {
    id: string;
    code: string;
    name: string;
  } | null;
  stockSummary?: {
    totalQuantity: number;
    productCount: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface DriverAssignmentDto {
  id: string;
  employeeCode: string;
  active: boolean;
  truckId?: string | null;
  user: {
    id: string;
    fullName: string;
    email: string;
  };
  truck?: {
    id: string;
    code: string;
    registration: string;
  } | null;
}

export type TruckMutationInput = {
  code: string;
  registration: string;
  brand?: string | null;
  model?: string | null;
  capacity?: number | null;
  status: string;
  depotId: string;
};

export interface StockLocationDto {
  id: string;
  code: string;
  name: string;
  type: "DEPOT" | "TRUCK";
  depotId?: string | null;
  truckId?: string | null;
  depotName?: string | null;
  truckCode?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockLevelDto {
  id: string;
  productId: string;
  productReference: string;
  productName: string;
  barcode?: string | null;
  categoryId: string;
  categoryName: string;
  brandId?: string | null;
  brandName?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  locationId: string;
  locationCode: string;
  locationName: string;
  locationType: "DEPOT" | "TRUCK";
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  minimumStock: number;
  salePrice: number;
  stockValue: number;
  status: "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK";
  updatedAt: string;
}

export interface StockMovementDto {
  id: string;
  movementNumber: string;
  type: string;
  productId: string;
  productReference: string;
  productName: string;
  quantity: number;
  sourceLocationId?: string | null;
  sourceLocationName?: string | null;
  destinationLocationId?: string | null;
  destinationLocationName?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  note?: string | null;
  locationId?: string | null;
  locationCode?: string | null;
  locationType?: "DEPOT" | "TRUCK" | null;
  beforeQuantity?: number | null;
  afterQuantity?: number | null;
  deltaQuantity?: number | null;
  createdByUserId: string;
  createdByUserName: string;
  createdAt: string;
  status: string;
}

/**
 * Phase 3: StockMovementDto itself was already light (no nested arrays like
 * SaleDto's lines[]/payments[] or TruckLoadingDto's lines[]) - the fix here
 * is pagination + server-side filters, not a lighter row shape. See
 * getStockMovementsPage's doc comment in stock-movements.ts.
 */
export interface StockMovementsPageDto {
  items: StockMovementDto[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export interface StockSummaryDto {
  totalValue: number;
  productCount: number;
  outOfStockCount: number;
  lowStockCount: number;
  trucksValue: number;
}

export type StockAdjustmentInput = {
  productId: string;
  locationId: string;
  quantity: number;
  targetQuantity?: number | null;
  adjustmentMode?: "DELTA" | "SET";
  reason: string;
  note?: string | null;
  reference?: string | null;
  createdByUserId?: string | null;
  confirmActiveTour?: boolean;
};

export interface TourDto {
  id: string;
  code: string;
  date: string;
  status: string;
  startedAt?: string | null;
  returnedAt?: string | null;
  closedAt?: string | null;
  depot: {
    id: string;
    code: string;
    name: string;
  };
  truck: {
    id: string;
    code: string;
    registration: string;
    status: string;
  };
  driver: {
    id: string;
    employeeCode: string;
    name: string;
  };
  loading?: TruckLoadingDto | null;
  stockSheet?: TourStockSheetDto | null;
  closure?: TourClosureDto | null;
  createdByUserName: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiscrepancyDto {
  id: string;
  type: string;
  productId: string | null;
  productReference: string | null;
  productName: string | null;
  quantity: number | null;
  amount: number | null;
  reason: string;
  justification: string;
  status: string;
  declaredByUserName: string;
  validatedByUserName: string | null;
  validatedAt: string | null;
  createdAt: string;
}

export interface TourClosureDto {
  id: string;
  tourId: string;
  theoreticalStockValue: number | null;
  actualStockValue: number | null;
  expectedCash: number;
  receivedCash: number;
  cashDifference: number;
  status: string;
  controlledByUserName: string | null;
  validatedByUserName: string | null;
  discrepancies: DiscrepancyDto[];
  createdAt: string;
  updatedAt: string;
}

export type TourClosureInput = {
  // Cash physically counted by the person closing the tour. Omitted =>
  // assumed equal to expectedCash (no cash discrepancy declared) - COMDIS
  // has no dedicated cash-counting UI yet, so this stays an optional
  // override rather than a fabricated gap.
  receivedCash?: number | null;
};

export interface TourStockSheetLineDto {
  productId: string;
  productReference: string;
  productName: string;
  productUnit: string;
  initialQuantity: number;
  loadedQuantity: number;
  reloadedQuantity: number;
  soldQuantity: number;
  // F4: sum of VALIDATED driver-return CreditNoteLine quantities for this
  // product on this exact tour (see createDriverReturn) - a depot return
  // never contributes here.
  returnedQuantity: number;
  theoreticalQuantity: number;
  actualQuantity?: number | null;
  differenceQuantity?: number | null;
  countedAt?: string | null;
  note?: string | null;
}

export interface TourStockSheetDto {
  truckCurrentQuantity: number;
  productCount: number;
  lines: TourStockSheetLineDto[];
}

export interface TourSummaryDto {
  id: string;
  code: string;
  date: string;
  status: string;
  depotName: string;
  truckCode: string;
  driverName: string;
  loadingStatus?: string | null;
  startedAt?: string | null;
  returnedAt?: string | null;
}

export interface DriverTourStartContextDto {
  date: string;
  driver: {
    id: string;
    name: string;
  };
  truck: {
    id: string;
    code: string;
    registration: string;
    status: string;
  };
  depot?: {
    id: string;
    code: string;
    name: string;
  } | null;
  stockCurrentQuantity: number;
  productCount: number;
  warning?: string | null;
}

/**
 * Phase 3: the light row shape for /chargements's history table - exactly
 * the fields that table actually renders (see loadings-view.tsx's history
 * TabsContent), never the per-line stock computation TruckLoadingDto's
 * `lines[]` carries (depotAvailableQuantity/truckCurrentQuantity/etc,
 * needed only by the single-record detail page). linesCount/totalQuantity
 * replace `lines.length`/`lines.reduce(sum, quantity)`, which is all the
 * history table ever derived from the full line list.
 */
export interface TruckLoadingListItemDto {
  id: string;
  loadingNumber: string;
  displayNumber: string;
  loadingYear: number | null;
  loadingSequence: number | null;
  tourCode: string | null;
  driverName: string;
  date: string;
  depotName: string;
  truckCode: string;
  status: string;
  linesCount: number;
  totalQuantity: number;
  createdAt: string;
  closedAt: string | null;
}

export interface TruckLoadingHistoryPageDto {
  items: TruckLoadingListItemDto[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export interface TruckLoadingDto {
  id: string;
  loadingNumber: string;
  displayNumber: string;
  loadingYear: number | null;
  loadingSequence: number | null;
  tourId: string | null;
  /** The tour that claimed this loading when its driver started (see lib/server/tours.ts#claimLoadingAndStartTour) - null until then, permanently once claimed. */
  tourCode: string | null;
  driverId: string;
  driverName: string;
  date: string;
  depotId: string;
  depotName: string;
  truckId: string;
  truckCode: string;
  status: string;
  stockAppliedAt?: string | null;
  validatedAt?: string | null;
  closedAt?: string | null;
  validatedByUserName?: string | null;
  createdByUserName: string;
  updatedByUserName?: string | null;
  lines: TruckLoadingLineDto[];
  createdAt: string;
  updatedAt: string;
}

export interface TruckLoadingLineDto {
  id: string;
  productId: string;
  productReference: string;
  productName: string;
  /** Phase 3 CRITICAL #1 fix: embedded directly so an already-loaded line's
   * barcode/unit render correctly even when its product isn't in the
   * picker's current small preload/search results - see LoadingsView's
   * draftLines sync and getProductPickerPreload's doc comment. */
  productBarcode: string | null;
  productUnit: string;
  quantity: number;
  initialQuantity: number;
  reloadedQuantity: number;
  depotAvailableQuantity: number;
  truckCurrentQuantity: number;
  depotAfterLoading: number;
  truckAfterLoading: number;
  theoreticalRemainingQuantity: number | null;
  actualRemainingQuantity: number | null;
}

export type TruckLoadingCreateInput = {
  truckId: string;
  driverId: string;
  date: string;
};

export type TruckLoadingEditInput = {
  lines: {
    productId: string;
    initialQuantity: number;
    reloadedQuantity: number;
    actualRemainingQuantity?: number | null;
  }[];
};

export interface CurrentDriverTourDto {
  tour: TourDto | null;
  message: string;
  startContext?: DriverTourStartContextDto | null;
  canStart: boolean;
  canReturn: boolean;
  customers: DriverTourCustomerDto[];
  route: DriverTourPositionDto[];
  stops: DriverTourStopDto[];
  latestPosition?: DriverTourPositionDto | null;
  proximity?: DriverTourProximityDto | null;
  summary?: DriverTourSummaryDto | null;
}

export interface DriverTourCustomerDto {
  id: string;
  code: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
  distanceMeters?: number | null;
  visitStatus: "PENDING" | "NEARBY" | "ARRIVED" | "DELIVERED" | "NO_SALE";
  lastEventAt?: string | null;
  noSaleReason?: string | null;
}

export interface DriverTourPositionDto {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  recordedAt: string;
}

export interface DriverTourStopDto {
  id: string;
  latitude: number;
  longitude: number;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  isActive: boolean;
}

export interface DriverTourProximityDto {
  customerId: string;
  customerName: string;
  distanceMeters: number;
}

export interface DriverTourSummaryDto {
  routePointCount: number;
  distanceMeters: number;
  customersNearby: number;
  customersArrived: number;
  customersDelivered: number;
  customersNoSale: number;
  salesCount: number;
  totalSalesTTC: number;
  theoreticalStockQuantity: number;
  stockCurrentQuantity: number;
  actualStockQuantity?: number | null;
  discrepancyQuantity?: number | null;
  /**
   * Phase 3 CRITICAL #2 fix: total customers this driver can access
   * (organization-wide ADMIN-origin + their own), from a cheap count() -
   * `customers` on CurrentDriverTourDto is now bounded to this tour's
   * in-play visits (NEARBY/ARRIVED/DELIVERED/NO_SALE), so it can no longer
   * be used as the "X/Y clients" denominator. This field replaces that use
   * without re-fetching the full customer list. See buildCurrentDriverTourState's
   * doc comment in lib/server/driver-tour.ts.
   */
  totalAccessibleCustomers: number;
}

export type TourMutationInput = {
  date: string;
  truckId: string;
};

export type TourStockCountMutationInput = {
  lines: {
    productId: string;
    actualQuantity: number;
    note?: string | null;
  }[];
};

export type TruckLoadingMutationInput = {
  lines: {
    productId: string;
    initialQuantity: number;
    reloadedQuantity: number;
  }[];
};

export type TruckLoadingValidationInput = {
  lines: {
    productId: string;
    actualRemainingQuantity: number;
  }[];
};

export interface CustomerDto {
  id: string;
  /** Stored account code, e.g. "34211" (never change this - it is the unique key). */
  code: string;
  /** Presentation form of `code`, e.g. "3421/1" (see lib/customer-code.ts). Display only. */
  displayCode: string;
  name: string;
  phone: string;
  email?: string | null;
  address: string;
  city: string;
  type: string;
  status: string;
  creditLimit: number;
  currentBalance: number;
  ice?: string | null;
  taxId?: string | null;
  contactName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracy?: number | null;
  locationUpdatedAt?: string | null;
  notes?: string | null;
  createdByUserId: string;
  createdByUserName: string;
  createdByDriverId?: string | null;
  createdFromTruckId?: string | null;
  creationOrigin: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Phase 3 CRITICAL #2 follow-up: cursor-paginated + server-searched
 * companion to getCustomersForCurrentDriver() (which stayed unbounded on
 * purpose, per the first CRITICAL #2 report - now itself the finding being
 * fixed here). Same shape/convention as ProductsPageDto (types/product-dto.ts)
 * - items/nextCursor/hasMore/totalCount from a cursor query, `totalCount`
 * reflecting the current search filter (or everything, with none). The 3
 * metric counts are always UNFILTERED (independent of `search`), matching
 * the "Total clients / Actifs / Bloques / Ajoutes par vous" cards' original
 * behavior (computed from the full accessible list before this fix).
 */
export interface DriverCustomersPageDto {
  items: CustomerDto[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
  totalAccessibleCustomers: number;
  activeCount: number;
  blockedCount: number;
  ownCreatedCount: number;
  /**
   * Resolved separately when `guaranteeCustomerId` was passed and that
   * customer isn't on the current page - e.g. a deep link from the "client
   * proche" banner (?customerId=...) must resolve regardless of which page
   * it would otherwise fall on. Null if not requested, not found, or
   * already present in `items`.
   */
  guaranteedCustomer: CustomerDto | null;
}

export interface SupplierPartnerDto {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  ice?: string | null;
  taxId?: string | null;
  active: boolean;
  productsCount: number;
  purchasesCount: number;
  createdAt: string;
  updatedAt: string;
}

export type CustomerMutationInput = {
  code?: string | null;
  name: string;
  phone: string;
  email?: string | null;
  address: string;
  city: string;
  type: string;
  status?: string;
  creditLimit?: number;
  ice?: string | null;
  taxId?: string | null;
  contactName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracy?: number | null;
  notes?: string | null;
};

export interface DriverPosProductDto {
  id: string;
  reference: string;
  barcode?: string | null;
  name: string;
  imageUrl?: string | null;
  salePriceHT: number;
  salePriceTTC: number;
  taxRate: number;
  availableQuantity: number;
}

export interface DriverPosContextDto {
  canSell: boolean;
  message?: string;
  driver: { id: string; name: string };
  truck?: { id: string; code: string; registration: string; status?: string } | null;
  tour?: { id: string; code: string; status: string } | null;
  customers: CustomerDto[];
  products: DriverPosProductDto[];
  /** Truck stock location id, when known - lets the frontend fall back to
   * GET /api/products/search?locationId=... when productsTruncated is true. */
  stockLocationId?: string | null;
  /** true when `products` was capped (see POS_PRODUCT_LIST_LIMIT) and more
   * sellable products exist at this location than were returned - the
   * frontend must fall back to a server search instead of trusting the
   * preloaded list to contain everything. */
  productsTruncated: boolean;
}

export interface CounterPosContextDto {
  canSell: boolean;
  message?: string;
  user: { id: string; name: string };
  depot: { id: string; code: string; name: string };
  stockLocation: { id: string; code: string; name: string };
  customers: CustomerDto[];
  products: DriverPosProductDto[];
  /** See DriverPosContextDto.productsTruncated. */
  productsTruncated: boolean;
}

export interface SaleLineDto {
  id: string;
  productId: string;
  productReference: string;
  productName: string;
  quantity: number;
  unitPriceHT: number;
  discountRate: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  totalHT: number;
  totalTTC: number;
}

export interface PaymentDto {
  id: string;
  paymentNumber: string;
  amount: number;
  method: string;
  status: string;
  reference?: string | null;
  receivedAt: string;
}

/**
 * Phase 3: the light row shape for /ventes's Commandes table (and the
 * session/month drilldown dialogs, which reuse the same list) - exactly
 * the fields InvoicesTable renders, never a sale's full lines[]/payments[]
 * (see SaleDto below, still used verbatim by the detail dialog, fetched
 * on demand for exactly one sale at a time via GET /api/sales/[id]).
 * articleCount replaces `lines.reduce(sum, quantity)`, which is all the
 * list ever derived from the full line list.
 */
export interface SaleHistoryListItemDto {
  id: string;
  invoiceNumber: string;
  displayNumber: string;
  posSessionId: string | null;
  status: string;
  customer: { id: string; code: string; name: string } | null;
  driver: { id: string; name: string } | null;
  articleCount: number;
  totalTTC: number;
  net: number;
  paidAmount: number;
  creditAmount: number;
  paymentMethod: string;
  createdByUserName: string;
  createdAt: string;
}

export interface SaleHistoryOrdersPageDto {
  items: SaleHistoryListItemDto[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export interface SaleDto {
  id: string;
  invoiceNumber: string;
  saleYear: number | null;
  saleNumber: number | null;
  displayNumber: string;
  posSessionId: string | null;
  /** Total minus validated customer credit notes tied to this sale. Only set by sales-history aggregation. */
  net?: number;
  origin: string;
  status: string;
  customer?: { id: string; code: string; name: string } | null;
  depot?: { id: string; name: string } | null;
  driver?: { id: string; name: string } | null;
  truck?: { id: string; code: string; registration: string } | null;
  tour?: { id: string; code: string; status: string; date: string } | null;
  subtotalHT: number;
  discountAmount: number;
  taxAmount: number;
  totalTTC: number;
  stampAmount: number;
  paidAmount: number;
  creditAmount: number;
  paymentMethod: string;
  createdByUserName: string;
  validatedAt?: string | null;
  createdAt: string;
  lines: SaleLineDto[];
  payments: PaymentDto[];
}

export interface PosSessionDto {
  id: string;
  number: number;
  year: number;
  displayNumber: string;
  openedAt: string;
  closedAt: string | null;
  status: "OPEN" | "CLOSED";
  ordersCount: number;
  totalSales: number;
  totalRefunds: number;
  totalNet: number;
}

export interface SalesMonthDto {
  key: string;
  monthNumber: number;
  year: number;
  displayNumber: string;
  label: string;
  ordersCount: number;
  totalSales: number;
  totalRefunds: number;
  totalNet: number;
}

export interface SalesHistoryDto {
  orders: SaleDto[];
  sessions: PosSessionDto[];
  months: SalesMonthDto[];
}

export interface DriverTourSalesSummaryDto {
  tourId: string;
  tourCode: string;
  date: string;
  truckCode: string;
  status: string;
  salesCount: number;
  customersCount: number;
  totalQuantity: number;
  totalHT: number;
  totalTax: number;
  totalTTC: number;
  paidAmount: number;
  creditAmount: number;
  sales: SaleDto[];
}

export type DriverSaleInput = {
  customerId?: string | null;
  paymentMethod: string;
  paidAmount?: number;
  reference?: string | null;
  stampAmount?: number;
  lines: {
    productId: string;
    quantity: number;
    discountRate?: number;
  }[];
};

export type CounterSaleInput = DriverSaleInput;

export interface InventoryLineDto {
  id: string;
  productId: string;
  productReference: string;
  productName: string;
  productBarcode: string | null;
  productUnit: string;
  stockBefore: number;
  unitCost: number;
  physicalQuantity: number;
  differenceQuantity: number;
  lineValue: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventorySummaryDto {
  id: string;
  number: number;
  displayNumber: string;
  status: "EN_COURS" | "TERMINE";
  depotId: string;
  depotName: string;
  createdByUserName: string;
  createdAt: string;
  finishedAt: string | null;
  linesCount: number;
  totalValue: number;
  totalStockBefore: number;
  totalDifference: number;
}

export interface InventoryDto extends InventorySummaryDto {
  lines: InventoryLineDto[];
}

export type InventoryCreateInput = {
  depotId: string;
};

export type InventoryLineSaveInput = {
  productId: string;
  physicalQuantity: number;
};
