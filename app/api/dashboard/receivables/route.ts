import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getReceivablesOverview } from "@/lib/server/receivables";
import { ReceivablesError } from "@/lib/server/receivables-core";
import { rejectDisabledModule } from "@/lib/server/module-guard";

/**
 * GET /api/dashboard/receivables - Dashboard « Créances clients ».
 * Admin only (401 / 403 otherwise), the caller's own organisation only. Read only.
 */
export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    return NextResponse.json(await getReceivablesOverview(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof ReceivablesError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger les créances clients." }, { status: 500 });
  }
}
