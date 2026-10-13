import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getCurrentDriverTour } from "@/lib/server/driver-tour";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";
import { rejectDisabledModule } from "@/lib/server/module-guard";

/**
 * ÉTAPE 28A - also called by the mobile driver shell (Bearer, cross-origin).
 * Same CORS treatment as /api/driver/truck and /api/driver/stock; the web
 * app's cookie-authenticated calls are unchanged (withMobileCors only adds a
 * header for an allowlisted Origin, which the web app's own requests never
 * carry cross-site).
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return withMobileCors(request, moduleRejection);
  try {
    return withMobileCors(request, NextResponse.json({ currentTour: await getCurrentDriverTour() }));
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de charger la tournee chauffeur." }, { status: 500 }),
    );
  }
}
