import "server-only";

import { boundingBoxAround } from "@/lib/gps/gps-utils";
import { prisma } from "@/lib/prisma";
import {
  ensureUniquePhone,
  mapCustomerToDto,
  nextCustomerCode,
  parseCustomerInput,
  resolveLocationUpdatedAt,
  withSerializableRetry,
} from "@/lib/server/customers";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { Prisma } from "@/lib/generated/prisma/client";
import type {
  CustomerDto,
  CustomerMutationInput,
  DriverCustomersPageDto,
} from "@/types/operations-dto";

const customerInclude = {
  createdBy: { select: { fullName: true } },
} as const;

/**
 * CRITICAL #2 follow-up: kept unbounded and reachable through its own raw
 * endpoint (GET /api/driver/customers) only, exactly like getProducts()/
 * GET /api/products after the CRITICAL #1 fix - not deleted outright in
 * case something external still calls it directly, but no longer used
 * anywhere in the app. /driver/clients (the only real caller) now uses
 * getDriverCustomersPage() below instead.
 */
export async function getCustomersForCurrentDriver(): Promise<CustomerDto[]> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId) throw new OperationsServiceError("Profil chauffeur introuvable.", 403);

  const customers = await prisma.customer.findMany({
    where: {
      organizationId: user.organizationId,
      OR: [{ creationOrigin: "ADMIN" }, { createdByDriverId: user.driverId }],
    },
    include: customerInclude,
    orderBy: { name: "asc" },
  });
  return customers.map(mapCustomerToDto);
}

function driverAccessWhere(organizationId: string, driverId: string): Prisma.CustomerWhereInput {
  return {
    organizationId,
    OR: [{ creationOrigin: "ADMIN" }, { createdByDriverId: driverId }],
  };
}

/** Same fields/substring-match semantics as searchCustomers() (lib/server/customers.ts) - name, code, phone, email. */
function driverCustomerSearchWhere(search: string): Prisma.CustomerWhereInput {
  return {
    OR: [
      { name: { contains: search, mode: "insensitive" } },
      { code: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ],
  };
}

const DRIVER_CUSTOMERS_DEFAULT_PAGE_SIZE = 25;
const DRIVER_CUSTOMERS_MAX_PAGE_SIZE = 100;

function clampDriverCustomersPageSize(pageSize: number | undefined): number {
  const requested = Math.trunc(pageSize ?? DRIVER_CUSTOMERS_DEFAULT_PAGE_SIZE);
  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, DRIVER_CUSTOMERS_MAX_PAGE_SIZE)
    : DRIVER_CUSTOMERS_DEFAULT_PAGE_SIZE;
}

export type DriverCustomersPageParams = {
  cursor?: string | null;
  pageSize?: number;
  /** name / code / phone / email - same fields searchCustomers() matches. */
  search?: string;
  /** Resolved separately (and returned as `guaranteedCustomer`) when not on
   * the current page - e.g. a ?customerId= deep link from the "client
   * proche" banner must resolve regardless of pagination. */
  guaranteeCustomerId?: string | null;
};

/**
 * CRITICAL #2 follow-up: cursor-paginated + server-searched replacement for
 * /driver/clients' full-list load (was getCustomersForCurrentDriver(),
 * unbounded - see that function's doc comment). Same
 * `createdAt desc, id desc` stable-sort + cursor-pagination convention as
 * every other Phase 3 list (getProductsPage is the direct precedent). The 3
 * metric counts (Total/Actifs/Bloques/Ajoutes par vous) are cheap count()
 * calls, always unfiltered by `search` - matching the page's original
 * "always shows the true totals" behavior, now without ever fetching every
 * row to compute them.
 */
export async function getDriverCustomersPage(
  params: DriverCustomersPageParams = {},
): Promise<DriverCustomersPageDto> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId) throw new OperationsServiceError("Profil chauffeur introuvable.", 403);
  const organizationId = user.organizationId;
  const driverId = user.driverId;

  const pageSize = clampDriverCustomersPageSize(params.pageSize);
  const accessWhere = driverAccessWhere(organizationId, driverId);
  const search = params.search?.trim();
  const where: Prisma.CustomerWhereInput = search
    ? { AND: [accessWhere, driverCustomerSearchWhere(search)] }
    : accessWhere;

  const [rows, totalCount, totalAccessibleCustomers, activeCount, blockedCount, ownCreatedCount] =
    await Promise.all([
      prisma.customer.findMany({
        where,
        include: customerInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pageSize + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      }),
      prisma.customer.count({ where }),
      prisma.customer.count({ where: accessWhere }),
      prisma.customer.count({ where: { ...accessWhere, status: "ACTIVE" } }),
      prisma.customer.count({ where: { ...accessWhere, status: "BLOCKED" } }),
      prisma.customer.count({
        where: { ...accessWhere, createdByDriverId: driverId, creationOrigin: "DRIVER" },
      }),
    ]);

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

  let guaranteedCustomer: CustomerDto | null = null;
  if (params.guaranteeCustomerId && !pageRows.some((row) => row.id === params.guaranteeCustomerId)) {
    const found = await prisma.customer.findFirst({
      where: { ...accessWhere, id: params.guaranteeCustomerId },
      include: customerInclude,
    });
    guaranteedCustomer = found ? mapCustomerToDto(found) : null;
  }

  return {
    items: pageRows.map(mapCustomerToDto),
    nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    hasMore,
    totalCount,
    totalAccessibleCustomers,
    activeCount,
    blockedCount,
    ownCreatedCount,
    guaranteedCustomer,
  };
}

