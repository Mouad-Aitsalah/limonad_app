import "server-only";

import { z } from "zod";

import { GPS_GAP_MS, GPS_MAX_FUTURE_DRIFT_MS, GPS_MAX_TRUCK_SPEED_KMH } from "@/lib/gps/gps-config";
import { detectGpsStops } from "@/lib/gps/gps-stop-detection";
import {
  boundingBoxAround,
  calculateDistanceMeters,
  calculateSegmentedGpsDistanceMeters,
  CLIENT_PING_ID_PATTERN,
  hasAcceptableAccuracy,
  hasValidCoordinates,
  isGpsPointReliable,
  splitGpsRouteIntoSegments,
} from "@/lib/gps/gps-utils";
import { roundMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { signTrackingToken } from "@/lib/server/tracking-token";
import { getClaimableLoadingForTruck, getLoadingByTourId } from "@/lib/server/truck-loadings";
import {
  getActiveTourForDriver,
  getTodayTourDate,
  requireActiveTourForDriver,
} from "@/lib/server/tours";
import type {
  CurrentDriverTourDto,
  DriverTourStartContextDto,
  DriverTourCustomerDto,
  DriverTourPositionDto,
  DriverTourProximityDto,
  DriverTourSummaryDto,
  TourDto,
} from "@/types/operations-dto";
import type { GpsBatchResult } from "@/types/gps-offline";

const proximityThresholdMeters = 150;

/** Phase 5B: hard cap on how many points one batch may carry. */
export const GPS_BATCH_MAX_POINTS = 100;
/**
 * Phase 5B: a catch-up point older than this (relative to `now`, when the
 * tour has no `startedAt`) is treated as junk. When the tour has a
 * `startedAt`, that minus a small grace is the real lower bound instead.
 */
const GPS_BATCH_MAX_CAPTURE_AGE_MS = 24 * 60 * 60 * 1000;

const clientPingIdSchema = z.string().regex(CLIENT_PING_ID_PATTERN);

const locationPingSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).nullable().optional(),
  speed: z.coerce.number().min(0).nullable().optional(),
  heading: z.coerce.number().min(0).max(360).nullable().optional(),
  recordedAt: z.coerce.date().optional(),
  clientPingId: clientPingIdSchema.optional(),
});

const batchEnvelopeSchema = z.object({
  tourId: z.string().min(1).max(64),
  points: z.array(z.unknown()).min(1).max(GPS_BATCH_MAX_POINTS),
});

const batchPointSchema = z.object({
  clientPingId: clientPingIdSchema,
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).nullable().optional(),
  speed: z.coerce.number().min(0).nullable().optional(),
  heading: z.coerce.number().min(0).max(360).nullable().optional(),
  capturedAt: z.coerce.date(),
});

const noSaleSchema = z.object({
  reason: z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional(),
});

type VisitDbClient = Pick<typeof prisma, "tourCustomerVisit">;

export async function getCurrentDriverTour(): Promise<CurrentDriverTourDto> {
  const user = await requireDriverUser();

  const activeTour = await getActiveTourForDriver(user.driverId, user.organizationId);
  if (!activeTour) {
    const startContext = await getDriverTourStartContext(user.driverId, user.organizationId);

    // 1. an ACTIVE tour was already ruled out above. 2. a tour already
    // prepared (DRAFT/PREPARED/LOADED) for this truck - whichever day it
    // was created - is resumable as-is. 3. otherwise, a fresh tour can
    // start as soon as the truck has an unclaimed, stock-applied loading
    // (see getClaimableLoadingForTruck) - never gated on "a tour already
    // exists today for this truck", which is exactly what used to block a
    // 2nd/3rd same-day tour once the 1st one closed.
    const resumableTour = await findResumableTourForDriverTruck(
      user.driverId,
      user.organizationId,
      startContext.truck.id,
    );
    if (resumableTour) {
      return emptyCurrentTour(
        "Une tournee preparee vous attend. Vous pouvez la commencer.",
        startContext,
        true,
      );
    }

    const claimableLoading = await getClaimableLoadingForTruck(
      prisma,
      user.organizationId,
      startContext.truck.id,
    );

    return emptyCurrentTour(
      claimableLoading
        ? "Vous pouvez commencer une nouvelle tournee."
        : "Aucune tournee prete avec chargement valide.",
      startContext,
      Boolean(claimableLoading),
    );
  }

  return buildCurrentDriverTourState(user.organizationId, user.driverId, activeTour);
}

export async function requireCurrentDriverTour(): Promise<TourDto> {
  const user = await requireDriverUser();
  return requireActiveTourForDriver(user.driverId, user.organizationId);
}

export async function recordCurrentDriverLocation(
  input: unknown,
): Promise<{ currentTour: CurrentDriverTourDto; point: DriverTourPositionDto }> {
  const user = await requireDriverUser();
  return recordDriverLocationForDriver(user.organizationId, user.driverId, input);
}

