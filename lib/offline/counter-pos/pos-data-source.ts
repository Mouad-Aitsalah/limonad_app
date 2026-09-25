"use client";

/**
 * COUNTER POS - the POS context, from the server or from the local snapshot.
 *
 * The same idea as the driver layer's pos-data-source.ts (which is neither
 * modified nor imported): ONE DTO shape (`CounterPosContextDto`, exactly what
 * getCounterPosContext returns) whether it came from the server or from the
 * local cache, so a future PosLayout renders identically either way and no
 * OnlinePos / OfflinePos split is needed.
 *
 *   ONLINE                 -> GET /api/sales/context, then mirror it locally
 *   OFFLINE / UNREACHABLE  -> rebuild the same DTO from IndexedDB
 *   server error / 401     -> same, with `serverIssue` saying why
 *
 * Nothing here is wired into components/pos yet.
 *
 * SNAPSHOT RULES (each one is a decision, not an accident):
 *  - Catalogue is shared by the organization's users on this PC; stock is per
 *    stock location; the POS context (depot, bank accounts) is per user.
 *  - The context carries at most 500 products (`productsTruncated`). Products
 *    absent from a NON-truncated context are deleted (deactivated/removed
 *    server-side). When it IS truncated, absence proves nothing, so nothing
 *    is deleted - and an EMPTY incoming catalogue never purges a non-empty
 *    cache (it is far likelier a fault than a real "no products at all").
 *  - Customers arrive as a small preload, never the full list: they are only
 *    upserted, never deleted. (A full customer sync is a later phase.)
 *  - The stock snapshot is a SERVER value. It is never sent back. What the POS
 *    should DISPLAY is `snapshot - quantities of sales not yet applied by the
 *    server` (PENDING/SYNCING), which is what `applyPendingSales` does - the
 *    driver layer instead overwrites its local stock on refresh, forgetting
 *    its own unsynced sales.
 */

import type {
  CounterPosContextDto,
  CustomerDto,
  DriverPosProductDto,
} from "@/types/operations-dto";

import { assertScope, CounterPosStoreError, runStorage, toIso } from "./database";
import { getNetworkState as defaultGetNetworkState, type NetworkState } from "./network-status";
import type { OrganizationInfoInput } from "./profile-store";
import type {
  CounterPosScope,
  CustomerRecord,
  PosContextRecord,
  ProductRecord,
  StockLevelRecord,
  StoreErrorCode,
  StoreResult,
  SyncCounts,
} from "./schema";
import { getPendingQuantityByProduct } from "./sales-store";

// ---------------------------------------------------------------------------
// DTO <-> record mapping (pure, exported for tests)
// ---------------------------------------------------------------------------

/**
 * Product photos may come back from the counter context as a raw `data:` URL
 * (the driver context already swaps those for a lightweight route URL; the
 * counter one does not). Hundreds of base64 images would fill the local
 * quota, so they are NOT stored: the product simply has no photo offline.
 * Normal (http/relative) URLs are kept as-is. Caching photos properly (Cache
 * API through the service worker) is a later phase.
 */
export function storableImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  return imageUrl.startsWith("data:") ? null : imageUrl;
}

export function productRecordFromDto(
  organizationId: string,
  dto: DriverPosProductDto,
  syncedAt: string,
): ProductRecord {
  return {
    organizationId,
    id: dto.id,
    reference: dto.reference,
    barcode: dto.barcode ?? null,
    name: dto.name,
    imageUrl: storableImageUrl(dto.imageUrl),
    salePriceHT: dto.salePriceHT,
    salePriceTTC: dto.salePriceTTC,
    taxRate: dto.taxRate,
    supplierId: dto.supplierId ?? null,
    supplierName: dto.supplierName ?? null,
    supplierLogoUrl: dto.supplierLogoUrl ?? null,
    priceToken: dto.priceToken ?? null,
    syncedAt,
  };
}

export function productDtoFromRecord(
  record: ProductRecord,
  availableQuantity: number,
): DriverPosProductDto {
  return {
    id: record.id,
    reference: record.reference,
    barcode: record.barcode,
    name: record.name,
    imageUrl: record.imageUrl,
    salePriceHT: record.salePriceHT,
    salePriceTTC: record.salePriceTTC,
    taxRate: record.taxRate,
    availableQuantity,
    supplierId: record.supplierId,
    supplierName: record.supplierName,
    supplierLogoUrl: record.supplierLogoUrl,
    ...(record.priceToken ? { priceToken: record.priceToken } : {}),
  };
}

