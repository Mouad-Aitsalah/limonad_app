import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getSalesForDriverByTour } from "@/lib/server/driver-sales";

type RouteContext = { params: Promise<{ tourId: string }> };

export async function GET(_request: Request, context: RouteContext) {
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