/** Phase 5B: session-authenticated wrapper over the offline batch path. */
export async function recordCurrentDriverLocationBatch(
  input: unknown,
): Promise<GpsBatchResult> {
  const user = await requireDriverUser();
  return recordDriverLocationBatchForDriver(user.organizationId, user.driverId, input);
}

/**
 * Issues the short-lived bearer token the Capacitor driver app hands to
 * @capgo/background-geolocation (as `Authorization: Bearer <token>`) so
 * native code can POST GPS points directly to /api/driver/tour/location/native
 * once the WebView is suspended - see lib/server/tracking-token.ts. Only
 * mintable from an authenticated driver session with a tour actually in
 * progress; the token then carries that exact driver/organization/tour
 * triple as its own authority.
 */
export async function issueDriverTrackingToken(): Promise<{
  token: string;
  expiresAt: string;
  tourId: string;
}> {
  const user = await requireDriverUser();
  const tour = await requireActiveTourForDriver(user.driverId, user.organizationId);

  if (tour.status !== "IN_PROGRESS") {
    throw new OperationsServiceError(
      "Le suivi GPS ne peut demarrer qu'une fois la tournee commencée.",
      409,
    );
  }

  const { token, expiresAt } = signTrackingToken({
    userId: user.id,
    driverId: user.driverId,
    organizationId: user.organizationId,
    tourId: tour.id,
  });

  return { token, expiresAt, tourId: tour.id };
}

/**
 * Core GPS-ping validation/filtering/persistence, shared by the
 * session-authenticated web path (recordCurrentDriverLocation, above) and
 * the token-authenticated native background path
 * (app/api/driver/tour/location/native). There is only ever one place a
 * GPS point actually gets written for a tour - both callers funnel through
 * this exact same logic, just with driverId/organizationId resolved
 * differently (session vs. signed token).
 */
export async function recordDriverLocationForDriver(
  organizationId: string,
  driverId: string,
  input: unknown,
  options?: {
    /**
     * Native path only: the resolved active tour must match this id. The
     * token was minted for one specific tour, so if the driver's active
     * tour has since changed (that tour ended, a new one started), a
     * stale-but-still-valid token must be rejected rather than silently
     * writing into the new tour.
     */
    expectedTourId?: string;
  },
): Promise<{ currentTour: CurrentDriverTourDto; point: DriverTourPositionDto }> {
  const data = locationPingSchema.parse(input);
  const tour = await requireActiveTourForDriver(driverId, organizationId);

  if (options?.expectedTourId && tour.id !== options.expectedTourId) {
    throw new OperationsServiceError(
      "Le jeton de suivi ne correspond plus a la tournee active.",
      409,
    );
  }

  const recordedAt = data.recordedAt ?? new Date();
  const receivedAt = new Date();
  const nextPoint = {
    latitude: data.latitude,
    longitude: data.longitude,
    accuracy: data.accuracy ?? null,
    recordedAt: recordedAt.toISOString(),
  };

  if (tour.status !== "IN_PROGRESS") {
    throw new OperationsServiceError(
      "Le suivi GPS ne peut demarrer qu'une fois la tournee commencée.",
      409,
    );
  }

  if (!hasAcceptableAccuracy(nextPoint)) {
    throw new OperationsServiceError("Position GPS trop imprecise.", 422);
  }

  const capturedAgeMs = receivedAt.getTime() - recordedAt.getTime();
  if (
    capturedAgeMs < -GPS_MAX_FUTURE_DRIFT_MS ||
    !isGpsPointReliable(nextPoint, receivedAt.getTime())
  ) {
    throw new OperationsServiceError("Position GPS trop ancienne ou indisponible.", 422);
  }

  const previousPing = await prisma.tourLocationPing.findFirst({
    where: { tourId: tour.id },
    select: {
      latitude: true,
      longitude: true,
      recordedAt: true,
    },
    orderBy: { recordedAt: "desc" },
  });

  if (previousPing) {
    const previousPoint = {
      latitude: previousPing.latitude.toNumber(),
      longitude: previousPing.longitude.toNumber(),
      recordedAt: previousPing.recordedAt.toISOString(),
    };
    const elapsedMs = recordedAt.getTime() - previousPing.recordedAt.getTime();

    if (elapsedMs > 0 && elapsedMs <= GPS_GAP_MS) {
      const distanceMeters = calculateDistanceMeters(previousPoint, nextPoint);
      const speedKmh = (distanceMeters / (elapsedMs / 1000)) * 3.6;
      if (speedKmh > GPS_MAX_TRUCK_SPEED_KMH) {
        throw new OperationsServiceError("Point GPS ignore: deplacement impossible detecte.", 422);
      }
    }
  }

  try {
    await prisma.tourLocationPing.create({
      data: {
        tourId: tour.id,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy ?? null,
        speed: data.speed ?? null,
        heading: data.heading ?? null,
        recordedAt,
        clientPingId: data.clientPingId ?? null,
      },
    });
  } catch (error) {
    // Idempotent when a clientPingId is present (native path, Phase 5B): the
    // offline batch, or a retried native POST, may have already stored this
    // exact fix under the same (tourId, clientPingId). Anything else rethrows.
    if (!(data.clientPingId && (error as { code?: string }).code === "P2002")) {
      throw error;
    }
  }

  await upsertNearbyVisit(
    organizationId,
    driverId,
    tour.id,
    data.latitude,
    data.longitude,
  );

  const point: DriverTourPositionDto = {
    latitude: data.latitude,
    longitude: data.longitude,
    accuracy: data.accuracy ?? null,
    speed: data.speed ?? null,
    heading: data.heading ?? null,
    recordedAt: recordedAt.toISOString(),
  };

  // A tour can accumulate thousands of GPS points; re-fetching and
  // re-serializing all of them on every single ping (every few seconds while
  // driving) would grow the response and the work done here without bound.
  // The caller already has the new point and appends it to its own route
  // locally, so the route history here is skipped - only a cheap count is
  // used for the summary's routePointCount.
  const currentTour = await buildCurrentDriverTourState(
    organizationId,
    driverId,
    tour,
    {
    skipRouteHistory: true,
    latestPositionOverride: point,
    },
  );

  return { currentTour, point };
}

