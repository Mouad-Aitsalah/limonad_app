import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getDriverSaleById } from "@/lib/server/driver-sales";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * CORRECTION BUG-03 "TICKET OFF-* → VENTE OFFICIELLE": now also called
 * cross-origin by the driver shell (see mobile/driver's fetchDriverSaleById)
 * right after an offline sale syncs, to fetch the full official Sale
 * (payments/lines/stampAmount/...) for the ticket - same CORS wiring as
 * every other driver-facing route the shell calls. GET carries no CSRF
 * exposure (rejectUntrustedOrigin only ever guards mutating methods), so
 * nothing else changes here.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return withMobileCors(request, NextResponse.json({ sale: await getDriverSaleById(id) }));
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(request, NextResponse.json({ message: "Impossible de charger la vente." }, { status: 500 }));
  }
}
