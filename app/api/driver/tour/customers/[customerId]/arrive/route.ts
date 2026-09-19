import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { confirmCurrentDriverArrival } from "@/lib/server/driver-tour";
import { rejectUntrustedCookieOrigin } from "@/lib/server/csrf";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

// ÉTAPE 28A - Bearer/CORS for the mobile shell; the cookie-CSRF check is
// unchanged for every request without a Bearer header (see
// rejectUntrustedCookieOrigin's own doc comment).
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  const csrfRejection = rejectUntrustedCookieOrigin(request);
  if (csrfRejection) return withMobileCors(request, csrfRejection);
  try {
    const { customerId } = await context.params;

    return withMobileCors(
      request,
      NextResponse.json({
        currentTour: await confirmCurrentDriverArrival(customerId),
      }),
    );
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }

    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de confirmer l'arrivee chez le client." }, { status: 500 }),
    );
  }
}
