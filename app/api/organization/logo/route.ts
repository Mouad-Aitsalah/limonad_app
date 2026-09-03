import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { updateCurrentOrganizationLogo } from "@/lib/server/organization-identity";

/**
 * PUT /api/organization/logo
 * Body: { logoDataUrl: string | null }. Admin only. The data URL is
 * validated (PNG/JPG/WEBP, size cap) server-side; null clears the logo.
 */
export async function PUT(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = (await request.json().catch(() => ({}))) as { logoDataUrl?: unknown };
    const logoDataUrl =
      typeof body.logoDataUrl === "string" ? body.logoDataUrl : null;
    const identity = await updateCurrentOrganizationLogo(logoDataUrl);
    return NextResponse.json({ identity });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { message: "Impossible d'enregistrer le logo." },
      { status: 500 },
    );
  }
}
