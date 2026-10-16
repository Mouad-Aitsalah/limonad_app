import { NextResponse } from "next/server";

import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { resetOrganizationDashboardPassword } from "@/lib/server/dashboard-security";
import { DASHBOARD_SECURITY_NO_STORE, dashboardSecurityErrorResponse } from "@/lib/server/dashboard-security-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/organizations/[id]/dashboard-security/reset - « Réinitialiser le mot de passe dashboard ».
 * SUPER_ADMIN only. The old password stops working at once, every temporary authorization of this
 * organisation is deleted and the admin must create a new password at the next access.
 */
export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const { id } = await context.params;
    return NextResponse.json(await resetOrganizationDashboardPassword(id), { headers: DASHBOARD_SECURITY_NO_STORE });
  } catch (error) {
    return dashboardSecurityErrorResponse(error, "Impossible de réinitialiser le mot de passe dashboard.");
  }
}
