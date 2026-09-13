import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getDriverPosContext } from "@/lib/server/driver-sales";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

// PHASE 5A.1 - "13. TEST API MOBILE": this is the "route simple driver
// protégée" the shell calls with its Bearer token to prove end-to-end auth.
// getDriverPosContext() -> requireOrganizationUser() -> requireSessionUser()
// -> getCurrentSessionUser() already accepts a Bearer token unchanged (see
// lib/server/auth.ts's resolveSessionToken) - the only addition here is CORS,
// since the shell's origin is cross-site to this API.
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const customerId = url.searchParams.get("customerId");
    return withMobileCors(request, NextResponse.json({ context: await getDriverPosContext(customerId) }));
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(request, NextResponse.json({ message: "Impossible de charger le POS." }, { status: 500 }));
  }
}
