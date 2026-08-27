import { NextResponse } from "next/server";

import { OperationsServiceError } from "@/lib/server/depots";
import { getDepotStock } from "@/lib/server/stock-levels";

type RouteContext = { params: Promise<{ depotId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { depotId } = await context.params;
  try {
    return NextResponse.json({ levels: await getDepotStock(depotId) });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger le stock depot." },
      { status: 500 },
    );
  }
}
