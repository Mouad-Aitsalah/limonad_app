import { NextResponse } from "next/server";

import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { getOrganizationDashboardSecurity, updateOrganizationDashboardSecurity } from "@/lib/server/dashboard-security";
import { DASHBOARD_SECURITY_NO_STORE, dashboardSecurityErrorResponse } from "@/lib/server/dashboard-security-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/organizations/[id]/dashboard-security - the dashboard security settings of ONE organisation
 * (never the password nor its hash). PUT - body { enabled, renewalEnabled, renewalPeriod }.
 * SUPER_ADMIN only (enforced in lib/server/dashboard-security.ts, 401/403 otherwise), CSRF-checked on PUT.
 * Only the organisation of the URL is touched.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getOrganizationDashboardSecurity(id), { headers: DASHBOARD_SECURITY_NO_STORE });
  } catch (error) {
    return dashboardSecurityErrorResponse(error, "Impossible de charger la sécurité du dashboard.");
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    return NextResponse.json(await updateOrganizationDashboardSecurity(id, body), { headers: DASHBOARD_SECURITY_NO_STORE });
  } catch (error) {
    return dashboardSecurityErrorResponse(error, "Impossible d'enregistrer la sécurité du dashboard.");
  }
}