export function customerRecordFromDto(
  organizationId: string,
  dto: SnapshotCustomerInput,
  syncedAt: string,
): CustomerRecord {
  return {
    organizationId,
    id: dto.id,
    code: dto.code,
    displayCode: dto.displayCode,
    name: dto.name,
    phone: dto.phone,
    city: dto.city,
    type: dto.type,
    status: dto.status,
    creditLimit: dto.creditLimit,
    creditLimitEnabled: dto.creditLimitEnabled,
    syncedAt,
  };
}

/**
 * Rebuilds the DTO the POS components expect. Fields the cache deliberately
 * does not keep are filled with explicit neutral values, never invented data:
 * `currentBalance: 0` is NOT the customer's balance (the server owns it and
 * the credit ceiling is only enforced server-side), and `creationOrigin:
 * "CACHE"` marks the object as coming from this snapshot.
 */
export function customerDtoFromRecord(record: CustomerRecord): CustomerDto {
  return {
    id: record.id,
    code: record.code,
    displayCode: record.displayCode,
    name: record.name,
    phone: record.phone,
    address: "",
    city: record.city,
    type: record.type,
    status: record.status,
    creditLimit: record.creditLimit,
    creditLimitEnabled: record.creditLimitEnabled,
    currentBalance: 0,
    createdByUserId: "",
    createdByUserName: "",
    creationOrigin: "CACHE",
    createdAt: UNKNOWN_TIMESTAMP,
    updatedAt: UNKNOWN_TIMESTAMP,
  };
}

/** The snapshot does not keep a customer's real creation/update dates. A
 *  constant (rather than the sync time) keeps the rebuilt DTO identical from
 *  one sync to the next. */
const UNKNOWN_TIMESTAMP = "1970-01-01T00:00:00.000Z";

/** Pure: the context with each product's availableQuantity reduced by what
 *  sales not yet applied by the server have taken. May go negative (negative
 *  stock is an explicit business rule for sales). */
export function applyPendingSalesToContext(
  context: CounterPosContextDto,
  pendingByProduct: Record<string, number>,
): CounterPosContextDto {
  return {
    ...context,
    products: context.products.map((product) => {
      const pending = pendingByProduct[product.id] ?? 0;
      return pending === 0
        ? product
        : { ...product, availableQuantity: product.availableQuantity - pending };
    }),
  };
}

// ---------------------------------------------------------------------------
// Snapshot write
// ---------------------------------------------------------------------------

/** The customer fields the snapshot keeps. A full CustomerDto is assignable. */
export type SnapshotCustomerInput = Pick<
  CustomerDto,
  | "id"
  | "code"
  | "displayCode"
  | "name"
  | "phone"
  | "city"
  | "type"
  | "status"
  | "creditLimit"
  | "creditLimitEnabled"
>;

/** What hydrateCounterPosSnapshot needs. `CounterPosContextDto` (the server's
 *  own shape) is assignable to it, and so is the trimmed data the sync
 *  downloads - which is how private customer fields never even reach here. */
export type CounterPosSnapshotInput = Omit<CounterPosContextDto, "customers"> & {
  customers: SnapshotCustomerInput[];
};

export type DiffCounts = SyncCounts;

export type HydrateResult = {
  products: DiffCounts;
  customers: DiffCounts;
  stockLevels: number;
  /** True when the catalogue was reconciled (absent products deleted). */
  purgedMissingProducts: boolean;
  /** True when the customer list was reconciled (absent customers deleted). */
  purgedMissingCustomers: boolean;
};

export type HydrateOptions = {
  now?: Date;
  /** Organization name/logo, when the caller already has them. Written in the
   *  SAME transaction as the rest, so the snapshot is all-or-nothing. */
  organization?: OrganizationInfoInput;
  /**
   * The customers passed in are the COMPLETE list of active customers, so any
   * local customer they do not contain was deleted or deactivated server-side
   * and is removed. Default false: a customer preload is partial by design.
   * An EMPTY list never purges (see the products rule).
   */
  customersComplete?: boolean;
};

