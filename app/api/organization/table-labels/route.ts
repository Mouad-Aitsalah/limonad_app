import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { updateTablePageLabels } from "@/lib/server/organization-settings";

/**
 * PUT /api/organization/table-labels
 * Body: { page: "<page key>", labels: { [table]: { [column]: "label" } } }
 * Replaces the custom column labels of ONE page (see lib/table-labels).
 * Admin only (403 otherwise), the caller's own organisation only. Display
 * only - no column, property or database name changes. Audited.
 */
export async function PUT(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json().catch(() => null);
    return NextResponse.json({ labels: await updateTablePageLabels(body) });
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
      { message: "Impossible d'enregistrer les intitulés." },
      { status: 500 },
    );
  }
}
