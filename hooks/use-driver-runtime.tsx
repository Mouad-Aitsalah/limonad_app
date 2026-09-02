"use client";

import * as React from "react";
import { Capacitor } from "@capacitor/core";

import {
  useDriverGeolocation,
  type DriverGpsPosition,
} from "@/hooks/use-driver-geolocation";
import { calculateDistanceMeters } from "@/lib/gps/gps-utils";
import {
  startNativeTracking,
  stopNativeTracking,
} from "@/lib/gps/native-tracking";
import type {
  CurrentDriverTourDto,
  CustomerDto,
  DriverTourCustomerDto,
  DriverTourPositionDto,
} from "@/types/operations-dto";

const DRIVER_NEARBY_ENTRY_RADIUS_METERS = 100;
const DRIVER_NEARBY_EXIT_RADIUS_METERS = 120;

/**
 * CRITICAL #2 follow-up: getDriverProximityCustomers's server-side candidate
 * pool is boxed to ~100km around the driver's last known GPS position at
 * fetch time (see its doc comment) - a fixed one-time fetch on mount would
 * silently go stale for a tour that drives farther than that in one
 * session, so local proximity suggestions for a customer near the new area
 * would never surface even though server-side detection (upsertNearbyVisit,
 * boxed fresh on every ping) keeps working. This re-fetches well before the
 * driver could actually exit the original box - comfortably inside its
 * ~100km margin - using only the already-existing calculateDistanceMeters
 * utility to decide WHEN to refetch; the proximity/hysteresis math itself
 * (DRIVER_NEARBY_*_RADIUS_METERS, suppressedCustomerIdsRef, syncNearbyCustomer)
 * is untouched.
 */
const PROXIMITY_FEED_REFETCH_DISTANCE_METERS = 50_000;

type DriverNearbyCustomerSuggestion = {
  customer: CustomerDto;
  distanceMeters: number;
};

type NearbyCustomerCandidate = DriverNearbyCustomerSuggestion & {
  visitStatus: DriverTourCustomerDto["visitStatus"];
};

type DriverRuntimeContextValue = {
  customers: CustomerDto[];
  currentTour: CurrentDriverTourDto | null;
  gps: ReturnType<typeof useDriverGeolocation>;
  nearbyCustomer: DriverNearbyCustomerSuggestion | null;
  dismissNearbyCustomer: () => void;
  markCustomerHandled: (customerId: string) => void;
  upsertCustomer: (customer: CustomerDto) => void;
  refreshCustomers: () => Promise<CustomerDto[]>;
  refreshCurrentTour: () => Promise<CurrentDriverTourDto>;
  refreshRuntime: () => Promise<void>;
  hydrateCurrentTour: (tour: CurrentDriverTourDto) => void;
  replaceCurrentTour: (tour: CurrentDriverTourDto) => void;
};

const DriverRuntimeContext = React.createContext<DriverRuntimeContextValue | null>(null);

// Phase 3 CRITICAL #2 fix: the runtime's own GPS-reactive proximity feed
// (syncNearbyCustomer below) never needs the driver's ENTIRE accessible
// customer list - just a bounded, GPS-scoped candidate pool. See
// getDriverProximityCustomers's doc comment in lib/server/driver-customers.ts.
// /driver/clients (the full directory page) is unrelated and keeps fetching
// GET /api/driver/customers directly server-side - untouched by this chantier.
async function fetchDriverCustomers() {
  const response = await fetch("/api/driver/customers/nearby", { cache: "no-store" });
  const payload = (await response.json()) as {
    customers?: CustomerDto[];
    message?: string;
  };

  if (!response.ok || !payload.customers) {
    throw new Error(payload.message ?? "Impossible de charger les clients du chauffeur.");
  }

  return payload.customers;
}

async function fetchCurrentDriverTour() {
  const response = await fetch("/api/driver/tour", { cache: "no-store" });
  const payload = (await response.json()) as {
    currentTour?: CurrentDriverTourDto;
    message?: string;
  };

  if (!response.ok || !payload.currentTour) {
    throw new Error(payload.message ?? "Impossible de charger la tournee chauffeur.");
  }

  return payload.currentTour;
}

