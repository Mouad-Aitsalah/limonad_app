import {
  deleteOutboxEntry,
  getCachedDriverTour,
  getPendingOutboxEntries,
  saveCachedDriverTour,
} from "@/lib/offline/driver-pos";
import type { DriverOfflineContext } from "@/lib/offline/driver-pos";
import type { CurrentDriverTourDto, TourDto } from "@/types/operations-dto";

import { mobileFetch } from "./mobile-fetch";
import { dispatchDriverOfflineSyncCompleted } from "./driver-offline-events";

let inFlight: Promise<DriverTourSyncResult> | null = null;

export type DriverTourSyncResult = {
  synced: number;
  failed: number;
};

export function syncPendingDriverTourReturnsForShell(
  context: DriverOfflineContext,
  token: string | null,
): Promise<DriverTourSyncResult> {
  if (inFlight) return inFlight;
  inFlight = syncPendingDriverReturns(context, token).finally(() => {
    inFlight = null;
  });
  return inFlight.then((result) => {
    dispatchDriverOfflineSyncCompleted({ syncedCount: result.synced, failedCount: result.failed });
    return result;
  });
}

async function syncPendingDriverReturns(
  context: DriverOfflineContext,
  token: string | null,
): Promise<DriverTourSyncResult> {
  if (!token) return { synced: 0, failed: 0 };
  const scope = { organizationId: context.organizationId, driverId: context.driverId };
  const entries = (await getPendingOutboxEntries()).filter(
    (entry) => entry.entityType === "DRIVER_TOUR" && entry.operation === "RETURN",
  );
  let synced = 0;
  let failed = 0;

  for (const entry of entries) {
    const payload = parsePayload(entry.payloadJson);
    if (
      !payload ||
      payload.organizationId !== scope.organizationId ||
      payload.driverId !== scope.driverId ||
      payload.tourId !== entry.entityLocalId
    ) {
      failed += 1;
      continue;
    }

    const outcome = await mobileFetch<{ tour?: TourDto }>("/api/driver/tour/return", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tourId: payload.tourId }),
    });
    if (outcome.kind !== "ok" || !outcome.data?.tour) {
      failed += 1;
      continue;
    }

    const cached = await getCachedDriverTour(scope);
    if (cached?.tour.tour?.id === payload.tourId) {
      const updated = mergeReturnedTour(cached.tour, outcome.data.tour);
      await saveCachedDriverTour(scope, updated);
    }
    await deleteOutboxEntry(entry.id);
    synced += 1;
  }

  return { synced, failed };
}

function parsePayload(value: string | null): { organizationId: string; driverId: string; tourId: string } | null {
  if (!value) return null;
  try {
    const payload = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof payload.organizationId !== "string" ||
      typeof payload.driverId !== "string" ||
      typeof payload.tourId !== "string"
    ) return null;
    return {
      organizationId: payload.organizationId,
      driverId: payload.driverId,
      tourId: payload.tourId,
    };
  } catch {
    return null;
  }
}

function mergeReturnedTour(current: CurrentDriverTourDto, returnedTour: TourDto): CurrentDriverTourDto {
  return {
    ...current,
    tour: { ...current.tour, ...returnedTour },
    canReturn: false,
    canStart: false,
    message: "Votre retour est synchronise. La tournee est en attente de cloture.",
  };
}