/**
 * Phase 5B - the offline catch-up path. Takes a batch of GPS fixes that were
 * captured on the phone (possibly minutes ago, while the network was down)
 * and stores the ones that pass validation, idempotently.
 *
 * Same trust model as recordDriverLocationForDriver: driverId /
 * organizationId are resolved by the caller (session or signed token), never
 * from the body; the active tour is re-derived here and must be IN_PROGRESS
 * and belong to this driver/organization. `expectedTourId` (native/token
 * path) rejects a stale-but-valid token whose tour has since changed.
 *
 * Idempotent by construction: `createMany({ skipDuplicates: true })` against
 * the @@unique([tourId, clientPingId]) index, so a batch that is retried
 * after a lost response never creates a duplicate row.
 *
 * Deliberately does NOT re-run the live "implausible jump" speed check (that
 * guards a real-time stream against a single spike; a catch-up batch has
 * legitimate gaps) and runs upsertNearbyVisit only once, for the newest
 * point, rather than 100 times.
 */
export async function recordDriverLocationBatchForDriver(
  organizationId: string,
  driverId: string,
  input: unknown,
  options?: { expectedTourId?: string },
): Promise<GpsBatchResult> {
  const envelope = batchEnvelopeSchema.safeParse(input);
  if (!envelope.success) {
    throw new OperationsServiceError(
      "Lot de positions GPS invalide (tableau vide ou trop grand).",
      422,
    );
  }

  const tour = await requireActiveTourForDriver(driverId, organizationId);

  if (options?.expectedTourId && tour.id !== options.expectedTourId) {
    throw new OperationsServiceError(
      "Le jeton de suivi ne correspond plus a la tournee active.",
      409,
    );
  }
  if (tour.status !== "IN_PROGRESS") {
    throw new OperationsServiceError(
      "Le suivi GPS ne peut demarrer qu'une fois la tournee commencée.",
      409,
    );
  }

  // The queued points belong to a tour that has since ended (the phone was
  // offline across the return). They can never be attached to this new tour -
  // acknowledge them as processed (200, all "rejected") so the phone drops
  // them cleanly instead of retrying forever.
  if (envelope.data.tourId !== tour.id) {
    const staleIds: string[] = [];
    for (const raw of envelope.data.points) {
      const id = (raw as { clientPingId?: unknown } | null)?.clientPingId;
      if (typeof id === "string" && CLIENT_PING_ID_PATTERN.test(id)) staleIds.push(id);
    }
    return {
      accepted: 0,
      duplicates: 0,
      rejected: envelope.data.points.length,
      processedIds: staleIds,
    };
  }

  const nowMs = Date.now();
  const startedAtMs = tour.startedAt ? Date.parse(tour.startedAt) : Number.NaN;
  const minCapturedMs = Number.isFinite(startedAtMs)
    ? startedAtMs - 60_000
    : nowMs - GPS_BATCH_MAX_CAPTURE_AGE_MS;
  const maxCapturedMs = nowMs + GPS_MAX_FUTURE_DRIFT_MS;

  const processedIds: string[] = [];
  const seenIds = new Set<string>();
  let rejected = 0;
  let duplicates = 0;
  const rows: Array<{
    tourId: string;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
    recordedAt: Date;
    clientPingId: string;
  }> = [];

  for (const raw of envelope.data.points) {
    const parsed = batchPointSchema.safeParse(raw);
    if (!parsed.success) {
      rejected += 1;
      const maybeId = (raw as { clientPingId?: unknown } | null)?.clientPingId;
      if (typeof maybeId === "string" && CLIENT_PING_ID_PATTERN.test(maybeId)) {
        processedIds.push(maybeId);
      }
      continue;
    }

    const p = parsed.data;
    processedIds.push(p.clientPingId);

    if (seenIds.has(p.clientPingId)) {
      duplicates += 1;
      continue;
    }
    seenIds.add(p.clientPingId);

    const capturedMs = p.capturedAt.getTime();
    const point = {
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy: p.accuracy ?? null,
    };
    if (
      !hasValidCoordinates(point) ||
      !hasAcceptableAccuracy(point) ||
      capturedMs < minCapturedMs ||
      capturedMs > maxCapturedMs
    ) {
      rejected += 1;
      continue;
    }

    rows.push({
      tourId: tour.id,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy: p.accuracy ?? null,
      speed: p.speed ?? null,
      heading: p.heading ?? null,
      recordedAt: p.capturedAt,
      clientPingId: p.clientPingId,
    });
  }

  let accepted = 0;
  if (rows.length > 0) {
    const created = await prisma.tourLocationPing.createMany({
      data: rows,
      skipDuplicates: true,
    });
    accepted = created.count;
    duplicates += rows.length - created.count;

    const newest = rows.reduce((a, b) =>
      b.recordedAt.getTime() > a.recordedAt.getTime() ? b : a,
    );
    try {
      await upsertNearbyVisit(
        organizationId,
        driverId,
        tour.id,
        newest.latitude,
        newest.longitude,
      );
    } catch {
      // proximity detection is best-effort - never fail a batch for it
    }
  }

  return { accepted, duplicates, rejected, processedIds };
}