export function DriverRuntimeProvider({ children }: { children: React.ReactNode }) {
  const mountedRef = React.useRef(true);
  const customersRef = React.useRef<CustomerDto[]>([]);
  const currentTourRef = React.useRef<CurrentDriverTourDto | null>(null);
  const reliablePositionRef = React.useRef<DriverGpsPosition | null>(null);
  const suppressedCustomerIdsRef = React.useRef<Set<string>>(new Set());
  const activeNearbyCustomerIdRef = React.useRef<string | null>(null);
  const lastProximityFetchPositionRef = React.useRef<{ latitude: number; longitude: number } | null>(
    null,
  );
  const proximityRefetchInFlightRef = React.useRef(false);

  const [customers, setCustomers] = React.useState<CustomerDto[]>([]);
  const [currentTour, setCurrentTour] = React.useState<CurrentDriverTourDto | null>(null);
  const [nearbyCustomer, setNearbyCustomer] =
    React.useState<DriverNearbyCustomerSuggestion | null>(null);

  const syncNearbyCustomer = React.useCallback(() => {
    const reliablePosition = reliablePositionRef.current;
    const currentCustomers = customersRef.current;
    const runtimeTour = currentTourRef.current;

    if (!reliablePosition) {
      activeNearbyCustomerIdRef.current = null;
      setNearbyCustomer(null);
      return;
    }

    const tourCustomersById = new Map(
      (runtimeTour?.customers ?? []).map((customer) => [customer.id, customer]),
    );
    const nearbyCandidates = currentCustomers
      .filter(hasCustomerCoordinates)
      .map((customer) => ({
        customer,
        distanceMeters: calculateDistanceMeters(reliablePosition, {
          latitude: customer.latitude!,
          longitude: customer.longitude!,
        }),
        visitStatus: tourCustomersById.get(customer.id)?.visitStatus ?? "PENDING",
      }))
      .filter(
        (candidate) =>
          candidate.visitStatus !== "DELIVERED" && candidate.visitStatus !== "NO_SALE",
      )
      .sort(compareNearbyCandidates);

    for (const customerId of [...suppressedCustomerIdsRef.current]) {
      const candidate = nearbyCandidates.find((item) => item.customer.id === customerId) ?? null;
      if (!candidate || candidate.distanceMeters > DRIVER_NEARBY_EXIT_RADIUS_METERS) {
        suppressedCustomerIdsRef.current.delete(customerId);
      }
    }

    const currentCandidate = activeNearbyCustomerIdRef.current
      ? nearbyCandidates.find(
          (item) => item.customer.id === activeNearbyCustomerIdRef.current,
        ) ?? null
      : null;
    const nextEntryCandidate =
      nearbyCandidates.find(
        (item) =>
          item.distanceMeters <= DRIVER_NEARBY_ENTRY_RADIUS_METERS &&
          !suppressedCustomerIdsRef.current.has(item.customer.id),
      ) ?? null;

    if (
      currentCandidate &&
      currentCandidate.distanceMeters <= DRIVER_NEARBY_EXIT_RADIUS_METERS &&
      !suppressedCustomerIdsRef.current.has(currentCandidate.customer.id) &&
      (!nextEntryCandidate || nextEntryCandidate.customer.id === currentCandidate.customer.id)
    ) {
      activeNearbyCustomerIdRef.current = currentCandidate.customer.id;
      setNearbyCustomer(toNearbySuggestion(currentCandidate));
      return;
    }

    if (nextEntryCandidate) {
      activeNearbyCustomerIdRef.current = nextEntryCandidate.customer.id;
      setNearbyCustomer(toNearbySuggestion(nextEntryCandidate));
      return;
    }

    if (
      currentCandidate &&
      currentCandidate.distanceMeters <= DRIVER_NEARBY_EXIT_RADIUS_METERS &&
      !suppressedCustomerIdsRef.current.has(currentCandidate.customer.id)
    ) {
      activeNearbyCustomerIdRef.current = currentCandidate.customer.id;
      setNearbyCustomer(toNearbySuggestion(currentCandidate));
      return;
    }

    activeNearbyCustomerIdRef.current = null;
    setNearbyCustomer(null);
  }, []);

  const handleReliablePosition = React.useCallback(async (position: DriverGpsPosition) => {
    reliablePositionRef.current = position;
    syncNearbyCustomer();

    const activeTour = currentTourRef.current?.tour;
    if (!activeTour || activeTour.status !== "IN_PROGRESS") {
      return;
    }

    if (Capacitor.isNativePlatform()) {
      // Native background-geolocation already POSTs every point straight to
      // the server from native code (see lib/gps/native-tracking.ts and the
      // tour-status effect below) - fetching here too would double-write
      // every GPS point.
      return;
    }

    try {
      const response = await fetch("/api/driver/tour/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
          speed: position.speed,
          heading: position.heading,
          recordedAt: position.recordedAt,
        }),
      });
      const payload = (await response.json()) as {
        currentTour?: CurrentDriverTourDto;
        point?: DriverTourPositionDto;
      };

      if (!response.ok || !payload.currentTour || !payload.point || !mountedRef.current) {
        return;
      }

      const nextTour = mergeCurrentTourLocationUpdate(
        currentTourRef.current,
        payload.currentTour,
        payload.point,
      );
      currentTourRef.current = nextTour;
      setCurrentTour(nextTour);
      syncNearbyCustomer();
    } catch {
      // Nearby detection must keep working locally even if tour sync fails.
    }
  }, [syncNearbyCustomer]);

  const gps = useDriverGeolocation({
    active: true,
    initialPosition: null,
    onReliablePosition: handleReliablePosition,
  });
  const lastKnownPosition = gps.lastKnownPosition;
  const resetGps = gps.reset;
  const activeTourId = currentTour?.tour?.id ?? null;
  const activeTourStatus = currentTour?.tour?.status ?? null;

  // Native background tracking follows the tour lifecycle: starts the
  // moment a tour becomes IN_PROGRESS, stops as soon as it no longer is
  // (return, closure, cancellation) - mirroring exactly when the web path
  // above is allowed to push points. A no-op entirely on the web (see
  // lib/gps/native-tracking.ts). The position callback only updates the
  // live/displayed position (via gps.reset) - it never fetch()es, since the
  // native `url` POST already persisted the point server-side.
  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    if (activeTourStatus === "IN_PROGRESS" && activeTourId) {
      void startNativeTracking(activeTourId, (position) => {
        if (mountedRef.current) resetGps(position);
      });
    } else {
      void stopNativeTracking();
    }
  }, [activeTourId, activeTourStatus, resetGps]);

  React.useEffect(() => {
    return () => {
      if (Capacitor.isNativePlatform()) {
        void stopNativeTracking();
      }
    };
  }, []);

  React.useEffect(() => {
    currentTourRef.current = currentTour;
    syncNearbyCustomer();
  }, [currentTour, syncNearbyCustomer]);

  React.useEffect(() => {
    customersRef.current = customers;
    syncNearbyCustomer();
  }, [customers, syncNearbyCustomer]);

  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.info("[driver-runtime] mounted");
      return () => {
        console.info("[driver-runtime] unmounted");
      };
    }

    return undefined;
  }, []);

  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshCustomers = React.useCallback(async () => {
    // Best-effort: remember roughly where this fetch's candidate pool is
    // centered (the driver's current reliable position, if known - the
    // server itself boxes around the driver's latest recorded ping, which
    // by now normally matches). Used only to decide when a later refetch is
    // due - see PROXIMITY_FEED_REFETCH_DISTANCE_METERS's doc comment.
    lastProximityFetchPositionRef.current = reliablePositionRef.current
      ? { latitude: reliablePositionRef.current.latitude, longitude: reliablePositionRef.current.longitude }
      : null;
    const nextCustomers = sortCustomersByName(await fetchDriverCustomers());
    if (mountedRef.current) {
      customersRef.current = nextCustomers;
      setCustomers(nextCustomers);
      syncNearbyCustomer();
    }
    return nextCustomers;
  }, [syncNearbyCustomer]);

  React.useEffect(() => {
    reliablePositionRef.current = gps.reliablePosition;
    syncNearbyCustomer();

    // CRITICAL #2 follow-up: refetch the bounded proximity feed once the
    // driver has moved far enough from where it was last fetched - see
    // PROXIMITY_FEED_REFETCH_DISTANCE_METERS's doc comment. Never lets more
    // than one refetch run at a time; a position with no reference yet
    // (first reliable fix of the session, or the very first load before any
    // GPS reading exists) always triggers one so the pool converges onto
    // the live area quickly.
    const position = gps.reliablePosition;
    if (!position || proximityRefetchInFlightRef.current) return;
    const lastFetchPosition = lastProximityFetchPositionRef.current;
    const shouldRefetch =
      !lastFetchPosition ||
      calculateDistanceMeters(lastFetchPosition, position) > PROXIMITY_FEED_REFETCH_DISTANCE_METERS;
    if (!shouldRefetch) return;

    proximityRefetchInFlightRef.current = true;
    void refreshCustomers()
      .catch(() => {
        // A failed refetch just leaves the previous (still reasonably
        // relevant) pool in place - the next reliable position retries.
      })
      .finally(() => {
        proximityRefetchInFlightRef.current = false;
      });
  }, [gps.reliablePosition, refreshCustomers, syncNearbyCustomer]);

  const refreshCurrentTour = React.useCallback(async () => {
    const nextTour = mergeHydratedCurrentTour(
      currentTourRef.current,
      await fetchCurrentDriverTour(),
    );
    if (mountedRef.current) {
      currentTourRef.current = nextTour;
      setCurrentTour(nextTour);
      syncNearbyCustomer();
    }
    return nextTour;
  }, [syncNearbyCustomer]);

  const refreshRuntime = React.useCallback(async () => {
    await Promise.allSettled([refreshCustomers(), refreshCurrentTour()]);
  }, [refreshCustomers, refreshCurrentTour]);

  const replaceCurrentTour = React.useCallback((tour: CurrentDriverTourDto) => {
    if (!mountedRef.current) return;
    currentTourRef.current = tour;
    setCurrentTour(tour);
    syncNearbyCustomer();
  }, [syncNearbyCustomer]);

  const hydrateCurrentTour = React.useCallback((tour: CurrentDriverTourDto) => {
    if (!mountedRef.current) return;
    const nextTour = mergeHydratedCurrentTour(currentTourRef.current, tour);
    currentTourRef.current = nextTour;
    setCurrentTour(nextTour);
    syncNearbyCustomer();
  }, [syncNearbyCustomer]);

  const upsertCustomer = React.useCallback((customer: CustomerDto) => {
    if (!mountedRef.current) return;
    const nextCustomers = upsertSortedCustomer(customersRef.current, customer);
    customersRef.current = nextCustomers;
    setCustomers(nextCustomers);

    // Also merge into the active tour's own customer list (map markers,
    // nearby-customer detection within the tour view) so a client
    // created/edited from /driver/clients - including its GPS location -
    // shows up immediately on /driver/tournee without a full page reload,
    // not just in the global customers list above.
    if (currentTourRef.current) {
      const nextTour = mergeCustomerIntoCurrentTour(currentTourRef.current, customer);
      if (nextTour !== currentTourRef.current) {
        currentTourRef.current = nextTour;
        setCurrentTour(nextTour);
      }
    }

    syncNearbyCustomer();
  }, [syncNearbyCustomer]);

  const markCustomerHandled = React.useCallback((customerId: string) => {
    suppressedCustomerIdsRef.current.add(customerId);
    if (activeNearbyCustomerIdRef.current === customerId) {
      activeNearbyCustomerIdRef.current = null;
    }
    syncNearbyCustomer();
  }, [syncNearbyCustomer]);

  React.useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

  React.useEffect(() => {
    if (currentTour?.latestPosition && !lastKnownPosition) {
      resetGps(currentTour.latestPosition);
    }
  }, [currentTour?.latestPosition, lastKnownPosition, resetGps]);

  const dismissNearbyCustomer = React.useCallback(() => {
    if (!nearbyCustomer) {
      return;
    }

    markCustomerHandled(nearbyCustomer.customer.id);
  }, [markCustomerHandled, nearbyCustomer]);

  const value = React.useMemo<DriverRuntimeContextValue>(
    () => ({
      customers,
      currentTour,
      gps,
      nearbyCustomer,
      dismissNearbyCustomer,
      markCustomerHandled,
      upsertCustomer,
      refreshCustomers,
      refreshCurrentTour,
      refreshRuntime,
      hydrateCurrentTour,
      replaceCurrentTour,
    }),
    [
      currentTour,
      customers,
      dismissNearbyCustomer,
      gps,
      hydrateCurrentTour,
      markCustomerHandled,
      nearbyCustomer,
      refreshCurrentTour,
      refreshCustomers,
      refreshRuntime,
      replaceCurrentTour,
      upsertCustomer,
    ],
  );

  return (
    <DriverRuntimeContext.Provider value={value}>
      {children}
    </DriverRuntimeContext.Provider>
  );
}

