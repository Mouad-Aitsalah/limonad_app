import type { DriverTourPositionDto } from "@/types/operations-dto";

const DRIVER_TOUR_FINISHED_STATUSES = new Set(["WAITING_FOR_CLOSURE", "CLOSED"]);

export function isDriverTourFinished(status?: string | null) {
  return status ? DRIVER_TOUR_FINISHED_STATUSES.has(status) : false;
}

export function resolveDriverTourStartPoint(points: DriverTourPositionDto[]) {
  return points[0] ?? null;
}

export function resolveDriverTourEndPoint({
  points,
  status,
  returnedAt,
}: {
  points: DriverTourPositionDto[];
  status?: string | null;
  returnedAt?: string | null;
}) {
  if (!isDriverTourFinished(status) || points.length === 0) {
    return null;
  }

  if (!returnedAt) {
    return points[points.length - 1] ?? null;
  }

  const returnedAtMs = Date.parse(returnedAt);
  if (!Number.isFinite(returnedAtMs)) {
    return points[points.length - 1] ?? null;
  }

  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (!point) {
      continue;
    }

    const recordedAtMs = Date.parse(point.recordedAt);
    if (Number.isFinite(recordedAtMs) && recordedAtMs <= returnedAtMs) {
      return point;
    }
  }

  return null;
}

export function resolveDriverTourFocusPoint({
  points,
  status,
  returnedAt,
}: {
  points: DriverTourPositionDto[];
  status?: string | null;
  returnedAt?: string | null;
}) {
  return (
    resolveDriverTourEndPoint({ points, status, returnedAt }) ??
    points[points.length - 1] ??
    resolveDriverTourStartPoint(points)
  );
}
