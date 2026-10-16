import { NextResponse } from "next/server";

import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { unlockDashboard } from "@/lib/server/dashboard-security";
import {
  DASHBOARD_SECURITY_NO_STORE,
  dashboardSecurityErrorResponse,
  setDashboardGrantCookie,
} from "@/lib/server/dashboard-security-http";
import { rejectDisabledModule } from "@/lib/server/module-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/dashboard/security/unlock - body { password }. Validates the dashboard password of the
 * caller's own organisation (the organisation always comes from the session) and, only on success,
 * sets the httpOnly grant cookie. Wrong passwords are rate limited and answered generically.
 */
export async function POST(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json().catch(() => null);
    const { grantToken } = await unlockDashboard(body);
    const response = NextResponse.json({ ok: true }, { headers: DASHBOARD_SECURITY_NO_STORE });
    setDashboardGrantCookie(response, grantToken);
    return response;
  } catch (error) {
    return dashboardSecurityErrorResponse(error, "Impossible de vérifier le mot de passe.");
  }
}
