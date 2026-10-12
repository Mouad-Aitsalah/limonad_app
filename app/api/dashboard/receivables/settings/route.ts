import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { updateReceivablesSettings } from "@/lib/server/receivables";
import { ReceivablesError } from "@/lib/server/receivables-core";

/**
 * PUT /api/dashboard/receivables/settings
 * Body: { overdueDays: number } (whole days, 1-365). Admin only (403 otherwise),
 * the caller's own organisation only. Audited.
 */
export async function PUT(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json().catch(() => null);
    return NextResponse.json({ settings: await updateReceivablesSettings(body) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof ReceivablesError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message, fieldErrors: error.fieldErrors }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible d'enregistrer le délai de retard." }, { status: 500 });
  }
}
