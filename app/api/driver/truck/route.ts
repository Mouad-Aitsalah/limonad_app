import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getCurrentDriverTruck } from "@/lib/server/drivers";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

/**
 * GET /api/driver/truck
 * ÉTAPE 19 - the Bearer-reachable sibling of getCurrentDriverTruck(), until
 * now only ever called directly from app/driver/page.tsx's own Server
 * Component (see that function's own doc comment). The Android shell's
 * Accueil needs the same "Mon camion" data over HTTP since it has no Server
 * Component of its own - same function, zero new business logic, same CORS
 * pattern as every other shell-reachable /api/driver/* route (see
 * lib/server/mobile-cors.ts's own doc comment).
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  try {
    return withMobileCors(request, NextResponse.json({ truck: await getCurrentDriverTruck() }));
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de charger le camion." }, { status: 500 }),
    );
  }
}
