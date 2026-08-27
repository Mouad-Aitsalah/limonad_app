import { NextResponse } from "next/server";

import { OperationsServiceError } from "@/lib/server/depots";
import { getStockLocationById } from "@/lib/server/stock-locations";
import { getStockLevelsByLocation } from "@/lib/server/stock-levels";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const [location, levels] = await Promise.all([
      getStockLocationById(id),
      getStockLevelsByLocation(id),
    ]);
    return NextResponse.json({ location, levels });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger l'emplacement." },
      { status: 500 },
    );
  }
}
