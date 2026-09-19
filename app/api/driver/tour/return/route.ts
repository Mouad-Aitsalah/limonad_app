import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { markCurrentDriverTourReturned } from "@/lib/server/tours";
import { rejectUntrustedCookieOrigin } from "@/lib/server/csrf";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";
import { reportUnexpected } from "@/lib/server/report-error";

// ÉTAPE 28A - Bearer/CORS for the mobile shell; the cookie-CSRF check is
// unchanged for every request without a Bearer header (see
// rejectUntrustedCookieOrigin's own doc comment).
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedCookieOrigin(request);
  if (csrfRejection) return withMobileCors(request, csrfRejection);
  try {
    return withMobileCors(request, NextResponse.json({ tour: await markCurrentDriverTourReturned() }));
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/driver/tour/return",
      area: "driver-tours",
      op: "returnTour",
    });
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible d'enregistrer le retour." }, { status: 500 }),
    );
  }
}
