import { NextResponse } from "next/server";

import { AnalysisFilterError, parseSalesFilters } from "@/lib/commercial-analysis/filters";
import { AuthServiceError } from "@/lib/server/auth";
import { getSalesAnalysis } from "@/lib/server/commercial-analysis";

/**
 * GET /api/dashboard/sales-analysis?driverId&month&supplierId&metric&sort&direction
 * Dashboard « Analyse des ventes ». ADMIN ONLY (401 / 403 enforced in
 * getSalesAnalysis), the caller's own organisation only, read only. Every
 * filter is validated: an invalid value is a 422, never silently replaced.
 */
export async function GET(request: Request) {
  try {
    const filters = parseSalesFilters(new URL(request.url).searchParams);
    return NextResponse.json(await getSalesAnalysis(filters), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof AnalysisFilterError) {
      return NextResponse.json({ message: error.message, field: error.field }, { status: 422 });
    }
    return NextResponse.json({ message: "Impossible de charger l'analyse des ventes." }, { status: 500 });
  }
}
