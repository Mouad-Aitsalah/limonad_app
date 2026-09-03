import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getCurrentOrganizationIdentity } from "@/lib/server/organization-identity";

/**
 * GET /api/organization/identity
 * The current organisation's name + logo, for the sidebar and the sales
 * ticket. Any authenticated member; scoped to their own organisation.
 */
export async function GET() {
  try {
    return NextResponse.json({ identity: await getCurrentOrganizationIdentity() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger l'identité de l'entreprise." },
      { status: 500 },
    );
  }
}