const PROXIMITY_FEED_RADIUS_METERS = 100_000; // ~100km: generous single-day operating area
const PROXIMITY_FEED_HARD_CAP = 500;

/**
 * Phase 3 CRITICAL #2 fix (included extra): hooks/use-driver-runtime.tsx
 * does its own LOCAL, GPS-reactive proximity/hysteresis computation (the
 * "nearby customer" banner) over whatever customer list it is given - it
 * must react instantly to every GPS reading with no network round-trip, so
 * it cannot be turned into a search-on-demand picker the way a plain list
 * screen can (see getProductPickerPreload's precedent, which does not apply
 * here). It used to be fed by getCustomersForCurrentDriver() (every
 * accessible customer, unbounded). This scopes the SAME candidate pool
 * (identical access rule) to a box around the driver's own most recent GPS
 * position (any of their tours, most recent ping first) - a square that
 * always fully contains everything within the radius, so no genuinely
 * nearby customer can ever be excluded (see boundingBoxAround) - plus a
 * hard cap as a second, unconditional bound. Only customers with
 * coordinates are fetched at all, since a customer with no location can
 * never be "nearby". Falls back to a hard-capped, coordinate-bearing set
 * ordered by most-recently-updated only when this driver has no GPS history
 * yet at all (their very first session, before any ping has ever been
 * recorded) - self-resolving after that first ping.
 */
export async function getDriverProximityCustomers(): Promise<CustomerDto[]> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId) throw new OperationsServiceError("Profil chauffeur introuvable.", 403);

  const referencePing = await prisma.tourLocationPing.findFirst({
    where: { tour: { driverId: user.driverId, organizationId: user.organizationId } },
    orderBy: { recordedAt: "desc" },
    select: { latitude: true, longitude: true },
  });

  const baseWhere = {
    organizationId: user.organizationId,
    OR: [{ creationOrigin: "ADMIN" as const }, { createdByDriverId: user.driverId }],
    latitude: { not: null },
    longitude: { not: null },
  };

  if (!referencePing) {
    const customers = await prisma.customer.findMany({
      where: baseWhere,
      include: customerInclude,
      orderBy: { updatedAt: "desc" },
      take: PROXIMITY_FEED_HARD_CAP,
    });
    return customers.map(mapCustomerToDto);
  }

  const box = boundingBoxAround(
    referencePing.latitude.toNumber(),
    referencePing.longitude.toNumber(),
    PROXIMITY_FEED_RADIUS_METERS,
  );
  const customers = await prisma.customer.findMany({
    where: {
      ...baseWhere,
      latitude: { not: null, gte: box.minLat, lte: box.maxLat },
      longitude: { not: null, gte: box.minLng, lte: box.maxLng },
    },
    include: customerInclude,
    orderBy: { name: "asc" },
    take: PROXIMITY_FEED_HARD_CAP,
  });
  return customers.map(mapCustomerToDto);
}

export async function createCustomerForCurrentDriver(
  input: CustomerMutationInput,
  customerId?: string,
): Promise<CustomerDto> {
  const user = await requireOrganizationUser(["driver"]);
  if (!user.driverId) throw new OperationsServiceError("Profil chauffeur introuvable.", 403);
  const data = await parseCustomerInput(input);
  await ensureUniquePhone(user.organizationId, data.phone, customerId);

  // F10: read-then-write in both branches (update re-checks ownership fresh,
  // create's nextCustomerCode counts existing rows) - a retry after a
  // Serializable conflict (P2034) or a numbering/code race (P2002) simply
  // re-reads current state, never a duplicate or partial write. Reuses
  // customers.ts's withSerializableRetry, already imported above.
  const customer = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
      if (customerId) {
        const existing = await tx.customer.findFirst({
          where: {
            id: customerId,
            organizationId: user.organizationId,
          },
          select: { id: true, createdByDriverId: true, status: true },
        });
        if (!existing) throw new OperationsServiceError("Client introuvable.", 404);
        if (existing.createdByDriverId !== user.driverId) {
          throw new OperationsServiceError("Vous ne pouvez modifier que vos clients.", 403);
        }

        return tx.customer.update({
          where: { id: customerId },
          data: {
            name: data.name,
            phone: data.phone,
            email: data.email,
            address: data.address,
            city: data.city,
            type: data.type,
            creditLimit: data.creditLimit ?? 0,
            ice: data.ice,
            taxId: data.taxId,
            contactName: data.contactName,
            latitude: data.latitude,
            longitude: data.longitude,
            locationAccuracy: data.locationAccuracy,
            locationUpdatedAt: resolveLocationUpdatedAt(data.latitude, data.longitude),
            notes: data.notes,
            status: existing.status === "BLOCKED" ? "BLOCKED" : (data.status ?? "ACTIVE"),
          },
          include: customerInclude,
        });
      }

      return tx.customer.create({
        data: {
          organizationId: user.organizationId,
          ...data,
          locationUpdatedAt: resolveLocationUpdatedAt(data.latitude, data.longitude),
          code: await nextCustomerCode(tx, user.organizationId),
          status: "ACTIVE",
          creditLimit: data.creditLimit ?? 0,
          currentBalance: 0,
          createdByUserId: user.id,
          createdByDriverId: user.driverId,
          createdFromTruckId: user.truckId ?? null,
          creationOrigin: "DRIVER",
        },
        include: customerInclude,
      });
      },
      { isolationLevel: "Serializable" },
    ),
  );

  return mapCustomerToDto(customer);
}