function assertContextShape(context: CounterPosSnapshotInput): void {
  if (
    !context ||
    !context.stockLocation ||
    typeof context.stockLocation.id !== "string" ||
    context.stockLocation.id === "" ||
    !context.depot ||
    !context.user ||
    !Array.isArray(context.products) ||
    !Array.isArray(context.customers)
  ) {
    throw new CounterPosStoreError("INVALID_INPUT", "Contexte POS invalide.");
  }
}

/** Mirrors a server context into the local snapshot, atomically (all tables
 *  or none). See the SNAPSHOT RULES in this file's header. */
export function hydrateCounterPosSnapshot(
  scope: CounterPosScope,
  context: CounterPosSnapshotInput,
  options: HydrateOptions = {},
): Promise<StoreResult<HydrateResult>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    assertContextShape(context);
    const organization = options.organization;
    if (organization && (typeof organization.name !== "string" || organization.name.trim() === "")) {
      throw new CounterPosStoreError("INVALID_INPUT", "Le nom de l'organisation est requis.");
    }
    const organizationId = scope.organizationId;
    const syncedAt = toIso(options.now);
    const stockLocationId = context.stockLocation.id;

    const products = context.products.map((dto) => productRecordFromDto(organizationId, dto, syncedAt));
    const stockLevels: StockLevelRecord[] = context.products.map((dto) => ({
      organizationId,
      stockLocationId,
      productId: dto.id,
      availableQuantity: dto.availableQuantity,
      syncedAt,
    }));
    const customers = context.customers.map((dto) => customerRecordFromDto(organizationId, dto, syncedAt));
    const contextRecord: PosContextRecord = {
      organizationId,
      userId: scope.userId,
      userName: context.user.name,
      depot: context.depot,
      stockLocation: context.stockLocation,
      defaultCustomerId: context.defaultCustomerId ?? null,
      canSell: context.canSell,
      message: context.message ?? null,
      productsTruncated: context.productsTruncated,
      bankAccounts: context.bankAccounts ?? [],
      syncedAt,
    };

    const purgeProducts = !context.productsTruncated && products.length > 0;
    const purgeCustomers = options.customersComplete === true && customers.length > 0;

    return db.transaction(
      "rw",
      [db.posContexts, db.products, db.stockLevels, db.customers, db.organizationInfo],
      async (): Promise<HydrateResult> => {
        const [existingProducts, existingCustomers] = await Promise.all([
          db.products.where("organizationId").equals(organizationId).toArray(),
          db.customers.where("organizationId").equals(organizationId).toArray(),
        ]);

        await db.posContexts.put(contextRecord);

        const productDiff = diffRecords(existingProducts, products, sameProduct, purgeProducts);
        await db.products.bulkPut(products);
        if (purgeProducts) {
          await db.products.bulkDelete(productDiff.removedKeys.map((id) => [organizationId, id]));
          await db.stockLevels
            .where("[organizationId+stockLocationId]")
            .equals([organizationId, stockLocationId])
            .delete();
        }
        await db.stockLevels.bulkPut(stockLevels);

        const customerDiff = diffRecords(existingCustomers, customers, sameCustomer, purgeCustomers);
        await db.customers.bulkPut(customers);
        if (purgeCustomers) {
          await db.customers.bulkDelete(customerDiff.removedKeys.map((id) => [organizationId, id]));
        }

        if (organization) {
          await db.organizationInfo.put({
            organizationId,
            name: organization.name,
            tradeName: organization.tradeName ?? null,
            logoUrl: organization.logoUrl ?? null,
            syncedAt,
          });
        }

        return {
          products: {
            total: purgeProducts ? products.length : existingProducts.length + productDiff.added,
            added: productDiff.added,
            updated: productDiff.updated,
            removed: productDiff.removedKeys.length,
          },
          customers: {
            total: purgeCustomers ? customers.length : existingCustomers.length + customerDiff.added,
            added: customerDiff.added,
            updated: customerDiff.updated,
            removed: customerDiff.removedKeys.length,
          },
          stockLevels: stockLevels.length,
          purgedMissingProducts: purgeProducts,
          purgedMissingCustomers: purgeCustomers,
        };
      },
    );
  });
}

type Diff = { added: number; updated: number; removedKeys: string[] };

