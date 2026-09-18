import { getCachedTruck, saveCachedTruck } from "@/lib/offline/driver-pos";
import type { DriverOfflineContext } from "@/lib/offline/driver-pos";
import type { TruckDto } from "@/types/operations-dto";

import { mobileFetch } from "./mobile-fetch";

type TruckScope = { organizationId: string; driverId: string };

/**
 * ÉTAPE 27 - "MON CAMION": one online fetch of the same data the historical
 * /driver page loads server-side (GET /api/driver/truck, a thin Bearer/CORS
 * wrapper over getCurrentDriverTruck()), mirrored into cached_truck so the
 * screen keeps working offline. Returns `undefined` when the server could not
 * be reached/answered (nothing written), `null` when the server says no truck
 * is assigned (cache row removed), or the fresh TruckDto.
 *
 * Also called from refresh-offline-context.ts on every online boot/login, so
 * the cache is warm before the driver ever opens the screen.
 */
export async function refreshDriverTruckCache(
  token: string,
  scope: TruckScope,
): Promise<TruckDto | null | undefined> {
  const outcome = await mobileFetch<{ truck: TruckDto | null }>("/api/driver/truck", token);
  if (outcome.kind !== "ok" || !outcome.data || !("truck" in outcome.data)) return undefined;
  await saveCachedTruck(scope, outcome.data.truck);
  return outcome.data.truck;
}

export type ShellDriverTruckResult =
  | { ok: true; source: "server" | "cache"; truck: TruckDto | null }
  | { ok: false; message: string };

export async function loadShellDriverTruck(params: {
  token: string | null;
  offlineContext: DriverOfflineContext;
}): Promise<ShellDriverTruckResult> {
  const { token, offlineContext } = params;
  const scope = { organizationId: offlineContext.organizationId, driverId: offlineContext.driverId };

  if (token) {
    const fresh = await refreshDriverTruckCache(token, scope);
    if (fresh !== undefined) return { ok: true, source: "server", truck: fresh };
    // unauthorized/network_error/server_error - fall through to the cache,
    // same graceful degrade as the other shell data sources.
  }

  const cached = await getCachedTruck(scope);
  if (cached) return { ok: true, source: "cache", truck: cached.truck };

  // No cached row: either the driver genuinely has no truck (the cached
  // context says so - DriverTruckCard's own "Aucun camion affecte" state), or
  // this device never managed to fetch it yet - never invented in that case.
  if (!offlineContext.truckId) return { ok: true, source: "cache", truck: null };
  return {
    ok: false,
    message: "Les informations du camion ne sont pas encore disponibles hors connexion.",
  };
}
