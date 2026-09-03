import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { listPendingCounterSales } from "@/lib/server/pending-sales";

/**
 * GET /api/sales/pending
 * Counter POS "Factures du jour" - the not-yet-collected sales (status
 * DRAFT) of the current day for the caller's depot / organisation.
 */
export async function GET() {
  try {
    return NextResponse.json({ sales: await listPendingCounterSales() });
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
