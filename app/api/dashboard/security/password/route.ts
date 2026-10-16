import { NextResponse } from "next/server";

import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { setDashboardPassword } from "@/lib/server/dashboard-security";
import {
  DASHBOARD_SECURITY_NO_STORE,
  dashboardSecurityErrorResponse,
  setDashboardGrantCookie,
} from "@/lib/server/dashboard-security-http";
import { rejectDisabledModule } from "@/lib/server/module-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/dashboard/security/password - body { password, confirmation }. Creates the dashboard password
 * (first access) or renews it (expired). ADMIN of the organisation only (403 otherwise); only possible
 * while the SUPER_ADMIN's security is on and a password is missing or expired (409 otherwise).
 */
export async function POST(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json().catch(() => null);
    const { grantToken, passwordExpiresAt } = await setDashboardPassword(body);
    const response = NextResponse.json({ ok: true, passwordExpiresAt }, { headers: DASHBOARD_SECURITY_NO_STORE });
    setDashboardGrantCookie(response, grantToken);
    return response;
  } catch (error) {
    return dashboardSecurityErrorResponse(error, "Impossible d'enregistrer le mot de passe.");
  }
}
