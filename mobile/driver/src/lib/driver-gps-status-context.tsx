import * as React from "react";

import type { GpsStatus } from "@/lib/gps/gps-utils";

/**
 * Real state of DriverGpsRuntime's native background tracker (App.tsx-level,
 * clock-driven - see driver-gps-runtime.tsx), independent of any tour/
 * chargement. DriverTourHeader's badge reads this on native platforms
 * instead of the tour-scoped foreground watch in driver-tour-runtime.tsx,
 * which only ever runs while a tour screen is mounted AND a tour is
 * IN_PROGRESS - it cannot represent "GPS is on because it's 10h, no tour
 * needed" on its own.
 */
export const DriverGpsStatusContext = React.createContext<GpsStatus>("INACTIVE");

export function useDriverGpsRuntimeStatus(): GpsStatus {
  return React.useContext(DriverGpsStatusContext);
}
