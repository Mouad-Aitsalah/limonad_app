import { isDriverTourFinished } from "@/lib/gps/tour-boundaries";
import type { TruckRouteDto, TruckRoutePointDto } from "@/types/truck-routes";

/**
 * Start / end of a tour on the /trajets map and in its "Informations de tournee"
 * panel. Nothing is recomputed: the points are the SAME GPS points the map
 * already used (first and last point of route.points), the times are the
 * existing tour fields (startedAt / returnedAt, each with its existing GPS
 * fallback built by lib/server/truck-routes.ts).
 *
 * The end of the route is an ARRIVAL only for a tour that is really over: never
 * IN_PROGRESS, and either returned (Tour.returnedAt recorded) or in a finished
 * status according to the existing rule (lib/gps/tour-boundaries.ts:
 * WAITING_FOR_CLOSURE, CLOSED). Otherwise the last GPS point is only the LAST
 * POSITION known - never labelled "Arrivee".
 */

export type RouteEndKind = "ARRIVAL" | "LAST_POSITION";

export type RouteEndpoints = {
  /** First GPS point (null without GPS) and the departure time (startedAt, GPS fallback). */
  start: { point: TruckRoutePointDto | null; at: string | null };
  /** True for a tour that is really over (see above). */
  isFinished: boolean;
  /** Arrival time of a finished tour (returnedAt, GPS fallback), otherwise null. */
  arrivalAt: string | null;
  /** Last GPS point of a tour that is NOT finished (its time is the point's), otherwise null. */
  lastPosition: TruckRoutePointDto | null;
  /** The end marker of the map: shown, as before, only when there are at least 2 GPS points. */
  end: { kind: RouteEndKind; point: TruckRoutePointDto; at: string | null } | null;
};

export function isRouteFinished(tour: Pick<TruckRouteDto["tour"], "status" | "hasReturned">): boolean {
  if (tour.status === "IN_PROGRESS") return false;
  return tour.hasReturned || isDriverTourFinished(tour.status);
}

export function resolveRouteEndpoints(route: Pick<TruckRouteDto, "tour" | "points">): RouteEndpoints {
  const points = route.points;
  const firstPoint = points[0] ?? null;
  const lastPoint = points.length > 0 ? (points[points.length - 1] ?? null) : null;
  const isFinished = isRouteFinished(route.tour);

  const lastPosition = !isFinished ? lastPoint : null;
  const endPoint = points.length > 1 ? lastPoint : null;

  return {
    start: { point: firstPoint, at: route.tour.startedAt },
    isFinished,
    arrivalAt: isFinished ? route.tour.returnedAt : null,
    lastPosition,
    end: endPoint
      ? isFinished
        ? { kind: "ARRIVAL", point: endPoint, at: route.tour.returnedAt }
        : { kind: "LAST_POSITION", point: endPoint, at: endPoint.recordedAt }
      : null,
  };
}
