import { NextResponse } from "next/server";

import { OperationsServiceError } from "@/lib/server/depots";
import { getTruckStock } from "@/lib/server/stock-levels";
import { rejectDisabledModule } from "@/lib/server/module-guard";

type RouteContext = { params: Promise<{ truckId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const { truckId } = await context.params;
  try {
    return NextResponse.json({ levels: await getTruckStock(truckId) });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger le stock camion." },
      { status: 500 },
    );
  }
}
