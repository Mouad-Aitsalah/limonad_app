import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getSalesForDriverByTour } from "@/lib/server/driver-sales";
import { rejectDisabledModule } from "@/lib/server/module-guard";

type RouteContext = { params: Promise<{ tourId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const { tourId } = await context.params;
  try {
    return NextResponse.json({ sales: await getSalesForDriverByTour(tourId) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger les ventes." }, { status: 500 });
  }
}
