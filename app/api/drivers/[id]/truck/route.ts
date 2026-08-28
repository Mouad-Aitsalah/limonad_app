import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { assignTruckToDriver } from "@/lib/server/drivers";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    const truckId =
      typeof body?.truckId === "string" && body.truckId.length > 0
        ? body.truckId
        : null;
    const driver = await assignTruckToDriver(id, truckId);
    return NextResponse.json({ driver });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { message: "Impossible d'affecter le camion." },
      { status: 500 },
    );
  }
}
