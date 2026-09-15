import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";
import { getCurrentOrganizationIdentity } from "@/lib/server/organization-identity";

/**
 * GET /api/organization/identity
 * The current organisation's name + logo, for the sidebar and the sales
 * ticket. Any authenticated member; scoped to their own organisation.
 *
 * PHASE 5A.5 (CORRECTION CONTEXTE OFFLINE) - also called by the mobile
 * driver shell (Bearer, cross-origin) to get organizationName for
 * offline_context, since it is not part of DriverPosContextDto (see
 * mobile/driver/src/lib/refresh-offline-context.ts) - same CORS treatment
 * as /api/driver/pos, nothing else about this route changes.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  try {
    return withMobileCors(
      request,
      NextResponse.json({ identity: await getCurrentOrganizationIdentity() }),
    );
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de charger l'identité de l'entreprise." }, { status: 500 }),
    );
  }
}
