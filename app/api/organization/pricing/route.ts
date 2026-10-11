import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { updatePricingSettings } from "@/lib/server/organization-settings";

/**
 * PUT /api/organization/pricing
 * Body: { quantityPricingEnabled: boolean }. Admin only (403 otherwise),
 * the caller's own organisation only. Audited.
 */
export async function PUT(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json().catch(() => null);
    return NextResponse.json({ settings: await updatePricingSettings(body) });
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
      { message: "Impossible d'enregistrer le réglage de tarification." },
      { status: 500 },
    );
  }
}