export async function confirmCurrentDriverArrival(
  customerId: string,
): Promise<CurrentDriverTourDto> {
  const user = await requireDriverUser();
  const tour = await requireActiveTourForDriver(user.driverId, user.organizationId);

  if (tour.status !== "IN_PROGRESS") {
    throw new OperationsServiceError("La tournee doit etre en cours pour confirmer une arrivee.", 409);
  }

  const customer = await getAccessibleDriverCustomer(
    user.organizationId,
    user.driverId,
    customerId,
  );
  const latestPing = await prisma.tourLocationPing.findFirst({
    where: { tourId: tour.id },
    orderBy: { recordedAt: "desc" },
    select: { latitude: true, longitude: true, accuracy: true, recordedAt: true },
  });
  const latestPoint = latestPing
    ? {
        latitude: latestPing.latitude.toNumber(),
        longitude: latestPing.longitude.toNumber(),
        accuracy: latestPing.accuracy?.toNumber() ?? null,
        recordedAt: latestPing.recordedAt.toISOString(),
      }
    : null;

  const distanceMeters =
    latestPoint &&
    isGpsPointReliable(latestPoint) &&
    customer.latitude !== null &&
    customer.longitude !== null
      ? calculateDistanceMeters(latestPoint, {
          latitude: customer.latitude.toNumber(),
          longitude: customer.longitude.toNumber(),
        })
      : null;

  const now = new Date();
  const existingVisit = await prisma.tourCustomerVisit.findUnique({
    where: {
      tourId_customerId: {
        tourId: tour.id,
        customerId,
      },
    },
    select: { firstDetectedAt: true },
  });

  await prisma.tourCustomerVisit.upsert({
    where: {
      tourId_customerId: {
        tourId: tour.id,
        customerId,
      },
    },
    update: {
      status: "ARRIVED",
      arrivedAt: now,
      noSaleReason: null,
      lastKnownDistanceMeters: distanceMeters,
    },
    create: {
      tourId: tour.id,
      customerId,
      status: "ARRIVED",
      firstDetectedAt: existingVisit?.firstDetectedAt ?? now,
      arrivedAt: now,
      lastKnownDistanceMeters: distanceMeters,
    },
  });

  return buildCurrentDriverTourState(user.organizationId, user.driverId, tour);
}

export async function markCurrentDriverNoSale(
  customerId: string,
  input: unknown,
): Promise<CurrentDriverTourDto> {
  const user = await requireDriverUser();
  const tour = await requireActiveTourForDriver(user.driverId, user.organizationId);

  if (tour.status !== "IN_PROGRESS") {
    throw new OperationsServiceError("La tournee doit etre en cours pour enregistrer une visite.", 409);
  }

  const customer = await getAccessibleDriverCustomer(
    user.organizationId,
    user.driverId,
    customerId,
  );
  const data = noSaleSchema.parse(input);
  const now = new Date();

  await prisma.tourCustomerVisit.upsert({
    where: {
      tourId_customerId: {
        tourId: tour.id,
        customerId,
      },
    },
    update: {
      status: "NO_SALE",
      completedAt: now,
      noSaleReason: data.reason ?? "Aucune vente",
    },
    create: {
      tourId: tour.id,
      customerId: customer.id,
      status: "NO_SALE",
      firstDetectedAt: now,
      arrivedAt: now,
      completedAt: now,
      noSaleReason: data.reason ?? "Aucune vente",
    },
  });

  return buildCurrentDriverTourState(user.organizationId, user.driverId, tour);
}

