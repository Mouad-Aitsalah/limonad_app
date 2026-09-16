import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { resolveCustomerByNumber } from "@/lib/server/customers";
import { OperationsServiceError } from "@/lib/server/depots";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

/**
 * GET /api/customers/by-number?n=15
 *
 * POS "N° client" box: resolves a short number ("1", "15", "125"), a full
 * "3421/15" or a raw "342115" to the one customer it can be, scoped to the
 * caller's organisation (and driver visibility for a driver session). A
 * number that doesn't exist here returns a clean 404, never a 500.
 *
 * CORRECTION "RECHERCHE IMPOSSIBLE MALGRÉ CONNECTÉ": same CORS gap as
 * /api/customers/search - see that route's doc comment. Same
 * OPTIONS/withMobileCors wiring, never a wildcard origin.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  const n = new URL(request.url).searchParams.get("n") ?? "";
  try {
    const customer = await resolveCustomerByNumber(n);
    if (!customer) {
      return withMobileCors(request, NextResponse.json({ message: "Client introuvable." }, { status: 404 }));
    }
    return withMobileCors(request, NextResponse.json({ customer }));
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de rechercher le client." }, { status: 500 }),
    );
  }
}