export function useDriverRuntime() {
  const context = React.useContext(DriverRuntimeContext);
  if (!context) {
    throw new Error("useDriverRuntime must be used within a DriverRuntimeProvider");
  }
  return context;
}

function hasCustomerCoordinates(customer: CustomerDto) {
  return (
    customer.latitude !== null &&
    customer.latitude !== undefined &&
    customer.longitude !== null &&
    customer.longitude !== undefined
  );
}

function sortCustomersByName(customers: CustomerDto[]) {
  return [...customers].sort((left, right) =>
    left.name.localeCompare(right.name, "fr-FR"),
  );
}

function upsertSortedCustomer(customers: CustomerDto[], customer: CustomerDto) {
  const existingIndex = customers.findIndex((item) => item.id === customer.id);
  if (existingIndex === -1) {
    return sortCustomersByName([customer, ...customers]);
  }

  const nextCustomers = [...customers];
  nextCustomers[existingIndex] = customer;
  return sortCustomersByName(nextCustomers);
}

function compareNearbyCandidates(
  left: NearbyCustomerCandidate,
  right: NearbyCustomerCandidate,
) {
  return (
    left.distanceMeters - right.distanceMeters ||
    left.customer.name.localeCompare(right.customer.name, "fr-FR")
  );
}

function toNearbySuggestion(
  candidate: NearbyCustomerCandidate,
): DriverNearbyCustomerSuggestion {
  return {
    customer: candidate.customer,
    distanceMeters: candidate.distanceMeters,
  };
}

