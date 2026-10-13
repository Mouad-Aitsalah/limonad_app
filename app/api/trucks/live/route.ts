import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getFleetSnapshot } from "@/lib/server/fleet-tracking";
import { rejectDisabledModule } from "@/lib/server/module-guard";

/**
 * Polled by the admin live fleet map every few seconds. Read-only, and
 * scoped to the caller's own organization entirely server-side (see
 * getFleetSnapshot -> requireOrganizationUser) - the client never supplies
 * an organizationId.
 */
export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    return NextResponse.json(await getFleetSnapshot());
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger le suivi GPS en direct." },
      { status: 500 },
    );
  }
}
