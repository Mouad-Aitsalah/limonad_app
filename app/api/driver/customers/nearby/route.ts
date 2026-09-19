import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getDriverProximityCustomers } from "@/lib/server/driver-customers";
import { OperationsServiceError } from "@/lib/server/depots";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

/**
 * Phase 3 CRITICAL #2 fix (included extra): bounded companion to
 * GET /api/driver/customers, used only by the runtime GPS-proximity feed
 * (hooks/use-driver-runtime.tsx) - see getDriverProximityCustomers's doc
 * comment in lib/server/driver-customers.ts. /driver/clients keeps using
 * GET /api/driver/customers unchanged.
 *
 * ÉTAPE 28A - Bearer/CORS for the mobile shell (same treatment as
 * /api/driver/customers); getDriverProximityCustomers already authenticates
 * through requireOrganizationUser, which resolves a Bearer session.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  try {
    return withMobileCors(request, NextResponse.json({ customers: await getDriverProximityCustomers() }));
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de charger les clients proches." }, { status: 500 }),
    );
  }
}