/** Compares what is stored with what is coming in. `removedKeys` lists the
 *  stored ids the incoming set no longer contains - reported only when the
 *  caller says the incoming set is complete (`complete`). */
function diffRecords<T extends { id: string }>(
  existing: T[],
  incoming: T[],
  same: (a: T, b: T) => boolean,
  complete: boolean,
): Diff {
  const existingById = new Map(existing.map((record) => [record.id, record]));
  let added = 0;
  let updated = 0;
  for (const record of incoming) {
    const previous = existingById.get(record.id);
    if (!previous) added += 1;
    else if (!same(previous, record)) updated += 1;
  }
  const incomingIds = new Set(incoming.map((record) => record.id));
  const removedKeys = complete
    ? existing.filter((record) => !incomingIds.has(record.id)).map((record) => record.id)
    : [];
  return { added, updated, removedKeys };
}

/** Field-by-field equality ignoring `syncedAt` (which changes on every sync). */
function sameProduct(a: ProductRecord, b: ProductRecord): boolean {
  return (
    a.reference === b.reference &&
    a.barcode === b.barcode &&
    a.name === b.name &&
    a.imageUrl === b.imageUrl &&
    a.salePriceHT === b.salePriceHT &&
    a.salePriceTTC === b.salePriceTTC &&
    a.taxRate === b.taxRate &&
    a.supplierId === b.supplierId &&
    a.supplierName === b.supplierName &&
    a.supplierLogoUrl === b.supplierLogoUrl &&
    a.priceToken === b.priceToken
  );
}

function sameCustomer(a: CustomerRecord, b: CustomerRecord): boolean {
  return (
    a.code === b.code &&
    a.displayCode === b.displayCode &&
    a.name === b.name &&
    a.phone === b.phone &&
    a.city === b.city &&
    a.type === b.type &&
    a.status === b.status &&
    a.creditLimit === b.creditLimit &&
    a.creditLimitEnabled === b.creditLimitEnabled
  );
}

// ---------------------------------------------------------------------------
// Snapshot read
// ---------------------------------------------------------------------------

export type CachedContextResult =
  | {
      ok: true;
      context: CounterPosContextDto;
      /** When this user's context was last mirrored from the server. */
      syncedAt: string;
      counts: { products: number; customers: number; stockLevels: number };
    }
  | { ok: false; reason: "NOT_FOUND" | StoreErrorCode };

/**
 * Rebuilds a CounterPosContextDto from the local snapshot. `NOT_FOUND` means
 * this user's context was never mirrored on this PC; an EMPTY product list
 * with `ok: true` is a real (mirrored) empty state - whether to use it is the
 * caller's decision, never this function's.
 */
export async function loadCachedCounterPosContext(
  scope: CounterPosScope,
  options: { applyPendingSales?: boolean } = {},
): Promise<CachedContextResult> {
  const read = await runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const contextRecord = await db.posContexts.get([scope.organizationId, scope.userId]);
    if (!contextRecord) return null;

    const [productRecords, stockRecords, customerRecords] = await Promise.all([
      db.products.where("organizationId").equals(scope.organizationId).toArray(),
      db.stockLevels
        .where("[organizationId+stockLocationId]")
        .equals([scope.organizationId, contextRecord.stockLocation.id])
        .toArray(),
      db.customers.where("organizationId").equals(scope.organizationId).toArray(),
    ]);
    return { contextRecord, productRecords, stockRecords, customerRecords };
  });

  if (!read.ok) return { ok: false, reason: read.code };
  if (read.value === null) return { ok: false, reason: "NOT_FOUND" };

  const { contextRecord, productRecords, stockRecords, customerRecords } = read.value;
  // No stock row for a product = 0, the same rule getCounterPosContext applies.
  const stockByProduct = new Map(stockRecords.map((row) => [row.productId, row.availableQuantity]));
  const products = productRecords
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .map((record) => productDtoFromRecord(record, stockByProduct.get(record.id) ?? 0));
  const customers = customerRecords
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .map(customerDtoFromRecord);

  let context: CounterPosContextDto = {
    canSell: contextRecord.canSell,
    ...(contextRecord.message ? { message: contextRecord.message } : {}),
    user: { id: contextRecord.userId, name: contextRecord.userName },
    depot: contextRecord.depot,
    stockLocation: contextRecord.stockLocation,
    customers,
    defaultCustomerId: contextRecord.defaultCustomerId,
    products,
    productsTruncated: contextRecord.productsTruncated,
    bankAccounts: contextRecord.bankAccounts,
  };
  if (options.applyPendingSales !== false) context = await withPendingSales(scope, context);

  return {
    ok: true,
    context,
    syncedAt: contextRecord.syncedAt,
    counts: { products: products.length, customers: customers.length, stockLevels: stockRecords.length },
  };
}

