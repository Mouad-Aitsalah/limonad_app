"use client";

import type { DriverPosContextDto } from "@/types/operations-dto";

import { hydrateDriverOfflineCache } from "./bootstrap";
import { loadCachedDriverPosContext } from "./pos-context";
import { getNetworkState } from "./network-status";

export type DriverPosContextSource = "server" | "cache";

export type DriverPosContextResult =
  | { ok: true; source: DriverPosContextSource; context: DriverPosContextDto; cacheSyncedAt: string | null }
  | { ok: false };

export type LoadDriverPosContextParams = {
  organizationId: string;
  organizationName: string | null;
  userId: string;
  userName: string;
  driverId: string;
  /** Kept present in the online preload, same as the existing refreshContext(). */
  customerId?: string | null;
};

/**
 * Phase 2 data-source switch (see this task's own architecture diagram):
 *
 *   ONLINE               -> GET /api/driver/pos (server = source), then
 *                            mirror the response into SQLite.
 *   OFFLINE/unreachable  -> loadCachedDriverPosContext (SQLite = source).
 *
 * Same DriverPosContextDto shape either way, so driver-pos-view.tsx renders
 * identically regardless of where the data came from - no OnlineDriverPos/
 * OfflineDriverPos split (see this task's "3. NE PAS DUPLIQUER L'UI").
 *
 * `ok: false` means neither a server response nor a usable cache exists -
 * see this task's "14. CACHE ABSENT". Never throws.
 */
export async function loadDriverPosContext(
  params: LoadDriverPosContextParams,
): Promise<DriverPosContextResult> {
  const networkState = await getNetworkState();

  if (networkState === "ONLINE") {
    try {
      const query = params.customerId ? `?customerId=${encodeURIComponent(params.customerId)}` : "";
      const response = await fetch(`/api/driver/pos${query}`, { cache: "no-store" });
      if (response.ok) {
        const payload = (await response.json()) as { context?: DriverPosContextDto };
        if (payload.context) {
          void hydrateDriverOfflineCache({
            organizationId: params.organizationId,
            organizationName: params.organizationName,
            userId: params.userId,
            userName: params.userName,
            context: payload.context,
          });
          return { ok: true, source: "server", context: payload.context, cacheSyncedAt: null };
        }
      }
    } catch {
      // Network looked available a moment ago but the request itself
      // failed (Vercel/API/Neon unreachable, DNS blip, ...) - fall through
      // to the cache exactly like the OFFLINE branch below.
    }
  }

  const cached = await loadCachedDriverPosContext({
    organizationId: params.organizationId,
    driverId: params.driverId,
  });
  if (!cached) return { ok: false };
  return { ok: true, source: "cache", context: cached.context, cacheSyncedAt: cached.syncedAt };
}
