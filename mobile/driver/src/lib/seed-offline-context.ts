import { getDriverOfflineContext, saveDriverOfflineContext } from "@/lib/offline/driver-pos";

import type { MobileUser } from "./mobile-auth";

/**
 * PHASE 5A.2 - "13. LOGIN UI: ... rafraichir/cache offline_context si
 * l'architecture actuelle le permet".
 *
 * Deliberately minimal: only ever ADDS a context row when none already
 * exists for this exact organizationId+driverId - never overwrites a richer
 * context already populated by the full online bootstrap flow
 * (organizationName/truckName/tourCode/etc., see lib/offline/driver-pos/
 * bootstrap.ts's hydrateDriverOfflineCache). That full hydration - and the
 * products/customers/stock caching that goes with it - stays out of scope
 * here (Phase 5A.3): this only seeds enough for the local home screen to
 * have something to show right after a first login on a fresh device,
 * using fields the login response already carries.
 */
export async function seedMinimalOfflineContextIfMissing(user: MobileUser): Promise<void> {
  if (!user.organizationId || !user.driverId) return;

  const existing = await getDriverOfflineContext({
    organizationId: user.organizationId,
    driverId: user.driverId,
  });
  if (existing) return;

  await saveDriverOfflineContext({
    organizationId: user.organizationId,
    organizationName: null,
    userId: user.id,
    userName: user.nom,
    driverId: user.driverId,
    driverName: user.nom,
    truckId: user.truckId ?? null,
    truckName: null,
    stockLocationId: null,
    tourId: null,
    tourCode: null,
    tourStatus: null,
  });
}
