import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import {
  recordCurrentDriverLocationBatch,
  recordDriverLocationBatchForDriver,
} from "@/lib/server/driver-tour";
import { reportUnexpected } from "@/lib/server/report-error";
import { verifyTrackingToken } from "@/lib/server/tracking-token";

/**
 * Phase 5B - GPS offline catch-up. Receives a batch of GPS fixes the phone
 * queued locally (typically while the network was down) and stores the valid
 * ones idempotently. Same two auth contexts as the single-point paths:
 *
 *  - Native background (WebView may be suspended): a signed
 *    `Authorization: Bearer <tracking token>` header. driver / tour /
 *    organization come ONLY from the verified token, never the body.
 *  - Web / foreground: the normal driver session cookie (+ CSRF origin
 *    check). No token needed.
 *
 * The server re-derives the active tour and requires it to be IN_PROGRESS
 * and to belong to this exact driver/organization. Cross-tenant is
 * impossible - organizationId is never taken from the request.
 *
 * Response: { accepted, duplicates, rejected, processedIds }. The phone
 * removes only `processedIds` from its queue; on any non-2xx it keeps the
 * whole queue and retries later with backoff.
 */
export async function POST(request: Request) {
  try {
    const bearer = extractBearerToken(request);

    if (bearer) {
      const claims = verifyTrackingToken(bearer);
      if (!claims) {
        return NextResponse.json(
          { message: "Jeton de suivi invalide ou expire." },
          { status: 401 },
        );
      }
      const body = await request.json();
      const result = await recordDriverLocationBatchForDriver(
        claims.organizationId,
        claims.driverId,
        body,
        { expectedTourId: claims.tourId },
      );
      return NextResponse.json(result);
    }

    const csrfRejection = rejectUntrustedOrigin(request);
    if (csrfRejection) return csrfRejection;

    const body = await request.json();
    const result = await recordCurrentDriverLocationBatch(body);
    return NextResponse.json(result);
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/driver/tour/location/batch",
      area: "driver-tours",
      op: "recordLocationBatch",
    });
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible d'enregistrer le lot de positions GPS." },
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