/**
 * Projects a CustomerDto (the global customer shape) into the tour-scoped
 * DriverTourCustomerDto shape and upserts it into current.customers, so a
 * client created/edited from /driver/clients appears on the tour map right
 * away. A brand-new entry starts PENDING with no visit history yet - an
 * existing one keeps its visitStatus/lastEventAt/noSaleReason/distance
 * untouched, only its identity/address/coordinates are refreshed.
 */
function mergeCustomerIntoCurrentTour(
  current: CurrentDriverTourDto,
  customer: CustomerDto,
): CurrentDriverTourDto {
  const existingIndex = current.customers.findIndex((item) => item.id === customer.id);
  const existing = existingIndex >= 0 ? current.customers[existingIndex] : null;

  const tourCustomer: DriverTourCustomerDto = {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    city: customer.city,
    latitude: customer.latitude ?? null,
    longitude: customer.longitude ?? null,
    distanceMeters: existing?.distanceMeters ?? null,
    visitStatus: existing?.visitStatus ?? "PENDING",
    lastEventAt: existing?.lastEventAt ?? null,
    noSaleReason: existing?.noSaleReason ?? null,
  };

  const nextCustomers =
    existingIndex >= 0
      ? current.customers.map((item, index) => (index === existingIndex ? tourCustomer : item))
      : [...current.customers, tourCustomer];

  return { ...current, customers: nextCustomers };
}

