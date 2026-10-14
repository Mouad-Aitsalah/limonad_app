import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { dailyParamsFromSearchParams, getDailySalesGrouping } from "@/lib/server/daily-invoices";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectDisabledModule } from "@/lib/server/module-guard";

// « Regroupement des ventes » of /ventes/journalieres. Read-only; the same filters
// (day, users, payment method) and the same roles as GET /api/daily-invoices. The
// margin fields are only present for a role allowed to see them (admin).
export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    const url = new URL(request.url);
    const grouping = await getDailySalesGrouping(dailyParamsFromSearchParams(url.searchParams));
    return NextResponse.json(grouping);
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger le regroupement des ventes." },
      { status: 500 },
    );
  }
}