export async function markCustomerDeliveredOnTour(
  tx: VisitDbClient,
  tourId: string,
  customerId: string,
) {
  const existingVisit = await tx.tourCustomerVisit.findUnique({
    where: {
      tourId_customerId: {
        tourId,
        customerId,
      },
    },
    select: {
      firstDetectedAt: true,
      arrivedAt: true,
    },
  });

  const now = new Date();

  if (existingVisit) {
    await tx.tourCustomerVisit.update({
      where: {
        tourId_customerId: {
          tourId,
          customerId,
        },
      },
      data: {
        status: "DELIVERED",
        arrivedAt: existingVisit.arrivedAt ?? null,
        completedAt: now,
        noSaleReason: null,
      },
    });
    return;
  }

  await tx.tourCustomerVisit.create({
    data: {
      tourId,
      customerId,
      status: "DELIVERED",
      firstDetectedAt: now,
      completedAt: now,
    },
  });
}

const driverCustomerAccessScope = (organizationId: string, driverId: string) => ({
  organizationId,
  status: "ACTIVE" as const,
  OR: [{ creationOrigin: "ADMIN" as const }, { createdByDriverId: driverId }],
});

const driverCustomerSelect = {
  id: true,
  code: true,
  name: true,
  phone: true,
  address: true,
  city: true,
  latitude: true,
  longitude: true,
} as const;

