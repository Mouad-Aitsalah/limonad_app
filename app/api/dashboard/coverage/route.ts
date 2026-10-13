import { NextResponse } from "next/server";

import { AnalysisFilterError, parseCoverageFilters } from "@/lib/commercial-analysis/filters";
import { AuthServiceError } from "@/lib/server/auth";
import { getCoverage } from "@/lib/server/commercial-analysis";
import { rejectDisabledModule } from "@/lib/server/module-guard";

/**
 * GET /api/dashboard/coverage?driverId&week
 * Dashboard « Couverture commerciale » (weekly, Monday -> Sunday). ADMIN ONLY
 * (401 / 403 enforced in getCoverage), the caller's own organisation only, read
 * only. `week` is any valid day (normalised to its Monday); an invalid value is a 422.
 */
export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    const filters = parseCoverageFilters(new URL(request.url).searchParams);
    return NextResponse.json(await getCoverage(filters), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof AnalysisFilterError) {
      return NextResponse.json({ message: error.message, field: error.field }, { status: 422 });
    }
    return NextResponse.json({ message: "Impossible de charger la couverture commerciale." }, { status: 500 });
  }
}
