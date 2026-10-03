import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getOrganizationConnections } from "@/lib/server/organization-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * SUPER_ADMIN only: live connected-devices counts of one organization
 * (polled by the "Detail organisation" page). Auth, role and organization
 * scoping are enforced inside getOrganizationConnections.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const connections = await getOrganizationConnections(id);
    return NextResponse.json({ connections }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      { message: "Impossible de charger les connexions." },
      { status: 500, headers: NO_STORE },
    );
  }
}