async function buildCurrentDriverTourState(
  organizationId: string,
  driverId: string,
  baseTour: TourDto,
  options?: {
    /**
     * Skips the tourLocationPing.findMany history fetch (unbounded and
     * growing for the whole tour) — used for the per-ping "record location"
     * response, where the caller already has the new point and appends it to
     * its own client-side route instead of receiving the full history again.
     * Only a cheap count() is used for the summary's point count.
     */
    skipRouteHistory?: boolean;
    /** The just-recorded point, used as the last known/latest position when history is skipped. */
    latestPositionOverride?: DriverTourPositionDto;
  },
): Promise<CurrentDriverTourDto> {
  const tour = await hydrateTourLoading(organizationId, baseTour);
  const skipRouteHistory = options?.skipRouteHistory ?? false;
  const accessScope = driverCustomerAccessScope(organizationId, driverId);

  // Phase 3 CRITICAL #2 fix: this used to fetch EVERY customer this driver
  // can access (org-wide ADMIN-origin + their own) on every call - including
  // every GPS ping (via recordDriverLocationForDriver, below) - measured
  // 7.4s/17.6MB at 100k customers. A tour has no fixed, pre-planned stop
  // list (see TourCustomerVisit's doc comment): a customer only becomes
  // relevant to THIS tour once a visit row exists for them (created by
  // upsertNearbyVisit on GPS proximity, or by confirmCurrentDriverArrival/
  // markCurrentDriverNoSale/a driver sale) - so `customers` below is now
  // bounded to exactly that "in play" set, which stays naturally small
  // (a handful to a few dozen stops a day) regardless of catalog size.
  // `totalAccessibleCustomers` (a cheap count(), not a row fetch) replaces
  // `customers.length` as the "X/Y clients" progress denominator the UI
  // used to compute from the full list - see DriverTourSummaryDto. A
  // customer not yet "in play" is still fully reachable: the "Choisir un
  // client" sheet falls back to GET /api/customers/search (searchCustomers,
  // already driver-scoped) for anyone outside this bounded set.
  const [visits, pingsOrCount, sales, totalAccessibleCustomers] = await Promise.all([
    prisma.tourCustomerVisit.findMany({
      where: { tourId: tour.id },
      orderBy: { updatedAt: "desc" },
    }),
    skipRouteHistory
      ? prisma.tourLocationPing.count({ where: { tourId: tour.id } })
      : prisma.tourLocationPing.findMany({
          where: { tourId: tour.id },
          orderBy: { recordedAt: "asc" },
        }),
    prisma.sale.findMany({
      where: {
        organizationId,
        tourId: tour.id,
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        customerId: true,
        totalTTC: true,
      },
    }),
    prisma.customer.count({ where: accessScope }),
  ]);

  const inPlayCustomerIds = new Set<string>();
  for (const visit of visits) inPlayCustomerIds.add(visit.customerId);
  for (const sale of sales) if (sale.customerId) inPlayCustomerIds.add(sale.customerId);

  const customers = inPlayCustomerIds.size > 0
    ? await prisma.customer.findMany({
        where: { ...accessScope, id: { in: [...inPlayCustomerIds] } },
        select: driverCustomerSelect,
        orderBy: { name: "asc" },
      })
    : [];

  const pointCount = typeof pingsOrCount === "number" ? pingsOrCount : pingsOrCount.length;
  const rawRoute: DriverTourPositionDto[] = typeof pingsOrCount === "number"
    ? []
    : pingsOrCount.map((ping) => ({
        latitude: ping.latitude.toNumber(),
        longitude: ping.longitude.toNumber(),
        accuracy: ping.accuracy?.toNumber() ?? null,
        speed: ping.speed?.toNumber() ?? null,
        heading: ping.heading?.toNumber() ?? null,
        recordedAt: ping.recordedAt.toISOString(),
      }));
  const route = splitGpsRouteIntoSegments(rawRoute).flat();

  const lastKnownPosition = skipRouteHistory
    ? (options?.latestPositionOverride ?? null)
    : (route.at(-1) ?? null);
  const latestPosition =
    lastKnownPosition && isGpsPointReliable(lastKnownPosition) ? lastKnownPosition : null;
  const visitsByCustomerId = new Map(visits.map((visit) => [visit.customerId, visit]));
  const deliveredCustomerIds = new Set(
    sales.map((sale) => sale.customerId).filter((value): value is string => Boolean(value)),
  );

  const driverCustomers: DriverTourCustomerDto[] = customers.map((customer) => {
    const visit = visitsByCustomerId.get(customer.id);
    const latitude = customer.latitude?.toNumber() ?? null;
    const longitude = customer.longitude?.toNumber() ?? null;
    const distanceMeters =
      latestPosition && latitude !== null && longitude !== null
        ? calculateDistanceMeters(latestPosition, { latitude, longitude })
        : null;

    const visitStatus = deliveredCustomerIds.has(customer.id)
      ? "DELIVERED"
      : visit
        ? mapVisitStatus(visit.status)
        : "PENDING";

    return {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      city: customer.city,
      latitude,
      longitude,
      distanceMeters,
      visitStatus,
      lastEventAt:
        visit?.completedAt?.toISOString() ??
        visit?.arrivedAt?.toISOString() ??
        visit?.firstDetectedAt?.toISOString() ??
        null,
      noSaleReason: visit?.noSaleReason ?? null,
    };
  });

  driverCustomers.sort((left, right) => {
    const leftDistance = left.distanceMeters ?? Number.POSITIVE_INFINITY;
    const rightDistance = right.distanceMeters ?? Number.POSITIVE_INFINITY;
    return leftDistance - rightDistance || left.name.localeCompare(right.name, "fr-FR");
  });

  const stops = skipRouteHistory ? [] : detectGpsStops(route);
  const proximity = resolveProximity(driverCustomers);
  const summary = buildTourSummary(
    tour,
    route,
    driverCustomers,
    sales,
    pointCount,
    totalAccessibleCustomers,
  );

  return {
    tour,
    message: driverTourMessage(tour),
    canStart: tour.status === "LOADED" && tour.loading?.status === "VALIDATED",
    canReturn: tour.status === "IN_PROGRESS",
    customers: driverCustomers,
    route,
    stops,
    latestPosition,
    proximity,
    summary,
  };
}

async function hydrateTourLoading(
  organizationId: string,
  tour: TourDto,
): Promise<TourDto> {
  const loading = await getLoadingByTourId(tour.id, organizationId);
  return { ...tour, loading };
}

