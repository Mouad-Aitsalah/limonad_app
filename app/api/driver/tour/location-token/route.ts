import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { issueDriverTrackingToken } from "@/lib/server/driver-tour";
import { rejectUntrustedCookieOrigin } from "@/lib/server/csrf";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

/**
 * Mints the bearer token the Capacitor driver app hands to
 * @capgo/background-geolocation for native background GPS POSTs. Requires
 * the driver's normal session - the token itself is what carries authority
 * afterwards, once the WebView may no longer be alive to supply that session.
 *
 * ÉTAPE 28A - the session may now be the mobile shell's Bearer session as
 * well as the web cookie (issueDriverTrackingToken -> requireDriverUser ->
 * getCurrentSessionUser resolves either, unchanged): Bearer/CORS added, the
 * cookie-CSRF check is unchanged for every request without a Bearer header.
 * The token's own logic (claims, secret, 16 h TTL) is untouched.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedCookieOrigin(request);
  if (csrfRejection) return withMobileCors(request, csrfRejection);
  try {
    const { token, expiresAt, tourId } = await issueDriverTrackingToken();
    return withMobileCors(request, NextResponse.json({ token, expiresAt, tourId }));
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de generer le jeton de suivi GPS." }, { status: 500 }),
    );
  }
}
