import { NextResponse } from "next/server";

import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { lockDashboard } from "@/lib/server/dashboard-security";
import {
  DASHBOARD_SECURITY_NO_STORE,
  clearDashboardGrantCookie,
  dashboardSecurityErrorResponse,
} from "@/lib/server/dashboard-security-http";
import { rejectDisabledModule } from "@/lib/server/module-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/dashboard/security/lock - leaving the dashboard: deletes this session's grant (and clears the
 * cookie) so the next visit asks the password again. Harmless when the security is off.
 */
export async function POST(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    await lockDashboard();
    const response = NextResponse.json({ ok: true }, { headers: DASHBOARD_SECURITY_NO_STORE });
    clearDashboardGrantCookie(response);
    return response;
  } catch (error) {
    return dashboardSecurityErrorResponse(error, "Impossible de verrouiller le dashboard.");
  }
}