async function withPendingSales(
  scope: CounterPosScope,
  context: CounterPosContextDto,
): Promise<CounterPosContextDto> {
  const pending = await getPendingQuantityByProduct(scope.organizationId, context.stockLocation.id);
  // If the pending sales cannot be read, showing the raw snapshot is better
  // than showing nothing - it is the same number the server would give.
  return pending.ok ? applyPendingSalesToContext(context, pending.value) : context;
}

// ---------------------------------------------------------------------------
// Orchestration: server first, cache as fallback
// ---------------------------------------------------------------------------

export class CounterPosContextFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "CounterPosContextFetchError";
  }
}

async function defaultFetchContext(): Promise<CounterPosContextDto> {
  const response = await fetch("/api/sales/context", { cache: "no-store" });
  let payload: { context?: CounterPosContextDto; message?: string } | null = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON body (proxy/edge error page): handled below as a failure.
  }
  if (!response.ok || !payload?.context) {
    throw new CounterPosContextFetchError(
      payload?.message ?? `Contexte POS indisponible (${response.status}).`,
      response.status,
    );
  }
  return payload.context;
}

export type ServerIssue = "OFFLINE" | "UNREACHABLE" | "AUTH_REQUIRED" | "SERVER_ERROR";

export type CounterPosContextResult =
  | {
      ok: true;
      source: "server";
      context: CounterPosContextDto;
      /** False when the server answered but the local mirror could not be written. */
      cached: boolean;
    }
  | {
      ok: true;
      source: "cache";
      context: CounterPosContextDto;
      cacheSyncedAt: string;
      /** Why the server was not used. */
      serverIssue: ServerIssue;
      counts: { products: number; customers: number; stockLevels: number };
    }
  | { ok: false; reason: "NOT_FOUND" | StoreErrorCode; serverIssue: ServerIssue | null };

export type LoadCounterPosContextDeps = {
  getNetworkState?: () => Promise<NetworkState>;
  fetchContext?: () => Promise<CounterPosContextDto>;
  now?: () => Date;
  organization?: OrganizationInfoInput;
  /** Default true: display `snapshot - pending`. See the file header. */
  applyPendingSales?: boolean;
};

export async function loadCounterPosContext(
  scope: CounterPosScope,
  deps: LoadCounterPosContextDeps = {},
): Promise<CounterPosContextResult> {
  const getState = deps.getNetworkState ?? (() => defaultGetNetworkState());
  const fetchContext = deps.fetchContext ?? defaultFetchContext;
  const applyPending = deps.applyPendingSales !== false;

  const state = await getState();
  let serverIssue: ServerIssue;

  if (state === "ONLINE") {
    try {
      let context = await fetchContext();
      const hydrated = await hydrateCounterPosSnapshot(scope, context, {
        now: deps.now?.(),
        organization: deps.organization,
      });
      if (!hydrated.ok) {
        console.warn("[COUNTER POS SNAPSHOT] server context not mirrored locally:", hydrated.message);
      }
      if (applyPending) context = await withPendingSales(scope, context);
      return { ok: true, source: "server", context, cached: hydrated.ok };
    } catch (error) {
      const status = error instanceof CounterPosContextFetchError ? error.status : null;
      serverIssue = status === 401 || status === 403 ? "AUTH_REQUIRED" : "SERVER_ERROR";
    }
  } else {
    serverIssue = state === "OFFLINE" ? "OFFLINE" : "UNREACHABLE";
  }

  const cached = await loadCachedCounterPosContext(scope, { applyPendingSales: applyPending });
  if (!cached.ok) return { ok: false, reason: cached.reason, serverIssue };
  return {
    ok: true,
    source: "cache",
    context: cached.context,
    cacheSyncedAt: cached.syncedAt,
    serverIssue,
    counts: cached.counts,
  };
}
