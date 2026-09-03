import { NextResponse } from "next/server";

import { deriveClientPingId } from "@/lib/gps/gps-utils";
import { OperationsServiceError } from "@/lib/server/depots";
import { recordDriverLocationForDriver } from "@/lib/server/driver-tour";
import { verifyTrackingToken } from "@/lib/server/tracking-token";

/**
 * Receives GPS points POSTed directly by native code (Android/iOS), via
 * @capgo/background-geolocation's `url` option in BackgroundGeolocation.start()
 * - not by a fetch() from the app's JavaScript. This is what keeps working
 * once the WebView is suspended (backgrounded, screen locked, another app
 * open): no cookie, no running JS, just a plain HTTPS POST from the OS.
 *
 * Authenticated with a short-lived signed bearer token (see
 * lib/server/tracking-token.ts), never the session cookie. driverId /
 * organizationId / tourId are read ONLY from that verified token - never
 * from the request body, which is client-controlled and could be forged by
 * a compromised device. recordDriverLocationForDriver then re-verifies the
 * tour is still active for that exact driver/organization before writing
 * anything, so a stale or cross-tenant token can never land a point in the
 * wrong tour.
 */
export async function POST(request: Request) {
  try {
    const token = extractBearerToken(request);
    if (!token) {
      return NextResponse.json({ message: "Jeton de suivi manquant." }, { status: 401 });
    }

    const claims = verifyTrackingToken(token);
    if (!claims) {
      return NextResponse.json({ message: "Jeton de suivi invalide ou expire." }, { status: 401 });
    }

    const body = await request.json();
    // @capgo/background-geolocation's native POST body: latitude, longitude,
    // accuracy, altitude, altitudeAccuracy, simulated, bearing, speed, time,
    // plus "source": "native". Only the fields the existing GPS pipeline
    // already understands are forwarded - altitude/simulated are accepted
    // (the request is never rejected for carrying them) but intentionally
    // not persisted, since TourLocationPing has no column for them and none
    // was requested.
    // Phase 5B: derive the SAME deterministic clientPingId the JS offline
    // queue derives for this native fix (see deriveClientPingId), so the
    // plugin's native POST and a later offline-queue batch converge on one
    // (tourId, clientPingId) row instead of writing the point twice.
    const capturedAtMs = typeof body?.time === "number" ? body.time : Date.now();
    const clientPingId =
      typeof body?.latitude === "number" && typeof body?.longitude === "number"
        ? deriveClientPingId("n", capturedAtMs, body.latitude, body.longitude)
        : undefined;

    const input = {
      latitude: body?.latitude,
      longitude: body?.longitude,
      accuracy: body?.accuracy ?? null,
      speed: body?.speed ?? null,
      heading: body?.bearing ?? null,
      recordedAt: typeof body?.time === "number" ? new Date(body.time) : undefined,
      clientPingId,
    };

    const { point } = await recordDriverLocationForDriver(
      claims.organizationId,
      claims.driverId,
      input,
      { expectedTourId: claims.tourId },
    );

    return NextResponse.json({ ok: true, point });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible d'enregistrer la position GPS native." },
      { status: 500 },
    );
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}