async function upsertNearbyVisit(
  organizationId: string,
  driverId: string,
  tourId: string,
  latitude: number,
  longitude: number,
) {
  // Phase 3 CRITICAL #2 fix: this used to scan every geolocated customer
  // this driver can access on every single GPS ping to find the nearest one
  // - same unbounded-at-scale problem as buildCurrentDriverTourState, just
  // one call earlier in the same request (recordDriverLocationForDriver
  // calls this, then buildCurrentDriverTourState). Only a customer within
  // proximityThresholdMeters can ever become "nearest and close enough"
  // below, so pre-filtering to a bounding box around the ping's own
  // position first is a pure, always-safe optimization - see
  // boundingBoxAround's doc comment.
  const box = boundingBoxAround(latitude, longitude, proximityThresholdMeters);
  const customers = await prisma.customer.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      latitude: { not: null, gte: box.minLat, lte: box.maxLat },
      longitude: { not: null, gte: box.minLng, lte: box.maxLng },
      OR: [{ creationOrigin: "ADMIN" }, { createdByDriverId: driverId }],
    },
    select: {
      id: true,
      latitude: true,
      longitude: true,
    },
  });

  const nearest = customers
    .map((customer) => ({
      id: customer.id,
      distanceMeters: calculateDistanceMeters(
        { latitude, longitude },
        {
          latitude: customer.latitude!.toNumber(),
          longitude: customer.longitude!.toNumber(),
        },
      ),
    }))
    .sort((left, right) => left.distanceMeters - right.distanceMeters)[0];

  if (!nearest || nearest.distanceMeters > proximityThresholdMeters) {
    return;
  }

  const now = new Date();
  const existingVisit = await prisma.tourCustomerVisit.findUnique({
    where: {
      tourId_customerId: {
        tourId,
        customerId: nearest.id,
      },
    },
    select: {
      status: true,
      firstDetectedAt: true,
      arrivedAt: true,
      completedAt: true,
    },
  });

  if (existingVisit?.status === "DELIVERED" || existingVisit?.status === "NO_SALE") {
    await prisma.tourCustomerVisit.update({
      where: {
        tourId_customerId: {
          tourId,
          customerId: nearest.id,
        },
      },
      data: { lastKnownDistanceMeters: nearest.distanceMeters },
    });
    return;
  }

  await prisma.tourCustomerVisit.upsert({
    where: {
      tourId_customerId: {
        tourId,
        customerId: nearest.id,
      },
    },
    update: {
      status: existingVisit?.arrivedAt ? "ARRIVED" : "NEARBY",
      firstDetectedAt: existingVisit?.firstDetectedAt ?? now,
      lastKnownDistanceMeters: nearest.distanceMeters,
    },
    create: {
      tourId,
      customerId: nearest.id,
      status: "NEARBY",
      firstDetectedAt: now,
      lastKnownDistanceMeters: nearest.distanceMeters,
    },
  });
}

async function getAccessibleDriverCustomer(
  organizationId: string,
  driverId: string,
  customerId: string,
) {
  const customer = await prisma.customer.findFirst({
    where: {
      organizationId,
      id: customerId,
      status: "ACTIVE",
      OR: [{ creationOrigin: "ADMIN" }, { createdByDriverId: driverId }],
    },
    select: {
      id: true,
      latitude: true,
      longitude: true,
    },
  });

  if (!customer) {
    throw new OperationsServiceError("Client introuvable.", 404);
  }

  return customer;
}

/**
 * The tour that would be resumed if this driver clicked "Commencer" right
 * now: the most recent NON-TERMINAL tour (DRAFT/PREPARED/LOADED) for their
 * truck, regardless of which day it was created - not date-scoped, so a
 * previous day's or an earlier same-day tour that already reached a
 * terminal state (WAITING_FOR_CLOSURE/CLOSED/CANCELLED/INTERRUPTED) never
 * matches here and never blocks a fresh tour from starting instead.
 */
async function findResumableTourForDriverTruck(
  driverId: string,
  organizationId: string,
  truckId: string,
) {
  const tour = await prisma.tour.findFirst({
    where: {
      organizationId,
      truckId,
      status: { in: ["DRAFT", "PREPARED", "LOADED"] },
    },
    orderBy: { createdAt: "desc" },
    select: { driverId: true },
  });

  if (!tour || tour.driverId !== driverId) {
    return null;
  }

  return tour;
}

async function requireDriverUser() {
  const user = await requireOrganizationUser(["driver"]);
  const driverId = user.driverId;
  if (!driverId) {
    throw new AuthServiceError("Profil chauffeur introuvable.", 403);
  }

  return { ...user, driverId };
}

async function getDriverTourStartContext(
  driverId: string,
  organizationId: string,
): Promise<DriverTourStartContextDto> {
  const driver = await prisma.driver.findFirst({
    where: { id: driverId, organizationId },
    select: {
      id: true,
      active: true,
      user: { select: { fullName: true } },
      truck: {
        select: {
          id: true,
          code: true,
          registration: true,
          status: true,
          depot: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          stockLocation: {
            select: {
              id: true,
              active: true,
            },
          },
        },
      },
    },
  });

  if (!driver?.active) {
    throw new OperationsServiceError("Profil chauffeur introuvable.", 403);
  }

  if (!driver.truck) {
    throw new OperationsServiceError("Aucun camion n'est affecte a cet utilisateur.", 403);
  }

  let stockCurrentQuantity = 0;
  let productCount = 0;

  if (driver.truck.stockLocation?.active) {
    const aggregates = await prisma.stockLevel.aggregate({
      where: {
        locationId: driver.truck.stockLocation.id,
        quantity: { gt: 0 },
      },
      _sum: { quantity: true },
      _count: { productId: true },
    });

    stockCurrentQuantity = aggregates._sum.quantity ?? 0;
    productCount = aggregates._count.productId ?? 0;
  }

  return {
    date: getTodayTourDate().toISOString(),
    driver: {
      id: driver.id,
      name: driver.user.fullName,
    },
    truck: {
      id: driver.truck.id,
      code: driver.truck.code,
      registration: driver.truck.registration,
      status: driver.truck.status,
    },
    depot: driver.truck.depot,
    stockCurrentQuantity,
    productCount,
    warning:
      stockCurrentQuantity <= 0
        ? "Le stock camion est actuellement a zero. Vous pouvez demarrer la tournee, mais aucune vente ne sera possible sans stock."
        : null,
  };
}

