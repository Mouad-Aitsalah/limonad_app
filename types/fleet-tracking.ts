import type { FleetGpsStatus } from "@/lib/gps/gps-utils";

export type { FleetGpsStatus };

export type FleetTruckPositionDto = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  recordedAt: string;
};

/**
 * One currently-touring truck, as shown on the admin live fleet map
 * (components/trajets/live-fleet-map.tsx). Only trucks with an IN_PROGRESS
 * tour appear here — a finished/not-yet-started tour has nothing "live" to
 * show and belongs to the historical /trajets view instead.
 */
export type FleetTruckDto = {
  tourId: string;
  tourCode: string;
  truckId: string;
  truckCode: string;
  truckRegistration: string;
  driverId: string;
  driverName: string;
  /** null when the tour has started but no GPS point has been recorded yet. */
  position: FleetTruckPositionDto | null;
  gpsStatus: FleetGpsStatus;
  clientsVisited: number;
  salesCount: number;
  salesAmount: number;
};

export type FleetSnapshotDto = {
  trucks: FleetTruckDto[];
  /** Server clock at snapshot time, so the client can age-classify status between polls without trusting its own clock/skew. */
  serverTime: string;
};
