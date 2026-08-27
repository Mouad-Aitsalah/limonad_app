import { NextResponse } from "next/server";

import { getDepotById, OperationsServiceError } from "@/lib/server/depots";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ depot: await getDepotById(id) });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger le depot." },
      { status: 500 },
    );
  }
}
