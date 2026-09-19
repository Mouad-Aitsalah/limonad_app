import type { DriverGpsPosition } from "@/hooks/use-driver-geolocation";
import { deriveClientPingId } from "@/lib/gps/gps-utils";
import type { GpsBatchRequest, GpsBatchResult } from "@/types/gps-offline";

import { mobileFetch } from "./mobile-fetch";

/**
 * ÉTAPE 28E - foreground GPS, ONLINE only: sends one fix to the SAME endpoint
 * the web runtime's flush uses (POST /api/driver/tour/location/batch, contract
 * in types/gps-offline.ts), authenticated with the mobile session Bearer
 * (ÉTAPE 28A) through mobileFetch - the one place that attaches the token and
 * never logs it.
 *
 * Deliberately NOT queued: a fix that cannot be sent right now (device offline,
 * request failed) is dropped, never stored. The durable GPS queue and its
 * catch-up sync are a later étape.
 *
 * Idempotent: the clientPingId is derived from the fix itself (same helper as
 * the web runtime), so a fix the server already has is a "duplicate", not a
 * second row.
 */
export type GpsSendOutcome =
  | { kind: "synced" }
  | { kind: "unauthorized" }
  | { kind: "rejected" }
  | { kind: "offline" }
  | { kind: "error"; message: string };

export async function sendGpsPoint(params: {
  token: string | null;
  tourId: string;
  position: DriverGpsPosition;
}): Promise<GpsSendOutcome> {
  const { token, tourId, position } = params;
  if (!token) return { kind: "unauthorized" };

  const capturedAtMs = Date.parse(position.recordedAt);
  const clientPingId = deriveClientPingId(
    "w",
    Number.isFinite(capturedAtMs) ? capturedAtMs : Date.now(),
    position.latitude,
    position.longitude,
  );

  const body: GpsBatchRequest = {
    tourId,
    points: [
      {
        clientPingId,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy ?? null,
        speed: position.speed ?? null,
        heading: position.heading ?? null,
        capturedAt: position.recordedAt,
      },
    ],
  };

  const outcome = await mobileFetch<GpsBatchResult>("/api/driver/tour/location/batch", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  switch (outcome.kind) {
    case "ok": {
      // processedIds is the server's "final decision" list and ALSO holds
      // points it rejected (bad timestamp, implausible jump...). Only a point
      // it actually stored - or already had - counts as synchronised.
      const result = outcome.data;
      if (!result?.processedIds?.includes(clientPingId)) {
        return { kind: "error", message: "Position non confirmee par le serveur." };
      }
      return result.accepted + result.duplicates > 0 ? { kind: "synced" } : { kind: "rejected" };
    }
    case "unauthorized":
      return { kind: "unauthorized" };
    case "network_error":
      return { kind: "offline" };
    case "server_error":
      return { kind: "error", message: outcome.message };
  }
}
