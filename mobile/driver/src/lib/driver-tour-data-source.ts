import { getCachedDriverTour, saveCachedDriverTour } from "@/lib/offline/driver-pos";
import type { DriverOfflineContext } from "@/lib/offline/driver-pos";
import type { CurrentDriverTourDto } from "@/types/operations-dto";

import { mobileFetch } from "./mobile-fetch";

/**
 * ÉTAPE 28B/28C - loads the same data app/driver/tournee/page.tsx passes to
 * DriverTourView (getCurrentDriverTour()), over Bearer (GET /api/driver/tour,
 * CORS/Bearer-enabled in ÉTAPE 28A), mirrored into SQLite (cached_driver_tour*,
 * schema v5) so "Ma tournee" keeps working offline and after a cold start.
 *
 *  - ONLINE + answer: the DTO is returned immediately AND written to the cache
 *    in the BACKGROUND (see persistInBackground - a day's route can be
 *    thousands of points, i.e. seconds of native SQLite work the driver must
 *    not wait for). The write replaces the previous tour whole (tour-store.ts)
 *    - a successful "no active tour" answer included, so a tour that ended
 *    server-side is never shown as still running.
 *  - Network failure / 5xx / device offline / no token: the cache is read.
 *    A failed call NEVER touches the cache - a valid cached tour is never
 *    replaced by an error or an empty result.
 *  - 401: an error (the session is genuinely invalid - re-login), cache not shown.
 *  - Other 4xx (a business refusal, e.g. "no truck assigned"): shown as the
 *    empty "Aucune tournee active" state carrying the server's own message,
 *    exactly like the web page (which catches OperationsServiceError the same
 *    way) - but NOT cached, so it can never overwrite a real cached tour.
 */
export type ShellDriverTourResult =
  | { ok: true; source: "server" | "cache"; tour: CurrentDriverTourDto; syncedAt: string | null }
  | { ok: false; reason: "network" | "unauthorized" | "server"; message: string };

function emptyTour(message: string): CurrentDriverTourDto {
  return {
    tour: null,
    message,
    startContext: null,
    canStart: false,
    canReturn: false,
    customers: [],
    route: [],
    stops: [],
    latestPosition: null,
    proximity: null,
    summary: null,
  };
}

// Latest-wins coalescing: the screen can load twice in a row (boot re-sets the
// offline context, a reconnect re-runs the effect) and each save is seconds of
// native SQLite work for a long route - only the newest pending tour is ever
// written after the one already in flight. The DB layer's own FIFO mutex
// (database.ts) keeps these writes from overlapping any other store call.
let pendingSave: { scope: { organizationId: string; driverId: string }; tour: CurrentDriverTourDto } | null = null;
let saveLoop: Promise<void> | null = null;

function persistInBackground(scope: { organizationId: string; driverId: string }, tour: CurrentDriverTourDto): void {
  pendingSave = { scope, tour };
  if (saveLoop) return;
  saveLoop = (async () => {
    try {
      while (pendingSave) {
        const job = pendingSave;
        pendingSave = null;
        // A failed write is logged by the store and never surfaces here: the
        // driver keeps the fresh tour, only the offline copy stays stale.
        await saveCachedDriverTour(job.scope, job.tour);
      }
    } finally {
      saveLoop = null;
    }
  })();
}

/** Resolves once every queued cache write has finished (tests / shutdown). */
export async function whenTourCachePersisted(): Promise<void> {
  while (saveLoop) await saveLoop;
}

const NO_CACHE_OFFLINE_MESSAGE =
  "Aucune tournee enregistree sur cet appareil. Connectez-vous a Internet pour la charger.";
const SERVER_ERROR_MESSAGE = "Impossible de charger la tournee chauffeur.";

export async function loadShellDriverTour(params: {
  token: string | null;
  offlineContext: DriverOfflineContext;
  deviceOnline: boolean;
}): Promise<ShellDriverTourResult> {
  const { token, offlineContext, deviceOnline } = params;
  const scope = { organizationId: offlineContext.organizationId, driverId: offlineContext.driverId };

  let failure: ShellDriverTourResult = { ok: false, reason: "network", message: NO_CACHE_OFFLINE_MESSAGE };

  if (token && deviceOnline) {
    const outcome = await mobileFetch<{ currentTour?: CurrentDriverTourDto }>("/api/driver/tour", token);
    switch (outcome.kind) {
      case "ok":
        if (outcome.data?.currentTour) {
          const tour = outcome.data.currentTour;
          persistInBackground(scope, tour);
          return { ok: true, source: "server", tour, syncedAt: new Date().toISOString() };
        }
        failure = { ok: false, reason: "server", message: SERVER_ERROR_MESSAGE };
        break;
      case "unauthorized":
        return { ok: false, reason: "unauthorized", message: "Session expiree. Reconnectez-vous." };
      case "server_error":
        if (outcome.status >= 400 && outcome.status < 500) {
          return { ok: true, source: "server", tour: emptyTour(outcome.message), syncedAt: null };
        }
        failure = { ok: false, reason: "server", message: SERVER_ERROR_MESSAGE };
        break;
      case "network_error":
        break;
    }
  }

  const cached = await getCachedDriverTour(scope);
  if (cached) return { ok: true, source: "cache", tour: cached.tour, syncedAt: cached.syncedAt };
  return failure;
}
