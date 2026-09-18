import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getCurrentDriverTruckStock } from "@/lib/server/driver-stock";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

/**
 * ÉTAPE 23 - no endpoint previously existed for /driver/stock (the web page
 * calls getCurrentDriverTruckStock() directly, server-side, as a Server
 * Component - see app/driver/stock/page.tsx). This is the minimal Bearer/CORS
 * wrapper the shell needs for its own online fetch, reusing that same
 * function unchanged - same pattern as app/api/driver/customers/list/route.ts
 * and app/api/driver/pos/route.ts. GET is never CSRF-gated, so no other
 * change was needed.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  try {
    const stock = await getCurrentDriverTruckStock();
    return withMobileCors(request, NextResponse.json({ stock }));
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de charger le stock." }, { status: 500 }),
    );
  }
}
