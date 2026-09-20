import { enqueueSyncOperation, saveCachedDriverTour } from "@/lib/offline/driver-pos";
import type { CurrentDriverTourDto, TourDto } from "@/types/operations-dto";

import { mobileFetch } from "./mobile-fetch";
import type { DriverOfflineContext } from "@/lib/offline/driver-pos";

export type DriverTourReturnResult = {
  currentTour: CurrentDriverTourDto;
  mode: "online" | "offline";
};

type ReturnParams = {
  token: string | null;
  offlineContext: DriverOfflineContext;
  currentTour: CurrentDriverTourDto;
  deviceOnline: boolean;
};

const RETURN_ENTITY_TYPE = "DRIVER_TOUR";
const RETURN_OPERATION = "RETURN" as const;

export async function returnShellDriverTour(params: ReturnParams): Promise<DriverTourReturnResult> {
  const { currentTour, deviceOnline, offlineContext, token } = params;
  const tour = currentTour.tour;
  if (!tour || !currentTour.canReturn || tour.status !== "IN_PROGRESS") {
    throw new Error("Seule une tournee en cours peut etre terminee.");
  }

  if (token && deviceOnline) {
    const outcome = await mobileFetch<{ tour?: TourDto }>("/api/driver/tour/return", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tourId: tour.id }),
    });

    if (outcome.kind === "ok" && outcome.data?.tour) {
      const refreshed = await mobileFetch<{ currentTour?: CurrentDriverTourDto }>("/api/driver/tour", token);
      const nextTour = refreshed.kind === "ok" && refreshed.data?.currentTour?.tour
        ? refreshed.data.currentTour
        : buildReturnedTourState(currentTour, outcome.data.tour, "Tournee terminee.");
      const persisted = await saveCachedDriverTour(scopeOf(offlineContext), nextTour);
      if (!persisted) throw new Error("Impossible d'enregistrer la tournee sur l'appareil.");
      return { currentTour: nextTour, mode: "online" };
    }

    if (outcome.kind === "unauthorized") {
      throw new Error("Session expiree. Reconnectez-vous.");
    }
    if (outcome.kind === "server_error") {
      throw new Error(outcome.message);
    }
    // A network error after the user pressed the button is handled exactly as
    // offline: the local state is durable and the same official API is retried.
  }

  const nextTour = buildReturnedTourState(
    currentTour,
    { ...tour, status: "WAITING_FOR_CLOSURE", returnedAt: new Date().toISOString() },
    "Tournee terminee hors ligne. Synchronisation en attente.",
  );
  const scope = scopeOf(offlineContext);
  const persisted = await saveCachedDriverTour(scope, nextTour);
  if (!persisted) throw new Error("Impossible d'enregistrer la tournee hors ligne.");

  const queued = await enqueueSyncOperation({
    entityType: RETURN_ENTITY_TYPE,
    entityLocalId: tour.id,
    operation: RETURN_OPERATION,
    payloadJson: JSON.stringify({
      organizationId: scope.organizationId,
      driverId: scope.driverId,
      tourId: tour.id,
    }),
  });
  if (!queued) throw new Error("Impossible de preparer la synchronisation de la tournee.");

  return { currentTour: nextTour, mode: "offline" };
}

export function buildReturnedTourState(
  current: CurrentDriverTourDto,
  returnedTour: TourDto,
  message: string,
): CurrentDriverTourDto {
  return {
    ...current,
    tour: { ...current.tour, ...returnedTour, status: returnedTour.status },
    canReturn: false,
    canStart: false,
    message,
  };
}

function scopeOf(context: DriverOfflineContext) {
  return { organizationId: context.organizationId, driverId: context.driverId };
}
