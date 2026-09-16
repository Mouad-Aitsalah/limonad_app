import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  createCustomerForCurrentDriver,
  getCustomersForCurrentDriver,
} from "@/lib/server/driver-customers";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";
import { reportUnexpected } from "@/lib/server/report-error";

/**
 * CORRECTION "CACHE COMPLET CLIENTS CHAUFFEUR": GET is now also called
 * cross-origin by the driver shell (see mobile/driver/src/lib/driver-pos-
 * data-source.ts's refreshFullDriverCustomerCache) to refresh cached_
 * customers with every customer this driver is allowed to see - not just
 * GET /api/driver/pos's small, bounded preload. Same CORS wiring as
 * app/api/driver/pos/route.ts. POST (used only by the web app's own
 * same-origin /driver/clients today) is left untouched - the shell does not
 * call it, so it keeps its existing cookie/CSRF-only protection.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  try {
    return withMobileCors(request, NextResponse.json({ customers: await getCustomersForCurrentDriver() }));
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    reportUnexpected(error, { route: "GET /api/driver/customers", area: "driver" });
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de charger les clients." }, { status: 500 }),
    );
  }
}

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json();
    return NextResponse.json(
      { customer: await createCustomerForCurrentDriver(body, body.id) },
      { status: body.id ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    return NextResponse.json({ message: "Impossible d'enregistrer le client." }, { status: 500 });
  }
}
