import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getFleetSnapshot } from "@/lib/server/fleet-tracking";

/**
 * Polled by the admin live fleet map every few seconds. Read-only, and
 * scoped to the caller's own organization entirely server-side (see
 * getFleetSnapshot -> requireOrganizationUser) - the client never supplies
 * an organizationId.
 */
export async function GET() {
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
