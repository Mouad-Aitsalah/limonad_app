import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedCookieOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { createQuickCustomerForCurrentDriver } from "@/lib/server/driver-customers";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";
import { reportUnexpected } from "@/lib/server/report-error";

/**
 * POST /api/driver/customers/quick
 *
 * "Ajout rapide client" from the driver GPS/tournée screen: body is just
 * `{ name, latitude, longitude, locationAccuracy? }`. organizationId /
 * driverId / truckId / createdByUserId / code are all derived server-side
 * from the authenticated driver session (never trusted from the body).
 *
 * Mobile shell (same pattern as the other /api/driver/* routes opened in
 * ÉTAPE 28A): CORS for the Capacitor origin, and the cookie-CSRF origin check
 * is skipped ONLY for a request carrying `Authorization: Bearer` (there is no
 * ambient credential a cross-site page could ride on) - the session is still
 * resolved from that Bearer by the same createQuickCustomerForCurrentDriver
 * -> requireDriverUser -> getCurrentSessionUser path the web cookie uses.
 * The web behavior (cookie + CSRF check) is unchanged.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedCookieOrigin(request);
  if (csrfRejection) return withMobileCors(request, csrfRejection);
  try {
    const body = await request.json();
    return withMobileCors(
      request,
      NextResponse.json(
        { customer: await createQuickCustomerForCurrentDriver(body) },
        { status: 201 },
      ),
    );
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    if (error instanceof OperationsServiceError) {
      return withMobileCors(
        request,
        NextResponse.json(
          { message: error.message, fieldErrors: error.fieldErrors },
          { status: error.status },
        ),
      );
    }
    reportUnexpected(error, { route: "POST /api/driver/customers/quick", area: "driver" });
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible d'enregistrer le client." }, { status: 500 }),
    );
  }
}
