import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { listPendingDriverSales } from "@/lib/server/pending-sales";
import { rejectDisabledModule } from "@/lib/server/module-guard";

/**
 * GET /api/driver/sales/pending
 * Driver POS "Factures du jour" - the not-yet-collected sales (status DRAFT)
 * of the current day for the signed-in driver.
 */
export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    return NextResponse.json({ sales: await listPendingDriverSales() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger les factures du jour." },
      { status: 500 },
    );
  }
}
