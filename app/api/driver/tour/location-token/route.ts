import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { issueDriverTrackingToken } from "@/lib/server/driver-tour";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

/**
 * Mints the bearer token the Capacitor driver app hands to
 * @capgo/background-geolocation for native background GPS POSTs. Requires
 * the driver's normal (cookie) session - the token itself is what carries
 * authority afterwards, once the WebView may no longer be alive to supply
 * that cookie.
 */
export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const { token, expiresAt, tourId } = await issueDriverTrackingToken();
    return NextResponse.json({ token, expiresAt, tourId });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de generer le jeton de suivi GPS." },
      { status: 500 },
    );
  }
}
