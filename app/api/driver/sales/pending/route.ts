import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { listPendingDriverSales } from "@/lib/server/pending-sales";

/**
 * GET /api/driver/sales/pending
 * Driver POS "Factures du jour" - the not-yet-collected sales (status DRAFT)
 * of the current day for the signed-in driver.
 */
export async function GET() {
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
