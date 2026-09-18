import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getTodaySalesForCurrentDriver } from "@/lib/server/driver-sales";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

/**
 * ÉTAPE 25D - no endpoint previously existed returning exactly
 * DriverTodaySalesDto (day + stats + today's sales only, business-day
 * scoped) over CORS - GET /api/driver/sales (getSalesForCurrentDriver)
 * returns a different, unbounded shape. Minimal Bearer/CORS wrapper reusing
 * getTodaySalesForCurrentDriver() unchanged, same pattern as
 * app/api/driver/stock/route.ts. GET is never CSRF-gated, so no other
 * change was needed.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  try {
    const data = await getTodaySalesForCurrentDriver();
    return withMobileCors(request, NextResponse.json(data));
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de charger les ventes du jour." }, { status: 500 }),
    );
  }
}
