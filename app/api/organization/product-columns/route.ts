import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { updateProductColumnSettings } from "@/lib/server/organization-settings";

/**
 * PUT /api/organization/product-columns
 * Body: { columns: { [columnKey]: boolean } } (see lib/product-columns.ts).
 * Admin only (403 otherwise), the caller's own organisation only. Display
 * only - no product data is touched. Audited.
 */
export async function PUT(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json().catch(() => null);
    return NextResponse.json(await updateProductColumnSettings(body));
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible d'enregistrer les colonnes." },
      { status: 500 },
    );
  }
}