function mergeHydratedCurrentTour(
  current: CurrentDriverTourDto | null,
  next: CurrentDriverTourDto,
) {
  if (!current) {
    return next;
  }

  const currentTourId = current.tour?.id ?? null;
  const nextTourId = next.tour?.id ?? null;
  if (currentTourId !== nextTourId) {
    return next;
  }

  const preservedRoute =
    current.route.length > next.route.length ? current.route : next.route;
  const preservedSummary =
    current.route.length > next.route.length && current.summary && next.summary
      ? {
          ...next.summary,
          routePointCount: current.summary.routePointCount,
          distanceMeters: current.summary.distanceMeters,
        }
      : next.summary;

  return {
    ...next,
    route: preservedRoute,
    latestPosition:
      next.latestPosition ?? current.latestPosition ?? preservedRoute.at(-1) ?? null,
    summary: preservedSummary,
  };
}

function mergeCurrentTourLocationUpdate(
  current: CurrentDriverTourDto | null,
  next: CurrentDriverTourDto,
  point: DriverTourPositionDto,
) {
  const currentTourId = current?.tour?.id ?? null;
  const nextTourId = next.tour?.id ?? null;
  if (!current || currentTourId !== nextTourId) {
    return {
      ...next,
      route: [point],
      latestPosition: point,
      summary: next.summary
        ? {
            ...next.summary,
            routePointCount: 1,
          }
        : next.summary,
    };
  }

  const previousPoint = current.route.at(-1) ?? current.latestPosition ?? null;
  const route = appendUniqueTourPoint(current.route, point);
  const incrementalDistanceMeters =
    previousPoint && !isSameTourPoint(previousPoint, point)
      ? calculateDistanceMeters(previousPoint, point)
      : 0;

  return {
    ...next,
    route,
    latestPosition: point,
    summary: next.summary
      ? {
          ...next.summary,
          routePointCount: route.length,
          distanceMeters: roundMetric(
            (current.summary?.distanceMeters ?? 0) + incrementalDistanceMeters,
          ),
        }
      : next.summary,
  };
}

function appendUniqueTourPoint(
  route: DriverTourPositionDto[],
  point: DriverTourPositionDto,
) {
  const lastPoint = route.at(-1) ?? null;
  if (lastPoint && isSameTourPoint(lastPoint, point)) {
    return route;
  }

  return [...route, point];
}

function isSameTourPoint(
  left: DriverTourPositionDto,
  right: DriverTourPositionDto,
) {
  return (
    left.latitude === right.latitude &&
    left.longitude === right.longitude &&
    left.recordedAt === right.recordedAt
  );
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}
