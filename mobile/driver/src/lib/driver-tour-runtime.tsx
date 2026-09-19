import * as React from "react";

import type { useDriverGeolocation } from "@/hooks/use-driver-geolocation";
import { DriverRuntimeContext } from "@/hooks/use-driver-runtime";
import type { CurrentDriverTourDto } from "@/types/operations-dto";

import { mobileFetch } from "./mobile-fetch";

type RuntimeValue = NonNullable<React.ContextType<typeof DriverRuntimeContext>>;
type RuntimeGps = ReturnType<typeof useDriverGeolocation>;

/**
 * ÉTAPE 28B - the shell's minimal, read-only stand-in for the historical
 * DriverRuntimeProvider (hooks/use-driver-runtime.tsx), providing the very same
 * DriverRuntimeContext that module already exports for exactly this purpose
 * (see its own doc comment) - DriverTourView keeps calling useDriverRuntime()
 * unchanged.
 *
 * Why not the real provider yet: mounting it would start the browser GPS watch
 * and the native background tracker as soon as a tour is IN_PROGRESS, and run
 * its 60 s GPS-queue flush with same-origin `fetch`es that have no server
 * behind them on the shell - all explicitly out of scope for 28B. This
 * adapter therefore reproduces only the contract: the current tour (hydrated
 * by DriverTourView itself, or refreshed through Bearer `mobileFetch`), an
 * inert GPS (permanently INACTIVE, never touches navigator.geolocation or the
 * native plugin), and no-op customer/proximity helpers. The GPS étape swaps
 * this for the real provider with an injected Bearer transport - DriverTourView
 * and the context contract do not change.
 */
const INERT_GPS: RuntimeGps = {
  status: "INACTIVE",
  displayPosition: null,
  reliablePosition: null,
  lastKnownPosition: null,
  errorMessage: null,
  failureKind: null,
  permissionState: null,
  searching: false,
  supported: false,
  retry: () => undefined,
  captureFreshPosition: async () => null,
  lastAttemptAccuracyRef: { current: null },
  lastAttemptFailureKindRef: { current: null },
  reset: () => undefined,
  stop: () => undefined,
};

export function DriverTourRuntimeProvider({
  token,
  children,
}: {
  token: string | null;
  children: React.ReactNode;
}) {
  const [currentTour, setCurrentTour] = React.useState<CurrentDriverTourDto | null>(null);

  const setTour = React.useCallback((tour: CurrentDriverTourDto) => setCurrentTour(tour), []);

  const refreshCurrentTour = React.useCallback(async () => {
    const outcome = await mobileFetch<{ currentTour?: CurrentDriverTourDto }>("/api/driver/tour", token);
    if (outcome.kind !== "ok" || !outcome.data?.currentTour) {
      throw new Error("Impossible de charger la tournee chauffeur.");
    }
    setCurrentTour(outcome.data.currentTour);
    return outcome.data.currentTour;
  }, [token]);

  const value = React.useMemo<RuntimeValue>(
    () => ({
      customers: [],
      currentTour,
      gps: INERT_GPS,
      nearbyCustomer: null,
      dismissNearbyCustomer: () => undefined,
      markCustomerHandled: () => undefined,
      upsertCustomer: () => undefined,
      refreshCustomers: async () => [],
      refreshCurrentTour,
      refreshRuntime: async () => {
        await refreshCurrentTour().catch(() => undefined);
      },
      hydrateCurrentTour: setTour,
      replaceCurrentTour: setTour,
    }),
    [currentTour, refreshCurrentTour, setTour],
  );

  return <DriverRuntimeContext.Provider value={value}>{children}</DriverRuntimeContext.Provider>;
}
