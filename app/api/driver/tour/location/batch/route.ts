import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedCookieOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import {
  recordCurrentDriverLocationBatch,
  recordDriverLocationBatchForDriver,
} from "@/lib/server/driver-tour";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";
import { reportUnexpected } from "@/lib/server/report-error";
import { verifyTrackingToken } from "@/lib/server/tracking-token";

/**
 * Phase 5B - GPS offline catch-up. Receives a batch of GPS fixes the phone
 * queued locally (typically while the network was down) and stores the valid
 * ones idempotently. Three auth contexts, told apart by the request itself:
 *
 *  - Native background (WebView may be suspended): a signed
 *    `Authorization: Bearer <tracking token>` header. driver / tour /
 *    organization come ONLY from the verified token, never the body.
 *  - ÉTAPE 28A - mobile shell foreground: `Authorization: Bearer <session
 *    token>` (the same Bearer session every other /api/driver/* route the
 *    shell calls uses). Resolved by recordCurrentDriverLocationBatch ->
 *    requireDriverUser -> getCurrentSessionUser, exactly like the cookie path.
 *  - Web / foreground: the normal driver session cookie (+ CSRF origin
 *    check). No token needed.
 *
 * Telling the two Bearer kinds apart: a tracking token is
 * `<base64url payload>.<base64url signature>` (lib/server/tracking-token.ts)
 * and ALWAYS contains a "." - a session token is a plain base64url string
 * (randomBytes(...).toString("base64url"), lib/server/auth.ts) and NEVER does,
 * since "." is not in the base64url alphabet. The two therefore never overlap,
 * and each is validated ONLY by its own mechanism: a dotted token is verified
 * as a tracking token (invalid -> 401, never retried as a session), a dotless
 * one is looked up as a session (invalid -> 401, never tried as a tracking
 * token). The two are also signed/hashed with unrelated secrets, so neither
 * can stand in for the other.
 *
 * The server re-derives the active tour and requires it to be IN_PROGRESS
 * and to belong to this exact driver/organization. Cross-tenant is
 * impossible - organizationId is never taken from the request.
 *
 * Response: { accepted, duplicates, rejected, processedIds }. The phone
 * removes only `processedIds` from its queue; on any non-2xx it keeps the
 * whole queue and retries later with backoff.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function POST(request: Request) {
  try {
    const bearer = extractBearerToken(request);

    if (bearer && isTrackingTokenShape(bearer)) {
      const claims = verifyTrackingToken(bearer);
      if (!claims) {
        return withMobileCors(
          request,
          NextResponse.json({ message: "Jeton de suivi invalide ou expire." }, { status: 401 }),
        );
      }
      const body = await request.json();
      const result = await recordDriverLocationBatchForDriver(
        claims.organizationId,
        claims.driverId,
        body,
        { expectedTourId: claims.tourId },
      );
      return withMobileCors(request, NextResponse.json(result));
    }

    // Session-authenticated from here on: a Bearer session (the shell - no
    // ambient cookie, so the cookie-CSRF check does not apply) or the web
    // cookie (CSRF check unchanged).
    const csrfRejection = rejectUntrustedCookieOrigin(request);
    if (csrfRejection) return withMobileCors(request, csrfRejection);

    const body = await request.json();
    const result = await recordCurrentDriverLocationBatch(body);
    return withMobileCors(request, NextResponse.json(result));
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/driver/tour/location/batch",
      area: "driver-tours",
      op: "recordLocationBatch",
    });
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible d'enregistrer le lot de positions GPS." }, { status: 500 }),
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

/** Tracking tokens are `<payload>.<signature>`; session tokens never contain
 *  a "." (base64url alphabet). See this route's own doc comment. */
function isTrackingTokenShape(token: string): boolean {
  return token.includes(".");
}
