import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { createDriverSale, getSalesForCurrentDriver } from "@/lib/server/driver-sales";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

/**
 * INTÉGRATION POS SHELL - also called by the mobile driver shell (Bearer,
 * cross-origin) for its ONLINE "Valider"/"Préparer" path - the offline CASH
 * path never calls this at all (see createOfflineSale). Same CORS treatment
 * as /api/driver/pos and /api/organization/identity.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  try {
    return withMobileCors(request, NextResponse.json({ sales: await getSalesForCurrentDriver() }));
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(request, NextResponse.json({ message: "Impossible de charger les ventes." }, { status: 500 }));
  }
}

export async function POST(request: Request) {
  // A Bearer-authenticated request (the shell) carries no ambient cookie -
  // nothing for a forged cross-site request to exploit, so the cookie-CSRF
  // check does not apply to it (same reasoning as /api/mobile/auth/login).
  // The web app never sends an Authorization header, so this is purely
  // additive: its CSRF protection is completely unchanged.
  const hasBearer = (request.headers.get("authorization") ?? "").toLowerCase().startsWith("bearer ");
  if (!hasBearer) {
    const csrfRejection = rejectUntrustedOrigin(request);
    if (csrfRejection) return csrfRejection;
  }
  try {
    const body = await request.json();
    const collectNow = body?.collectNow !== false;
    return withMobileCors(
      request,
      NextResponse.json({ sale: await createDriverSale(body, { collectNow }) }, { status: 201 }),
    );
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    if (error instanceof OperationsServiceError) {
      return withMobileCors(
        request,
        NextResponse.json({ message: error.message, fieldErrors: error.fieldErrors }, { status: error.status }),
      );
    }
    return withMobileCors(request, NextResponse.json({ message: "Impossible de valider la vente." }, { status: 500 }));
  }
}