function emptyCurrentTour(
  message: string,
  startContext: DriverTourStartContextDto | null = null,
  canStart = false,
): CurrentDriverTourDto {
  return {
    tour: null,
    message,
    startContext,
    canStart,
    canReturn: false,
    customers: [],
    route: [],
    stops: [],
    latestPosition: null,
    proximity: null,
    summary: null,
  };
}

function buildTourSummary(
  tour: TourDto,
  route: DriverTourPositionDto[],
  customers: DriverTourCustomerDto[],
  sales: Array<{ id: string; customerId: string | null; totalTTC: { toNumber(): number } }>,
  routePointCountOverride: number | undefined,
  totalAccessibleCustomers: number,
): DriverTourSummaryDto {
  const distanceMeters = calculateSegmentedGpsDistanceMeters(route);

  const theoreticalStockQuantity =
    tour.stockSheet?.lines.reduce((sum, line) => sum + line.theoreticalQuantity, 0) ?? 0;
  const actualLines = tour.stockSheet?.lines.filter((line) => line.actualQuantity !== null && line.actualQuantity !== undefined) ?? [];
  const actualStockQuantity =
    actualLines.length > 0
      ? actualLines.reduce((sum, line) => sum + (line.actualQuantity ?? 0), 0)
      : null;
  const discrepancyQuantity =
    actualLines.length > 0
      ? actualLines.reduce((sum, line) => sum + (line.differenceQuantity ?? 0), 0)
      : null;

  return {
    routePointCount: routePointCountOverride ?? route.length,
    distanceMeters: roundMetric(distanceMeters),
    customersNearby: customers.filter((customer) => customer.visitStatus === "NEARBY").length,
    customersArrived: customers.filter((customer) => customer.visitStatus === "ARRIVED").length,
    customersDelivered: customers.filter((customer) => customer.visitStatus === "DELIVERED").length,
    customersNoSale: customers.filter((customer) => customer.visitStatus === "NO_SALE").length,
    salesCount: sales.length,
    // F8-C: this one field is real money (sum of Sale.totalTTC), unlike every
    // other roundMetric() call in this file (distanceMeters, GPS-only) - so
    // it's split out to the shared decimal-based engine (lib/money.ts)
    // instead. roundMetric()/Math.round(x*100)/100 itself is left untouched
    // here and everywhere else in this file: it stays the correct tool for
    // rounding a plain distance-in-meters float, which is not currency.
    totalSalesTTC: roundMoney(
      sales.reduce((sum, sale) => sum + sale.totalTTC.toNumber(), 0),
    ),
    theoreticalStockQuantity,
    stockCurrentQuantity: tour.stockSheet?.truckCurrentQuantity ?? 0,
    actualStockQuantity,
    discrepancyQuantity,
    totalAccessibleCustomers,
  };
}

function resolveProximity(
  customers: DriverTourCustomerDto[],
): DriverTourProximityDto | null {
  const nearest = customers
    .filter(
      (customer) =>
        customer.distanceMeters !== null &&
        customer.distanceMeters !== undefined &&
        customer.visitStatus !== "DELIVERED" &&
        customer.visitStatus !== "NO_SALE",
    )
    .sort((left, right) => (left.distanceMeters ?? Infinity) - (right.distanceMeters ?? Infinity))[0];

  const distanceMeters = nearest?.distanceMeters ?? null;

  if (!nearest || distanceMeters === null || distanceMeters > proximityThresholdMeters) {
    return null;
  }

  return {
    customerId: nearest.id,
    customerName: nearest.name,
    distanceMeters: roundMetric(distanceMeters),
  };
}

function mapVisitStatus(
  status: "NEARBY" | "ARRIVED" | "DELIVERED" | "NO_SALE",
): DriverTourCustomerDto["visitStatus"] {
  switch (status) {
    case "NEARBY":
      return "NEARBY";
    case "ARRIVED":
      return "ARRIVED";
    case "DELIVERED":
      return "DELIVERED";
    case "NO_SALE":
      return "NO_SALE";
  }
}

function driverTourMessage(tour: TourDto) {
  if (!tour.loading || tour.loading.status !== "VALIDATED") {
    return "Votre tournee est en preparation. Le chargement n'est pas encore valide.";
  }
  if (tour.status === "LOADED") {
    return "Votre chargement est pret. Vous pouvez demarrer la tournee.";
  }
  if (tour.status === "WAITING_FOR_CLOSURE") {
    return "Votre retour est enregistre. La tournee est en attente de cloture.";
  }
  if (tour.status === "IN_PROGRESS") {
    return "Votre tournee est en cours.";
  }
  throw new OperationsServiceError("Statut de tournee incompatible.", 409);
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}
